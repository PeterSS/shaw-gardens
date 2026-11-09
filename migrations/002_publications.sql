create table if not exists publications (
  id text primary key,
  kind text not null,
  created_at timestamptz not null default now()
);

create table if not exists publication_projects (
  publication_id text not null,
  project_id text not null,
  title text not null,
  notes text not null default '',
  recommendations text not null default '',
  before_image bytea,
  before_type text,
  after_image bytea,
  after_type text,
  updated_at timestamptz not null default now(),
  position integer not null,
  primary key (publication_id, project_id)
);

create index if not exists publication_projects_order
  on publication_projects (publication_id, position);

create table if not exists site_pointer (
  id integer primary key,
  live_id text,
  previous_id text
);

insert into publications (id, kind)
  values ('coming-soon', 'coming-soon')
  on conflict (id) do nothing;

insert into site_pointer (id, live_id, previous_id)
  values (1, 'coming-soon', null)
  on conflict (id) do nothing;
