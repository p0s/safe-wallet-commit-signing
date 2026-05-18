import { NextResponse } from "next/server";
import { seedDemoState } from "@/lib/demoData";
import { getSignerNodeId, requireSignerAuth } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { enforceRateLimit } from "@/lib/rateLimit";
import { getRuntimeStore } from "@safe-git/db";
import { nowIso } from "@safe-git/core";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const rateLimitError = enforceRateLimit(request, "signer-tasks");
  if (rateLimitError) {
    return rateLimitError;
  }
  const authError = requireSignerAuth(request);
  if (authError) {
    return authError;
  }
  const store = await getRuntimeStore();
  await seedDemoState(store);
  const signerNodeId = getSignerNodeId(request);
  if (signerNodeId) {
    const existing = await store.getSignerNode(signerNodeId);
    await store.upsertSignerNode({
      id: signerNodeId,
      nodeName: existing?.nodeName ?? signerNodeId,
      ...(existing?.publicAuthKey ? { publicAuthKey: existing.publicAuthKey } : {}),
      status: existing?.status === "compromised" ? "compromised" : "active",
      lastSeenAt: nowIso(),
      createdAt: existing?.createdAt ?? nowIso(),
      updatedAt: nowIso()
    });
    await recordAuditEvent(store, {
      eventType: "signer.tasks_polled",
      actorType: "signer",
      actorId: signerNodeId
    });
  }
  const tasks = await store.listSignerTasks();
  const visibleTasks = signerNodeId
    ? tasks.filter((task) => task.selectedSigners.includes(signerNodeId))
    : tasks;
  return NextResponse.json({ tasks: visibleTasks });
}
