import { NextResponse } from "next/server";
import { nowIso } from "@safe-git/core";
import { hasAdminReadAuth, requireAdminMutationAuth } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { enforceRateLimit } from "@/lib/rateLimit";
import { getRuntimeStore } from "@safe-git/db";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const rateLimitError = enforceRateLimit(request, "admin-signers");
  if (rateLimitError) {
    return rateLimitError;
  }
  if (!hasAdminReadAuth(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const store = await getRuntimeStore();
  return NextResponse.json({ signerNodes: await store.listSignerNodes() });
}

export async function POST(request: Request) {
  const rateLimitError = enforceRateLimit(request, "admin-signers-mutate");
  if (rateLimitError) {
    return rateLimitError;
  }
  const authError = requireAdminMutationAuth(request);
  if (authError) {
    return authError;
  }
  const body = (await request.json()) as {
    id?: string;
    nodeName?: string;
    publicAuthKey?: string;
    status?: "active" | "inactive" | "compromised";
  };
  if (!body.id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  const store = await getRuntimeStore();
  const existing = await store.getSignerNode(body.id);
  const now = nowIso();
  const publicAuthKey = body.publicAuthKey ?? existing?.publicAuthKey;
  const node = await store.upsertSignerNode({
    id: body.id,
    nodeName: body.nodeName ?? existing?.nodeName ?? body.id,
    ...(publicAuthKey ? { publicAuthKey } : {}),
    status: body.status ?? existing?.status ?? "inactive",
    ...(existing?.lastSeenAt ? { lastSeenAt: existing.lastSeenAt } : {}),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  });
  await recordAuditEvent(store, {
    eventType: "signer.node_upserted",
    actorType: "admin",
    actorId: body.id,
    metadata: { status: node.status, hasPublicAuthKey: Boolean(node.publicAuthKey) }
  });
  return NextResponse.json(node);
}
