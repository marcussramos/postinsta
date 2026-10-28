// Endpoint do publicador. Protegido pelo CRON_SECRET.
import crypto from 'node:crypto';
import { route, send, need } from '../lib/http.js';
import { cronSecret } from '../lib/env.js';
import { runPublisher } from '../lib/publisher.js';
import { autoReports, snapshotFollowers } from '../lib/reports.js';
import { weeklyBackup, weeklyBackupCheck } from '../lib/backup.js';
import { getState } from '../lib/appstate.js';
import { notify } from '../lib/push.js';
import { runMailer } from '../lib/mail.js';
import { checkConnections } from '../lib/ighealth.js';
import { runReminders } from '../lib/reminders.js';

function authorized(req) {
  const given = Buffer.from(String(req.headers.authorization || ''));
  const expected = Buffer.from(`Bearer ${cronSecret()}`);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

async function run(req, res) {
  need(authorized(req), 401, 'Não autorizado.');
  const started = Date.now();
  // Vigia: o cron diário da Vercel (GET) é independente do agendador do Supabase (a cada 5 min).
  // Se o agendador não roda há mais de 2 h, avisa no celular: posts aprovados não estão saindo.
  let watchdog = null;
  if (req.method === 'GET') {
    const prev = await getState('publisher', null);
    const idle = prev?.at ? Date.now() - new Date(prev.at).getTime() : null;
    if (idle == null || idle > 2 * 3600e3) {
      watchdog = idle == null ? 'agendador nunca rodou' : `agendador parado há ${Math.round(idle / 3600e3)} h`;
      await notify({ title: '⚠️ Agendador automático parado', body: `${watchdog[0].toUpperCase()}${watchdog.slice(1)}: posts aprovados não estão saindo. Veja em Ajustes.`, url: '/equipe#ajustes', tag: 'watchdog' }).catch(() => {});
    }
  }
  const log = await runPublisher();
  if (watchdog) log.watchdog = watchdog;
  // Tarefas extras (só se sobrou tempo; antes da atualização do banco as tabelas não existem e elas ficam quietas)
  if (Date.now() - started < 20000) {
    try { log.followers_snapshot = await snapshotFollowers(); } catch (e) { log.followers_snapshot_error = e.message; }
    try { log.auto_report = await autoReports(); } catch (e) { log.auto_report_error = e.message; }
  }
  try { log.reminders = await runReminders(); } catch (e) { log.reminders_error = e.message; }
  if (Date.now() - started < 25000) { try { log.ig_health = await checkConnections({ force: req.method === 'GET' }); } catch (e) { log.ig_health_error = e.message; } }
  if (Date.now() - started < 25000) { try { log.backup = await weeklyBackup(); } catch (e) { log.backup_error = e.message; } }
  if (req.method === 'GET' && Date.now() - started < 30000) { // uma vez por semana, confere se o último backup abre e está inteiro
    try {
      log.backup_check = await weeklyBackupCheck();
      if (log.backup_check && !log.backup_check.ok) await notify({ title: '⚠️ Backup com problema', body: log.backup_check.problems.join(' ').slice(0, 160), url: '/equipe#ajustes', tag: 'backup-check' }).catch(() => {});
    } catch (e) { log.backup_check_error = e.message; }
  }
  if (Date.now() - started < 30000) { try { log.mail = await runMailer({ budgetMs: 45000 - (Date.now() - started) }); } catch (e) { log.mail_error = e.message; } }
  if (log.failed.length) console.warn('Publicador: falhas', JSON.stringify(log.failed));
  send(res, 200, log);
}

// POST: agendador do Supabase (a cada 5 min). GET: cron diário da Vercel, como reserva.
export default route({ GET: run, POST: run });
