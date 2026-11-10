create table if not exists sessions (
  id text primary key,
  expires_at timestamptz not null
);

create index if not exists sessions_expires_at on sessions (expires_at);
