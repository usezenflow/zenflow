import { LOGO_SVG } from "../common/brand";
import { showUserCode } from "./user-code";

export type PageLang = "vi" | "en";

const COPY = {
  en: {
    title: (name: string) => `Connect ${name}`,
    steps: "Enter this code in the Zenflow app.",
    open: "Open Zenflow",
    waiting: "Waiting for approval",
    expired: "This request expired",
    again: "Start again from your assistant.",
  },
  vi: {
    title: (name: string) => `Kết nối ${name}`,
    steps: "Nhập mã này trong ứng dụng Zenflow.",
    open: "Mở Zenflow",
    waiting: "Đang chờ duyệt",
    expired: "Yêu cầu đã hết hạn",
    again: "Bắt đầu lại từ trợ lý của bạn.",
  },
} as const;

/** The only values that reach the markup from outside are escaped here. */
export const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

const CURVE =
  "M220.5 51.5C220.5 51.5 172.668 65.7587 147.635 89.6235C122.602 113.488 136.249 158.201 104.912 183.517C80.2542 203.436 32.9999 199.5 32.9999 199.5";

const GRADIENT = (id: string, stops: string) =>
  `<linearGradient id="${id}" x1="48.5" y1="31.5" x2="222.5" y2="220.5" gradientUnits="userSpaceOnUse">${stops}</linearGradient>`;

/** The logo, as in the apps. */
const LOGO = `<div class="logo">${LOGO_SVG}</div>`;

/** The error mark: a dimmed sun with a break in the curve. */
const ERROR_MARK = `<svg width="84" height="84" viewBox="0 0 260 260" fill="none" aria-hidden="true"><defs>${GRADIENT(
  "g",
  '<stop stop-color="#C9A58C"/><stop offset="0.45" stop-color="#B9AE9C"/><stop offset="1" stop-color="#C8C7B4"/>',
)}</defs><circle cx="130" cy="130" r="130" fill="url(#g)"/><path d="${CURVE}" pathLength="100" stroke="#F4EBDD" stroke-width="24" stroke-linecap="round" stroke-dasharray="40 20 100"/></svg>`;

const CSS = `
:root{color-scheme:light dark;--bg:#faf6ef;--card:#fff;--fg:#2a2118;--muted:#7a6c5c;--line:#eadfce;--accent:#f0620a}
@media (prefers-color-scheme:dark){:root{--bg:#1b1713;--card:#25201a;--fg:#f4ebdd;--muted:#a99a88;--line:#3a3128}}
*{box-sizing:border-box}
body{margin:0;min-height:100svh;display:grid;place-items:center;padding:24px;background:var(--bg);color:var(--fg);font:16px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif}
main{width:100%;max-width:380px;display:flex;flex-direction:column;align-items:center;gap:20px;padding:32px 24px;text-align:center;background:var(--card);border:1px solid var(--line);border-radius:24px}
h1{margin:0;font-size:20px;font-weight:600}
p{margin:0;color:var(--muted);font-size:15px}
.logo svg{width:72px;height:72px}
.code{font:600 34px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;padding:16px 20px;border:1px solid var(--line);border-radius:16px}
a.btn{display:block;width:100%;padding:12px;border-radius:999px;background:var(--accent);color:#fff;font-weight:600;text-decoration:none}
.wait{font-size:13px}
`;

function shell(lang: PageLang, title: string, body: string, nonce?: string) {
  const script = nonce ? `<script nonce="${nonce}">${POLL}</script>` : "";
  return `<!doctype html><html lang="${lang === "vi" ? "vi" : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="referrer" content="no-referrer"><title>${escapeHtml(title)}</title><style>${CSS}</style></head><body><main>${body}</main>${script}</body></html>`;
}

/** Polls the status next to this page; moves the browser on once the app has decided. */
const POLL = `(function(){var q=location.search;function t(){fetch(location.pathname+'/status'+q,{headers:{accept:'application/json'}}).then(function(r){return r.json()}).then(function(j){var d=j.data||{};if(d.status==='done'){location.assign(d.redirectUrl);return}if(d.status==='expired'){location.reload();return}setTimeout(t,2000)}).catch(function(){setTimeout(t,4000)})}t()})();`;

/** The code and a link into the app, while the user approves there. */
export function connectPage(args: {
  code: string;
  clientName: string;
  lang: PageLang;
  nonce: string;
}): string {
  const c = COPY[args.lang];
  const title = c.title(args.clientName);
  return shell(
    args.lang,
    title,
    `${LOGO}<h1>${escapeHtml(title)}</h1><p>${c.steps}</p><div class="code">${showUserCode(args.code)}</div><a class="btn" href="zenflow://settings?connect=${args.code}">${c.open}</a><p class="wait">${c.waiting}</p>`,
    args.nonce,
  );
}

/** Shown when the request is unknown, spent or past its time. */
export function expiredPage(lang: PageLang): string {
  const c = COPY[lang];
  return shell(
    lang,
    c.expired,
    `${ERROR_MARK}<h1>${c.expired}</h1><p>${c.again}</p>`,
  );
}
