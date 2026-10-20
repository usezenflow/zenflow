import { BlockList, isIP } from "node:net";

const BLOCKED_V4 = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], // this network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, cloud metadata
  ["172.16.0.0", 12], // private
  ["192.168.0.0", 16], // private
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved
] as const) {
  BLOCKED_V4.addSubnet(net, prefix, "ipv4");
}

const BLOCKED_V6 = new BlockList();
BLOCKED_V6.addAddress("::", "ipv6");
BLOCKED_V6.addAddress("::1", "ipv6");
BLOCKED_V6.addSubnet("fc00::", 7, "ipv6"); // unique local
BLOCKED_V6.addSubnet("fe80::", 10, "ipv6"); // link-local
BLOCKED_V6.addSubnet("ff00::", 8, "ipv6"); // multicast

/** Eight 16-bit groups of an IPv6 literal; dotted-quad tails become two groups. */
function ipv6Groups(ip: string): number[] | null {
  let s = ip;
  let tail: [number, number] | null = null;
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (dotted) {
    const o = dotted[1].split(".").map(Number);
    tail = [(o[0] << 8) | o[1], (o[2] << 8) | o[3]];
    s = `${s.slice(0, dotted.index)}0:0`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if (halves.length === 1 && head.length !== 8) return null;
  const fill = 8 - head.length - rest.length;
  if (fill < 0) return null;
  const groups = [...head, ...Array<string>(fill).fill("0"), ...rest].map((g) =>
    Number.parseInt(g, 16),
  );
  if (groups.length !== 8 || groups.some((g) => !(g >= 0 && g <= 0xffff)))
    return null;
  if (tail) groups.splice(6, 2, ...tail);
  return groups;
}

const dottedOf = (hi: number, lo: number) =>
  [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join(".");

/**
 * True only for addresses on the public internet. IPv4-mapped (`::ffff:`),
 * IPv4-compatible and NAT64 (`64:ff9b::`) IPv6 forms are judged by the IPv4
 * address they embed.
 */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !BLOCKED_V4.check(address, "ipv4");
  if (family !== 6) return false;
  const g = ipv6Groups(address);
  if (!g) return false;
  const zeros = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (zeros(5) && g[5] === 0xffff) return isPublicAddress(dottedOf(g[6], g[7]));
  if (zeros(6)) return isPublicAddress(dottedOf(g[6], g[7]));
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0))
    return isPublicAddress(dottedOf(g[6], g[7]));
  return !BLOCKED_V6.check(address, "ipv6");
}
