import { NextResponse } from "next/server";
import { requireAdminMutationAuth } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { openProposalPullRequest } from "@/lib/githubApp";
import { enforceRateLimit } from "@/lib/rateLimit";
import { seedDemoState } from "@/lib/demoData";
import { getRuntimeStore } from "@safe-git/db";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const rateLimitError = enforceRateLimit(request, "open-pr");
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
  const pullRequest = await openProposalPullRequest({ proposal });
  await recordAuditEvent(store, {
    eventType: "github.pull_request_opened",
    actorType: "admin",
    proposalId: proposal.id,
    metadata: { result: pullRequest }
  });
  return NextResponse.json({ ok: true, pullRequest });
}
