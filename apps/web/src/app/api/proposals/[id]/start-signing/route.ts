import { NextResponse } from "next/server";
import { nowIso } from "@safe-git/core";
import { seedDemoState } from "@/lib/demoData";
import { allowDevSafeApproval, requireAdminMutationAuth } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { enforceRateLimit } from "@/lib/rateLimit";
import { getRuntimeStore } from "@safe-git/db";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const rateLimitError = enforceRateLimit(request, "start-signing");
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
  const approved =
    proposal.safeProof.approvalStatus === "onchain_approved" ||
    (allowDevSafeApproval() && proposal.safeProof.approvalStatus === "dev_approved");
  if (!approved) {
    return NextResponse.json({ error: "safe approval is required before signing" }, { status: 409 });
  }
  try {
    await store.reserveNonce(proposal.intent.nonce, proposal.id);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 409 });
  }
  const body = (await request.json().catch(() => ({}))) as { selectedSigners?: string[] };
  const thresholdRequired = Number(process.env.SIGNING_THRESHOLD_T ?? 2);
  const thresholdTotal = Number(process.env.SIGNING_TOTAL_N ?? 3);
  const configuredSigners = (process.env.SIGNER_NODE_IDS ?? "signer-a,signer-b,signer-c")
    .split(",")
    .map((signer) => signer.trim())
    .filter(Boolean);
  const selectedSigners = (body.selectedSigners?.length ? body.selectedSigners : configuredSigners).slice(
    0,
    thresholdTotal
  );
  for (const signer of selectedSigners) {
    await store.upsertSignerNode({
      id: signer,
      nodeName: signer,
      status: "inactive",
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
  }
  const session = await store.upsertSession({
    id: `sess_${proposal.id}`,
    proposalId: proposal.id,
    status: "round1_open",
    selectedSigners,
    threshold: { required: thresholdRequired, total: thresholdTotal },
    audit: ["nonce reserved", `round1 opened for ${selectedSigners.join(",")}`],
    createdAt: nowIso(),
    updatedAt: nowIso()
  });
  await store.upsertProposal({ ...proposal, status: "signing" });
  await recordAuditEvent(store, {
    eventType: "signing_session.started",
    actorType: "admin",
    proposalId: proposal.id,
    sessionId: session.id,
    metadata: { selectedSigners, thresholdRequired, thresholdTotal }
  });
  return NextResponse.json(session);
}
