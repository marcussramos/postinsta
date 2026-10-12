-- Pauta — banco de dados (Supabase / Postgres)
-- Rode este arquivo inteiro no Supabase: SQL Editor → New query → colar → Run.
-- Depois rode o bloco "AGENDADOR" no final, trocando os dois valores indicados.

create extension if not exists pgcrypto;

-- ───────────── Clientes (uma marca = um perfil do Instagram)
create table if not exists clients (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  contact_whatsapp text,                         -- só números, com DDI+DDD: 5565999999999
  contact_email    text,
  brand_voice      text,                         -- tom de voz da marca (usado pela IA de legendas)
  approval_token   text not null unique default encode(gen_random_bytes(24), 'hex'),
  ig_user_id       text,                         -- id do perfil na API do Instagram
  ig_username      text,
  ig_token         text,                         -- token de longa duração (60 dias)
  ig_token_expires_at timestamptz,
  ig_connected_at  timestamptz,
  created_at       timestamptz not null default now()
);

-- ───────────── Posts
-- Fluxo: idea → draft (produção) → internal_review → pending_approval → approved → publishing → published
--                                                     ↘ changes_requested
-- failed = a publicação deu erro (mensagem em last_error)
create table if not exists posts (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references clients(id) on delete cascade,
  title            text,                         -- pauta/ideia (uso interno)
  notes            text,                         -- briefing interno
  image_url        text,                         -- URL pública (bucket "posts"); ideias podem não ter

  image_path       text,                         -- caminho no bucket, para apagar depois
  caption          text not null default '',
  alt_text         text,
  scheduled_at     timestamptz,                  -- ideias podem não ter data
  status           text not null default 'draft'
                   check (status in ('idea','draft','internal_review','pending_approval','approved','changes_requested','publishing','published','failed')),
  client_feedback  text,
  decided_at       timestamptz,                  -- quando o cliente aprovou/pediu ajuste
  sent_for_approval_at timestamptz,
  ig_container_id  text,
  ig_media_id      text,
  ig_permalink     text,
  published_at     timestamptz,
  attempts         int not null default 0,
  last_error       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists posts_client_sched on posts (client_id, scheduled_at);
create index if not exists posts_due on posts (status, scheduled_at);

create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists posts_touch on posts;
create trigger posts_touch before update on posts for each row execute function touch_updated_at();

-- Segurança: só o servidor (chave service_role) acessa as tabelas.
-- RLS ligado e nenhuma política = a chave pública (anon) não lê nem grava nada.
alter table clients enable row level security;
alter table posts   enable row level security;

-- ───────────── Armazenamento das imagens
-- Bucket público: a Meta precisa baixar a imagem por URL no momento de publicar.
-- Os nomes dos arquivos são aleatórios, então não dá para "adivinhar" imagens.
insert into storage.buckets (id, name, public)
values ('posts', 'posts', true)
on conflict (id) do update set public = true;

-- ───────────── Pastas dos clientes (privadas), financeiro e contrato
alter table clients add column if not exists monthly_fee_cents int;
alter table clients add column if not exists due_day int;
alter table clients add column if not exists billing_start date;
alter table clients add column if not exists contract_data jsonb;

create table if not exists client_files (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references clients(id) on delete cascade,
  category     text not null check (category in ('contract','receipt','report','other')),
  name         text not null,
  path         text not null,               -- no bucket PRIVADO "docs"
  mime         text,
  size         int,
  ref_month    text,                        -- 'AAAA-MM' (comprovantes e relatórios)
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

insert into storage.buckets (id, name, public) values ('docs', 'docs', false)
on conflict (id) do update set public = false;

-- ───────────── Estado do sistema (última execução do agendador etc.)
create table if not exists app_state (
  key        text primary key,
  value      jsonb,
  updated_at timestamptz default now()
);
alter table app_state enable row level security;

-- ───────────── AGENDADOR
-- Não precisa editar nada aqui: depois de publicar o app, entre no painel,
-- abra a aba "Ajustes" e copie o comando pronto (já vem com o seu endereço e o código secreto).
