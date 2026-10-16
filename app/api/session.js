// GET: estou logado? (+ estado da instalação, só para a agência) | POST: entrar | DELETE: sair
import { route, send, readJson, need } from '../lib/http.js';
import { currentUser, checkPassword, checkUserPassword, sessionCookie, clearCookie } from '../lib/auth.js';
import { TIMEZONE, missingEnv, igReady, appUrl, cronSecret, supabaseKeyProblem } from '../lib/env.js';
import { redirectUri } from '../lib/ig.js';
import { db } from '../lib/db.js';
import { setState } from '../lib/appstate.js';
import { asaasEnv } from '../lib/asaas.js';
import { activeSecret, verifyTotp, twoFactorOff } from '../lib/totp.js';
import { MIGRATION_WORKFLOW, MIGRATION_FOLDERS, MIGRATION_REPORTS, MIGRATION_PORTAL, MIGRATION_PRO, MIGRATION_V7, MIGRATION_V8, MIGRATION_V9, MIGRATION_V10, MIGRATION_V11, MIGRATION_V12, MIGRATION_V13 } from '../lib/migrations.js';

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
    // banco desatualizado? Cada atualização tem suas colunas de teste; tudo consultado AO MESMO TEMPO
    // (em sequência eram ~25 idas ao banco e o painel demorava ~3 s para abrir).
    const sel = (t, cols) => db.select(t, { select: cols, limit: 1 });
    const CHECKS = [
      [MIGRATION_WORKFLOW, [['posts', 'title'], ['clients', 'brand_voice']]],
      [MIGRATION_FOLDERS, [['client_files', 'id'], ['payments', 'ref_month'], ['clients', 'monthly_fee_cents']]],
      [MIGRATION_REPORTS, [['reports', 'id'], ['ig_daily', 'day']]],
      [MIGRATION_PORTAL, [['clients', 'portal_token']]],
      [MIGRATION_PRO, [['posts', 'media_type'], ['payments', 'installment'], ['post_events', 'id'], ['users', 'id'], ['requests', 'id'], ['clients', 'brand_kit,installments']]],
      [MIGRATION_V7, [['proposals', 'id']]],
      [MIGRATION_V8, [['payments', 'asaas_id'], ['clients', 'asaas_customer_id']]],
      [MIGRATION_V9, [['push_subs', 'id'], ['snippets', 'id'], ['media_bank', 'id'], ['mail_log', 'key'], ['users', 'totp_secret'], ['payments', 'nf_id,nf_url']]],
      [MIGRATION_V10, [['posts', 'feedback_audio']]],
      [MIGRATION_V11, [['leads', 'id']]],
      [MIGRATION_V12, [['users', 'perms,client_ids']]],
      [MIGRATION_V13, [['posts', 'script']]],
    ];
    // Uma consulta só no caso comum: o último "tudo em dia" fica salvo em app_state (schema_ok).
    // Quando entra uma atualização nova (CHECKS cresce), testa de novo.
    let rows = null;
    try { rows = await db.select('app_state', { select: 'key,value', key: 'in.(publisher,schema_ok)' }); }
    catch (e) { info.publisher_state_error = e.message; }
    const st = Object.fromEntries((rows || []).map((r) => [r.key, r.value]));
    if (rows) info.publisher_last_run = st.publisher?.at || null;
    let parts = [];
    if (st.schema_ok?.v !== CHECKS.length) {
      parts = (await Promise.all(CHECKS.map(([sql, probes]) => Promise.all(probes.map(([t, c]) => sel(t, c))).then(() => null, () => sql)))).filter(Boolean);
      if (!parts.length && rows) await setState('schema_ok', { v: CHECKS.length, at: new Date().toISOString() }).catch(() => {});
    }
    info.legal_missing = [];
    if (process.env.ASAAS_API_KEY) info.asaas = { env: asaasEnv(), webhook_url: `${info.app_url}/api/pasta?r=asaas` };
    if (parts.length) info.migration_sql = parts.join('\n\n');
  }
  return info;
}

export default route({
  GET: async (req, res) => {
    const u = await currentUser(req);
    const admin = u?.role === 'admin';
    send(res, 200, { admin, staff: Boolean(u), role: u?.role || null, name: u?.name || null, perms: u?.perms || null, clients: u?.clients || null, timezone: TIMEZONE(), setup: admin ? await setupInfo() : undefined });
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
