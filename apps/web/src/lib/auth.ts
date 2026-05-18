import { createHash, createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { safeEqual } from "@safe-git/core";

export function isProductionLike(): boolean {
  return process.env.NODE_ENV === "production" && process.env.SAFE_GIT_ENV !== "development";
}

function requireBearer(request: Request, secret: string | undefined): NextResponse | null {
  if (!secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

export function hasAdminReadAuth(request: Request): boolean {
  if (!isProductionLike()) {
    return true;
  }
  const secret = process.env.SAFE_GIT_ADMIN_TOKEN;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

export function requireAdminMutationAuth(request: Request): NextResponse | null {
  if (!isProductionLike()) {
    return null;
  }
  return requireBearer(request, process.env.SAFE_GIT_ADMIN_TOKEN);
}

export function requireSignerAuth(request: Request): NextResponse | null {
  if (!isProductionLike()) {
    return null;
  }
  const hmacKeys = signerNodeKeys();
  if (hmacKeys.size > 0) {
    return requireSignerHmac(request, "", hmacKeys);
  }
  return requireBearer(request, process.env.SIGNER_COORDINATOR_SHARED_SECRET);
}

export function requireSignerRequestAuth(request: Request, rawBody = ""): NextResponse | null {
  if (!isProductionLike()) {
    return null;
  }
  const hmacKeys = signerNodeKeys();
  if (hmacKeys.size > 0) {
    return requireSignerHmac(request, rawBody, hmacKeys);
  }
  return requireBearer(request, process.env.SIGNER_COORDINATOR_SHARED_SECRET);
}

export function getSignerNodeId(request: Request): string | undefined {
  return request.headers.get("x-safegit-signer-id") ?? undefined;
}

export function allowDevSafeApproval(): boolean {
  return !isProductionLike();
}

function signerNodeKeys(env: NodeJS.ProcessEnv = process.env): Map<string, string> {
  const raw = env.SIGNER_NODE_KEYS?.trim();
  if (!raw) {
    return new Map();
  }
  if (raw.startsWith("{")) {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return new Map(Object.entries(parsed).filter(([, value]) => Boolean(value)));
  }
  return new Map(
    raw
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const separator = entry.includes("=") ? "=" : ":";
        const [nodeId, ...secretParts] = entry.split(separator);
        return [(nodeId ?? "").trim(), secretParts.join(separator).trim()] as const;
      })
      .filter(([nodeId, secret]) => Boolean(nodeId && secret))
  );
}

function requireSignerHmac(request: Request, rawBody: string, keys: Map<string, string>): NextResponse | null {
  const signerId = getSignerNodeId(request);
  const timestamp = request.headers.get("x-safegit-timestamp");
  const signature = request.headers.get("x-safegit-signature")?.replace(/^sha256=/u, "");
  if (!signerId || !timestamp || !signature) {
    return NextResponse.json({ error: "unauthorized signer" }, { status: 401 });
  }
  const secret = keys.get(signerId);
  if (!secret) {
    return NextResponse.json({ error: "unauthorized signer" }, { status: 401 });
  }
  const timestampNumber = Number(timestamp);
  const maxSkewSeconds = Number(process.env.SIGNER_AUTH_MAX_SKEW_SECONDS ?? 300);
  if (!Number.isFinite(timestampNumber) || Math.abs(Math.floor(Date.now() / 1000) - timestampNumber) > maxSkewSeconds) {
    return NextResponse.json({ error: "stale signer authentication" }, { status: 401 });
  }
  const bodyHash = createHash("sha256").update(rawBody).digest("hex");
  const path = new URL(request.url).pathname;
  const message = [request.method, path, timestamp, bodyHash].join("\n");
  const expected = createHmac("sha256", secret).update(message).digest("hex");
  if (!safeEqual(expected, signature)) {
    return NextResponse.json({ error: "unauthorized signer" }, { status: 401 });
  }
  return null;
}
