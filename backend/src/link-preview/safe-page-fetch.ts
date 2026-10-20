import { lookup as dnsLookup } from "node:dns";
import { lookup as dnsLookupAsync } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isPublicAddress } from "./address-guard";

export const MAX_REDIRECTS = 3;
export const MAX_BODY_BYTES = 256 * 1024;
export const FETCH_TIMEOUT_MS = 5000;

const ALLOWED_PORTS = new Set(["", "80", "443"]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export class BlockedUrlError extends Error {}

/** Throws unless `url` is plain http(s) on port 80/443 whose host resolves only to public addresses. */
export async function assertFetchableUrl(url: URL): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new BlockedUrlError("scheme");
  if (!ALLOWED_PORTS.has(url.port) || url.username || url.password)
    throw new BlockedUrlError("port or credentials");
  const host = url.hostname.replace(/^\[(.*)\]$/, "$1");
  if (isIP(host)) {
    if (!isPublicAddress(host)) throw new BlockedUrlError("address");
    return;
  }
  const addrs = await dnsLookupAsync(host, { all: true, verbatim: true });
  if (addrs.length === 0 || addrs.some((a) => !isPublicAddress(a.address)))
    throw new BlockedUrlError("address");
}

/**
 * Connect-time check: the address the socket actually dials is validated, so a
 * DNS answer that changes between the pre-check and the connect cannot reach a
 * private host (DNS rebinding).
 */
const publicOnlyLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { all: true, verbatim: true }, (err, addrs) => {
    if (err) return callback(err, "", 4);
    if (addrs.length === 0 || addrs.some((a) => !isPublicAddress(a.address)))
      return callback(new BlockedUrlError("address"), "", 4);
    if (options.all) return callback(null, addrs);
    callback(null, addrs[0].address, addrs[0].family);
  });
};

function send(url: URL, signal: AbortSignal): Promise<IncomingMessage> {
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: "GET",
        signal,
        lookup: publicOnlyLookup,
        headers: {
          Accept: "text/html",
          "Accept-Encoding": "identity",
          "User-Agent":
            "Mozilla/5.0 (compatible; ZenflowLinkPreview/1.0; +https://zenflow.app)",
        },
      },
      resolve,
    );
    req.on("error", reject);
    req.end();
  });
}

async function readCapped(res: IncomingMessage, max: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of res) {
    const buf = chunk as Buffer;
    if (size + buf.length >= max) {
      chunks.push(buf.subarray(0, max - size));
      break;
    }
    chunks.push(buf);
    size += buf.length;
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Fetches an HTML page, following at most {@link MAX_REDIRECTS} redirects and
 * re-checking every hop. `null` for any non-2xx, non-HTML or redirect-capped
 * response. Throws on blocked or unreachable targets.
 */
export async function fetchHtmlPage(
  start: URL,
  signal: AbortSignal,
): Promise<{ url: URL; html: string } | null> {
  let url = start;
  for (let hop = 0; ; hop++) {
    await assertFetchableUrl(url);
    const res = await send(url, signal);
    const status = res.statusCode ?? 0;
    if (REDIRECT_STATUSES.has(status)) {
      res.resume();
      const location = res.headers.location;
      if (!location || hop >= MAX_REDIRECTS) return null;
      url = new URL(location, url);
      continue;
    }
    if (
      status < 200 ||
      status >= 300 ||
      !/^text\/html\b/i.test(res.headers["content-type"] ?? "")
    ) {
      res.resume();
      return null;
    }
    return { url, html: await readCapped(res, MAX_BODY_BYTES) };
  }
}
