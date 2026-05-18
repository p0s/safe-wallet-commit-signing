import { sha256Base64, sha256Hex } from "./crypto.js";
import type { CommitActor, Hex } from "./types.js";

export interface UnsignedCommitPayloadInput {
  treeOid: string;
  expectedParentOid: string;
  author: CommitActor;
  committer: CommitActor;
  commitMessage: string;
}

export interface ParsedCommitPayload {
  treeOid: string;
  parentOids: string[];
  author: CommitActor;
  committer: CommitActor;
  message: string;
  hasSshSignature: boolean;
  armoredSshSignature?: string;
  unsignedPayload: string;
}

export const NULL_PARENT_OID = "0000000000000000000000000000000000000000";

export function isNullParentOid(oid: string): boolean {
  return oid === "" || oid === NULL_PARENT_OID;
}

export function canonicalCommitMessage(message: string): string {
  const normalized = message.replace(/\r\n?/gu, "\n").replace(/\n*$/u, "");
  return `${normalized}\n`;
}

export function formatGitIdentity(actor: CommitActor): string {
  if (!/^[+-]\d{4}$/u.test(actor.timezone)) {
    throw new Error(`Invalid Git timezone offset: ${actor.timezone}`);
  }
  if (actor.name.includes("\n") || actor.email.includes("\n") || actor.email.includes(">")) {
    throw new Error("Git identity contains unsupported characters");
  }
  return `${actor.name} <${actor.email}> ${actor.unixSeconds} ${actor.timezone}`;
}

export function buildUnsignedCommitPayload(input: UnsignedCommitPayloadInput): string {
  const message = canonicalCommitMessage(input.commitMessage);
  const headers = [
    `tree ${input.treeOid}`,
    `author ${formatGitIdentity(input.author)}`,
    `committer ${formatGitIdentity(input.committer)}`,
    "",
    message
  ];
  if (!isNullParentOid(input.expectedParentOid)) {
    headers.splice(1, 0, `parent ${input.expectedParentOid}`);
  }
  return headers.join("\n");
}

export function unsignedCommitPayloadSha256(input: UnsignedCommitPayloadInput): Hex {
  return sha256Hex(buildUnsignedCommitPayload(input));
}

export function insertSshSignature(unsignedPayload: string, armoredSshSignature: string): string {
  const [headerPart, ...messageParts] = unsignedPayload.split("\n\n");
  if (!headerPart || messageParts.length === 0) {
    throw new Error("Unsigned commit payload must contain headers and message");
  }
  const headers = headerPart.split("\n");
  const committerIndex = headers.findIndex((line) => line.startsWith("committer "));
  if (committerIndex < 0) {
    throw new Error("Unsigned commit payload has no committer header");
  }
  const signatureLines = armoredSshSignature.trimEnd().split("\n");
  if (signatureLines[0] !== "-----BEGIN SSH SIGNATURE-----") {
    throw new Error("SSH signature must be OpenSSH armored data");
  }
  const gpgsigLines = [
    `gpgsig ${signatureLines[0]}`,
    ...signatureLines.slice(1).map((line) => ` ${line}`)
  ];
  headers.splice(committerIndex + 1, 0, ...gpgsigLines);
  return `${headers.join("\n")}\n\n${messageParts.join("\n\n")}`;
}

export function parseCommitPayload(payload: string): ParsedCommitPayload {
  const [headerPart, ...messageParts] = payload.split("\n\n");
  if (!headerPart || messageParts.length === 0) {
    throw new Error("Commit payload must contain headers and message");
  }
  const rawHeaders = headerPart.split("\n");
  const normalizedHeaders: string[] = [];
  const signatureLines: string[] = [];
  let inSignature = false;

  for (const line of rawHeaders) {
    if (line.startsWith("gpgsig ")) {
      inSignature = true;
      signatureLines.push(line.slice("gpgsig ".length));
      continue;
    }
    if (inSignature && line.startsWith(" ")) {
      signatureLines.push(line.slice(1));
      continue;
    }
    inSignature = false;
    normalizedHeaders.push(line);
  }

  const getHeader = (prefix: string): string => {
    const line = normalizedHeaders.find((candidate) => candidate.startsWith(prefix));
    if (!line) {
      throw new Error(`Missing commit header: ${prefix.trim()}`);
    }
    return line.slice(prefix.length);
  };

  const parentOids = normalizedHeaders
    .filter((line) => line.startsWith("parent "))
    .map((line) => line.slice("parent ".length));
  const message = messageParts.join("\n\n");
  const unsignedPayload = `${normalizedHeaders.join("\n")}\n\n${message}`;
  const signature = signatureLines.length > 0 ? signatureLines.join("\n") : undefined;

  return {
    treeOid: getHeader("tree "),
    parentOids,
    author: parseGitIdentity(getHeader("author ")),
    committer: parseGitIdentity(getHeader("committer ")),
    message,
    hasSshSignature: signature?.startsWith("-----BEGIN SSH SIGNATURE-----") ?? false,
    ...(signature ? { armoredSshSignature: signature } : {}),
    unsignedPayload
  };
}

export function parseGitIdentity(value: string): CommitActor {
  const match = /^(?<name>.+) <(?<email>[^>]+)> (?<unixSeconds>\d+) (?<timezone>[+-]\d{4})$/u.exec(value);
  if (!match?.groups) {
    throw new Error(`Invalid Git identity: ${value}`);
  }
  const { name, email, unixSeconds, timezone } = match.groups;
  if (!name || !email || !unixSeconds || !timezone) {
    throw new Error(`Invalid Git identity: ${value}`);
  }
  return {
    name,
    email,
    unixSeconds: Number(unixSeconds),
    timezone
  };
}

export function sshFingerprintFromPublicKey(publicKey: string): string {
  const parts = publicKey.trim().split(/\s+/u);
  if (parts.length < 2 || parts[0] !== "ssh-ed25519") {
    throw new Error("Expected an ssh-ed25519 public key");
  }
  return `SHA256:${sha256Base64(Buffer.from(parts[1]!, "base64"))}`;
}

export function signedCommitPayloadSha256(payload: string): Hex {
  return sha256Hex(payload);
}
