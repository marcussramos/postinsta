// Backup automático: uma vez por semana copia todas as tabelas para um arquivo JSON
// no cofre privado (bucket "docs", pasta _backups). Guarda as 8 últimas cópias.
// As imagens e documentos já ficam no Supabase Storage; o backup é dos dados (clientes, posts, pagamentos…).
import { db, docs } from './db.js';
import { getState, setState } from './appstate.js';

export const BACKUP_TABLES = ['clients', 'posts', 'client_files', 'payments', 'reports', 'ig_daily', 'post_events', 'users', 'requests', 'proposals', 'app_state', 'snippets', 'media_bank', 'push_subs', 'mail_log'];
const KEEP = 8;
const WEEK = 7 * 864e5;
const PAGE = 1000;

async function dumpTable(t) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await db.select(t, { select: '*', limit: PAGE, offset });
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

export async function listBackups() {
  return (await getState('backups', [])) || [];
}

export async function runBackup({ now = Date.now(), reason = 'auto' } = {}) {
  const data = { app: 'MC DIGITAL', version: 1, created_at: new Date(now).toISOString(), reason, tables: {} };
  const counts = {};
  for (const t of BACKUP_TABLES) {
    try { data.tables[t] = await dumpTable(t); counts[t] = data.tables[t].length; }
    catch { /* tabela ainda não existe nesta instalação */ }
  }
  const stamp = new Date(now).toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const path = `_backups/backup-${stamp}.json`;
  const buf = Buffer.from(JSON.stringify(data));
  await docs.upload(path, buf, 'application/json');
  const list = [{ path, at: data.created_at, size: buf.length, rows: Object.values(counts).reduce((a, b) => a + b, 0), reason }, ...(await listBackups()).filter((b) => b.path !== path)];
  for (const old of list.slice(KEEP)) await docs.remove(old.path);
  await setState('backups', list.slice(0, KEEP));
  return list[0];
}

// Chamado pelo agendador: só faz se o último tem mais de 7 dias.
export async function weeklyBackup({ now = Date.now() } = {}) {
  const last = (await listBackups()).find((b) => b.reason === 'auto') || (await listBackups())[0];
  if (last && now - new Date(last.at).getTime() < WEEK) return null;
  return runBackup({ now, reason: 'auto' });
}

// ── Conferência: abre o último backup, valida o arquivo e compara com o banco atual.
// Não mexe em nada; o resultado fica em app_state "backup_check" e aparece em Ajustes.
export function checkBackup(data) {
  const problems = [];
  if (!data || typeof data !== 'object' || data.app !== 'MC DIGITAL' || !data.tables || typeof data.tables !== 'object') return { ok: false, problems: ['Arquivo não é um backup do MC DIGITAL.'], tables: {} };
  const tables = {};
  for (const [t, rows] of Object.entries(data.tables)) {
    if (!Array.isArray(rows)) { problems.push(`Tabela ${t} corrompida.`); continue; }
    tables[t] = rows.length;
    if (['clients', 'posts'].includes(t) && rows.some((r) => !r?.id)) problems.push(`Tabela ${t} tem registros sem id.`);
  }
  if (!data.tables.clients) problems.push('Backup sem a tabela de clientes.');
  return { ok: !problems.length, problems, tables, created_at: data.created_at };
}
export async function verifyLatestBackup({ now = Date.now() } = {}) {
  const last = (await listBackups())[0];
  if (!last) return null;
  let res;
  try { res = checkBackup(await docs.download(last.path)); }
  catch (e) { res = { ok: false, problems: [`Não consegui abrir o arquivo: ${e.message}`], tables: {} }; }
  // o banco atual não pode ter "perdido" muitos clientes em relação ao backup (sinal de algo errado)
  try {
    const cur = (await db.select('clients', { select: 'id' })).length;
    if (res.tables.clients != null && cur < res.tables.clients) res.problems.push(`O banco tem ${cur} clientes; o backup tem ${res.tables.clients}.`);
  } catch { /* sem acesso ao banco agora: confere só o arquivo */ }
  const out = { at: new Date(now).toISOString(), path: last.path, backup_at: last.at, ok: res.ok && !res.problems.length, problems: res.problems, rows: Object.values(res.tables).reduce((a, b) => a + b, 0), tables: res.tables };
  await setState('backup_check', out);
  return out;
}
export async function weeklyBackupCheck({ now = Date.now() } = {}) {
  const last = await getState('backup_check', null);
  if (last && now - new Date(last.at).getTime() < WEEK) return null;
  return verifyLatestBackup({ now });
}

// ── Restauração (só para emergência, pelo script scripts/restaurar-backup.mjs; não fica exposta no app).
// Regrava as linhas do backup por cima (upsert pelo id/chave), na ordem das dependências.
export const RESTORE_ORDER = ['clients', 'users', 'client_files', 'posts', 'payments', 'reports', 'ig_daily', 'post_events', 'requests', 'proposals', 'snippets', 'media_bank', 'push_subs', 'mail_log', 'app_state'];
export async function restoreBackup(data, { only } = {}) {
  const chk = checkBackup(data);
  if (!chk.ok) throw new Error(`Backup inválido: ${chk.problems.join(' ')}`);
  const done = {};
  for (const t of RESTORE_ORDER) {
    const rows = data.tables[t];
    if (!Array.isArray(rows) || (only && !only.includes(t))) continue;
    for (let i = 0; i < rows.length; i += 500) await db.upsert(t, rows.slice(i, i + 500));
    done[t] = rows.length;
  }
  return done;
}
