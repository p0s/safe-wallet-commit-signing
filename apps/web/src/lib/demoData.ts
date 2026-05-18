import { buildIntent, nowIso } from "@safe-git/core";
import type { RuntimeStore } from "@safe-git/db";
import type { CommitReceipt, FileChange, ProposalRecord, SafeProof, SigningSessionRecord } from "@safe-git/core";

const createdAt = "2026-05-18T00:00:00.000Z";
const parent = "158b6831ff7893a3b9d1370dbd5ed74349699fe4";
const tree = "417bbc9aad208489098836eca3bfbcfb4d2cc6ef";
const fingerprint = "SHA256:qoZVb4ipEg85+3B85vci62bzhQGOTXXA1w6zZzPN4uk";
const demoSafeAddress = "0xe4acA85aD9826d15385D32CDd78DeA836c862dDb" as const;
const demoSafeChainId = 11155111;
const demoSafeDeploymentTxHash = "0xbf101d454b96431a6be205930a94ae1bd67406140d50beb07532ce6bb3ee6bee" as const;
const demoSafeApprovalTxHash = "0x1b5682fffa4d6506246694fac1f8fe6435927be1b516e3c7c44416a1a1076294" as const;
const fileChanges: FileChange[] = [
  {
    path: "README.md",
    operation: "upsert",
    contentBase64: Buffer.from("# SafeGit protected update\n").toString("base64")
  }
];

export async function seedDemoState(store: RuntimeStore): Promise<ProposalRecord> {
  const existing = await store.getProposal("prop_demo");
  if (existing) {
    return existing;
  }
  const safeAddress = (process.env.SAFE_ADDRESS ?? demoSafeAddress) as `0x${string}`;
  const chainId = Number(process.env.SAFE_CHAIN_ID ?? demoSafeChainId);
  const built = buildIntent({
    repoHost: "github.com",
    repoOwner: "p0s",
    repoName: "safe-wallet-commit-signing",
    targetRef: "refs/heads/main",
    expectedParentOid: parent,
    treeOid: tree,
    diffText: "diff --git a/README.md b/README.md\n+SafeGit protected update\n",
    fileChanges,
    commitMessage: "Prove Safe-approved threshold signing\n",
    author: {
      name: "Alice Example",
      email: "alice@example.com",
      unixSeconds: 1770000000,
      timezone: "+0000"
    },
    committer: {
      name: process.env.SAFEGIT_COMMITTER_NAME ?? "Safe Git Bot",
      email: process.env.SAFEGIT_COMMITTER_EMAIL ?? "safe-git-bot@example.com",
      unixSeconds: 1770000000,
      timezone: "+0000"
    },
    signingKeyId: process.env.SIGNING_KEY_ID ?? "safegit-dev-1",
    signingKeyFingerprint: process.env.SIGNING_PUBLIC_KEY_FINGERPRINT_SHA256 || fingerprint,
    safeAddress,
    chainId,
    nonce: "0x0000000000000000000000000000000000000000000000000000000000000007",
    deadlineUnixSeconds: 1790000000
  });
  const proposal: ProposalRecord = {
    id: "prop_demo",
    status: "safe_approved",
    intent: built.intent,
    typedData: built.typedData,
    intentHash: built.intentHash,
    safeProof: demoSafeProof(safeAddress, chainId, built.safeMessageHash),
    commitMessage: "Prove Safe-approved threshold signing\n",
    diffText: "diff --git a/README.md b/README.md\n+SafeGit protected update\n",
    fileChanges,
    createdAt,
    updatedAt: createdAt
  };
  await store.upsertProposal(proposal);
  await store.upsertSession(seedSession());
  await store.upsertReceipt(seedReceipt(built.intentHash, built.safeMessageHash));
  return proposal;
}

export function seedSession(): SigningSessionRecord {
  return {
    id: "sess_demo",
    proposalId: "prop_demo",
    status: "commit_verified",
    selectedSigners: ["signer-a", "signer-b"],
    threshold: { required: 2, total: 3 },
    audit: [
      "signer-a verified repo/ref/Safe/key policy",
      "signer-b verified repo/ref/Safe/key policy",
      "coordinator aggregated 2-of-3 FROST Ed25519 transcript in local E2E"
    ],
    createdAt,
    updatedAt: createdAt
  };
}

export function seedReceipt(intentHash: string, safeMessageHash: `0x${string}`): CommitReceipt {
  const githubHtmlUrl = process.env.SAFE_DEMO_GITHUB_COMMIT_URL;
  return {
    id: "receipt_demo",
    proposalId: "prop_demo",
    sessionId: "sess_demo",
    finalCommitOid: "d500f57b79d339e584b9317bc8dac1864d3db61e",
    signedCommitPayloadSha256: "0x5d4353892d1ddde3e0ee0568da0652d8b1a63453c62af70c0d6e8fa2fd16be1f",
    armoredSshSignatureSha256: "0x42c7591ab188dbe468a4923435cb1bb5d0d4cc1c06f6a7ffc596166a80e9c7e3",
    ...(githubHtmlUrl ? { githubHtmlUrl } : {}),
    intentHash: intentHash as `0x${string}`,
    safeMessageHash,
    verifyResult: {
      ok: true,
      checks: [
        { name: "commit.signature", passed: true, detail: "2-of-3 FROST Ed25519 SSHSIG verified locally" },
        {
          name: "safe.approval",
          passed: true,
          detail:
            process.env.SAFE_GIT_ENV !== "development"
              ? `Sepolia 2-of-3 Safe on-chain approval ${process.env.SAFE_DEMO_APPROVAL_TX_HASH ?? demoSafeApprovalTxHash}`
              : "dev Safe proof; production uses EIP-1271 on-chain validation"
        },
        { name: "nonce.replay", passed: true, detail: "nonce consumed by prop_demo" }
      ]
    },
    createdAt
  };
}

