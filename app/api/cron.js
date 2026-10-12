// Endpoint do publicador. Protegido pelo CRON_SECRET.
import crypto from 'node:crypto';
import { route, send, need } from '../lib/http.js';
import { env } from '../lib/env.js';
import { runPublisher } from '../lib/publisher.js';

function authorized(req) {
  const given = Buffer.from(String(req.headers.authorization || ''));
  const expected = Buffer.from(`Bearer ${env('CRON_SECRET')}`);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

async function run(req, res) {
  need(authorized(req), 401, 'Não autorizado.');
  const log = await runPublisher();
  if (log.failed.length) console.warn('Publicador: falhas', JSON.stringify(log.failed));
  send(res, 200, log);
}

// POST: agendador do Supabase (a cada 5 min). GET: cron diário da Vercel, como reserva.
export default route({ GET: run, POST: run });
