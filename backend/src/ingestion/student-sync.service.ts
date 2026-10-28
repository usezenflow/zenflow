import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DEFAULT_USER_NAME } from "@zenflow/shared";
import { NotificationsService } from "../notifications/notifications.service";
import { NotificationEvent } from "../notifications/types";
import { PortalAPIService } from "../portal/portal-api.service";
import { PrismaService } from "../prisma/prisma.service";
import { QueueService } from "../queue/queue.service";
import {
  PORTAL_MARKS_QUEUE,
  type MarksJobData,
  type ProfileJobData,
} from "../queue/queues";
import { idempotencyKey } from "../queue/queue.types";
import type { PortalMarksYear } from "./core/parse-student";
import { parseMarks, parseStudentInfo } from "./core/parse-student";
import { marksEligible, type SeasonOverrides } from "./core/seasonal-policy";
import { resolveSemester } from "./core/semester";
import { seasonOverrides } from "./season-config";
import { PortalSessionService } from "./portal-session.service";
import { errorMessage, jitter, sleep } from "./watcher-support";

/** Marks are refreshed at most this often once due (`INGESTION_MARKS_PERIOD_MS`). */
export const DEFAULT_MARKS_PERIOD_MS = 60 * 60_000;

export interface StudentSyncResult {
  ok: boolean;
}

/**
 * Student profile and marks: the bodies of the `portal-profile` and
 * `portal-marks` jobs.
 *
 * Only normalised fields are stored. The marks payload repeats the student's
 * phone and birthday on every course row, so no raw body is kept anywhere.
 */
