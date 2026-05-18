import { NextResponse } from "next/server";
import { seedDemoState } from "@/lib/demoData";
import { hasAdminReadAuth } from "@/lib/auth";
import { isPublicProposalId, publicProposal } from "@/lib/publicAccess";
import { getRuntimeStore } from "@safe-git/db";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const store = await getRuntimeStore();
  await seedDemoState(store);
  const { id } = await context.params;
  const proposal = await store.getProposal(id);
  if (!proposal) {
    return NextResponse.json({ error: "proposal not found" }, { status: 404 });
  }
  if (hasAdminReadAuth(request)) {
    return NextResponse.json(proposal);
  }
  if (!isPublicProposalId(id)) {
    return NextResponse.json({ error: "proposal not found" }, { status: 404 });
  }
  return NextResponse.json(publicProposal(proposal, await store.getReceipt(id)));
}
