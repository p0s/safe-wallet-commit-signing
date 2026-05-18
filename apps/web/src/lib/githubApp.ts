import {
  buildVerificationCheckRun,
  createCheckRun,
  createPullRequest,
  createGitHubAppJwt,
  proposalBranchName,
  requestInstallationToken
} from "@safe-git/github";
import type { CommitReceipt, ProposalRecord, SafeProof } from "@safe-git/core";

export interface PublishSafeGitCheckResult {
  skipped?: string;
  response?: unknown;
}

function readPrivateKeyPem(): string | undefined {
  if (process.env.GITHUB_APP_PRIVATE_KEY_BASE64) {
    return Buffer.from(process.env.GITHUB_APP_PRIVATE_KEY_BASE64, "base64").toString("utf8");
  }
  return process.env.GITHUB_APP_PRIVATE_KEY;
}

export function getGitHubAppConfig(): {
  appId: string;
  installationId: string;
  privateKeyPem: string;
} | undefined {
  const appId = process.env.GITHUB_APP_ID;
  const installationId = process.env.GITHUB_INSTALLATION_ID;
  const privateKeyPem = readPrivateKeyPem();
  if (!appId || !installationId || !privateKeyPem) {
    return undefined;
  }
  return { appId, installationId, privateKeyPem };
}

export async function requestConfiguredInstallationToken(): Promise<string | undefined> {
  const config = getGitHubAppConfig();
  if (!config) {
    return undefined;
  }
  const jwt = createGitHubAppJwt({ appId: config.appId, privateKeyPem: config.privateKeyPem });
  const token = await requestInstallationToken({ appJwt: jwt, installationId: config.installationId });
  return token.token;
}

export async function publishSafeGitCheck(input: {
  proposal: ProposalRecord;
  receipt: CommitReceipt;
  safeProof?: SafeProof;
  verifierVersion?: string;
}): Promise<PublishSafeGitCheckResult> {
  const token = await requestConfiguredInstallationToken();
  if (!token) {
    return { skipped: "GitHub App credentials are not configured" };
  }
  const payload = buildVerificationCheckRun({
    commitOid: input.receipt.finalCommitOid,
    intent: input.proposal.intent,
    receipt: input.receipt,
    safeProof: input.safeProof ?? input.proposal.safeProof,
    ok: input.receipt.verifyResult.ok,
    verifierVersion: input.verifierVersion ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "local"
  });
  return {
    response: await createCheckRun({
      token,
      repoOwner: input.proposal.intent.repoOwner,
      repoName: input.proposal.intent.repoName,
      payload
    })
  };
}

export async function openProposalPullRequest(input: { proposal: ProposalRecord }): Promise<PublishSafeGitCheckResult> {
  const token = await requestConfiguredInstallationToken();
  if (!token) {
    return { skipped: "GitHub App credentials are not configured" };
  }
  const base = input.proposal.intent.targetRef.replace(/^refs\/heads\//u, "");
  const title = input.proposal.commitMessage.trim().split("\n")[0] || `SafeGit proposal ${input.proposal.id}`;
  return {
    response: await createPullRequest({
      token,
      repoOwner: input.proposal.intent.repoOwner,
      repoName: input.proposal.intent.repoName,
      title,
      head: proposalBranchName(input.proposal.id),
      base,
      body: [
        `SafeGit proposal: ${input.proposal.id}`,
        "",
        `Intent hash: ${input.proposal.intentHash}`,
        `Safe message hash: ${input.proposal.safeProof.safeMessageHash}`,
        `Signing key fingerprint: ${input.proposal.intent.signingKeySshFingerprintSha256}`
      ].join("\n"),
      draft: true
    })
  };
}
