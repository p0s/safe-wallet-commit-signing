import { createHmac } from "node:crypto";
import { createPrivateKey, sign } from "node:crypto";
import { safeEqual } from "@safe-git/core";
import type { CommitReceipt, GitCommitIntent, SafeProof } from "@safe-git/core";

export interface CheckRunPayload {
  name: "safe-git-verify";
  head_sha: string;
  status: "queued" | "in_progress" | "completed";
  conclusion?: "success" | "failure" | "neutral";
  output: {
    title: string;
    summary: string;
    text?: string;
  };
}

export function verifyGitHubWebhookSignature(input: {
  rawBody: string | Buffer;
  signature256: string | null;
  secret: string;
}): boolean {
  if (!input.signature256?.startsWith("sha256=") || !input.secret) {
    return false;
  }
  const expected = `sha256=${createHmac("sha256", input.secret).update(input.rawBody).digest("hex")}`;
  return safeEqual(expected, input.signature256);
}

export function buildVerificationCheckRun(input: {
  commitOid: string;
  intent: GitCommitIntent;
  receipt?: CommitReceipt;
  safeProof?: SafeProof;
  ok: boolean;
  verifierVersion: string;
}): CheckRunPayload {
  const conclusion = input.receipt ? (input.ok ? "success" : "failure") : "neutral";
  const receipt = input.receipt;
  const summary = receipt
    ? [
        `Safe: ${input.safeProof?.safeAddress ?? "unknown"}`,
        `Chain ID: ${input.safeProof?.chainId ?? "unknown"}`,
        `Intent hash: ${receipt.intentHash}`,
        `Safe message hash: ${receipt.safeMessageHash}`,
        `Signing key fingerprint: ${input.intent.signingKeySshFingerprintSha256}`,
        `Commit: ${input.commitOid}`,
        `Verifier version: ${input.verifierVersion}`
      ].join("\n")
    : "Commit is not controlled by SafeGit.";

  return {
    name: "safe-git-verify",
    head_sha: input.commitOid,
    status: "completed",
    conclusion,
    output: {
      title: conclusion === "success" ? "SafeGit verified" : "SafeGit verification result",
      summary
    }
  };
}

export function proposalBranchName(proposalId: string): string {
  return `safegit/proposal/${proposalId}`;
}

export function createGitHubAppJwt(input: {
  appId: string;
  privateKeyPem: string;
  nowUnixSeconds?: number;
}): string {
  const now = input.nowUnixSeconds ?? Math.floor(Date.now() / 1000);
  const header = base64UrlJson({ alg: "RS256", typ: "JWT" });
  const payload = base64UrlJson({
    iat: now - 60,
    exp: now + 9 * 60,
    iss: input.appId
  });
  const body = `${header}.${payload}`;
  const signature = sign("RSA-SHA256", Buffer.from(body), createPrivateKey(input.privateKeyPem));
  return `${body}.${base64Url(signature)}`;
}

export async function requestInstallationToken(input: {
  appJwt: string;
  installationId: string | number;
  apiBaseUrl?: string;
}): Promise<{ token: string; expires_at: string }> {
  const response = await fetch(
    `${input.apiBaseUrl ?? "https://api.github.com"}/app/installations/${input.installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${input.appJwt}`,
        "x-github-api-version": "2022-11-28"
      }
    }
  );
  if (!response.ok) {
    throw new Error(`GitHub installation token request failed: ${response.status}`);
  }
  return (await response.json()) as { token: string; expires_at: string };
}

export async function createCheckRun(input: {
  token: string;
  repoOwner: string;
  repoName: string;
  payload: CheckRunPayload;
  apiBaseUrl?: string;
}): Promise<unknown> {
  const response = await fetch(`${input.apiBaseUrl ?? "https://api.github.com"}/repos/${input.repoOwner}/${input.repoName}/check-runs`, {
    method: "POST",
    headers: githubJsonHeaders(input.token),
    body: JSON.stringify(input.payload)
  });
  if (!response.ok) {
    throw new Error(`GitHub check-run creation failed: ${response.status}`);
  }
  return response.json();
}

export async function createPullRequest(input: {
  token: string;
  repoOwner: string;
  repoName: string;
  title: string;
  head: string;
  base: string;
  body: string;
  draft?: boolean;
  apiBaseUrl?: string;
}): Promise<unknown> {
  const response = await fetch(`${input.apiBaseUrl ?? "https://api.github.com"}/repos/${input.repoOwner}/${input.repoName}/pulls`, {
    method: "POST",
    headers: githubJsonHeaders(input.token),
    body: JSON.stringify({
      title: input.title,
      head: input.head,
      base: input.base,
      body: input.body,
      draft: input.draft ?? true
    })
  });
  if (!response.ok) {
    throw new Error(`GitHub pull request creation failed: ${response.status}`);
  }
  return response.json();
}

function githubJsonHeaders(token: string): Record<string, string> {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-github-api-version": "2022-11-28"
  };
}

function base64UrlJson(value: unknown): string {
  return base64Url(Buffer.from(JSON.stringify(value)));
}

function base64Url(value: Buffer): string {
  return value.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}
