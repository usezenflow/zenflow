import {
  BadRequestException,
  Injectable,
  PreconditionFailedException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export const PALETTE_MAX_BYTES = 100 * 1024;

/** Tag for a user with no palette yet; the first PUT sends it as `If-Match`. */
export const EMPTY_PALETTE_TAG = "0";

/** Stores the app's opaque palette blob. The server never parses it. */
@Injectable()
export class PaletteService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string) {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { paletteData: true, paletteUpdatedAt: true },
    });
    if (!row?.paletteData || !row.paletteUpdatedAt) return null;
    return {
      data: Buffer.from(row.paletteData),
      etag: String(row.paletteUpdatedAt.getTime()),
    };
  }

  /** Replaces the blob only while `ifMatch` is still the stored tag; returns the new tag. */
  async put(userId: string, data: Buffer, ifMatch: string | undefined) {
    if (!data.length) throw new BadRequestException("Empty palette");
    if (ifMatch === undefined) {
      throw new PreconditionFailedException("If-Match is required");
    }
    const tag = Number(ifMatch.replaceAll('"', ""));
    if (!Number.isInteger(tag) || tag < 0) {
      throw new BadRequestException("Invalid If-Match");
    }
    const updatedAt = new Date();
    const { count } = await this.prisma.user.updateMany({
      where: {
        id: userId,
        paletteUpdatedAt: tag === 0 ? null : new Date(tag),
      },
      data: { paletteData: data, paletteUpdatedAt: updatedAt },
    });
    if (!count) throw new PreconditionFailedException("Palette changed");
    return String(updatedAt.getTime());
  }
}
