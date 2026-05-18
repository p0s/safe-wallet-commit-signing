import { NextResponse } from "next/server";
import { nowIso, randomHex } from "@safe-git/core";
import { seedDemoState } from "@/lib/demoData";
import { getSignerNodeId, requireSignerRequestAuth } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { enforceRateLimit } from "@/lib/rateLimit";
import { getRuntimeStore } from "@safe-git/db";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const rateLimitError = enforceRateLimit(request, "signer-round2");
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
  if (!["round2_open", "round2_complete"].includes(session.status)) {
    return NextResponse.json({ error: `session is not accepting round2 shares: ${session.status}` }, { status: 409 });
  }
  const body = parseBody(rawBody) as {
    signerNodeId?: string;
    signatureShare?: Record<string, unknown>;
    shareId?: string;
    valid?: boolean;
  };
  const signerNodeId = getSignerNodeId(request) ?? body.signerNodeId;
  if (!signerNodeId) {
    return NextResponse.json({ error: "signerNodeId is required" }, { status: 400 });
  }
  if (!session.selectedSigners.includes(signerNodeId)) {
    return NextResponse.json({ error: "signer was not selected for this session" }, { status: 403 });
  }
  const commitments = await store.listRound1Commitments(id);
  if (commitments.length < session.threshold.required) {
    return NextResponse.json({ error: "round1 threshold has not completed" }, { status: 409 });
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
  const shareId = body.shareId ?? `share_${randomHex().slice(2, 18)}`;
  await store.upsertRound2Share({
    id: `${id}:${signerNodeId}`,
    sessionId: id,
    signerNodeId,
    signatureShare: body.signatureShare ?? { shareId },
    valid: body.valid ?? true,
    createdAt: now
  });
  const shares = await store.listRound2Shares(id);
  const validShareCount = shares.filter((share) => share.valid !== false).length;
  const thresholdReached = validShareCount >= session.threshold.required;
  const nextSession = await store.upsertSession({
    ...session,
    status: thresholdReached ? "round2_complete" : "round2_open",
    audit: [...session.audit, `${signerNodeId} submitted round2 share ${shareId}`]
  });
  await recordAuditEvent(store, {
    eventType: "signer.round2_share",
    actorType: "signer",
    actorId: signerNodeId,
    proposalId: session.proposalId,
    sessionId: id,
    metadata: { shareCount: validShareCount, thresholdReached }
  });
  return NextResponse.json({ session: nextSession, validShareCount, thresholdReached });
}

function parseBody(rawBody: string): Record<string, unknown> {
  if (!rawBody.trim()) {
    return {};
  }
  return JSON.parse(rawBody) as Record<string, unknown>;
}
