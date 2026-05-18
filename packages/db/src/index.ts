import { nowIso } from "@safe-git/core";
import type {
  AuditEventRecord,
  CommitReceipt,
  ProposalRecord,
  RuntimeBackup,
  SignerNodeRecord,
  SignerRound1CommitmentRecord,
  SignerRound2ShareRecord,
  SigningSessionRecord
} from "@safe-git/core";
import pg from "pg";

type NonceRecord = { nonce: string; proposalId: string; consumedAt: string };

export class MemoryStore {
  readonly proposals = new Map<string, ProposalRecord>();
  readonly sessions = new Map<string, SigningSessionRecord>();
  readonly receipts = new Map<string, CommitReceipt>();
  readonly nonces = new Map<string, NonceRecord>();
  readonly signerNodes = new Map<string, SignerNodeRecord>();
  readonly round1Commitments = new Map<string, SignerRound1CommitmentRecord>();
  readonly round2Shares = new Map<string, SignerRound2ShareRecord>();
  readonly auditEvents = new Map<string, AuditEventRecord>();

  upsertProposal(proposal: ProposalRecord): ProposalRecord {
    this.proposals.set(proposal.id, { ...proposal, updatedAt: nowIso() });
    return this.proposals.get(proposal.id)!;
  }

  getProposal(id: string): ProposalRecord | undefined {
    return this.proposals.get(id);
  }

