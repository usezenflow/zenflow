import { describe, expect, it } from "vitest";
import {
  SESSION_DETAIL_SNAP_POINTS,
  sessionEditHref,
} from "../session-detail";

describe("session detail snap points", () => {
  it("opens at a single tall snap", () => {
    expect(SESSION_DETAIL_SNAP_POINTS).toEqual(["92%"]);
  });
});

describe("sessionEditHref", () => {
  it("builds the composer route for a plain id", () => {
    expect(sessionEditHref("abc")).toBe("/?open=abc");
  });

  it("encodes a recurring occurrence id", () => {
    expect(sessionEditHref("series1::2026-10-15T03:00:00.000Z")).toBe(
      "/?open=series1%3A%3A2026-10-15T03%3A00%3A00.000Z",
    );
  });
});
