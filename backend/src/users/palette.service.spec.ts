import {
  BadRequestException,
  PreconditionFailedException,
} from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import { PaletteService } from "./palette.service";

function make(row: unknown, count = 1) {
  const findUnique = jest.fn(() => row);
  const updateMany = jest.fn<{ count: number }, [{ where: unknown }]>(() => ({
    count,
  }));
  const service = new PaletteService({
    user: { findUnique, updateMany },
  } as unknown as PrismaService);
  return { service, updateMany };
}

describe("PaletteService", () => {
  it("returns null when empty", async () => {
    const { service } = make({ paletteData: null, paletteUpdatedAt: null });
    expect(await service.get("u")).toBeNull();
  });

  it("round trips bytes with the epoch tag", async () => {
    const at = new Date(1_700_000_000_000);
    const { service } = make({
      paletteData: Buffer.from([1, 2]),
      paletteUpdatedAt: at,
    });
    const got = await service.get("u");
    expect([...got!.data]).toEqual([1, 2]);
    expect(got!.etag).toBe("1700000000000");
  });

  it("first put matches a null tag", async () => {
    const { service, updateMany } = make(null);
    await service.put("u", Buffer.from([1]), "0");
    expect(updateMany.mock.calls[0][0].where).toEqual({
      id: "u",
      paletteUpdatedAt: null,
    });
  });

  it("answers 412 on a stale tag", async () => {
    const { service } = make(null, 0);
    await expect(service.put("u", Buffer.from([1]), "5")).rejects.toThrow(
      PreconditionFailedException,
    );
  });

  it("requires If-Match and a body", async () => {
    const { service } = make(null);
    await expect(service.put("u", Buffer.from([1]), undefined)).rejects.toThrow(
      PreconditionFailedException,
    );
    await expect(service.put("u", Buffer.alloc(0), "0")).rejects.toThrow(
      BadRequestException,
    );
  });
});
