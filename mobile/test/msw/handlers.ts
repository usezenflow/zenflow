import { http, HttpResponse } from "msw";

export const API = "http://api.test";

export const testUser = {
  id: "u1",
  email: "a@b.co",
  name: "Test User",
  lang: "en",
  timezone: "Asia/Ho_Chi_Minh",
} as const;

/** Happy-path defaults; individual tests override with `server.use(...)`. */
export const handlers = [
  http.post(`${API}/auth/otp/request`, () => HttpResponse.json({ ok: true })),
  http.post(`${API}/auth/otp/verify`, () => HttpResponse.json({ data: testUser })),
  http.post(`${API}/auth/logout`, () => HttpResponse.json({ ok: true })),
  http.get(`${API}/auth/me`, () => HttpResponse.json({ data: testUser })),
  // A healthy server: a 401/403 then means the session really is gone.
  http.get(`${API}/health/ready`, () => HttpResponse.json({ success: true })),
  http.get(`${API}/users/me/api-access`, () =>
    HttpResponse.json({
      data: {
        mcpUrl: `${API}/mcp`,
        restBaseUrl: API,
        prompt: "Use the Zenflow tools to read and change the plan.",
        setup: [
          { id: "chatgpt", label: "ChatGPT", steps: ["Mở ChatGPT, vào Settings."] },
          { id: "claude", label: "Claude", steps: ["Mở claude.ai, vào Customize."] },
        ],
      },
    }),
  ),
  http.get(`${API}/users/me/insights`, () =>
    HttpResponse.json({
      data: {
        window: { from: "2026-10-17", to: "2026-10-23" },
        focus: [],
        recap: { plannedMinutes: 0, doneMinutes: 0, notThisTimeCount: 0, onTimeCount: 0 },
        buffers: [],
      },
    }),
  ),
  http.get(`${API}/integrations`, () =>
    HttpResponse.json({ data: { integrations: [] } }),
  ),
  http.get(`${API}/sessions/deadline-options`, () =>
    HttpResponse.json({
      data: {
        today: "2026-10-15T16:59:59.000Z",
        tomorrow: "2026-10-16T16:59:59.000Z",
        thisWeek: "2026-10-18T16:59:59.000Z",
        nextWeek: "2026-10-25T16:59:59.000Z",
        thisMonth: "2026-10-31T16:59:59.000Z",
        noRush: "2026-12-31T16:59:59.000Z",
      },
    }),
  ),
  http.get(`${API}/sessions`, () => HttpResponse.json({ data: { sessions: [] } })),
  http.get(`${API}/tags`, () => HttpResponse.json({ data: { tags: [] } })),
  http.patch(`${API}/users/update/basic-info`, () => HttpResponse.json({ data: testUser })),
  http.patch(`${API}/users/me`, () => HttpResponse.json({ data: testUser })),
  http.patch(`${API}/users/update/calendar-target`, () => HttpResponse.json({ data: testUser })),
  http.get(`${API}/oauth/apps`, () => HttpResponse.json({ data: { apps: [] } })),
  http.get(`${API}/google-calendar`, () =>
    HttpResponse.json({
      data: { available: true, target: "NONE", connected: false, state: null, lastSyncedAt: null },
    }),
  ),
];
