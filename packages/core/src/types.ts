export type Hex = `0x${string}`;

export type ProposalStatus =
  | "draft"
  | "awaiting_safe_approval"
  | "safe_approved"
  | "signing"
  | "commit_verified"
  | "receipt_published"
  | "failed"
  | "cancelled";

export type SigningSessionStatus =
  | "created"
  | "safe_verified"
  | "nonce_reserved"
  | "round1_open"
  | "round1_complete"
  | "round2_open"
  | "round2_complete"
  | "signature_aggregated"
  | "commit_built"
  | "commit_verified"
  | "pushed"
  | "receipt_published"
  | "failed"
  | "cancelled";

export interface CommitActor {
  name: string;
  email: string;
  unixSeconds: number;
  timezone: string;
}

export interface FileChange {
  path: string;
  operation: "upsert" | "delete";
  contentBase64?: string;
}

export interface GitCommitIntent {
  specVersion: "1";
  repoHost: string;
  repoOwner: string;
  repoName: string;
  targetRef: string;
  objectFormat: "sha1";
  expectedParentOid: string;
  treeOid: string;
  unsignedCommitPayloadSha256: Hex;
  commitMessageSha256: Hex;
  diffSha256: Hex;
  fileManifestSha256: Hex;
  authorName: string;
  authorEmail: string;
  authorUnixSeconds: number;
  authorTimezone: string;
  committerName: string;
  committerEmail: string;
  committerUnixSeconds: number;
  committerTimezone: string;
  signingKeyId: string;
  signingKeySshFingerprintSha256: string;
  policyId: Hex;
  nonce: Hex;
  deadlineUnixSeconds: number;
}

export interface IntentTypedData {
  domain: {
    name: "SafeGitCommitIntent";
    version: "1";
    chainId: number;
    verifyingContract: Hex;
  };
  primaryType: "GitCommitIntent";
  types: {
    readonly GitCommitIntent: ReadonlyArray<{ readonly name: keyof GitCommitIntent; readonly type: string }>;
  };
  message: GitCommitIntent;
}

export interface SafeProof {
  safeAddress: Hex;
  chainId: number;
  safeMessageHash: Hex;
  approvalStatus: "missing" | "dev_approved" | "onchain_approved" | "rejected";
  owners?: Hex[];
  threshold?: number;
  totalOwners?: number;
  deploymentTxHash?: Hex;
  deploymentBlockNumber?: number;
  approvalTxHash?: Hex;
  approvalBlockNumber?: number;
  verifiedAt?: string;
}

export interface RepositoryPolicy {
  id: Hex;
  repoOwner: string;
  repoName: string;
  targetRef: string;
  safeAddress: Hex;
  chainId: number;
  signingKeyId: string;
  signingKeyFingerprint: string;
  thresholdT: number;
  thresholdN: number;
  allowEmptyCommit: boolean;
  allowForcePush: boolean;
}

export interface ProposalRecord {
  id: string;
  status: ProposalStatus;
  intent: GitCommitIntent;
  typedData: IntentTypedData;
  intentHash: Hex;
  safeProof: SafeProof;
  commitMessage: string;
  diffText: string;
  fileChanges: FileChange[];
  createdAt: string;
  updatedAt: string;
}

export interface SigningSessionRecord {
  id: string;
  proposalId: string;
  status: SigningSessionStatus;
  selectedSigners: string[];
  threshold: { required: number; total: number };
  audit: string[];
  armoredSshSignature?: string;
  aggregateSignatureBase64?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export type SignerNodeStatus = "active" | "inactive" | "compromised";

export interface SignerNodeRecord {
  id: string;
  nodeName: string;
  publicAuthKey?: string;
  status: SignerNodeStatus;
  lastSeenAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SignerRound1CommitmentRecord {
  id: string;
  sessionId: string;
  signerNodeId: string;
  commitment: Record<string, unknown>;
  createdAt: string;
}

export interface SignerRound2ShareRecord {
  id: string;
  sessionId: string;
  signerNodeId: string;
  signatureShare: Record<string, unknown>;
  valid?: boolean;
  createdAt: string;
}

export type AuditActorType = "admin" | "github" | "signer" | "system";

export interface AuditEventRecord {
  id: string;
  eventType: string;
  actorType: AuditActorType;
  actorId?: string;
  proposalId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface RuntimeBackup {
  version: 1;
  exportedAt: string;
  records: {
    proposals: ProposalRecord[];
    sessions: SigningSessionRecord[];
    receipts: CommitReceipt[];
    nonces: Array<{ nonce: string; proposalId: string; consumedAt?: string }>;
    signerNodes: SignerNodeRecord[];
    round1Commitments: SignerRound1CommitmentRecord[];
    round2Shares: SignerRound2ShareRecord[];
    auditEvents: AuditEventRecord[];
  };
}

export interface CommitReceipt {
  id: string;
  proposalId: string;
  sessionId: string;
  finalCommitOid: string;
  signedCommitPayloadSha256: Hex;
  armoredSshSignatureSha256: Hex;
  githubHtmlUrl?: string;
  pushedAt?: string;
  intentHash: Hex;
  safeMessageHash: Hex;
  verifyResult: VerificationSummary;
  createdAt: string;
}

export interface VerificationCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface VerificationSummary {
  ok: boolean;
  checks: VerificationCheck[];
}
