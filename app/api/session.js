// GET: estou logado? (+ estado da instalação, só para a agência) | POST: entrar | DELETE: sair
import { route, send, readJson, need } from '../lib/http.js';
import { currentUser, checkPassword, checkUserPassword, sessionCookie, clearCookie } from '../lib/auth.js';
import { TIMEZONE, missingEnv, igReady, appUrl, cronSecret, supabaseKeyProblem } from '../lib/env.js';
import { redirectUri } from '../lib/ig.js';
import { db } from '../lib/db.js';
import { asaasEnv } from '../lib/asaas.js';
import { activeSecret, verifyTotp, twoFactorOff } from '../lib/totp.js';
import { MIGRATION_WORKFLOW, MIGRATION_FOLDERS, MIGRATION_REPORTS, MIGRATION_PORTAL, MIGRATION_PRO, MIGRATION_V7, MIGRATION_V8, MIGRATION_V9, MIGRATION_V10 } from '../lib/migrations.js';

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
  const info = { missing_env: missing, key_problem: supabaseKeyProblem(), ig_ready: igReady(), ai_ready: Boolean(process.env.ANTHROPIC_API_KEY), mail_ready: Boolean(process.env.RESEND_API_KEY), twofa_disabled_by_env: process.env.DISABLE_2FA === '1', migration_sql: null, app_url: null, redirect_uri: null, cron_sql: null, publisher_last_run: null };
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
    try { await db.select('payments', { select: 'asaas_id', limit: 1 }); await db.select('clients', { select: 'asaas_customer_id', limit: 1 }); } catch { parts.push(MIGRATION_V8); }
    try {
      for (const t of ['push_subs', 'snippets', 'media_bank']) await db.select(t, { select: 'id', limit: 1 });
      await db.select('mail_log', { select: 'key', limit: 1 }); await db.select('users', { select: 'totp_secret', limit: 1 }); await db.select('payments', { select: 'nf_id,nf_url', limit: 1 });
    } catch { parts.push(MIGRATION_V9); }
    try { await db.select('posts', { select: 'feedback_audio', limit: 1 }); } catch { parts.push(MIGRATION_V10); }
    if (process.env.ASAAS_API_KEY) info.asaas = { env: asaasEnv(), webhook_url: `${info.app_url}/api/pasta?r=asaas` };
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

  // Dono: { password }. Equipe: { email, password }. Com 2 etapas ligada: + { code } (6 dígitos do app autenticador).
  POST: async (req, res) => {
    const { email, password, code } = await readJson(req);
    const secondStep = async (uid) => {
      if (twoFactorOff()) return true;
      const secret = await activeSecret(uid).catch(() => null);
      if (!secret) return true;
      if (!code) { send(res, 200, { need_code: true }); return false; }
      need(verifyTotp(secret, code), 401, 'Código de verificação incorreto ou vencido. Confira o app autenticador e tente de novo.');
      return true;
    };
    // pequena espera em toda tentativa: atrasa quem tenta adivinhar a senha
    await new Promise((r) => setTimeout(r, 400));
    if (email) {
      const u = await db.one('users', { select: 'id,name,role,active,pass_hash', email: `eq.${String(email).trim().toLowerCase()}` }).catch(() => null);
      need(u && u.active && checkUserPassword(password, u.pass_hash), 401, 'E-mail ou senha incorretos.');
      if (!(await secondStep(u.id))) return;
      return send(res, 200, { admin: u.role === 'admin', staff: true, role: u.role, name: u.name, timezone: TIMEZONE() }, { 'Set-Cookie': sessionCookie({ role: u.role, uid: u.id }) });
    }
    need(!missingEnv().includes('ADMIN_PASSWORD'), 503, 'Falta definir ADMIN_PASSWORD na Vercel.');
    need(checkPassword(password), 401, 'Senha incorreta.');
    if (!(await secondStep(null))) return;
    send(res, 200, { admin: true, staff: true, role: 'admin', name: 'Dono', timezone: TIMEZONE() }, { 'Set-Cookie': sessionCookie({ role: 'admin' }) });
  },

  DELETE: (req, res) => send(res, 200, { admin: false }, { 'Set-Cookie': clearCookie() }),
});
