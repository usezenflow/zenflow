import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

/**
 * Encrypts OAuth tokens at rest with AES-256-GCM. The first field is `v<n>`,
 * the version of the key that sealed the value.
 */
export function sealToken(
  plain: string,
  key: { version: number; hex: string },
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key.hex, "hex"), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [
    `v${key.version}`,
    iv.toString("hex"),
    cipher.getAuthTag().toString("hex"),
    body.toString("hex"),
  ].join(".");
}

/** Reverses {@link sealToken}; throws if the key version is unknown, the key is wrong or the value was altered. */
export function openToken(sealed: string, keys: Map<number, string>): string {
  const [tag, iv, authTag, body] = sealed.split(".");
  const key = keys.get(Number(/^v(\d+)$/.exec(tag ?? "")?.[1]));
  if (!key || !iv || !authTag || !body) {
    throw new Error("Unsupported token format or key version");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(key, "hex"),
    Buffer.from(iv, "hex"),
  );
  decipher.setAuthTag(Buffer.from(authTag, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(body, "hex")),
    decipher.final(),
  ]).toString("utf8");
}
