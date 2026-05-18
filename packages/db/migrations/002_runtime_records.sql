create table if not exists runtime_records (
  kind text not null,
  id text not null,
  document jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (kind, id)
);

create index if not exists runtime_records_kind_updated_idx on runtime_records(kind, updated_at desc);
create index if not exists runtime_records_document_gin_idx on runtime_records using gin(document);
