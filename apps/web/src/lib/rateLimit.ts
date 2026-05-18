import { NextResponse } from "next/server";
import { isProductionLike } from "@/lib/auth";

interface BucketState {
  resetAt: number;
  count: number;
}

const buckets = new Map<string, BucketState>();

export function enforceRateLimit(request: Request, bucket: string): NextResponse | null {
  const now = Date.now();
  const windowMs = Number(process.env.SAFE_GIT_RATE_LIMIT_WINDOW_SECONDS ?? 60) * 1000;
  const max = Number(process.env.SAFE_GIT_RATE_LIMIT_MAX ?? (isProductionLike() ? 60 : 1000));
  const key = `${bucket}:${clientKey(request)}`;
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { resetAt: now + windowMs, count: 1 });
    return null;
  }
  existing.count += 1;
  if (existing.count <= max) {
    return null;
  }
  return NextResponse.json(
    { error: "rate limit exceeded" },
    { status: 429, headers: { "retry-after": String(Math.ceil((existing.resetAt - now) / 1000)) } }
  );
}

function clientKey(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    request.headers.get("authorization")?.slice(0, 24) ??
    "anonymous"
  );
}
