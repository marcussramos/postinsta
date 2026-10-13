// Pasta privada dos clientes — uma função só (o plano grátis da Vercel aceita no máximo 12).
// /api/pasta?r=files | payments | settings | contract | reports | report  (+ os parâmetros de cada rota)
import files from '../lib/pasta/files.js';
import payments from '../lib/pasta/payments.js';
import settings from '../lib/pasta/settings.js';
import contract from '../lib/pasta/contract.js';
import reports, { publicReport } from '../lib/pasta/reports.js';
import portal from '../lib/pasta/portal.js';
import users from '../lib/pasta/users.js';
import proposals, { publicProposal } from '../lib/pasta/proposals.js';
import pix, { asaasWebhook } from '../lib/pasta/pix.js';
import { deliveriesRoute, historyRoute, brandRoute, requestsRoute, feedRoute, besttimeRoute } from '../lib/pasta/extras.js';
import { planRoute, snippetsRoute, mediaRoute, duplicateRoute } from '../lib/pasta/tools.js';
import { backupRoute, pushRoute, securityRoute, mailcfgRoute, nfRoute } from '../lib/pasta/system.js';
import { onboardingRoute, onbcfgRoute } from '../lib/pasta/onboarding.js';
import { send } from '../lib/http.js';

// "report", "portal", "proposal" e "asaas" (aviso de pagamento, com código secreto) são públicos (abertos pelo link secreto do cliente); o resto exige login da agência
const ROUTES = {
  files, payments, settings, contract, reports, report: publicReport, portal, users, proposals, proposal: publicProposal, pix, asaas: asaasWebhook,
  deliveries: deliveriesRoute, history: historyRoute, brand: brandRoute, requests: requestsRoute, feed: feedRoute, besttime: besttimeRoute,
  plan: planRoute, snippets: snippetsRoute, media: mediaRoute, duplicate: duplicateRoute,
  onboarding: onboardingRoute, onbcfg: onbcfgRoute, backup: backupRoute, push: pushRoute, security: securityRoute, mailcfg: mailcfgRoute, nf: nfRoute,
};

export default function handler(req, res) {
  const r = new URL(req.url, 'http://x').searchParams.get('r');
  const fn = ROUTES[r];
  if (!fn) return send(res, 404, { error: 'Rota não encontrada.' });
  return fn(req, res);
}
