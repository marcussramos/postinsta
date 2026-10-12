// Endpoint do publicador. Protegido pelo CRON_SECRET.
import crypto from 'node:crypto';
import { route, send, need } from '../lib/http.js';
import { cronSecret } from '../lib/env.js';
import { runPublisher } from '../lib/publisher.js';
import { autoReports, snapshotFollowers } from '../lib/reports.js';

function authorized(req) {
  const given = Buffer.from(String(req.headers.authorization || ''));
  const expected = Buffer.from(`Bearer ${cronSecret()}`);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

async function run(req, res) {
  need(authorized(req), 401, 'Não autorizado.');
  const started = Date.now();
  const log = await runPublisher();
  // Tarefas extras (só se sobrou tempo; antes da atualização do banco as tabelas não existem e elas ficam quietas)
  if (Date.now() - started < 20000) {
    try { log.followers_snapshot = await snapshotFollowers(); } catch (e) { log.followers_snapshot_error = e.message; }
    try { log.auto_report = await autoReports(); } catch (e) { log.auto_report_error = e.message; }
  }
  if (log.failed.length) console.warn('Publicador: falhas', JSON.stringify(log.failed));
  send(res, 200, log);
}

// POST: agendador do Supabase (a cada 5 min). GET: cron diário da Vercel, como reserva.
export default route({ GET: run, POST: run });
