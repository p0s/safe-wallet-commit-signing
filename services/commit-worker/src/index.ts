import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { insertSshSignature, isNullParentOid, signedCommitPayloadSha256 } from "@safe-git/core";
import type { CommitReceipt, GitCommitIntent } from "@safe-git/core";

export interface BuildSignedCommitInput {
  repoDir: string;
  unsignedPayload: string;
  armoredSshSignature: string;
}

export interface BuildSignedCommitResult {
  commitOid: string;
  signedPayload: string;
  signedPayloadSha256: string;
}

export function buildSignedCommitObject(input: BuildSignedCommitInput): BuildSignedCommitResult {
  const signedPayload = insertSshSignature(input.unsignedPayload, input.armoredSshSignature);
  const oid = execFileSync("git", ["-C", input.repoDir, "hash-object", "-t", "commit", "-w", "--stdin"], {
    input: signedPayload,
    encoding: "utf8"
  }).trim();
  return {
    commitOid: oid,
    signedPayload,
    signedPayloadSha256: signedCommitPayloadSha256(signedPayload)
  };
}

export function signPayloadWithSshKey(input: {
  privateKeyPath: string;
  payload: string;
  namespace?: "git";
}): string {
  const dir = mkdtempSync(join(tmpdir(), "safegit-ssh-sign-"));
  const payloadPath = join(dir, "payload");
  writeFileSync(payloadPath, input.payload);
  execFileSync("ssh-keygen", ["-Y", "sign", "-f", input.privateKeyPath, "-n", input.namespace ?? "git", payloadPath], {
    encoding: "utf8",
    stdio: "pipe"
  });
  return readFileSync(`${payloadPath}.sig`, "utf8");
}

export function buildSshEd25519PublicKey(input: { verifyingKey: Uint8Array; comment?: string }): string {
  if (input.verifyingKey.byteLength !== 32) {
    throw new Error("Ed25519 verifying key must be 32 bytes");
  }
  const publicKeyBlob = Buffer.concat([sshString(Buffer.from("ssh-ed25519")), sshString(input.verifyingKey)]);
  return `ssh-ed25519 ${publicKeyBlob.toString("base64")}${
    input.comment ? ` ${input.comment}` : ""
  }`;
}

export function buildSshsigSignedData(input: {
  payload: string | Uint8Array;
  namespace?: "git";
  hashAlgorithm?: "sha512";
}): Buffer {
  const hashAlgorithm = input.hashAlgorithm ?? "sha512";
  const hash = createHash(hashAlgorithm).update(input.payload).digest();
  return Buffer.concat([
    Buffer.from("SSHSIG"),
    sshString(Buffer.from(input.namespace ?? "git")),
    sshString(Buffer.alloc(0)),
    sshString(Buffer.from(hashAlgorithm)),
    sshString(hash)
  ]);
}

export function buildArmoredSshsigFromEd25519(input: {
  verifyingKey: Uint8Array;
  signature: Uint8Array;
  namespace?: "git";
  hashAlgorithm?: "sha512";
}): string {
  if (input.verifyingKey.byteLength !== 32) {
    throw new Error("Ed25519 verifying key must be 32 bytes");
  }
  if (input.signature.byteLength !== 64) {
    throw new Error("Ed25519 signature must be 64 bytes");
  }
  const hashAlgorithm = input.hashAlgorithm ?? "sha512";
  const publicKeyBlob = Buffer.concat([sshString(Buffer.from("ssh-ed25519")), sshString(input.verifyingKey)]);
  const signatureBlob = Buffer.concat([sshString(Buffer.from("ssh-ed25519")), sshString(input.signature)]);
  const envelope = Buffer.concat([
    Buffer.from("SSHSIG"),
    uint32(1),
    sshString(publicKeyBlob),
    sshString(Buffer.from(input.namespace ?? "git")),
    sshString(Buffer.alloc(0)),
    sshString(Buffer.from(hashAlgorithm)),
    sshString(signatureBlob)
  ]);
  return armorSshsig(envelope);
}