@Injectable()
export class StudentSyncService {
  private readonly logger = new Logger(StudentSyncService.name);
  private readonly requestDelayMs: number;
  private readonly marksPeriodMs: number;
  private readonly dluTimezone: string;
  private readonly season: SeasonOverrides;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly portal: PortalAPIService,
    private readonly session: PortalSessionService,
    private readonly queue: QueueService,
    private readonly notifications: NotificationsService,
  ) {
    this.requestDelayMs = Number(
      this.config.get("INGESTION_REQUEST_DELAY_MS") ?? 750,
    );
    this.marksPeriodMs =
      Number(this.config.get("INGESTION_MARKS_PERIOD_MS")) ||
      DEFAULT_MARKS_PERIOD_MS;
    this.dluTimezone = this.config.get<string>("DLU_TZ") ?? "Asia/Ho_Chi_Minh";
    this.season = seasonOverrides(this.config);
  }

  /** Fetch name, class, cohort and study programs; then queue the marks job. */
  async syncProfile(
    data: ProfileJobData,
    now = new Date(),
  ): Promise<StudentSyncResult> {
    const fetched = await this.session.withToken(data.userId, async (token) => {
      const rawInfo = await this.portal.fetchStudentInfo(token);
      await sleep(jitter(this.requestDelayMs));
      const rawPrograms = await this.portal.fetchStudyPrograms(token);
      return { rawInfo, rawPrograms };
    });
    if (!fetched.ok) return { ok: false };
    const info = parseStudentInfo(fetched.value.rawInfo);
    if (!info) throw new Error("The portal returned no student profile");
    const programs = fetched.value.rawPrograms;

    // Type 1 is the student's main program.
    const main = programs.find((p) => p.Type === 1) ?? programs[0];
    const fields = {
      integrationId: data.integrationId,
      ...info,
      studentId: main?.StudentID ?? null,
      studyProgramId: main?.StudyProgramID ?? null,
      studyProgramName: main?.StudyProgramName ?? null,
      profileFetchedAt: now,
    };
    await this.prisma.studentProfile.upsert({
      where: { userId: data.userId },
      create: { userId: data.userId, ...fields },
      update: fields,
    });
    // The DLU name fills the placeholder only; a name the student set wins.
    await this.prisma.user.updateMany({
      where: { id: data.userId, name: DEFAULT_USER_NAME },
      data: { name: info.fullName },
    });
    for (const program of programs) {
      await this.prisma.studyProgram.upsert({
        where: {
          userId_studyProgramId: {
            userId: data.userId,
            studyProgramId: program.StudyProgramID,
          },
        },
        create: {
          userId: data.userId,
          studyProgramId: program.StudyProgramID,
          name: program.StudyProgramName,
          type: program.Type,
        },
        update: { name: program.StudyProgramName, type: program.Type },
      });
    }

    if (programs.length > 0) {
      await this.queue.enqueueBestEffort(
        PORTAL_MARKS_QUEUE,
        { userId: data.userId, integrationId: data.integrationId },
        { jobId: idempotencyKey("marks", data.integrationId, now.getTime()) },
      );
    }
    return { ok: true };
  }

  /** Fetch marks for each study program and attach them to the student. */
  async syncMarks(
    data: MarksJobData,
    now = new Date(),
  ): Promise<StudentSyncResult> {
    const programs = await this.prisma.studyProgram.findMany({
      where: { userId: data.userId },
      select: { studyProgramId: true },
    });
    if (programs.length === 0) return { ok: true };

    const fetched = await this.session.withToken(data.userId, async (token) => {
      const years: PortalMarksYear[] = [];
      let first = true;
      for (const { studyProgramId } of programs) {
        if (!first) await sleep(jitter(this.requestDelayMs));
        first = false;
        years.push(...(await this.portal.fetchMarks(token, studyProgramId)));
      }
      return years;
    });
    if (!fetched.ok) return { ok: false };
    const years = fetched.value;
    const parsed = parseMarks(years);

    const known = new Map(
      (
        await this.prisma.studentMark.findMany({
          where: { userId: data.userId },
          select: {
            scheduleStudyUnitId: true,
            score10: true,
            score4: true,
            letter: true,
            passed: true,
          },
        })
      ).map((m) => [m.scheduleStudyUnitId, m]),
    );
    // A course with no result yet is not news.
    const changed = parsed.marks.filter((m) => {
      if (m.score10 === null && m.letter === null) return false;
      const old = known.get(m.scheduleStudyUnitId);
      return (
        !old ||
        old.score10 !== m.score10 ||
        old.score4 !== m.score4 ||
        old.letter !== m.letter ||
        old.passed !== m.passed
      );
    });

    for (const mark of parsed.marks) {
      await this.prisma.studentMark.upsert({
        where: {
          userId_scheduleStudyUnitId: {
            userId: data.userId,
            scheduleStudyUnitId: mark.scheduleStudyUnitId,
          },
        },
        create: { userId: data.userId, ...mark },
        update: mark,
      });
    }
    for (const term of parsed.terms) {
      await this.prisma.studentTermResult.upsert({
        where: {
          userId_yearStudy_termId: {
            userId: data.userId,
            yearStudy: term.yearStudy,
            termId: term.termId,
          },
        },
        create: { userId: data.userId, ...term },
        update: term,
      });
    }

    const profile = await this.prisma.studentProfile.findUnique({
      where: { userId: data.userId },
      select: { marksFetchedAt: true },
    });
    await this.prisma.studentProfile.updateMany({
      where: { userId: data.userId },
      data: {
        marksFetchedAt: now,
        studentId: parsed.studentId ?? undefined,
        faculty: parsed.faculty ?? undefined,
        major: parsed.major ?? undefined,
        ranking: parsed.ranking,
        gpa4: parsed.gpa4,
        gpa10: parsed.gpa10,
        creditsEarned: parsed.creditsEarned,
      },
    });

    // The first time marks land is one announcement; later, only new or changed marks.
    if (profile && profile.marksFetchedAt === null) {
      await this.announce(
        data.userId,
        "marks.ready",
        "Your marks are available",
      );
    } else if (changed.length > 0) {
      await this.announce(
        data.userId,
        "marks.updated",
        changed.length === 1
          ? `New mark: ${changed[0].curriculumName}`
          : `${changed.length} new marks`,
      );
    }
    return { ok: true };
  }

  private async announce(
    userId: string,
    eventName: string,
    title: string,
  ): Promise<void> {
    try {
      const row = await this.notifications.create(userId, {
        sessionId: null,
        title,
        content: "Open your profile.",
        eventEndsAt: null,
        materializeSession: false,
        eventName,
      });
      this.notifications.notify(NotificationEvent.NEW_SESSION, row);
    } catch (error) {
      this.logger.warn(`Could not raise ${eventName}: ${errorMessage(error)}`);
    }
  }

  /**
   * Students whose marks are due. The first fetch follows the profile; after that
   * marks are refetched every {@link DEFAULT_MARKS_PERIOD_MS} from one week after the
   * student's first exam of the current term ends, and not before.
   */
  async dueForMarks(now: Date, limit: number): Promise<MarksJobData[]> {
    const cutoff = new Date(now.getTime() - this.marksPeriodMs);
    const term = resolveSemester(now, this.dluTimezone, 0);
    // A superset by exam start; the exact end is checked below.
    const examStartedBy = new Date(
      now.getTime() - this.season.marksAfterExamsMs,
    );
    const rows = await this.prisma.studentProfile.findMany({
      where: {
        OR: [
          { marksFetchedAt: null },
          {
            marksFetchedAt: { lt: cutoff },
            user: {
              sessions: {
                some: {
                  type: "EXAM",
                  source: "PORTAL",
                  deleted: false,
                  scheduledStartTime: {
                    gte: term.startDate,
                    lte: examStartedBy,
                  },
                },
              },
            },
          },
        ],
      },
      orderBy: [{ marksFetchedAt: { sort: "asc", nulls: "first" } }],
      take: limit * 4,
      select: {
        userId: true,
        integrationId: true,
        marksFetchedAt: true,
      },
    });
    if (rows.length === 0) return [];

    const exams = await this.prisma.session.findMany({
      where: {
        userId: { in: rows.map((r) => r.userId) },
        type: "EXAM",
        source: "PORTAL",
        deleted: false,
        scheduledStartTime: { gte: term.startDate, lte: term.endDate },
      },
      orderBy: { scheduledStartTime: "asc" },
      select: { userId: true, scheduledStartTime: true, durationMinutes: true },
    });
    const firstEnd = new Map<string, Date>();
    for (const exam of exams) {
      if (firstEnd.has(exam.userId) || !exam.scheduledStartTime) continue;
      firstEnd.set(
        exam.userId,
        new Date(
          exam.scheduledStartTime.getTime() + exam.durationMinutes * 60_000,
        ),
      );
    }

    return rows
      .filter(
        (r) =>
          r.marksFetchedAt === null ||
          marksEligible({
            now,
            firstExamEndsAt: firstEnd.get(r.userId) ?? null,
            overrides: this.season,
          }),
      )
      .slice(0, limit)
      .map(({ userId, integrationId }) => ({ userId, integrationId }));
  }
}
