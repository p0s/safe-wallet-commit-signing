import { NextResponse } from "next/server";
import { seedDemoState } from "@/lib/demoData";
import { requireAdminMutationAuth } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { enforceRateLimit } from "@/lib/rateLimit";
import { getRuntimeStore } from "@safe-git/db";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const rateLimitError = enforceRateLimit(request, "proposal-cancel");
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
  const updated = await store.upsertProposal({ ...proposal, status: "cancelled" });
  await recordAuditEvent(store, {
    eventType: "proposal.cancelled",
    actorType: "admin",
    proposalId: proposal.id
  });
  return NextResponse.json(updated);
}
