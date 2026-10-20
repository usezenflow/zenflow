import { Injectable } from "@nestjs/common";
import { Prisma } from "../../generated/prisma";
import {
  WORKLOAD_MIN_GROUP,
  type WorkloadDimension,
  type WorkloadGroup,
  type WorkloadResponse,
} from "@zenflow/shared";
import { PrismaService } from "../prisma/prisma.service";

const DIMENSIONS: Record<WorkloadDimension, Prisma.Sql> = {
  faculty: Prisma.sql`sp."faculty"`,
  className: Prisma.sql`sp."className"`,
  cohort: Prisma.sql`sp."cohort"`,
};

/**
 * Session load by weekday and hour, grouped by `StudentProfile` columns. Hours
 * are the student's own wall clock. Groups under `WORKLOAD_MIN_GROUP` students
 * are dropped here, not only in the UI.
 */
@Injectable()
export class WorkloadService {
  constructor(private readonly prisma: PrismaService) {}

  async workload(): Promise<WorkloadResponse> {
    const groups = (
      await Promise.all(
        (Object.keys(DIMENSIONS) as WorkloadDimension[]).map((dimension) =>
          this.byDimension(dimension),
        ),
      )
    ).flat();
    return { groups };
  }

  private async byDimension(
    dimension: WorkloadDimension,
  ): Promise<WorkloadGroup[]> {
    const column = DIMENSIONS[dimension];
    const sizes = await this.prisma.$queryRaw<
      { value: string; students: number }[]
    >`
      SELECT ${column} AS "value", count(*)::int AS students
      FROM "StudentProfile" sp
      WHERE ${column} IS NOT NULL
      GROUP BY 1`;
    const visible = sizes.filter((s) => s.students >= WORKLOAD_MIN_GROUP);
    if (visible.length === 0) return [];

    const cells = await this.prisma.$queryRaw<
      { value: string; weekday: number; hour: number; minutes: number }[]
    >`
      SELECT g."value", g.weekday, g.hour, sum(g.minutes)::int AS minutes
      FROM (
        SELECT ${column} AS "value",
               extract(isodow FROM w.wall)::int - 1 AS weekday,
               extract(hour FROM w.wall)::int AS hour,
               s."durationMinutes" AS minutes
        FROM "StudentProfile" sp
        JOIN "User" u ON u.id = sp."userId"
        JOIN "Session" s
          ON s."userId" = sp."userId"
         AND s.deleted = false
         AND s."scheduledStartTime" IS NOT NULL
        CROSS JOIN LATERAL (
          SELECT s."scheduledStartTime" AT TIME ZONE 'UTC' AT TIME ZONE u.timezone AS wall
        ) w
        WHERE ${column} IS NOT NULL
      ) g
      GROUP BY 1, 2, 3`;

    return visible
      .sort((a, b) => a.value.localeCompare(b.value))
      .map((size) => {
        const minutes = Array.from({ length: 7 }, () =>
          Array.from({ length: 24 }, () => 0),
        );
        for (const cell of cells) {
          if (cell.value !== size.value) continue;
          minutes[cell.weekday][cell.hour] = cell.minutes;
        }
        return {
          dimension,
          value: size.value,
          students: size.students,
          minutes,
        };
      });
  }
}
