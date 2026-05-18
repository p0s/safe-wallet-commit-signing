import { hashTypedData, isAddress } from "viem";
import { sha256Hex, stableStringify } from "./crypto.js";
import { buildUnsignedCommitPayload, canonicalCommitMessage } from "./git.js";
import { fileManifestSha256 } from "./manifest.js";
import type {
  CommitActor,
  FileChange,
  GitCommitIntent,
  Hex,
  IntentTypedData,
  RepositoryPolicy
} from "./types.js";

export const gitCommitIntentTypes = {
  GitCommitIntent: [
    { name: "specVersion", type: "string" },
    { name: "repoHost", type: "string" },
    { name: "repoOwner", type: "string" },
    { name: "repoName", type: "string" },
    { name: "targetRef", type: "string" },
    { name: "objectFormat", type: "string" },
    { name: "expectedParentOid", type: "string" },
    { name: "treeOid", type: "string" },
    { name: "unsignedCommitPayloadSha256", type: "bytes32" },
    { name: "commitMessageSha256", type: "bytes32" },
    { name: "diffSha256", type: "bytes32" },
    { name: "fileManifestSha256", type: "bytes32" },
    { name: "authorName", type: "string" },
    { name: "authorEmail", type: "string" },
    { name: "authorUnixSeconds", type: "uint256" },
    { name: "authorTimezone", type: "string" },
    { name: "committerName", type: "string" },
    { name: "committerEmail", type: "string" },
    { name: "committerUnixSeconds", type: "uint256" },
    { name: "committerTimezone", type: "string" },
    { name: "signingKeyId", type: "string" },
    { name: "signingKeySshFingerprintSha256", type: "string" },
    { name: "policyId", type: "bytes32" },
    { name: "nonce", type: "bytes32" },
    { name: "deadlineUnixSeconds", type: "uint256" }
  ]
} as const;

export interface BuildIntentInput {
  repoHost: string;
  repoOwner: string;
  repoName: string;
  targetRef: string;
  expectedParentOid: string;
  treeOid: string;
  diffText: string;
  fileChanges: FileChange[];
  commitMessage: string;
  author: CommitActor;
  committer: CommitActor;
  signingKeyId: string;
  signingKeyFingerprint: string;
  safeAddress: Hex;
  chainId: number;
  policyId?: Hex;
  nonce: Hex;
  deadlineUnixSeconds: number;
}

export interface BuiltIntent {
  intent: GitCommitIntent;
  typedData: IntentTypedData;
  intentHash: Hex;
  safeMessageHash: Hex;
  unsignedPayload: string;
}

export function buildPolicyId(policy: Omit<RepositoryPolicy, "id">): Hex {
  return sha256Hex(stableStringify(policy));
}

export function buildIntent(input: BuildIntentInput): BuiltIntent {
  if (!isAddress(input.safeAddress)) {
    throw new Error(`Invalid Safe address: ${input.safeAddress}`);
  }
  const unsignedPayload = buildUnsignedCommitPayload({
    treeOid: input.treeOid,
    expectedParentOid: input.expectedParentOid,
    author: input.author,
    committer: input.committer,
    commitMessage: input.commitMessage
  });
  const policyId =
    input.policyId ??
    buildPolicyId({
      repoOwner: input.repoOwner,
      repoName: input.repoName,
      targetRef: input.targetRef,
      safeAddress: input.safeAddress,
      chainId: input.chainId,
      signingKeyId: input.signingKeyId,
      signingKeyFingerprint: input.signingKeyFingerprint,
      thresholdT: 2,
      thresholdN: 3,
      allowEmptyCommit: false,
      allowForcePush: false
    });

  const intent: GitCommitIntent = {
    specVersion: "1",
    repoHost: input.repoHost,
    repoOwner: input.repoOwner,
    repoName: input.repoName,
    targetRef: input.targetRef,
    objectFormat: "sha1",
    expectedParentOid: input.expectedParentOid,
    treeOid: input.treeOid,
    unsignedCommitPayloadSha256: sha256Hex(unsignedPayload),
    commitMessageSha256: sha256Hex(canonicalCommitMessage(input.commitMessage)),
    diffSha256: sha256Hex(input.diffText),
    fileManifestSha256: fileManifestSha256(input.fileChanges),
    authorName: input.author.name,
    authorEmail: input.author.email,
    authorUnixSeconds: input.author.unixSeconds,
    authorTimezone: input.author.timezone,
    committerName: input.committer.name,
    committerEmail: input.committer.email,
    committerUnixSeconds: input.committer.unixSeconds,
    committerTimezone: input.committer.timezone,
    signingKeyId: input.signingKeyId,
    signingKeySshFingerprintSha256: input.signingKeyFingerprint,
    policyId,
    nonce: input.nonce,
    deadlineUnixSeconds: input.deadlineUnixSeconds
  };

  const typedData: IntentTypedData = {
    domain: {
      name: "SafeGitCommitIntent",
      version: "1",
      chainId: input.chainId,
      verifyingContract: input.safeAddress
    },
    primaryType: "GitCommitIntent",
    types: gitCommitIntentTypes,
    message: intent
  };
  const intentHash = hashTypedData(typedData as never);
  return {
    intent,
    typedData,
    intentHash,
    safeMessageHash: deriveSafeMessageHash(intentHash, input.safeAddress, input.chainId),
    unsignedPayload
  };
}

export function deriveSafeMessageHash(intentHash: Hex, safeAddress: Hex, chainId: number): Hex {
  return hashTypedData({
    domain: {
      chainId,
      verifyingContract: safeAddress
    },
    primaryType: "SafeMessage",
    types: {
      SafeMessage: [{ name: "message", type: "bytes" }]
    },
    message: {
      message: intentHash
    }
  } as never);
}
