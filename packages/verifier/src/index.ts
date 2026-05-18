import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  canonicalCommitMessage,
  deriveSafeMessageHash,
  isNullParentOid,
  parseCommitPayload,
  sha256Hex,
  sshFingerprintFromPublicKey
} from "@safe-git/core";
import type {
  CommitReceipt,
  GitCommitIntent,
  Hex,
  RepositoryPolicy,
  SafeProof,
  VerificationCheck,
  VerificationSummary
} from "@safe-git/core";

export interface VerifyCommitInput {
  repoDir: string;
  intent: GitCommitIntent;
  commitOid: string;
  allowedSignersPath: string;
}

export function verifyIntentAgainstCommit(input: VerifyCommitInput): VerificationSummary {
  const checks: VerificationCheck[] = [];
  const add = (name: string, passed: boolean, detail: string) => checks.push({ name, passed, detail });

  let payload = "";
  try {
    payload = execFileSync("git", ["-C", input.repoDir, "cat-file", "-p", input.commitOid], {
      encoding: "utf8"
    });
    add("commit.exists", true, input.commitOid);
  } catch (error) {
    add("commit.exists", false, String(error));
    return summarize(checks);
  }

  let parsed: ReturnType<typeof parseCommitPayload>;
  try {
    parsed = parseCommitPayload(payload);
    add("commit.parse", true, "commit payload parsed");
  } catch (error) {
    add("commit.parse", false, String(error));
    return summarize(checks);
  }

  const expectsRootCommit = isNullParentOid(input.intent.expectedParentOid);
  add(
    "commit.parentCount",
    expectsRootCommit ? parsed.parentOids.length === 0 : parsed.parentOids.length === 1,
    `${parsed.parentOids.length} parent(s)`
  );
  add(
    "commit.parent",
    expectsRootCommit ? parsed.parentOids.length === 0 : parsed.parentOids[0] === input.intent.expectedParentOid,
    expectsRootCommit ? "root commit" : `${parsed.parentOids[0]} == ${input.intent.expectedParentOid}`
  );
  add("commit.tree", parsed.treeOid === input.intent.treeOid, `${parsed.treeOid} == ${input.intent.treeOid}`);
  add(
    "commit.author",
    parsed.author.name === input.intent.authorName &&
      parsed.author.email === input.intent.authorEmail &&
      parsed.author.unixSeconds === input.intent.authorUnixSeconds &&
      parsed.author.timezone === input.intent.authorTimezone,
    `${parsed.author.name} <${parsed.author.email}>`
  );
  add(
    "commit.committer",
    parsed.committer.name === input.intent.committerName &&
      parsed.committer.email === input.intent.committerEmail &&
      parsed.committer.unixSeconds === input.intent.committerUnixSeconds &&
      parsed.committer.timezone === input.intent.committerTimezone,
    `${parsed.committer.name} <${parsed.committer.email}>`
  );
  add(
    "commit.messageHash",
    sha256Hex(canonicalCommitMessage(parsed.message)) === input.intent.commitMessageSha256,
    input.intent.commitMessageSha256
  );
  add(
    "commit.unsignedPayloadHash",
    sha256Hex(parsed.unsignedPayload) === input.intent.unsignedCommitPayloadSha256,
    input.intent.unsignedCommitPayloadSha256
  );
  add("commit.sshSignature", parsed.hasSshSignature, "OpenSSH armored signature embedded in gpgsig header");

  const allowedSigners = readFileSync(input.allowedSignersPath, "utf8");
  const hasExpectedFingerprint = allowedSigners
    .split("\n")
    .filter(Boolean)
    .some((line) => {
      const keyStart = line.indexOf("ssh-ed25519 ");
      if (keyStart < 0) {
        return false;
      }
      return sshFingerprintFromPublicKey(line.slice(keyStart)) === input.intent.signingKeySshFingerprintSha256;
    });
  add("commit.signingKeyFingerprint", hasExpectedFingerprint, input.intent.signingKeySshFingerprintSha256);

  try {
    execFileSync(
      "git",
      [
        "-C",
        input.repoDir,
        "-c",
        "gpg.format=ssh",
        "-c",
        `gpg.ssh.allowedSignersFile=${input.allowedSignersPath}`,
        "verify-commit",
        input.commitOid
      ],
      { encoding: "utf8", stdio: "pipe" }
    );
    add("git.verifyCommit", true, "git verify-commit succeeded");
    add("commit.sshNamespace", true, "git verify-commit accepted namespace-constrained allowed signers");
  } catch (error) {
    add("git.verifyCommit", false, String(error));
    add("commit.sshNamespace", false, "git verify-commit failed");
  }

  return summarize(checks);
}

export interface VerifySafeApprovalInput {
  intent: GitCommitIntent;
  proof: SafeProof;
  intentHash: Hex;
  proposalId: string;
  allowDevApproval?: boolean;
  nonceOwner?: string;
  nowUnixSeconds?: number;
}

