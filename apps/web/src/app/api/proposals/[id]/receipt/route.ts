import { NextResponse } from "next/server";
import type { CommitReceipt } from "@safe-git/core";
import { hasAdminReadAuth, requireAdminMutationAuth } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { publishSafeGitCheck } from "@/lib/githubApp";
import { enforceRateLimit } from "@/lib/rateLimit";
import { isPublicProposalId, publicReceipt } from "@/lib/publicAccess";
import { seedDemoState } from "@/lib/demoData";
import { getRuntimeStore } from "@safe-git/db";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const store = await getRuntimeStore();
  await seedDemoState(store);
  const { id } = await context.params;
  if (!hasAdminReadAuth(request) && !isPublicProposalId(id)) {
    return NextResponse.json({ error: "receipt not found" }, { status: 404 });
  }
  const receipt = await store.getReceipt(id);
  if (!receipt) {
    return NextResponse.json({ error: "receipt not found" }, { status: 404 });
  }
  return NextResponse.json(hasAdminReadAuth(request) ? receipt : publicReceipt(receipt));
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const rateLimitError = enforceRateLimit(request, "receipt-publish");
  if (rateLimitError) {
    return rateLimitError;
  }
  const authError = requireAdminMutationAuth(request);
  if (authError) {
    return authError;
  }
  const { id } = await context.params;
  const body = (await request.json()) as CommitReceipt & { publishCheck?: boolean };
  if (body.proposalId !== id) {
    return NextResponse.json({ error: "receipt proposalId must match route proposal id" }, { status: 400 });
  }
  const { publishCheck, ...receiptBody } = body;
  if (!receiptBody.verifyResult?.ok && process.env.SAFE_GIT_ALLOW_FAILED_RECEIPTS !== "true") {
    return NextResponse.json({ error: "receipt verification result must be successful" }, { status: 422 });
  }
  const store = await getRuntimeStore();
  const proposal = await store.getProposal(id);
  if (!proposal) {
    return NextResponse.json({ error: "proposal not found" }, { status: 404 });
  }
  const receipt = await store.upsertReceipt(receiptBody);
  const existingSession = await store.getSession(receipt.sessionId);
  if (existingSession) {
    await store.upsertSession({
      ...existingSession,
      status: "receipt_published",
      audit: [...existingSession.audit, `receipt published for ${receipt.finalCommitOid}`]
    });
  }
  const updatedProposal = await store.upsertProposal({ ...proposal, status: "receipt_published" });
  const check = publishCheck ? await publishSafeGitCheck({ proposal: updatedProposal, receipt }) : undefined;
  await recordAuditEvent(store, {
    eventType: "receipt.published",
    actorType: "admin",
    proposalId: proposal.id,
    sessionId: receipt.sessionId,
    metadata: { commitOid: receipt.finalCommitOid, publishCheck: Boolean(publishCheck) }
  });
  return NextResponse.json({ ok: true, receipt, check });
}
