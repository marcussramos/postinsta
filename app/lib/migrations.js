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