  listProposals(): ProposalRecord[] {
    return [...this.proposals.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  upsertSession(session: SigningSessionRecord): SigningSessionRecord {
    this.sessions.set(session.id, { ...session, updatedAt: nowIso() });
    return this.sessions.get(session.id)!;
  }

  getSession(id: string): SigningSessionRecord | undefined {
    return this.sessions.get(id);
  }

  listSignerTasks(): SigningSessionRecord[] {
    return [...this.sessions.values()].filter((session) =>
      ["round1_open", "round2_open"].includes(session.status)
    );
  }

  reserveNonce(nonce: string, proposalId: string): void {
    const existing = this.nonces.get(nonce);
    if (existing && existing.proposalId !== proposalId) {
      throw new Error(`Nonce already reserved by ${existing.proposalId}`);
    }
    this.nonces.set(nonce, { nonce, proposalId, consumedAt: nowIso() });
  }

  upsertReceipt(receipt: CommitReceipt): CommitReceipt {
    this.receipts.set(receipt.proposalId, receipt);
    return receipt;
  }

  getReceipt(proposalId: string): CommitReceipt | undefined {
    return this.receipts.get(proposalId);
  }

  listReceipts(): CommitReceipt[] {
    return [...this.receipts.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  findReceiptByCommit(commitOid: string): CommitReceipt | undefined {
    return this.listReceipts().find((receipt) => receipt.finalCommitOid === commitOid);
  }

  upsertSignerNode(node: SignerNodeRecord): SignerNodeRecord {
    const previous = this.signerNodes.get(node.id);
    const next = { ...node, createdAt: previous?.createdAt ?? node.createdAt, updatedAt: nowIso() };
    this.signerNodes.set(node.id, next);
    return next;
  }

  getSignerNode(id: string): SignerNodeRecord | undefined {
    return this.signerNodes.get(id);
  }

  listSignerNodes(): SignerNodeRecord[] {
    return [...this.signerNodes.values()].sort((left, right) => left.id.localeCompare(right.id));
  }

  upsertRound1Commitment(commitment: SignerRound1CommitmentRecord): SignerRound1CommitmentRecord {
    this.round1Commitments.set(commitment.id, commitment);
    return commitment;
  }

  listRound1Commitments(sessionId: string): SignerRound1CommitmentRecord[] {
    return [...this.round1Commitments.values()]
      .filter((commitment) => commitment.sessionId === sessionId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  upsertRound2Share(share: SignerRound2ShareRecord): SignerRound2ShareRecord {
    this.round2Shares.set(share.id, share);
    return share;
  }

  listRound2Shares(sessionId: string): SignerRound2ShareRecord[] {
    return [...this.round2Shares.values()]
      .filter((share) => share.sessionId === sessionId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  appendAuditEvent(event: AuditEventRecord): AuditEventRecord {
    this.auditEvents.set(event.id, event);
    return event;
  }

  listAuditEvents(filter: { proposalId?: string; sessionId?: string; limit?: number } = {}): AuditEventRecord[] {
    const events = [...this.auditEvents.values()]
      .filter((event) => !filter.proposalId || event.proposalId === filter.proposalId)
      .filter((event) => !filter.sessionId || event.sessionId === filter.sessionId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return typeof filter.limit === "number" ? events.slice(0, filter.limit) : events;
  }

  exportBackup(): RuntimeBackup {
    return {
      version: 1,
      exportedAt: nowIso(),
      records: {
        proposals: this.listProposals(),
        sessions: [...this.sessions.values()],
        receipts: this.listReceipts(),
        nonces: [...this.nonces.values()],
        signerNodes: this.listSignerNodes(),
        round1Commitments: [...this.round1Commitments.values()],
        round2Shares: [...this.round2Shares.values()],
        auditEvents: this.listAuditEvents()
      }
    };
  }

  importBackup(backup: RuntimeBackup): void {
    for (const proposal of backup.records.proposals) {
      this.proposals.set(proposal.id, proposal);
    }
    for (const session of backup.records.sessions) {
      this.sessions.set(session.id, session);
    }
    for (const receipt of backup.records.receipts) {
      this.receipts.set(receipt.proposalId, receipt);
    }
    for (const nonce of backup.records.nonces) {
      this.nonces.set(nonce.nonce, { ...nonce, consumedAt: nonce.consumedAt ?? nowIso() });
    }
    for (const node of backup.records.signerNodes) {
      this.signerNodes.set(node.id, node);
    }
    for (const commitment of backup.records.round1Commitments) {
      this.round1Commitments.set(commitment.id, commitment);
    }
    for (const share of backup.records.round2Shares) {
      this.round2Shares.set(share.id, share);
    }
    for (const event of backup.records.auditEvents) {
      this.auditEvents.set(event.id, event);
    }
  }
}

export const store = new MemoryStore();

export class PostgresStore {
  private readonly pool: pg.Pool;

  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({ connectionString: databaseUrl });
  }

  async migrate(): Promise<void> {
    await this.pool.query(`
      create table if not exists runtime_records (
        kind text not null,
        id text not null,
        document jsonb not null,
        updated_at timestamptz not null default now(),
        primary key (kind, id)
      )
    `);
    await this.pool.query("create index if not exists runtime_records_kind_updated_idx on runtime_records(kind, updated_at desc)");
    await this.pool.query("create index if not exists runtime_records_document_gin_idx on runtime_records using gin(document)");
    await this.pool.query(normalizedSchemaSql);
  }

  async upsertProposal(proposal: ProposalRecord): Promise<ProposalRecord> {
    const next = { ...proposal, updatedAt: nowIso() };
    await this.upsert("proposal", proposal.id, next);
    return next;
  }

  async getProposal(id: string): Promise<ProposalRecord | undefined> {
    return this.get<ProposalRecord>("proposal", id);
  }

  async listProposals(): Promise<ProposalRecord[]> {
    const result = await this.pool.query<{ document: ProposalRecord }>(
      "select document from runtime_records where kind = $1 order by updated_at desc",
      ["proposal"]
    );
    return result.rows.map((row) => row.document);
  }

  async upsertSession(session: SigningSessionRecord): Promise<SigningSessionRecord> {
    const next = { ...session, updatedAt: nowIso() };
    await this.upsert("session", session.id, next);
    return next;
  }

  async getSession(id: string): Promise<SigningSessionRecord | undefined> {
    return this.get<SigningSessionRecord>("session", id);
  }

  async listSignerTasks(): Promise<SigningSessionRecord[]> {
    const result = await this.pool.query<{ document: SigningSessionRecord }>(
      "select document from runtime_records where kind = $1 and document->>'status' in ('round1_open', 'round2_open')",
      ["session"]
    );
    return result.rows.map((row) => row.document);
  }

  async reserveNonce(nonce: string, proposalId: string): Promise<void> {
    const inserted = await this.pool.query(
      `insert into runtime_records(kind, id, document, updated_at)
       values ('nonce', $1, $2, now())
       on conflict(kind, id) do nothing`,
      [nonce, JSON.stringify({ nonce, proposalId, consumedAt: nowIso() })]
    );
    if (inserted.rowCount && inserted.rowCount > 0) {
      return;
    }
    const existing = await this.get<NonceRecord>("nonce", nonce);
    if (!existing || existing.proposalId !== proposalId) {
      throw new Error(`Nonce already reserved by ${existing?.proposalId ?? "unknown"}`);
    }
  }

  async upsertReceipt(receipt: CommitReceipt): Promise<CommitReceipt> {
    await this.upsert("receipt", receipt.proposalId, receipt);
    return receipt;
  }

  async getReceipt(proposalId: string): Promise<CommitReceipt | undefined> {
    return this.get<CommitReceipt>("receipt", proposalId);
  }

  async listReceipts(): Promise<CommitReceipt[]> {
    const result = await this.pool.query<{ document: CommitReceipt }>(
      "select document from runtime_records where kind = $1 order by updated_at desc",
      ["receipt"]
    );
    return result.rows.map((row) => row.document);
  }

  async findReceiptByCommit(commitOid: string): Promise<CommitReceipt | undefined> {
    const result = await this.pool.query<{ document: CommitReceipt }>(
      "select document from runtime_records where kind = $1 and document->>'finalCommitOid' = $2 order by updated_at desc limit 1",
      ["receipt", commitOid]
    );
    return result.rows[0]?.document;
  }

  async upsertSignerNode(node: SignerNodeRecord): Promise<SignerNodeRecord> {
    const previous = await this.get<SignerNodeRecord>("signer_node", node.id);
    const next = { ...node, createdAt: previous?.createdAt ?? node.createdAt, updatedAt: nowIso() };
    await this.upsert("signer_node", node.id, next);
    return next;
  }

  async getSignerNode(id: string): Promise<SignerNodeRecord | undefined> {
    return this.get<SignerNodeRecord>("signer_node", id);
  }

  async listSignerNodes(): Promise<SignerNodeRecord[]> {
    return this.list<SignerNodeRecord>("signer_node");
  }

  async upsertRound1Commitment(
    commitment: SignerRound1CommitmentRecord
  ): Promise<SignerRound1CommitmentRecord> {
    await this.upsert("round1_commitment", commitment.id, commitment);
    return commitment;
  }

  async listRound1Commitments(sessionId: string): Promise<SignerRound1CommitmentRecord[]> {
    const result = await this.pool.query<{ document: SignerRound1CommitmentRecord }>(
      "select document from runtime_records where kind = $1 and document->>'sessionId' = $2 order by updated_at asc",
      ["round1_commitment", sessionId]
    );
    return result.rows.map((row) => row.document);
  }

  async upsertRound2Share(share: SignerRound2ShareRecord): Promise<SignerRound2ShareRecord> {
    await this.upsert("round2_share", share.id, share);
    return share;
  }

  async listRound2Shares(sessionId: string): Promise<SignerRound2ShareRecord[]> {
    const result = await this.pool.query<{ document: SignerRound2ShareRecord }>(
      "select document from runtime_records where kind = $1 and document->>'sessionId' = $2 order by updated_at asc",
      ["round2_share", sessionId]
    );
    return result.rows.map((row) => row.document);
  }

  async appendAuditEvent(event: AuditEventRecord): Promise<AuditEventRecord> {
    await this.upsert("audit_event", event.id, event);
    return event;
  }

  async listAuditEvents(
    filter: { proposalId?: string; sessionId?: string; limit?: number } = {}
  ): Promise<AuditEventRecord[]> {
    const clauses = ["kind = $1"];
    const values: unknown[] = ["audit_event"];
    if (filter.proposalId) {
      values.push(filter.proposalId);
      clauses.push(`document->>'proposalId' = $${values.length}`);
    }
    if (filter.sessionId) {
      values.push(filter.sessionId);
      clauses.push(`document->>'sessionId' = $${values.length}`);
    }
    const limit = filter.limit && Number.isInteger(filter.limit) ? ` limit ${filter.limit}` : "";
    const result = await this.pool.query<{ document: AuditEventRecord }>(
      `select document from runtime_records where ${clauses.join(" and ")} order by updated_at desc${limit}`,
      values
    );
    return result.rows.map((row) => row.document);
  }

  async exportBackup(): Promise<RuntimeBackup> {
    return {
      version: 1,
      exportedAt: nowIso(),
      records: {
        proposals: await this.listProposals(),
        sessions: await this.list<SigningSessionRecord>("session"),
        receipts: await this.listReceipts(),
        nonces: await this.list<NonceRecord>("nonce"),
        signerNodes: await this.listSignerNodes(),
        round1Commitments: await this.list<SignerRound1CommitmentRecord>("round1_commitment"),
        round2Shares: await this.list<SignerRound2ShareRecord>("round2_share"),
        auditEvents: await this.listAuditEvents()
      }
    };
  }

  async importBackup(backup: RuntimeBackup): Promise<void> {
    for (const proposal of backup.records.proposals) {
      await this.upsert("proposal", proposal.id, proposal);
    }
    for (const session of backup.records.sessions) {
      await this.upsert("session", session.id, session);
    }
    for (const receipt of backup.records.receipts) {
      await this.upsert("receipt", receipt.proposalId, receipt);
    }
    for (const nonce of backup.records.nonces) {
      await this.upsert("nonce", nonce.nonce, { ...nonce, consumedAt: nonce.consumedAt ?? nowIso() });
    }
    for (const node of backup.records.signerNodes) {
      await this.upsert("signer_node", node.id, node);
    }
    for (const commitment of backup.records.round1Commitments) {
      await this.upsert("round1_commitment", commitment.id, commitment);
    }
    for (const share of backup.records.round2Shares) {
      await this.upsert("round2_share", share.id, share);
    }
    for (const event of backup.records.auditEvents) {
      await this.upsert("audit_event", event.id, event);
    }
  }

  private async upsert(kind: string, id: string, document: unknown): Promise<void> {
    await this.pool.query(
      `insert into runtime_records(kind, id, document, updated_at)
       values ($1, $2, $3, now())
       on conflict(kind, id) do update set document = excluded.document, updated_at = now()`,
      [kind, id, JSON.stringify(document)]
    );
  }

  private async get<T>(kind: string, id: string): Promise<T | undefined> {
    const result = await this.pool.query<{ document: T }>(
      "select document from runtime_records where kind = $1 and id = $2",
      [kind, id]
    );
    return result.rows[0]?.document;
  }

  private async list<T>(kind: string): Promise<T[]> {
    const result = await this.pool.query<{ document: T }>(
      "select document from runtime_records where kind = $1 order by updated_at desc",
      [kind]
    );
    return result.rows.map((row) => row.document);
  }
}

export function createRuntimeStore(env: NodeJS.ProcessEnv = process.env): MemoryStore | PostgresStore {
  return env.DATABASE_URL ? new PostgresStore(env.DATABASE_URL) : store;
}

const normalizedSchemaSql = `
  create table if not exists github_installations (
    id text primary key,
    installation_id bigint not null unique,
    account_login text not null,
    account_type text not null,
    created_at timestamptz not null,
    updated_at timestamptz not null
  );

  create table if not exists repositories (
    id text primary key,
    installation_id bigint not null,
    repo_owner text not null,
    repo_name text not null,
    repo_full_name text not null unique,
    default_branch text not null,
    allowlisted boolean not null default false,
    created_at timestamptz not null,
    updated_at timestamptz not null
  );

  create table if not exists policies (
    id text primary key,
    repo_id text not null references repositories(id),
    safe_address text not null,
    chain_id numeric not null,
    target_ref text not null,
    signing_key_id text not null,
    signing_key_fingerprint text not null,
    threshold_t int not null,
    threshold_n int not null,
    allow_empty_commit boolean not null default false,
    allow_force_push boolean not null default false,
    active boolean not null default true,
    created_at timestamptz not null,
    updated_at timestamptz not null
  );

  create table if not exists proposals (
    id text primary key,
    repo_id text not null references repositories(id),
    policy_id text not null references policies(id),
    status text not null,
    target_ref text not null,
    expected_parent_oid text not null,
    tree_oid text not null,
    object_format text not null,
    commit_message text not null,
    commit_message_sha256 text not null,
    unsigned_commit_payload_sha256 text not null,
    diff_sha256 text not null,
    file_manifest_sha256 text not null,
    intent_typed_data_json jsonb not null,
    intent_hash text not null,
    safe_message_hash text not null,
    nonce text not null unique,
    deadline_unix_seconds numeric not null,
    created_by_user_id text,
    created_at timestamptz not null,
    updated_at timestamptz not null
  );

  create table if not exists safe_approvals (
    id text primary key,
    proposal_id text not null references proposals(id),
    safe_address text not null,
    chain_id numeric not null,
    safe_message_hash text not null,
    approval_status text not null,
    approval_tx_hash text,
    approval_block_number numeric,
    verified_at timestamptz,
    created_at timestamptz not null,
    updated_at timestamptz not null
  );

  create table if not exists signing_sessions (
    id text primary key,
    proposal_id text not null references proposals(id),
    status text not null,
    selected_signers jsonb,
    started_at timestamptz,
    completed_at timestamptz,
    aggregate_signature_base64 text,
    armored_ssh_signature text,
    error text,
    created_at timestamptz not null,
    updated_at timestamptz not null
  );

  create table if not exists signer_nodes (
    id text primary key,
    node_name text not null,
    public_auth_key text,
    status text not null,
    last_seen_at timestamptz,
    created_at timestamptz not null,
    updated_at timestamptz not null
  );

  create table if not exists signer_round1_commitments (
    id text primary key,
    session_id text not null references signing_sessions(id),
    signer_node_id text not null references signer_nodes(id),
    commitment_json jsonb not null,
    created_at timestamptz not null,
    unique(session_id, signer_node_id)
  );

  create table if not exists signer_round2_shares (
    id text primary key,
    session_id text not null references signing_sessions(id),
    signer_node_id text not null references signer_nodes(id),
    signature_share_json jsonb not null,
    valid boolean,
    created_at timestamptz not null,
    unique(session_id, signer_node_id)
  );

  create table if not exists commit_receipts (
    id text primary key,
    proposal_id text not null references proposals(id),
    session_id text not null references signing_sessions(id),
    final_commit_oid text not null,
    signed_commit_payload_sha256 text not null,
    armored_ssh_signature_sha256 text not null,
    github_html_url text,
    pushed_at timestamptz,
    verify_result_json jsonb not null,
    created_at timestamptz not null
  );

  create table if not exists used_nonces (
    nonce text primary key,
    proposal_id text not null references proposals(id),
    policy_id text not null references policies(id),
    consumed_at timestamptz not null
  );

  create table if not exists audit_events (
    id text primary key,
    event_type text not null,
    actor_type text not null,
    actor_id text,
    proposal_id text,
    session_id text,
    metadata jsonb,
    created_at timestamptz not null
  );
`;

export type RuntimeStore = MemoryStore | PostgresStore;

let runtimeStore: RuntimeStore | undefined;
let migration: Promise<void> | undefined;

export async function getRuntimeStore(env: NodeJS.ProcessEnv = process.env): Promise<RuntimeStore> {
  if (!runtimeStore) {
    runtimeStore = createRuntimeStore(env);
  }
  if (runtimeStore instanceof PostgresStore) {
    migration ??= runtimeStore.migrate();
    await migration;
  }
  return runtimeStore;
}
