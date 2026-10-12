// Contrato preenchido de um cliente: GET ?client=  → { html, missing, title }
import { route, send, query, need } from '../lib/http.js';
import { requireAdmin } from '../lib/auth.js';
import { db } from '../lib/db.js';
import { TIMEZONE } from '../lib/env.js';
import { renderContract, contractValues, FIELDS } from '../lib/contract.js';
import { loadSettings } from './settings.js';

export default route({
  GET: async (req, res) => {
    requireAdmin(req);
    const { client: id } = query(req);
    need(id, 400, 'Cliente não informado.');
    const client = await db.one('clients', { select: '*', id: `eq.${id}` });
    need(client, 404, 'Cliente não encontrado.');
    const s = await loadSettings();
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE() }).format(new Date()); // AAAA-MM-DD no fuso da agência
    const { html, missing } = renderContract(s.contract_template, contractValues({ agency: s.agency, client, today }));
    send(res, 200, {
      html, title: `Contrato - ${client.contract_data?.nome || client.name}`,
      missing: missing.map((k) => FIELDS[k] || k), template_is_default: s.template_is_default,
    });
  },
});
