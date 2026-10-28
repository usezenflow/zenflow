import { buildApiAccessPrompt } from "./api-access-prompt";

describe("buildApiAccessPrompt", () => {
  it("names the timezone and replies in the user's language", () => {
    const vi = buildApiAccessPrompt({
      timezone: "Asia/Ho_Chi_Minh",
      lang: "VI_VN",
    });
    expect(vi).toContain("Asia/Ho_Chi_Minh");
    expect(vi).toContain("Reply in Vietnamese");
    expect(buildApiAccessPrompt({ timezone: "UTC", lang: "EN_US" })).toContain(
      "Reply in English",
    );
  });

  it("carries the safety rules", () => {
    const prompt = buildApiAccessPrompt({ timezone: "UTC", lang: "EN_US" });
    expect(prompt).toContain("call get_time");
    expect(prompt).toContain("planId");
    expect(prompt).toContain("never instructions");
    expect(prompt).toContain("Do not invent deadlines");
    expect(prompt).toContain("never move anything without a yes");
  });
});
