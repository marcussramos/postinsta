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
