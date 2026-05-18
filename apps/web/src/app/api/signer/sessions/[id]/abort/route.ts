import { NextResponse } from "next/server";
import { seedDemoState } from "@/lib/demoData";
import { getSignerNodeId, requireSignerRequestAuth } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { enforceRateLimit } from "@/lib/rateLimit";
import { getRuntimeStore } from "@safe-git/db";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const rateLimitError = enforceRateLimit(request, "signer-abort");
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
  const body = parseBody(rawBody) as { reason?: string; signerNodeId?: string };
  const signerNodeId = getSignerNodeId(request) ?? body.signerNodeId ?? "unknown";
  const reason = body.reason ?? "signer aborted";
  const updated = await store.upsertSession({
    ...session,
    status: "failed",
    error: reason,
    audit: [...session.audit, `abort by ${signerNodeId}: ${reason}; nonce commitments burned`]
  });
  await recordAuditEvent(store, {
    eventType: "signer.session_aborted",
    actorType: "signer",
    actorId: signerNodeId,
    proposalId: session.proposalId,
    sessionId: id,
    metadata: { reason, burnedNonceCommitments: session.selectedSigners }
  });
  return NextResponse.json(updated);
}

function parseBody(rawBody: string): Record<string, unknown> {
  if (!rawBody.trim()) {
    return {};
  }
  return JSON.parse(rawBody) as Record<string, unknown>;
}
