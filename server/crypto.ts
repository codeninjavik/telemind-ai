import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const keyFor = (secret: string) => scryptSync(secret, "telemind-v1", 32);

/** AES-256-GCM. Output: base64(iv | tag | ciphertext). Used for the Telegram session at rest. */
export function seal(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", keyFor(secret), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64");
}

export function unseal(blob: string, secret: string): string | null {
  try {
    const raw = Buffer.from(blob, "base64");
    const d = createDecipheriv("aes-256-gcm", keyFor(secret), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export const sign = (data: string, secret: string) => createHmac("sha256", secret).update(data).digest("base64url");

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const randomToken = (n = 24) => randomBytes(n).toString("base64url");

export function mask(secret: string | undefined): string | null {
  if (!secret) return null;
  return secret.length <= 8 ? "••••" : `${secret.slice(0, 3)}••••${secret.slice(-2)}`;
}
