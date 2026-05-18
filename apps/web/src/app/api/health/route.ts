import { NextResponse } from "next/server";
import { isProductionLike } from "@/lib/auth";
import { getRuntimeStore } from "@safe-git/db";

export const runtime = "nodejs";

export async function GET() {
  const store = await getRuntimeStore();
  const signerNodes = await store.listSignerNodes();
  return NextResponse.json({
    ok: true,
    service: "safe-git-threshold",
    productionLike: isProductionLike(),
    database: process.env.DATABASE_URL ? "postgres" : "memory",
    signerAuthMode: process.env.SIGNER_NODE_KEYS
      ? "node_hmac"
      : process.env.SIGNER_COORDINATOR_SHARED_SECRET
        ? "shared_secret"
        : "unconfigured",
    githubAppConfigured: Boolean(
      process.env.GITHUB_APP_ID &&
        process.env.GITHUB_INSTALLATION_ID &&
        (process.env.GITHUB_APP_PRIVATE_KEY_BASE64 || process.env.GITHUB_APP_PRIVATE_KEY)
    ),
    safeRpcConfigured: Boolean(process.env.SAFE_RPC_URL),
    signerNodes: {
      total: signerNodes.length,
      active: signerNodes.filter((node) => node.status === "active").length,
      compromised: signerNodes.filter((node) => node.status === "compromised").length
    }
  });
}
