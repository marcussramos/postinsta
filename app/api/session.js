// GET: estou logado? (+ estado da instalação, só para a agência) | POST: entrar | DELETE: sair
import { route, send, readJson, need } from '../lib/http.js';
import { isAdmin, checkPassword, sessionCookie, clearCookie } from '../lib/auth.js';
import { TIMEZONE, missingEnv, igReady, appUrl, cronSecret, supabaseKeyProblem } from '../lib/env.js';
import { redirectUri } from '../lib/ig.js';
import { db } from '../lib/db.js';

// Comando pronto para colar no SQL Editor do Supabase (Etapa 4), já com endereço e segredo certos.
function cronSql(url, secret) {
  return `-- Pauta: agendador (rode uma vez no SQL Editor do Supabase)
create table if not exists app_state (key text primary key, value jsonb, updated_at timestamptz default now());
alter table app_state enable row level security;
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule('pauta-publicador') where exists (select 1 from cron.job where jobname = 'pauta-publicador');
select cron.schedule(
  'pauta-publicador',
  '*/5 * * * *',
  $$ select net.http_post(
       url     := '${url}/api/cron',
       headers := jsonb_build_object('Authorization', 'Bearer ${secret}', 'Content-Type', 'application/json'),
       body    := '{}'::jsonb,
       timeout_milliseconds := 55000
     ) $$
);`;
}

async function setupInfo() {
  const missing = missingEnv();
  const info = { missing_env: missing, key_problem: supabaseKeyProblem(), ig_ready: igReady(), app_url: null, redirect_uri: null, cron_sql: null, publisher_last_run: null };
  try { info.app_url = appUrl(); info.redirect_uri = redirectUri(); } catch { /* sem endereço ainda */ }
  if (!missing.length && !info.key_problem && info.app_url) {
    info.cron_sql = cronSql(info.app_url, cronSecret());
    try { info.publisher_last_run = (await db.one('app_state', { select: 'value', key: 'eq.publisher' }))?.value?.at || null; }
    catch (e) { info.publisher_state_error = e.message; /* tabela app_state ainda não existe ou não visível */ }
  }
  return info;
}

export default route({
  GET: async (req, res) => {
    const admin = isAdmin(req);
    send(res, 200, { admin, timezone: TIMEZONE(), setup: admin ? await setupInfo() : undefined });
  },

  POST: async (req, res) => {
    need(!missingEnv().includes('ADMIN_PASSWORD'), 503, 'Falta definir ADMIN_PASSWORD na Vercel.');
    const { password } = await readJson(req);
    // pequena espera em toda tentativa: atrasa quem tenta adivinhar a senha
    await new Promise((r) => setTimeout(r, 400));
    need(checkPassword(password), 401, 'Senha incorreta.');
    send(res, 200, { admin: true, timezone: TIMEZONE() }, { 'Set-Cookie': sessionCookie() });
  },

  DELETE: (req, res) => send(res, 200, { admin: false }, { 'Set-Cookie': clearCookie() }),
});
