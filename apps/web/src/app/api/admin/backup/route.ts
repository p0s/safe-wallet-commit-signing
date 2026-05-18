import { NextResponse } from "next/server";
import type { RuntimeBackup } from "@safe-git/core";
import { requireAdminMutationAuth } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { enforceRateLimit } from "@/lib/rateLimit";
import { getRuntimeStore } from "@safe-git/db";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const rateLimitError = enforceRateLimit(request, "admin-backup");
  if (rateLimitError) {
    return rateLimitError;
  }
  const authError = requireAdminMutationAuth(request);
  if (authError) {
    return authError;
  }
  const store = await getRuntimeStore();
  const backup = await store.exportBackup();
  await recordAuditEvent(store, {
    eventType: "admin.backup_exported",
    actorType: "admin",
    metadata: {
      proposalCount: backup.records.proposals.length,
      receiptCount: backup.records.receipts.length
    }
  });
  return NextResponse.json(backup);
}

export async function POST(request: Request) {
  const rateLimitError = enforceRateLimit(request, "admin-restore");
  if (rateLimitError) {
    return rateLimitError;
  }
  const authError = requireAdminMutationAuth(request);
  if (authError) {
    return authError;
  }
  const backup = (await request.json()) as RuntimeBackup;
  if (backup.version !== 1) {
    return NextResponse.json({ error: "unsupported backup version" }, { status: 400 });
  }
  const store = await getRuntimeStore();
  await store.importBackup(backup);
  await recordAuditEvent(store, {
    eventType: "admin.backup_restored",
    actorType: "admin",
    metadata: {
      proposalCount: backup.records.proposals.length,
      receiptCount: backup.records.receipts.length
    }
  });
  return NextResponse.json({ ok: true });
}
