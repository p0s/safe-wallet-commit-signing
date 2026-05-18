import { nowIso, randomHex } from "@safe-git/core";
import type { AuditActorType } from "@safe-git/core";
import type { RuntimeStore } from "@safe-git/db";

export async function recordAuditEvent(
  store: RuntimeStore,
  input: {
    eventType: string;
    actorType: AuditActorType;
    actorId?: string;
    proposalId?: string;
    sessionId?: string;
    metadata?: Record<string, unknown>;
  }
) {
  const now = nowIso();
  const event = {
    id: `audit_${randomHex().slice(2, 18)}`,
    eventType: input.eventType,
    actorType: input.actorType,
    ...(input.actorId ? { actorId: input.actorId } : {}),
    ...(input.proposalId ? { proposalId: input.proposalId } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
    createdAt: now
  };
  await store.appendAuditEvent(event);
  return event;
}