export async function createProposalFromRequest(body: Record<string, unknown>, store: RuntimeStore): Promise<ProposalRecord> {
  const id = `prop_${Date.now().toString(36)}`;
  const commitMessage = String(body.commitMessage ?? "Update protected files\n");
  const changes = (body.fileChanges as FileChange[] | undefined) ?? fileChanges;
  const safeAddress = (process.env.SAFE_ADDRESS ?? demoSafeAddress) as `0x${string}`;
  const chainId = Number(process.env.SAFE_CHAIN_ID ?? demoSafeChainId);
  const built = buildIntent({
    repoHost: "github.com",
    repoOwner: String(body.repoOwner ?? "p0s"),
    repoName: String(body.repoName ?? "safe-wallet-commit-signing"),
    targetRef: `refs/heads/${String(body.targetBranch ?? "main")}`,
    expectedParentOid: String(body.expectedParentOid ?? parent),
    treeOid: String(body.treeOid ?? tree),
    diffText: String(body.diffText ?? ""),
    fileChanges: changes,
    commitMessage,
    author: {
      name: String(body.authorName ?? "Alice Example"),
      email: String(body.authorEmail ?? "alice@example.com"),
      unixSeconds: Math.floor(Date.now() / 1000),
      timezone: "+0000"
    },
    committer: {
      name: process.env.SAFEGIT_COMMITTER_NAME ?? "Safe Git Bot",
      email: process.env.SAFEGIT_COMMITTER_EMAIL ?? "safe-git-bot@example.com",
      unixSeconds: Math.floor(Date.now() / 1000),
      timezone: "+0000"
    },
    signingKeyId: process.env.SIGNING_KEY_ID ?? "safegit-dev-1",
    signingKeyFingerprint: process.env.SIGNING_PUBLIC_KEY_FINGERPRINT_SHA256 || fingerprint,
    safeAddress,
    chainId,
    nonce: `0x${Date.now().toString(16).padStart(64, "0")}`,
    deadlineUnixSeconds: Math.floor(Date.now() / 1000) + 3600
  });
  const proposal: ProposalRecord = {
    id,
    status: "awaiting_safe_approval",
    intent: built.intent,
    typedData: built.typedData,
    intentHash: built.intentHash,
    safeProof: {
      safeAddress,
      chainId,
      safeMessageHash: built.safeMessageHash,
      approvalStatus: "missing"
    },
    commitMessage,
    diffText: String(body.diffText ?? ""),
    fileChanges: changes,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  return store.upsertProposal(proposal);
}

function demoSafeProof(safeAddress: `0x${string}`, chainId: number, safeMessageHash: `0x${string}`): SafeProof {
  const approvalTxHash = (process.env.SAFE_DEMO_APPROVAL_TX_HASH ?? demoSafeApprovalTxHash) as `0x${string}`;
  const owners = (process.env.SAFE_DEMO_OWNER_ADDRESSES?.split(",") ?? [])
    .map((owner) => owner.trim())
    .filter(Boolean) as `0x${string}`[];
  const exposeOwners = process.env.SAFE_GIT_EXPOSE_OWNER_ADDRESSES === "true" && owners.length > 0;
  if (process.env.SAFE_GIT_ENV !== "development") {
    return {
      safeAddress,
      chainId,
      safeMessageHash,
      approvalStatus: "onchain_approved",
      threshold: Number(process.env.SAFE_DEMO_THRESHOLD ?? 2),
      totalOwners: Number(process.env.SAFE_DEMO_TOTAL_OWNERS ?? (owners.length || 3)),
      ...(exposeOwners ? { owners } : {}),
      deploymentTxHash: (process.env.SAFE_DEMO_DEPLOYMENT_TX_HASH ?? demoSafeDeploymentTxHash) as `0x${string}`,
      deploymentBlockNumber: Number(process.env.SAFE_DEMO_DEPLOYMENT_BLOCK_NUMBER ?? 10871780),
      approvalTxHash,
      approvalBlockNumber: Number(process.env.SAFE_DEMO_APPROVAL_BLOCK_NUMBER ?? 10871943),
      verifiedAt: "2026-05-18T03:04:00.000Z"
    };
  }
  return {
    safeAddress,
    chainId,
    safeMessageHash,
    approvalStatus: "dev_approved",
    threshold: 2,
    totalOwners: 3,
    approvalTxHash: "0x00000000000000000000000000000000000000000000000000000000deadc0de",
    approvalBlockNumber: 0,
    verifiedAt: new Date().toISOString()
  };
}
