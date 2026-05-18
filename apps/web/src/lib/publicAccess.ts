import type { CommitReceipt, ProposalRecord, SafeProof } from "@safe-git/core";

const defaultPublicProposalIds = ["prop_demo", "prop_safegit_root_main"];

export function publicProposalIds(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const raw = env.SAFE_GIT_PUBLIC_PROPOSAL_IDS;
  const ids = raw === undefined ? defaultPublicProposalIds : raw.split(",");
  return new Set(ids.map((id) => id.trim()).filter(Boolean));
}

export function isPublicProposalId(id: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return publicProposalIds(env).has(id);
}

export function publicSafeProof(proof: SafeProof, env: NodeJS.ProcessEnv = process.env): SafeProof {
  if (env.SAFE_GIT_EXPOSE_OWNER_ADDRESSES === "true") {
    return proof;
  }
  const { owners: _owners, ...redacted } = proof;
  return redacted;
}

export function publicProposal(proposal: ProposalRecord, receipt?: CommitReceipt): Record<string, unknown> {
  const { diffText: _diffText, fileChanges: _fileChanges, safeProof, ...rest } = proposal;
  return {
    ...rest,
    safeProof: publicSafeProof(safeProof),
    ...(receipt ? { receipt: publicReceipt(receipt) } : {}),
    public: true
  };
}

export function publicReceipt(receipt: CommitReceipt): CommitReceipt {
  return receipt;
}
