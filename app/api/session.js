// GET: estou logado? (+ estado da instalação, só para a agência) | POST: entrar | DELETE: sair
import { route, send, readJson, need } from '../lib/http.js';
import { currentUser, checkPassword, checkUserPassword, sessionCookie, clearCookie } from '../lib/auth.js';
import { TIMEZONE, missingEnv, igReady, appUrl, cronSecret, supabaseKeyProblem } from '../lib/env.js';
import { redirectUri } from '../lib/ig.js';
import { db } from '../lib/db.js';
import { MIGRATION_WORKFLOW, MIGRATION_FOLDERS, MIGRATION_REPORTS, MIGRATION_PORTAL, MIGRATION_PRO, MIGRATION_V7 } from '../lib/migrations.js';

// Comando pronto para colar no SQL Editor do Supabase (Etapa 4), já com endereço e segredo certos.
function cronSql(url, secret) {
  return `-- MC DIGITAL: agendador (rode uma vez no SQL Editor do Supabase)
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
  const info = { missing_env: missing, key_problem: supabaseKeyProblem(), ig_ready: igReady(), ai_ready: Boolean(process.env.ANTHROPIC_API_KEY), migration_sql: null, app_url: null, redirect_uri: null, cron_sql: null, publisher_last_run: null };
  try { info.app_url = appUrl(); info.redirect_uri = redirectUri(); } catch { /* sem endereço ainda */ }
  if (!missing.length && !info.key_problem && info.app_url) {
    info.cron_sql = cronSql(info.app_url, cronSecret());
    try { info.publisher_last_run = (await db.one('app_state', { select: 'value', key: 'eq.publisher' }))?.value?.at || null; }
    catch (e) { info.publisher_state_error = e.message; /* tabela app_state ainda não existe ou não visível */ }
    // banco desatualizado? os comandos são seguros de rodar de novo, então junta o que faltar
    const parts = [];
    try { await db.select('posts', { select: 'title', limit: 1 }); await db.select('clients', { select: 'brand_voice', limit: 1 }); }
    catch { parts.push(MIGRATION_WORKFLOW); }
    try { await db.select('client_files', { select: 'id', limit: 1 }); await db.select('payments', { select: 'ref_month', limit: 1 }); await db.select('clients', { select: 'monthly_fee_cents', limit: 1 }); }
    catch { parts.push(MIGRATION_FOLDERS); }
    try { await db.select('reports', { select: 'id', limit: 1 }); await db.select('ig_daily', { select: 'day', limit: 1 }); }
    catch { parts.push(MIGRATION_REPORTS); }
    try { await db.select('clients', { select: 'portal_token', limit: 1 }); }
    catch { parts.push(MIGRATION_PORTAL); }
    try {
      await db.select('posts', { select: 'media_type', limit: 1 }); await db.select('payments', { select: 'installment', limit: 1 });
      await db.select('post_events', { select: 'id', limit: 1 }); await db.select('users', { select: 'id', limit: 1 }); await db.select('requests', { select: 'id', limit: 1 });
      await db.select('clients', { select: 'brand_kit,installments', limit: 1 });
    } catch { parts.push(MIGRATION_PRO); }
    try { await db.select('proposals', { select: 'id', limit: 1 }); } catch { parts.push(MIGRATION_V7); }
    if (parts.length) info.migration_sql = parts.join('\n\n');
  }
  return info;
}

export default route({
  GET: async (req, res) => {
    const u = await currentUser(req);
    const admin = u?.role === 'admin';
    send(res, 200, { admin, staff: Boolean(u), role: u?.role || null, name: u?.name || null, timezone: TIMEZONE(), setup: admin ? await setupInfo() : undefined });
  },

  // Dono: { password }. Equipe: { email, password }.
  POST: async (req, res) => {
    const { email, password } = await readJson(req);
    // pequena espera em toda tentativa: atrasa quem tenta adivinhar a senha
    await new Promise((r) => setTimeout(r, 400));
    if (email) {
      const u = await db.one('users', { select: 'id,name,role,active,pass_hash', email: `eq.${String(email).trim().toLowerCase()}` }).catch(() => null);
      need(u && u.active && checkUserPassword(password, u.pass_hash), 401, 'E-mail ou senha incorretos.');
      return send(res, 200, { admin: u.role === 'admin', staff: true, role: u.role, name: u.name, timezone: TIMEZONE() }, { 'Set-Cookie': sessionCookie({ role: u.role, uid: u.id }) });
    }
    need(!missingEnv().includes('ADMIN_PASSWORD'), 503, 'Falta definir ADMIN_PASSWORD na Vercel.');
    need(checkPassword(password), 401, 'Senha incorreta.');
    send(res, 200, { admin: true, staff: true, role: 'admin', name: 'Dono', timezone: TIMEZONE() }, { 'Set-Cookie': sessionCookie({ role: 'admin' }) });
  },

  DELETE: (req, res) => send(res, 200, { admin: false }, { 'Set-Cookie': clearCookie() }),
});