export function verifyGitCommit(input: {
  repoDir: string;
  commitOid: string;
  allowedSignersPath: string;
}): string {
  return execFileSync(
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
}

export function revalidateBeforePush(input: {
  repoDir: string;
  branch: string;
  expectedParentOid: string;
  commitOid: string;
  treeOid: string;
  allowedSignersPath: string;
}): void {
  const parents = execFileSync("git", ["-C", input.repoDir, "show", "-s", "--format=%P", input.commitOid], {
    encoding: "utf8"
  }).trim();
  if (isNullParentOid(input.expectedParentOid)) {
    if (parents !== "") {
      throw new Error(`Commit parent mismatch: ${parents} != root`);
    }
  } else if (parents !== input.expectedParentOid) {
    throw new Error(`Commit parent mismatch: ${parents} != ${input.expectedParentOid}`);
  }
  const tree = execFileSync("git", ["-C", input.repoDir, "show", "-s", "--format=%T", input.commitOid], {
    encoding: "utf8"
  }).trim();
  if (tree !== input.treeOid) {
    throw new Error(`Commit tree mismatch: ${tree} != ${input.treeOid}`);
  }
  verifyGitCommit({ repoDir: input.repoDir, commitOid: input.commitOid, allowedSignersPath: input.allowedSignersPath });
}

export function buildPushRefspec(commitOid: string, branch: string): string {
  const target = branch.startsWith("refs/heads/") ? branch : `refs/heads/${branch}`;
  return `${commitOid}:${target}`;
}

export function pushWithInstallationToken(input: {
  repoDir: string;
  repoOwner: string;
  repoName: string;
  installationToken: string;
  commitOid: string;
  branch: string;
  forceWithLease?: boolean;
}): void {
  const credentialDir = mkdtempSync(join(tmpdir(), "safegit-github-credentials-"));
  const tokenPath = join(credentialDir, "token");
  const askpassPath = join(credentialDir, "askpass.sh");
  writeFileSync(tokenPath, input.installationToken, { mode: 0o600 });
  writeFileSync(
    askpassPath,
    [
      "#!/bin/sh",
      "case \"$1\" in",
      "*Username*) printf '%s\\n' x-access-token ;;",
      "*Password*) cat \"$SAFEGIT_GITHUB_TOKEN_FILE\" ;;",
      "*) printf '\\n' ;;",
      "esac",
      ""
    ].join("\n"),
    { mode: 0o700 }
  );
  chmodSync(askpassPath, 0o700);
  const remoteUrl = `https://github.com/${input.repoOwner}/${input.repoName}.git`;
  const args = ["-C", input.repoDir, "push"];
  if (input.forceWithLease) {
    args.push("--force-with-lease");
  }
  args.push(remoteUrl, buildPushRefspec(input.commitOid, input.branch));
  try {
    execFileSync("git", args, {
      encoding: "utf8",
      stdio: "pipe",
      env: {
        ...process.env,
        GIT_ASKPASS: askpassPath,
        GIT_TERMINAL_PROMPT: "0",
        SAFEGIT_GITHUB_TOKEN_FILE: tokenPath
      }
    });
  } finally {
    rmSync(credentialDir, { recursive: true, force: true });
  }
}

export function assertReceiptReadyForPush(input: {
  intent: GitCommitIntent;
  receipt: CommitReceipt;
  commitOid: string;
}): void {
  if (input.receipt.finalCommitOid !== input.commitOid) {
    throw new Error("Receipt does not match commit OID");
  }
  if (input.receipt.safeMessageHash.length !== 66 || input.intent.nonce.length !== 66) {
    throw new Error("Receipt or intent is malformed");
  }
}

function uint32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value, 0);
  return buffer;
}

function sshString(value: Uint8Array): Buffer {
  return Buffer.concat([uint32(value.byteLength), Buffer.from(value)]);
}

function armorSshsig(value: Uint8Array): string {
  const lines = Buffer.from(value).toString("base64").match(/.{1,70}/gu) ?? [];
  return `-----BEGIN SSH SIGNATURE-----\n${lines.join("\n")}\n-----END SSH SIGNATURE-----\n`;
}
