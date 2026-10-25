import {
  consumesQueue,
  getRole,
  runsHttp,
  runsJobs,
  runsOutbox,
  runsWatcher,
} from "./role";

describe("getRole", () => {
  it("defaults to all and ignores unknown values", () => {
    expect(getRole({})).toBe("all");
    expect(getRole({ ROLE: "nope" })).toBe("all");
  });

  it("parses every role", () => {
    for (const r of [
      "api",
      "watcher",
      "worker-portal",
      "worker-lms",
      "worker-notify",
      "worker-scheduler",
      "worker",
      "all",
    ]) {
      expect(getRole({ ROLE: r })).toBe(r);
    }
  });

  it("only api and all serve HTTP", () => {
    expect(runsHttp("api")).toBe(true);
    expect(runsHttp("all")).toBe(true);
    for (const r of [
      "watcher",
      "worker",
      "worker-portal",
      "worker-lms",
      "worker-notify",
    ] as const) {
      expect(runsHttp(r)).toBe(false);
    }
  });

  it("api runs no jobs; only watcher/worker/all run the cron heartbeat", () => {
    expect(runsJobs("api")).toBe(false);
    expect(runsWatcher("api")).toBe(false);
    expect(runsWatcher("watcher")).toBe(true);
    expect(runsWatcher("worker")).toBe(true);
    expect(runsWatcher("all")).toBe(true);
    expect(runsWatcher("worker-portal")).toBe(false);
    expect(runsWatcher("worker-notify")).toBe(false);
  });

  it("maps consumer roles to their queue; the watcher consumes nothing", () => {
    expect(consumesQueue("worker-portal", "portal-fetch")).toBe(true);
    expect(consumesQueue("worker-portal", "lms-fetch")).toBe(false);
    expect(consumesQueue("worker-lms", "lms-fetch")).toBe(true);
    expect(consumesQueue("worker-notify", "notify")).toBe(true);
    expect(consumesQueue("worker-notify", "portal-fetch")).toBe(false);
    expect(consumesQueue("worker-scheduler", "prep-plan")).toBe(true);
    expect(consumesQueue("worker-scheduler", "notify")).toBe(false);
    expect(consumesQueue("watcher", "notify")).toBe(false);
    expect(consumesQueue("api", "notify")).toBe(false);
    for (const q of [
      "portal-fetch",
      "lms-fetch",
      "notify",
      "prep-plan",
    ] as const) {
      expect(consumesQueue("all", q)).toBe(true);
      expect(consumesQueue("worker", q)).toBe(true);
    }
  });
});

describe("runsOutbox", () => {
  it("runs in the default role, the outbox role and the worker, never in api or the watcher", () => {
    expect(runsOutbox(getRole({} as NodeJS.ProcessEnv))).toBe(true);
    expect(runsOutbox("outbox")).toBe(true);
    expect(runsOutbox("worker")).toBe(true);
    expect(runsOutbox("api")).toBe(false);
    expect(runsOutbox("watcher")).toBe(false);
  });
});
