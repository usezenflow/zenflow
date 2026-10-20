import { Injectable } from "@nestjs/common";
import type { RecordClientEventsResponse } from "@zenflow/shared";
import type { User } from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import type { RecordClientEventsDto } from "./dto/record-client-events.dto";

/** Stores the app's passive exposure events (ADR-0025). */
@Injectable()
export class ClientEventsService {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    dto: RecordClientEventsDto,
    user: User,
  ): Promise<RecordClientEventsResponse> {
    const { count } = await this.prisma.clientEvent.createMany({
      data: dto.events.map((e) => ({
        userId: user.id,
        kind: e.kind,
        // An app open carries no channel, whatever the client sent.
        channel: e.kind === "OFFER_SHOWN" ? e.channel : null,
        slotProposalId: e.slotProposalId,
        sessionId: e.sessionId,
      })),
    });
    return { recorded: count };
  }
}
