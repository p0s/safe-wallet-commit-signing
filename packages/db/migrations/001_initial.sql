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
