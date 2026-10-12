// Atualizações do banco para instalações que já existiam.
// O painel (aba Ajustes) detecta quando falta rodar e mostra o comando pronto.
export const MIGRATION_WORKFLOW = `-- MC DIGITAL: atualização 2 (workflow, ideias e IA) — rode uma vez no SQL Editor do Supabase
alter table posts alter column image_url drop not null;
alter table posts alter column scheduled_at drop not null;
alter table posts add column if not exists title text;
alter table posts add column if not exists notes text;
alter table posts drop constraint if exists posts_status_check;
alter table posts add constraint posts_status_check check (status in
  ('idea','draft','internal_review','pending_approval','approved','changes_requested','publishing','published','failed'));
alter table clients add column if not exists brand_voice text;
notify pgrst, 'reload schema';`;

export const MIGRATION_FOLDERS = `-- MC DIGITAL: atualização 3 (pastas dos clientes, financeiro e contrato) — rode uma vez no SQL Editor do Supabase
alter table clients add column if not exists monthly_fee_cents int;
alter table clients add column if not exists due_day int;
alter table clients add column if not exists billing_start date;
alter table clients add column if not exists contract_data jsonb;

create table if not exists client_files (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references clients(id) on delete cascade,
  category     text not null check (category in ('contract','receipt','report','other')),
  name         text not null,
  path         text not null,
  mime         text,
  size         int,
  ref_month    text,
  created_at   timestamptz not null default now()
);
create index if not exists client_files_client on client_files (client_id, category, created_at desc);
alter table client_files enable row level security;

create table if not exists payments (
  client_id    uuid not null references clients(id) on delete cascade,
  ref_month    text not null,
  status       text not null default 'paid' check (status in ('paid','pending','waived')),
  amount_cents int,
  paid_at      date,
  file_id      uuid references client_files(id) on delete set null,
  note         text,
  updated_at   timestamptz not null default now(),
  primary key (client_id, ref_month)
);
alter table payments enable row level security;

create table if not exists app_state (key text primary key, value jsonb, updated_at timestamptz default now());
alter table app_state enable row level security;

-- arquivos dos clientes: bucket PRIVADO (só abre por link temporário gerado para a agência)
insert into storage.buckets (id, name, public) values ('docs', 'docs', false)
on conflict (id) do update set public = false;

notify pgrst, 'reload schema';`;

export const MIGRATION_REPORTS = `-- MC DIGITAL: atualização 4 (relatórios mensais do Instagram) — rode uma vez no SQL Editor do Supabase
create table if not exists reports (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references clients(id) on delete cascade,
  ref_month    text not null,
  data         jsonb not null,
  note         text,
  share_token  text not null unique,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (client_id, ref_month)
);
alter table reports enable row level security;

-- total de seguidores por dia (base para "seguidores ganhos" em perfis com menos de 100 seguidores)
create table if not exists ig_daily (
  client_id  uuid not null references clients(id) on delete cascade,
  day        date not null,
  followers  int,
  primary key (client_id, day)
);
alter table ig_daily enable row level security;

notify pgrst, 'reload schema';`;

export const MIGRATION_PORTAL = `-- MC DIGITAL: atualização 5 (área do cliente) — rode uma vez no SQL Editor do Supabase
alter table clients add column if not exists portal_token text unique;
notify pgrst, 'reload schema';`;

export const MIGRATION_PRO = `-- MC DIGITAL: atualização 6 (Reels/carrossel, parcelas, histórico de aprovações, equipe, marca e pedidos) — rode uma vez no SQL Editor do Supabase
-- Reels e carrossel
alter table posts add column if not exists media_type text not null default 'IMAGE';
alter table posts add column if not exists media jsonb;
alter table posts drop constraint if exists posts_media_type_check;
alter table posts add constraint posts_media_type_check check (media_type in ('IMAGE','CAROUSEL','REELS'));

-- mensalidade em parcelas
alter table clients add column if not exists installments jsonb;
alter table payments add column if not exists installment int not null default 1;
alter table payments drop constraint if exists payments_pkey;
alter table payments add primary key (client_id, ref_month, installment);

-- histórico de aprovações (prova): fica mesmo se o post for apagado
create table if not exists post_events (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid references posts(id) on delete set null,
  client_id   uuid not null references clients(id) on delete cascade,
  type        text not null,
  note        text,
  snapshot    jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists post_events_client on post_events (client_id, created_at desc);
alter table post_events enable row level security;

-- contas da equipe
create table if not exists users (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text not null unique,
  role        text not null default 'team' check (role in ('admin','team')),
  pass_hash   text not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
alter table users enable row level security;

-- identidade da marca e pedidos do cliente
alter table clients add column if not exists brand_kit jsonb;
alter table client_files drop constraint if exists client_files_category_check;
alter table client_files add constraint client_files_category_check check (category in ('contract','receipt','report','other','brand','briefing'));
create table if not exists requests (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references clients(id) on delete cascade,
  text         text not null,
  wanted_date  date,
  status       text not null default 'open' check (status in ('open','doing','done')),
  file_ids     jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists requests_client on requests (client_id, created_at desc);
alter table requests enable row level security;

notify pgrst, 'reload schema';`;

export const MIGRATION_V7 = `-- MC DIGITAL: atualização 7 (Stories e propostas comerciais) — rode uma vez no SQL Editor do Supabase
alter table posts drop constraint if exists posts_media_type_check;
alter table posts add constraint posts_media_type_check check (media_type in ('IMAGE','CAROUSEL','REELS','STORY'));

create table if not exists proposals (
  id               uuid primary key default gen_random_uuid(),
  token            text not null unique,
  status           text not null default 'draft' check (status in ('draft','sent','accepted','declined')),
  client_name      text not null,
  contact          jsonb,
  intro            text,
  items            jsonb,
  entregas         text,
  quota_posts      int,
  quota_reels      int,
  monthly_fee_cents int not null,
  installments     jsonb,
  forma_pagamento  text,
  valid_until      date,
  notes            text,
  accepted         jsonb,
  accepted_at      timestamptz,
  client_id        uuid references clients(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
alter table proposals enable row level security;

notify pgrst, 'reload schema';`;

export const MIGRATION_V8 = `-- MC DIGITAL: atualização 8 (Pix automático via Asaas) — rode uma vez no SQL Editor do Supabase
alter table payments add column if not exists asaas_id text;
alter table payments add column if not exists pix_payload text;
alter table payments add column if not exists pix_url text;
alter table payments add column if not exists receipt_url text;
alter table clients add column if not exists asaas_customer_id text;
notify pgrst, 'reload schema';`;
