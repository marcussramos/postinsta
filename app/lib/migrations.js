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