export function verifySafeApproval(input: VerifySafeApprovalInput): VerificationSummary {
  const checks: VerificationCheck[] = [];
  const add = (name: string, passed: boolean, detail: string) => checks.push({ name, passed, detail });
  const recomputed = deriveSafeMessageHash(input.intentHash, input.proof.safeAddress, input.proof.chainId);
  add("safe.hash", recomputed === input.proof.safeMessageHash, recomputed);
  add("safe.chain", input.proof.chainId > 0, `chain ${input.proof.chainId}`);
  add("safe.address", input.proof.safeAddress.toLowerCase().startsWith("0x"), input.proof.safeAddress);
  const approved =
    input.proof.approvalStatus === "onchain_approved" ||
    (input.allowDevApproval === true && input.proof.approvalStatus === "dev_approved");
  add(
    "safe.approval",
    approved,
    input.proof.approvalStatus
  );
  const now = input.nowUnixSeconds ?? Math.floor(Date.now() / 1000);
  add("safe.deadline", now <= input.intent.deadlineUnixSeconds, `${now} <= ${input.intent.deadlineUnixSeconds}`);
  add(
    "safe.nonce",
    !input.nonceOwner || input.nonceOwner === input.proposalId,
    input.nonceOwner ? `owned by ${input.nonceOwner}` : "unused"
  );
  return summarize(checks);
}

export interface VerifyRepositoryStateInput {
  repoDir: string;
  intent: GitCommitIntent;
  policy: RepositoryPolicy;
  remoteName?: string;
  currentRefOid?: string;
  finalCommitOid?: string;
  allowPostPush?: boolean;
}

export function verifyRepositoryState(input: VerifyRepositoryStateInput): VerificationSummary {
  const checks: VerificationCheck[] = [];
  const add = (name: string, passed: boolean, detail: string) => checks.push({ name, passed, detail });
  add(
    "repo.policy",
    input.intent.repoOwner === input.policy.repoOwner && input.intent.repoName === input.policy.repoName,
    `${input.intent.repoOwner}/${input.intent.repoName}`
  );
  add("repo.ref", input.intent.targetRef === input.policy.targetRef, input.intent.targetRef);
  add("repo.key", input.intent.signingKeyId === input.policy.signingKeyId, input.intent.signingKeyId);
  add(
    "repo.keyFingerprint",
    input.intent.signingKeySshFingerprintSha256 === input.policy.signingKeyFingerprint,
    input.intent.signingKeySshFingerprintSha256
  );

  try {
    const objectFormat = execFileSync("git", ["-C", input.repoDir, "rev-parse", "--show-object-format"], {
      encoding: "utf8"
    }).trim();
    add("repo.objectFormat", objectFormat === input.intent.objectFormat, objectFormat);
  } catch (error) {
    add("repo.objectFormat", false, String(error));
  }

  let current = input.currentRefOid;
  if (!current) {
    try {
      current = execFileSync(
        "git",
        ["-C", input.repoDir, "rev-parse", "--verify", input.intent.targetRef.replace("refs/heads/", "")],
        { encoding: "utf8" }
      ).trim();
    } catch {
      current = undefined;
    }
  }
  const allowedTarget = input.allowPostPush && input.finalCommitOid ? input.finalCommitOid : input.intent.expectedParentOid;
  const refMatches =
    current === allowedTarget || (!current && !input.allowPostPush && isNullParentOid(input.intent.expectedParentOid));
  add("repo.currentRef", refMatches, `${current ?? "unborn"} == ${allowedTarget}`);

  return summarize(checks);
}

export interface VerifyFinalCheckInput {
  commit: VerifyCommitInput;
  safe: VerifySafeApprovalInput;
  repository: VerifyRepositoryStateInput;
  receipt: CommitReceipt;
}

export function verifyFinalCheck(input: VerifyFinalCheckInput): VerificationSummary {
  const commit = verifyIntentAgainstCommit(input.commit);
  const safe = verifySafeApproval(input.safe);
  const repository = verifyRepositoryState({ ...input.repository, allowPostPush: true });
  const receiptChecks: VerificationCheck[] = [
    {
      name: "final.receiptCommit",
      passed: input.receipt.finalCommitOid === input.commit.commitOid,
      detail: `${input.receipt.finalCommitOid} == ${input.commit.commitOid}`
    },
    {
      name: "final.receiptIntentHash",
      passed: input.receipt.intentHash === input.safe.intentHash,
      detail: input.receipt.intentHash
    },
    {
      name: "final.receiptSafeMessageHash",
      passed: input.receipt.safeMessageHash === input.safe.proof.safeMessageHash,
      detail: input.receipt.safeMessageHash
    }
  ];
  return summarize([...commit.checks, ...safe.checks, ...repository.checks, ...receiptChecks]);
}

export function verifyReceipt(receipt: CommitReceipt): VerificationSummary {
  const checks: VerificationCheck[] = [
    {
      name: "receipt.commit",
      passed: /^[0-9a-f]{40}$/u.test(receipt.finalCommitOid),
      detail: receipt.finalCommitOid
    },
    {
      name: "receipt.intentHash",
      passed: /^0x[0-9a-f]{64}$/u.test(receipt.intentHash),
      detail: receipt.intentHash
    },
    {
      name: "receipt.safeMessageHash",
      passed: /^0x[0-9a-f]{64}$/u.test(receipt.safeMessageHash),
      detail: receipt.safeMessageHash
    },
    {
      name: "receipt.upstreamVerification",
      passed: receipt.verifyResult.ok,
      detail: receipt.verifyResult.ok ? "verified" : "failed"
    }
  ];
  return summarize(checks);
}

export function summarize(checks: VerificationCheck[]): VerificationSummary {
  return { ok: checks.every((check) => check.passed), checks };
}
