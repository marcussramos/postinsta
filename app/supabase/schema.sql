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

-- área do cliente (link privado com contrato, relatórios e financeiro)
alter table clients add column if not exists portal_token text unique;

-- ───────────── Relatórios mensais do Instagram
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

create table if not exists ig_daily (
  client_id  uuid not null references clients(id) on delete cascade,
  day        date not null,
  followers  int,
  primary key (client_id, day)
);
alter table ig_daily enable row level security;

-- MC DIGITAL: atualização 6 (Reels/carrossel, parcelas, histórico de aprovações, equipe, marca e pedidos) — rode uma vez no SQL Editor do Supabase
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

-- atualização 9: notificações, backup, modelos, banco de mídia, e-mails, nota fiscal e 2 etapas
create table if not exists push_subs (
  id          uuid primary key default gen_random_uuid(),
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  role        text not null default 'admin',
  user_id     uuid,
  device      text,
  created_at  timestamptz not null default now()
);
alter table push_subs enable row level security;

create table if not exists snippets (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid references clients(id) on delete cascade,
  kind        text not null check (kind in ('caption','hashtags')),
  name        text not null,
  text        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists snippets_client on snippets (client_id, kind);
alter table snippets enable row level security;

create table if not exists media_bank (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id) on delete cascade,
  url         text not null,
  path        text,
  name        text,
  created_at  timestamptz not null default now()
);
create index if not exists media_bank_client on media_bank (client_id, created_at desc);
alter table media_bank enable row level security;

create table if not exists mail_log (key text primary key, sent_at timestamptz not null default now());
alter table mail_log enable row level security;

alter table users add column if not exists totp_secret text;

alter table payments add column if not exists nf_id text;
alter table payments add column if not exists nf_status text;
alter table payments add column if not exists nf_url text;
alter table client_files drop constraint if exists client_files_category_check;
alter table client_files add constraint client_files_category_check check (category in ('contract','receipt','report','other','brand','briefing','invoice','audio'));

-- atualização 10: pedido de ajuste por áudio
alter table posts add column if not exists feedback_audio uuid references client_files(id) on delete set null;

-- atualização 11: funil de vendas e diagnóstico grátis
create table if not exists leads (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  company         text,
  instagram       text,
  whatsapp        text,
  email           text,
  niche           text,
  source          text not null default 'manual',
  stage           text not null default 'novo' check (stage in ('novo','contato','reuniao','proposta','fechado','perdido')),
  value_cents     int,
  next_action     text,
  next_action_at  date,
  notes           text,
  diagnosis       jsonb,
  wants_contact   boolean not null default false,
  proposal_id     uuid references proposals(id) on delete set null,
  client_id       uuid references clients(id) on delete set null,
  lost_reason     text,
  ip_hash         text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists leads_stage on leads (stage, updated_at desc);
alter table leads enable row level security;

-- atualização 12: permissões por pessoa da equipe
alter table users add column if not exists perms jsonb;
alter table users add column if not exists client_ids jsonb;
