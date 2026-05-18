import { NextResponse } from "next/server";
import { nowIso, randomHex } from "@safe-git/core";
import { seedDemoState } from "@/lib/demoData";
import { getSignerNodeId, requireSignerRequestAuth } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { enforceRateLimit } from "@/lib/rateLimit";
import { getRuntimeStore } from "@safe-git/db";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const rateLimitError = enforceRateLimit(request, "signer-round1");
  if (rateLimitError) {
    return rateLimitError;
  }
  const rawBody = await request.text();
  const authError = requireSignerRequestAuth(request, rawBody);
  if (authError) {
    return authError;
  }
  const store = await getRuntimeStore();
  await seedDemoState(store);
  const { id } = await context.params;
  const session = await store.getSession(id);
  if (!session) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }
  if (!["round1_open", "round1_complete"].includes(session.status)) {
    return NextResponse.json({ error: `session is not accepting round1 commitments: ${session.status}` }, { status: 409 });
  }
  const body = parseBody(rawBody) as { signerNodeId?: string; commitment?: Record<string, unknown>; commitmentId?: string };
  const signerNodeId = getSignerNodeId(request) ?? body.signerNodeId;
  if (!signerNodeId) {
    return NextResponse.json({ error: "signerNodeId is required" }, { status: 400 });
  }
  if (!session.selectedSigners.includes(signerNodeId)) {
    return NextResponse.json({ error: "signer was not selected for this session" }, { status: 403 });
  }
  const now = nowIso();
  const existingNode = await store.getSignerNode(signerNodeId);
  await store.upsertSignerNode({
    id: signerNodeId,
    nodeName: existingNode?.nodeName ?? signerNodeId,
    ...(existingNode?.publicAuthKey ? { publicAuthKey: existingNode.publicAuthKey } : {}),
    status: existingNode?.status === "compromised" ? "compromised" : "active",
    lastSeenAt: now,
    createdAt: existingNode?.createdAt ?? now,
    updatedAt: now
  });
  const commitmentId = body.commitmentId ?? `commitment_${randomHex().slice(2, 18)}`;
  const commitment = await store.upsertRound1Commitment({
    id: `${id}:${signerNodeId}`,
    sessionId: id,
    signerNodeId,
    commitment: body.commitment ?? { commitmentId },
    createdAt: now
  });
  const commitments = await store.listRound1Commitments(id);
  const thresholdReached = commitments.length >= session.threshold.required;
  const nextSession = await store.upsertSession({
    ...session,
    status: thresholdReached ? "round2_open" : "round1_open",
    audit: [...session.audit, `${signerNodeId} submitted round1 commitment ${commitmentId}`]
  });
  await recordAuditEvent(store, {
    eventType: "signer.round1_commitment",
    actorType: "signer",
    actorId: signerNodeId,
    proposalId: session.proposalId,
    sessionId: id,
    metadata: { commitmentId: commitment.id, commitmentCount: commitments.length, thresholdReached }
  });
  return NextResponse.json({ session: nextSession, commitmentCount: commitments.length, thresholdReached });
}

function parseBody(rawBody: string): Record<string, unknown> {
  if (!rawBody.trim()) {
    return {};
  }
  return JSON.parse(rawBody) as Record<string, unknown>;
}
