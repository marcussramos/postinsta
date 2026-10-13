// Dados da agência e modelo de contrato (guardados em app_state). Só para a agência.
import { route, send, readJson, need } from '../http.js';
import { requireAdmin, requirePerm } from '../auth.js';
import { db } from '../db.js';
import { DEFAULT_TEMPLATE, FIELDS } from '../contract.js';

const AGENCY_FIELDS = ['razao_social', 'qualificacao', 'cnpj', 'endereco', 'cidade', 'representante', 'representante_cpf', 'email', 'pix', 'marca', 'slogan'];

async function getKey(key) {
  try { return (await db.one('app_state', { select: 'value', key: `eq.${key}` }))?.value ?? null; }
  catch { return null; }
}

export async function loadSettings() {
  const [agency, tpl] = await Promise.all([getKey('agency'), getKey('contract_template')]);
  return { agency: agency || {}, contract_template: tpl?.text || DEFAULT_TEMPLATE, template_is_default: !tpl?.text, fields: FIELDS };
}

export default route({
  GET: async (req, res) => {
    await requirePerm(req, 'financeiro');
    send(res, 200, await loadSettings());
  },
  PUT: async (req, res) => {
    await requireAdmin(req);
    const b = await readJson(req);
    const now = new Date().toISOString();
    if (b.agency) {
      const agency = {};
      for (const k of AGENCY_FIELDS) if (b.agency[k] !== undefined) agency[k] = String(b.agency[k] || '').trim().slice(0, 300);
      await db.upsert('app_state', { key: 'agency', value: agency, updated_at: now });
    }
    if (b.contract_template !== undefined) {
      const text = String(b.contract_template || '');
      need(text.length <= 60000, 400, 'Modelo muito longo.');
      await db.upsert('app_state', { key: 'contract_template', value: { text }, updated_at: now });
    }
    send(res, 200, await loadSettings());
  },
});
