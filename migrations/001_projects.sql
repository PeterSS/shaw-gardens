create table if not exists projects (
  id text primary key,
  title text not null,
  notes text not null default '',
  recommendations text not null default '',
  before_image bytea,
  before_type text,
  after_image bytea,
  after_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists projects_updated_at on projects (updated_at desc);
