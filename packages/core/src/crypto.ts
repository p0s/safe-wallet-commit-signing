import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Hex } from "./types.js";

export function sha256Hex(input: string | Uint8Array): Hex {
  const hash = createHash("sha256").update(input).digest("hex");
  return `0x${hash}`;
}

export function sha256Base64(input: Uint8Array): string {
  return createHash("sha256").update(input).digest("base64").replace(/=+$/u, "");
}

export function randomHex(byteLength = 32): Hex {
  return `0x${randomBytes(byteLength).toString("hex")}`;
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
    .join(",")}}`;
}

export function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.byteLength !== rightBuffer.byteLength) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function assertDevSignerAllowed(env: NodeJS.ProcessEnv = process.env): void {
  if (env.UNSAFE_DEV_SIGNER === "true" && env.NODE_ENV === "production") {
    throw new Error("UNSAFE_DEV_SIGNER cannot be enabled when NODE_ENV=production");
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
