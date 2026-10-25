import { ForbiddenException } from "@nestjs/common";
import { assertSyncedEditable, isSynced } from "./synced-lock";

const portalLecture = { source: "PORTAL", type: "LECTURE" } as const;

describe("synced lock", () => {
  it("covers portal and LMS lectures, exams and assignments only", () => {
    expect(isSynced(portalLecture)).toBe(true);
    expect(isSynced({ source: "LMS", type: "ASSIGNMENT" })).toBe(true);
    expect(isSynced({ source: "USER", type: "LECTURE" })).toBe(false);
    expect(isSynced({ source: "AUTO", type: "TASK" })).toBe(false);
    expect(isSynced({ source: "PORTAL", type: "TASK" })).toBe(false);
  });

  it("lets the student edit note and tags", () => {
    expect(() =>
      assertSyncedEditable(portalLecture, {
        note: "bring laptop",
        tags: ["math"],
      }),
    ).not.toThrow();
  });

  it("lets the student edit their own lecture freely", () => {
    expect(() =>
      assertSyncedEditable(
        { source: "USER", type: "LECTURE" },
        { title: "New", scheduledStartTime: "2026-10-20T09:00:00.000Z" },
      ),
    ).not.toThrow();
  });

  it("refuses to edit what the sync owns", () => {
    expect(() => assertSyncedEditable(portalLecture, { title: "New" })).toThrow(
      ForbiddenException,
    );
  });
});
