// Pasta privada dos clientes — uma função só (o plano grátis da Vercel aceita no máximo 12).
// /api/pasta?r=files | payments | settings | contract | reports | report  (+ os parâmetros de cada rota)
import files from '../lib/pasta/files.js';
import payments from '../lib/pasta/payments.js';
import settings from '../lib/pasta/settings.js';
import contract from '../lib/pasta/contract.js';
import reports, { publicReport } from '../lib/pasta/reports.js';
import { send } from '../lib/http.js';

const ROUTES = { files, payments, settings, contract, reports, report: publicReport }; // "report" é o único público (link do cliente)

export default function handler(req, res) {
  const r = new URL(req.url, 'http://x').searchParams.get('r');
  const fn = ROUTES[r];
  if (!fn) return send(res, 404, { error: 'Rota não encontrada.' });
  return fn(req, res);
}
