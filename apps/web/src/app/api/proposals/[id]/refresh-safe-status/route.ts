import { NextResponse } from "next/server";
import { seedDemoState } from "@/lib/demoData";
import { allowDevSafeApproval, requireAdminMutationAuth } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { enforceRateLimit } from "@/lib/rateLimit";
import { getRuntimeStore } from "@safe-git/db";
import { devSafeProof, verifyOnchainSafeApproval } from "@safe-git/safe";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const rateLimitError = enforceRateLimit(request, "refresh-safe-status");
  if (rateLimitError) {
    return rateLimitError;
  }
  const authError = requireAdminMutationAuth(request);
  if (authError) {
    return authError;
  }
  const store = await getRuntimeStore();
  await seedDemoState(store);
  const { id } = await context.params;
  const proposal = await store.getProposal(id);
  if (!proposal) {
    return NextResponse.json({ error: "proposal not found" }, { status: 404 });
  }
  const proof =
    process.env.SAFE_RPC_URL && process.env.SAFE_GIT_ENV !== "development"
      ? await verifyOnchainSafeApproval({
          safeAddress: proposal.safeProof.safeAddress,
          chainId: proposal.safeProof.chainId,
          safeMessageHash: proposal.safeProof.safeMessageHash,
          messageHash: proposal.intentHash,
          rpcUrl: process.env.SAFE_RPC_URL
        })
      : devSafeProof({
          safeAddress: proposal.safeProof.safeAddress,
          chainId: proposal.safeProof.chainId,
          safeMessageHash: proposal.safeProof.safeMessageHash
        });
  const safeProof = { ...proposal.safeProof, ...proof };
  const approved =
    safeProof.approvalStatus === "onchain_approved" ||
    (allowDevSafeApproval() && safeProof.approvalStatus === "dev_approved");
  const updated = await store.upsertProposal({
    ...proposal,
    safeProof,
    status: approved ? "safe_approved" : "awaiting_safe_approval"
  });
  await recordAuditEvent(store, {
    eventType: "safe.approval_refreshed",
    actorType: "admin",
    proposalId: proposal.id,
    metadata: { approvalStatus: safeProof.approvalStatus, approvalTxHash: safeProof.approvalTxHash }
  });
  return NextResponse.json(updated);
}
