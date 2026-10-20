import { Test } from "@nestjs/testing";
import type { User } from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import { ClientEventsService } from "./client-events.service";

const user = { id: "user-1" } as User;

async function makeService() {
  const createMany = jest.fn().mockResolvedValue({ count: 2 });
  const module = await Test.createTestingModule({
    providers: [
      ClientEventsService,
      { provide: PrismaService, useValue: { clientEvent: { createMany } } },
    ],
  }).compile();
  return { service: module.get(ClientEventsService), createMany };
}

describe("ClientEventsService.record", () => {
  it("stores each event for the user and reports the count", async () => {
    const { service, createMany } = await makeService();

    const res = await service.record(
      {
        events: [
          {
            kind: "OFFER_SHOWN",
            channel: "TOAST",
            slotProposalId: "p1",
            sessionId: "s1",
          },
          {
            kind: "APP_OPEN",
            channel: null,
            slotProposalId: null,
            sessionId: null,
          },
        ],
      },
      user,
    );

    expect(res).toEqual({ recorded: 2 });
    expect(createMany).toHaveBeenCalledWith({
      data: [
        {
          userId: "user-1",
          kind: "OFFER_SHOWN",
          channel: "TOAST",
          slotProposalId: "p1",
          sessionId: "s1",
        },
        {
          userId: "user-1",
          kind: "APP_OPEN",
          channel: null,
          slotProposalId: null,
          sessionId: null,
        },
      ],
    });
  });

  it("drops a channel sent with an app open", async () => {
    const { service, createMany } = await makeService();

    await service.record(
      {
        events: [
          {
            kind: "APP_OPEN",
            channel: "PUSH",
            slotProposalId: null,
            sessionId: null,
          },
        ],
      },
      user,
    );

    const [arg] = createMany.mock.calls[0] as [
      { data: { channel: string | null }[] },
    ];
    expect(arg.data[0].channel).toBeNull();
  });
});
