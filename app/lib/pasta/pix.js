// Pix automático (Asaas).
//   pix   (admin)  GET status | POST {client_id, month, n} gera/mostra o Pix | POST ?setup=1 liga o aviso automático
//   asaas (público, só o Asaas): POST aviso de pagamento, protegido pelo cabeçalho asaas-access-token
import crypto from 'node:crypto';
import { route, send, readJson, query, need } from '../http.js';
import { requireAdmin } from '../auth.js';
import { db } from '../db.js';
import { appUrl } from '../env.js';
import { asaas, asaasReady, asaasEnv, ensureCharge, setupWebhook, webhookToken, handleWebhook } from '../asaas.js';
import { loadSettings } from './settings.js';

export default route({
  GET: async (req, res) => {
    await requireAdmin(req);
    if (!asaasReady()) return send(res, 200, { ready: false });
    let account = null, error = null;
    try { const b = await asaas('/finance/balance'); account = { balance: b.balance ?? null }; } catch (e) { error = e.message; }
    const hooks = await asaas('/webhooks').catch(() => ({ data: [] }));
    const url = `${appUrl()}/api/pasta?r=asaas`;
    const hook = (hooks.data || []).find((w) => w.url === url);
    send(res, 200, { ready: true, env: asaasEnv(), account, error, webhook: hook ? { enabled: hook.enabled, interrupted: hook.interrupted } : null, webhook_url: url });
  },
  POST: async (req, res) => {
    await requireAdmin(req);
    if (query(req).setup) {
      const { agency } = await loadSettings();
      const b = await readJson(req);
      const email = String(b.email || agency.email || '').trim();
      need(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email), 400, 'Informe um e-mail para o Asaas avisar se o webhook falhar (ou preencha o e-mail da agência em Ajustes).');
      await setupWebhook(appUrl(), email);
      return send(res, 200, { ok: true });
    }
    const b = await readJson(req);
    const c = await db.one('clients', { select: '*', id: `eq.${b.client_id}` });
    need(c, 404, 'Cliente não encontrado.');
    send(res, 200, await ensureCharge(c, String(b.month || ''), Number(b.n) || 1));
  },
});

export const asaasWebhook = route({
  POST: async (req, res) => {
    const given = Buffer.from(String(req.headers['asaas-access-token'] || ''));
    const expected = Buffer.from(webhookToken());
    need(given.length === expected.length && crypto.timingSafeEqual(given, expected), 401, 'Não autorizado.');
    const evt = await readJson(req);
    const out = await handleWebhook(evt);
    send(res, 200, { received: true, ...out });
  },
});
