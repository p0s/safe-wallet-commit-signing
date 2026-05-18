import { NextResponse } from "next/server";
import { hasAdminReadAuth } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rateLimit";
import { getRuntimeStore } from "@safe-git/db";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const rateLimitError = enforceRateLimit(request, "admin-audit");
  if (rateLimitError) {
    return rateLimitError;
  }
  if (!hasAdminReadAuth(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const proposalId = url.searchParams.get("proposalId") ?? undefined;
  const sessionId = url.searchParams.get("sessionId") ?? undefined;
  const limit = limitParam ? Math.min(Math.max(Number(limitParam), 1), 500) : 100;
  const store = await getRuntimeStore();
  return NextResponse.json({
    events: await store.listAuditEvents({
      ...(proposalId ? { proposalId } : {}),
      ...(sessionId ? { sessionId } : {}),
      limit
    })
  });
}
