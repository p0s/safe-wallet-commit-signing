import { NextResponse } from "next/server";
import { requireAdminMutationAuth } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { enforceRateLimit } from "@/lib/rateLimit";
import { publishSafeGitCheck } from "@/lib/githubApp";
import { seedDemoState } from "@/lib/demoData";
import { getRuntimeStore } from "@safe-git/db";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const rateLimitError = enforceRateLimit(request, "publish-check");
  if (rateLimitError) {
    return rateLimitError;
  }
  const authError = requireAdminMutationAuth(request);
  if (authError) {
    return authError;
  }
  const { id } = await context.params;
  const store = await getRuntimeStore();
  await seedDemoState(store);
  const proposal = await store.getProposal(id);
  if (!proposal) {
    return NextResponse.json({ error: "proposal not found" }, { status: 404 });
  }
  const receipt = await store.getReceipt(id);
  if (!receipt) {
    return NextResponse.json({ error: "receipt not found" }, { status: 404 });
  }
  const check = await publishSafeGitCheck({ proposal, receipt });
  await recordAuditEvent(store, {
    eventType: "github.check_published",
    actorType: "admin",
    proposalId: proposal.id,
    sessionId: receipt.sessionId,
    metadata: { commitOid: receipt.finalCommitOid, check }
  });
  return NextResponse.json({ ok: true, check });
}
