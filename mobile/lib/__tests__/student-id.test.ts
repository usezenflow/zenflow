import { describe, expect, it } from "vitest";
import { studentIdOf } from "../student-id";

describe("studentIdOf", () => {
  it.each([
    ["2123456@dlu.edu.vn", "2123456"],
    ["2123456@student.dlu.edu.vn", "2123456"],
    ["2123456@evil-dlu.edu.vn", null],
    ["a@b.com", null],
    [undefined, null],
  ])("%s", (email, id) => expect(studentIdOf(email)).toBe(id));
});
