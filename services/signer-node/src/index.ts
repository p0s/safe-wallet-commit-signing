import { assertDevSignerAllowed } from "@safe-git/core";
import { verifyOnchainSafeApproval } from "@safe-git/safe";
import { verifySafeApproval } from "@safe-git/verifier";
import type { GitCommitIntent, SafeProof, SigningSessionStatus, VerificationSummary } from "@safe-git/core";

export interface SignerPolicy {
  nodeName: string;
  allowedRepo: `${string}/${string}`;
  allowedRef: string;
  allowedSafeAddress: string;
  allowedChainId: number;
  signingKeyId: string;
  signingKeyFingerprint: string;
}

export interface SignerTask {
  sessionId: string;
  proposalId: string;
  phase: "round1_open" | "round2_open";
  intent: GitCommitIntent;
  intentHash: `0x${string}`;
  safeProof: SafeProof;
}

function allowDevApprovalByEnv(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.SAFE_GIT_ENV === "development";
}

export interface SignerSessionState {
  status: SigningSessionStatus;
  burnedNonceCommitments: string[];
  selectedSigners: string[];
  audit: string[];
}

export function verifySignerTask(task: SignerTask, policy: SignerPolicy): VerificationSummary {
  assertDevSignerAllowed();
  const checks = [
    {
      name: "policy.repo",
      passed: `${task.intent.repoOwner}/${task.intent.repoName}` === policy.allowedRepo,
      detail: `${task.intent.repoOwner}/${task.intent.repoName}`
    },
    {
      name: "policy.ref",
      passed: task.intent.targetRef === policy.allowedRef,
      detail: task.intent.targetRef
    },
    {
      name: "policy.safe",
      passed: task.safeProof.safeAddress.toLowerCase() === policy.allowedSafeAddress.toLowerCase(),
      detail: task.safeProof.safeAddress
    },
    {
      name: "policy.chain",
      passed: task.safeProof.chainId === policy.allowedChainId,
      detail: String(task.safeProof.chainId)
    },
    {
      name: "policy.key",
      passed:
        task.intent.signingKeyId === policy.signingKeyId &&
        task.intent.signingKeySshFingerprintSha256 === policy.signingKeyFingerprint,
      detail: task.intent.signingKeyId
    }
  ];
  const safe = verifySafeApproval({
    intent: task.intent,
    intentHash: task.intentHash,
    proposalId: task.proposalId,
    allowDevApproval: allowDevApprovalByEnv(),
    proof: task.safeProof
  });
  return {
    ok: checks.every((check) => check.passed) && safe.ok,
    checks: [...checks, ...safe.checks]
  };
}

export async function verifySignerTaskWithOnchainApproval(
  task: SignerTask,
  policy: SignerPolicy,
  input: { rpcUrl?: string | undefined }
): Promise<VerificationSummary> {
  if (!input.rpcUrl) {
    return verifySignerTask(task, policy);
  }
  const proof = await verifyOnchainSafeApproval({
    safeAddress: task.safeProof.safeAddress,
    chainId: task.safeProof.chainId,
    safeMessageHash: task.safeProof.safeMessageHash,
    messageHash: task.intentHash,
    rpcUrl: input.rpcUrl
  });
  return verifySignerTask({ ...task, safeProof: { ...task.safeProof, ...proof } }, policy);
}

export function buildRoundAudit(task: SignerTask, policy: SignerPolicy): string[] {
  const result = verifySignerTask(task, policy);
  if (!result.ok) {
    throw new Error(`Signer policy rejected task ${task.sessionId}`);
  }
  return [
    `${policy.nodeName}: verified repo/ref/Safe/key policy`,
    `${policy.nodeName}: verified Safe proof and deadline`,
    `${policy.nodeName}: policy attestation emitted for ${task.phase}`
  ];
}

export function transitionSession(
  state: SignerSessionState,
  event:
    | { type: "safe_verified" }
    | { type: "nonce_reserved" }
    | { type: "round1_open"; signers: string[] }
    | { type: "round1_commitment"; signer: string; commitmentId: string }
    | { type: "round2_share"; signer: string }
    | { type: "signature_aggregated" }
    | { type: "commit_verified" }
    | { type: "pushed" }
    | { type: "receipt_published" }
    | { type: "abort"; reason: string }
): SignerSessionState {
  const append = (status: SigningSessionStatus, detail: string): SignerSessionState => ({
    ...state,
    status,
    audit: [...state.audit, detail]
  });

  if (event.type === "safe_verified") {
    return append("safe_verified", "Safe proof verified");
  }
  if (event.type === "nonce_reserved") {
    return append("nonce_reserved", "nonce reserved");
  }
  if (event.type === "round1_open") {
    return { ...append("round1_open", `round1 opened for ${event.signers.join(",")}`), selectedSigners: event.signers };
  }
  if (event.type === "round1_commitment") {
    return append("round1_complete", `${event.signer} submitted round1 commitment ${event.commitmentId}`);
  }
  if (event.type === "round2_share") {
    return append("round2_complete", `${event.signer} submitted round2 share`);
  }
  if (event.type === "signature_aggregated") {
    return append("signature_aggregated", "signature shares aggregated");
  }
  if (event.type === "commit_verified") {
    return append("commit_verified", "signed commit verified");
  }
  if (event.type === "pushed") {
    return append("pushed", "commit pushed");
  }
  if (event.type === "receipt_published") {
    return append("receipt_published", "receipt published");
  }
  return {
    ...state,
    status: "failed",
    burnedNonceCommitments: [...state.burnedNonceCommitments, ...state.selectedSigners],
    audit: [...state.audit, `abort: ${event.reason}; nonce commitments burned`]
  };
}

export function selectReplacementSigner(
  state: SignerSessionState,
  failedSigner: string,
  candidates: string[]
): SignerSessionState {
  const remaining = state.selectedSigners.filter((signer) => signer !== failedSigner);
  const replacement = candidates.find((candidate) => candidate !== failedSigner && !remaining.includes(candidate));
  if (!replacement) {
    return {
      ...state,
      status: "failed",
      burnedNonceCommitments: [...state.burnedNonceCommitments, failedSigner],
      audit: [...state.audit, `abort: no replacement signer available for ${failedSigner}; nonce commitments burned`]
    };
  }
  return {
    ...state,
    selectedSigners: [...remaining, replacement],
    burnedNonceCommitments: [...state.burnedNonceCommitments, failedSigner],
    audit: [...state.audit, `${failedSigner} failed; replaced with ${replacement}; failed nonce commitment burned`]
  };
}
