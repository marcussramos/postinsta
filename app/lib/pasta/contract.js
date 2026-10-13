// Contrato preenchido de um cliente: GET ?client=  → { html, missing, title }
import { route, send, query, need } from '../http.js';
import { requirePerm, needClient } from '../auth.js';
import { db } from '../db.js';
import { TIMEZONE } from '../env.js';
import { renderContract, contractValues, FIELDS } from '../contract.js';
import { loadSettings } from './settings.js';

export default route({
  GET: async (req, res) => {
    const u = await requirePerm(req, 'financeiro');
    const { client: id } = query(req);
    need(id, 400, 'Cliente não informado.');
    needClient(u, id);
    const client = await db.one('clients', { select: '*', id: `eq.${id}` });
    need(client, 404, 'Cliente não encontrado.');
    const s = await loadSettings();
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE() }).format(new Date()); // AAAA-MM-DD no fuso da agência
    const { html, missing, header, footer } = renderContract(s.contract_template, contractValues({ agency: s.agency, client, today }));
    send(res, 200, {
      html, title: `Contrato - ${client.contract_data?.nome || client.name}`,
      missing: missing.map((k) => FIELDS[k] || k), template_is_default: s.template_is_default,
      brand: { marca: s.agency.marca || '', slogan: s.agency.slogan || '', titulo: (s.contract_template.match(/^# (.+)/m)?.[1] || '').trim() },
      header: header || [], footer: footer || [s.agency.marca, s.agency.slogan].filter(Boolean),
    });
  },
});
