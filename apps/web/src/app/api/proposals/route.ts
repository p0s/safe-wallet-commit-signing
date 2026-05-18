import { NextResponse } from "next/server";
import { createProposalFromRequest, seedDemoState } from "@/lib/demoData";
import { hasAdminReadAuth, requireAdminMutationAuth } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { enforceRateLimit } from "@/lib/rateLimit";
import { isPublicProposalId, publicProposal } from "@/lib/publicAccess";
import { getRuntimeStore } from "@safe-git/db";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const store = await getRuntimeStore();
  await seedDemoState(store);
  const proposals = await store.listProposals();
  if (hasAdminReadAuth(request)) {
    return NextResponse.json({ proposals });
  }
  const publicProposals = await Promise.all(
    proposals
      .filter((proposal) => isPublicProposalId(proposal.id))
      .map(async (proposal) => publicProposal(proposal, await store.getReceipt(proposal.id)))
  );
  return NextResponse.json({ proposals: publicProposals });
}

export async function POST(request: Request) {
  const rateLimitError = enforceRateLimit(request, "proposal-create");
  if (rateLimitError) {
    return rateLimitError;
  }
  const authError = requireAdminMutationAuth(request);
  if (authError) {
    return authError;
  }
  const contentType = request.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? ((await request.json()) as Record<string, unknown>)
    : Object.fromEntries((await request.formData()).entries());
  const store = await getRuntimeStore();
  const proposal = await createProposalFromRequest(body, store);
  await recordAuditEvent(store, {
    eventType: "proposal.created",
    actorType: "admin",
    proposalId: proposal.id,
    metadata: {
      repo: `${proposal.intent.repoOwner}/${proposal.intent.repoName}`,
      ref: proposal.intent.targetRef,
      intentHash: proposal.intentHash
    }
  });
  return NextResponse.json({
    proposalId: proposal.id,
    intentHash: proposal.intentHash,
    safeMessageHash: proposal.safeProof.safeMessageHash,
    approvalUrl: `/proposals/${proposal.id}`,
    status: proposal.status
  });
}
