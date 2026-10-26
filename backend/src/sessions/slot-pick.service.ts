import { Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import type {
  SlotPickResponse,
  Session as SharedSession,
} from "@zenflow/shared";
import { SchedulingModel, type User } from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import { PAIRWISE_KEEP_PREFERENCE_WEIGHT } from "../scheduler/constants";
import { SchedulingFeedbackService } from "../scheduler/io/scheduling-feedback.service";
import { WITH_SERIES } from "./types/session-row";
import { toSessionDto } from "./session-mapper";
import { moveEventData, recordUserMove } from "./session-events";
import { SlotPickDto } from "./dto/slot-pick.dto";
import { schedulerSlotPicks } from "../observability/metrics";

/** The session after an alternative was applied, with its undo group (absent when it was already there). */
interface AppliedAlternative {
  session: SharedSession;
  undoGroupId?: string;
}

type LoadedProposal = {
  id: string;
  primaryPolicy: SchedulingModel;
  heuristicProposal: unknown;
  modelProposal: unknown;
  pairwiseShown: boolean;
  chosenByUser: SchedulingModel | null;
  firstModifiedAt: Date | null;
};

type PairwiseProposal = Pick<
  LoadedProposal,
  "primaryPolicy" | "heuristicProposal" | "modelProposal" | "pairwiseShown"
>;

/** The other algorithm's raw pick, present only when the event was pairwise-sampled. */
export function alternativeStartOf(proposal: PairwiseProposal): Date | null {
  if (!proposal.pairwiseShown) return null;
  const source =
    proposal.primaryPolicy === SchedulingModel.LINUCB
      ? proposal.heuristicProposal
      : proposal.modelProposal;
  const iso = (source as { scheduledStartTime?: string } | null)
    ?.scheduledStartTime;
  return iso ? new Date(iso) : null;
}

/**
 * `POST /sessions/:id/slot-pick` (`docs/scheduler/ab-testing.md` §3): records
 * which side of a shown pairwise comparison the user picked. `"alternative"`
 * applies the other policy's raw proposal as a `MOVE`; `"primary"` (or a
 * proposal with no pairwise comparison at all) just records "kept". Idempotent
 * — a proposal that already has `chosenByUser` set is a no-op that just
 * echoes what was recorded, never re-applying a move. An alternative that
 * overlaps another sitting of the same `TASK` series is refused with a 409
 * {@link SlotTakenException} and nothing is recorded (#58).
 */
@Injectable()
export class SlotPickService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly schedulingFeedback: SchedulingFeedbackService,
  ) {}

  async recordPick(
    sessionId: string,
    dto: SlotPickDto,
    user: User,
  ): Promise<SlotPickResponse> {
    const proposal = await this.loadProposal(
      dto.slotProposalId,
      sessionId,
      user.id,
    );
    if (!proposal) return this.unchangedResponse(sessionId, user, null);
    await this.prisma.notification.updateMany({
      where: {
        userId: user.id,
        slotProposalId: proposal.id,
        actionTakenAt: null,
      },
      data: { actionTakenAt: new Date() },
    });

    if (proposal.chosenByUser) {
      return this.unchangedResponse(
        sessionId,
        user,
        this.sideOf(proposal, proposal.chosenByUser),
      );
    }

    if (dto.chose === "alternative") {
      const applied = await this.tryApplyAlternative(sessionId, proposal, user);
      if (applied) {
        await this.recordChosenPolicy(proposal.id, this.otherPolicy(proposal));
        if (this.otherPolicy(proposal) === SchedulingModel.LINUCB) {
          await this.schedulingFeedback.onPairwiseWin(user.id, proposal.id);
        }
        schedulerSlotPicks.add(1, {
          policy: proposal.primaryPolicy,
          chose: "alternative",
        });
        return {
          session: applied.session,
          chosenByUser: "alternative",
          undoGroupId: applied.undoGroupId,
        };
      }
    }

    await this.recordKeptPrimary(proposal);
    if (
      dto.chose === "primary" &&
      proposal.pairwiseShown &&
      proposal.primaryPolicy === SchedulingModel.HEURISTIC
    ) {
      await this.schedulingFeedback.onPairwiseLoss(user.id, proposal.id);
    }
    if (
      dto.chose === "primary" &&
      proposal.pairwiseShown &&
      proposal.primaryPolicy === SchedulingModel.LINUCB
    ) {
      await this.schedulingFeedback.onPairwiseWin(user.id, proposal.id);
    }
    const session = await this.currentSession(sessionId, user);
    // The kept heuristic slot is the one the student chose: reinforce its cell.
    if (
      dto.chose === "primary" &&
      proposal.pairwiseShown &&
      proposal.primaryPolicy === SchedulingModel.HEURISTIC &&
      session.scheduledStartTime
    ) {
      await this.schedulingFeedback.reinforcePreferenceMatrix(
        user.id,
        new Date(session.scheduledStartTime).getTime(),
        user.timezone,
        PAIRWISE_KEEP_PREFERENCE_WEIGHT,
      );
    }
    schedulerSlotPicks.add(1, {
      policy: proposal.primaryPolicy,
      chose: "primary",
    });
    return { session, chosenByUser: "primary" };
  }

  private loadProposal(
    slotProposalId: string,
    sessionId: string,
    userId: string,
  ): Promise<LoadedProposal | null> {
    return this.prisma.slotProposal.findFirst({
      where: { id: slotProposalId, sessionId, userId },
      select: {
        id: true,
        primaryPolicy: true,
        heuristicProposal: true,
        modelProposal: true,
        pairwiseShown: true,
        chosenByUser: true,
        firstModifiedAt: true,
      },
    });
  }

  private sideOf(
    proposal: LoadedProposal,
    chosen: SchedulingModel,
  ): "primary" | "alternative" {
    return chosen === proposal.primaryPolicy ? "primary" : "alternative";
  }

  private otherPolicy(proposal: LoadedProposal): SchedulingModel {
    return proposal.primaryPolicy === SchedulingModel.LINUCB
      ? SchedulingModel.HEURISTIC
      : SchedulingModel.LINUCB;
  }

  private async tryApplyAlternative(
    sessionId: string,
    proposal: LoadedProposal,
    user: User,
  ): Promise<AppliedAlternative | null> {
    const altStart = alternativeStartOf(proposal);
    if (!altStart) return null;
    return this.moveSessionTo(sessionId, altStart, user);
  }

  /** Applies the pick as an ordinary `MOVE` — same drag-distance grading and
   * delayed-reward path a manual drag takes ({@link SchedulingFeedbackService}). */
  private async moveSessionTo(
    sessionId: string,
    newStart: Date,
    user: User,
  ): Promise<AppliedAlternative | null> {
    const existing = await this.prisma.session.findFirst({
      where: { id: sessionId, userId: user.id, deleted: false },
      include: WITH_SERIES,
    });
    if (!existing?.scheduledStartTime) return null;
    if (existing.scheduledStartTime.getTime() === newStart.getTime()) {
      return { session: toSessionDto(existing) };
    }

    const dragDistanceMinutes = Math.round(
      (newStart.getTime() - existing.scheduledStartTime.getTime()) / 60_000,
    );
    const isFirstMove = existing.lastMovedAt == null;

    const undoGroupId = randomUUID();
    const [row, moveEvent] = await this.prisma.$transaction(async (tx) => {
      const event = await tx.sessionEvent.create({
        data: {
          ...moveEventData({
            sessionId,
            userId: user.id,
            oldStart: existing.scheduledStartTime as Date,
            oldDurationMinutes: existing.durationMinutes,
            newStart,
            newDurationMinutes: existing.durationMinutes,
            dragDistanceMinutes,
          }),
          groupId: undoGroupId,
        },
        select: { id: true },
      });
      recordUserMove(dragDistanceMinutes);
      const updated = await tx.session.update({
        where: { id: sessionId },
        data: {
          scheduledStartTime: newStart,
          lastMovedAt: new Date(),
        },
        include: WITH_SERIES,
      });
      return [updated, event] as const;
    });

    if (isFirstMove) {
      await this.schedulingFeedback.onFirstMove(
        user.id,
        sessionId,
        moveEvent.id,
        dragDistanceMinutes,
        {
          fromMs: existing.scheduledStartTime.getTime(),
          toMs: newStart.getTime(),
          timezone: user.timezone,
        },
      );
      await this.schedulingFeedback.reinforcePreferenceMove(
        user.id,
        existing.scheduledStartTime.getTime(),
        newStart.getTime(),
        user.timezone,
        dragDistanceMinutes,
      );
    }
    return { session: toSessionDto(row), undoGroupId };
  }

  private recordChosenPolicy(
    proposalId: string,
    policy: SchedulingModel,
  ): Promise<unknown> {
    return this.prisma.slotProposal.update({
      where: { id: proposalId },
      data: { chosenByUser: policy },
    });
  }

  private recordKeptPrimary(proposal: LoadedProposal): Promise<unknown> {
    return this.prisma.slotProposal.update({
      where: { id: proposal.id },
      data: {
        chosenByUser: proposal.primaryPolicy,
        ...(proposal.firstModifiedAt
          ? {}
          : { acceptedWithoutModification: true }),
      },
    });
  }

  private async currentSession(
    sessionId: string,
    user: User,
  ): Promise<SharedSession> {
    const row = await this.prisma.session.findFirst({
      where: { id: sessionId, userId: user.id, deleted: false },
      include: WITH_SERIES,
    });
    if (!row)
      throw new NotFoundException(`Cannot find session with id ${sessionId}`);
    return toSessionDto(row);
  }

  private async unchangedResponse(
    sessionId: string,
    user: User,
    chosenByUser: "primary" | "alternative" | null,
  ): Promise<SlotPickResponse> {
    return {
      session: await this.currentSession(sessionId, user),
      chosenByUser,
    };
  }
}
