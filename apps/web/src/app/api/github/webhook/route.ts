import { NextResponse } from "next/server";
import { getRuntimeStore } from "@safe-git/db";
import { verifyGitHubWebhookSignature } from "@safe-git/github";
import { recordAuditEvent } from "@/lib/audit";
import { publishSafeGitCheck } from "@/lib/githubApp";
import { enforceRateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const rateLimitError = enforceRateLimit(request, "github-webhook");
  if (rateLimitError) {
    return rateLimitError;
  }
  const rawBody = await request.text();
  const signature256 = request.headers.get("x-hub-signature-256");
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret && process.env.NODE_ENV === "production" && process.env.SAFE_GIT_ENV !== "development") {
    return NextResponse.json({ error: "invalid webhook signature" }, { status: 401 });
  }
  if (secret && !verifyGitHubWebhookSignature({ rawBody, signature256, secret })) {
    return NextResponse.json({ error: "invalid webhook signature" }, { status: 401 });
  }
  const event = request.headers.get("x-github-event") ?? "unknown";
  if (event === "push") {
    return handlePushWebhook(rawBody);
  }
  return NextResponse.json({
    ok: true,
    event,
    handled: ["installation", "installation_repositories", "pull_request", "push", "check_run", "check_suite"].includes(event)
  });
}

async function handlePushWebhook(rawBody: string): Promise<NextResponse> {
  const payload = JSON.parse(rawBody) as {
    after?: string;
    ref?: string;
    repository?: { full_name?: string };
  };
  const commitOid = payload.after;
  if (!commitOid || /^0{40}$/u.test(commitOid)) {
    return NextResponse.json({ ok: true, event: "push", handled: false, reason: "push has no head commit" });
  }

  const store = await getRuntimeStore();
  const receipt = await store.findReceiptByCommit(commitOid);
  if (!receipt) {
    return NextResponse.json({ ok: true, event: "push", handled: false, reason: "no SafeGit receipt for commit" });
  }
  const proposal = await store.getProposal(receipt.proposalId);
  if (!proposal) {
    return NextResponse.json({ ok: true, event: "push", handled: false, reason: "receipt proposal is missing" });
  }
  const expectedRepo = `${proposal.intent.repoOwner}/${proposal.intent.repoName}`;
  if (payload.repository?.full_name && payload.repository.full_name !== expectedRepo) {
    return NextResponse.json({ ok: true, event: "push", handled: false, reason: "repository mismatch" });
  }
  if (payload.ref && payload.ref !== proposal.intent.targetRef) {
    return NextResponse.json({ ok: true, event: "push", handled: false, reason: "ref mismatch" });
  }

  const check = await publishSafeGitCheck({ proposal, receipt });
  await recordAuditEvent(store, {
    eventType: "github.push_verified",
    actorType: "github",
    proposalId: proposal.id,
    sessionId: receipt.sessionId,
    metadata: { commitOid, ref: payload.ref, repository: payload.repository?.full_name }
  });
  return NextResponse.json({ ok: true, event: "push", handled: true, receiptId: receipt.id, check });
}
