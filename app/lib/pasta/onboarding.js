// Onboarding.
//   onboarding (público, link da área do cliente: ?t=portal_token)  GET apresentação + checklist + respostas | POST {answers} salva na Marca
//   onbcfg     (admin)  GET textos | PUT textos | POST ?photo=1 (corpo = JPEG) foto da fundadora
import crypto from 'node:crypto';
import { route, send, readJson, readRaw, query, need } from '../http.js';
import { requireAdmin } from '../auth.js';
import { db, storage } from '../db.js';
import { appUrl } from '../env.js';
import { setState, getState } from '../appstate.js';
import { notify } from '../push.js';
import { onboardingContent, checklistFor, ONB_TEXT_FIELDS } from '../onboarding.js';
import { QUESTIONS, SECTIONS, cleanAnswers } from '../../public/onboarding-perguntas.js';

const okToken = (t) => typeof t === 'string' && /^[a-f0-9]{32,64}$/.test(t);
async function clientByPortal(t) {
  need(okToken(t), 404, 'Link inválido. Peça um link novo para a agência.');
  const c = await db.one('clients', { select: '*', portal_token: `eq.${t}` });
  need(c, 404, 'Este link não está mais ativo. Peça um link novo para a agência.');
  return c;
}
const firstName = (c) => (c.contract_data?.representante || '').trim().split(/\s+/)[0] || c.name;

export const onboardingRoute = route({
  GET: async (req, res) => {
    const c = await clientByPortal(query(req).t);
    const [content, checklist] = await Promise.all([onboardingContent(), checklistFor(c)]);
    const o = c.brand_kit?.onboarding || null;
    send(res, 200, {
      client: { name: c.contract_data?.nome || c.name, first_name: firstName(c) },
      content, checklist, sections: SECTIONS, questions: QUESTIONS,
      answers: o?.answers || null, submitted_at: o?.submitted_at || null,
      portal_url: `${appUrl()}/cliente?t=${c.portal_token}`,
    }, { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
  },
  POST: async (req, res) => {
    const c = await clientByPortal(query(req).t);
    const b = await readJson(req);
    const { answers, missing } = cleanAnswers(b.answers || {});
    if (missing.length) need(false, 400, `Falta responder: ${QUESTIONS.find((q) => q.id === missing[0]).q}`);
    const first = !c.brand_kit?.onboarding?.submitted_at;
    const kit = { ...(c.brand_kit || {}) };
    kit.onboarding = { answers, submitted_at: new Date().toISOString() };
    // as 4 perguntas do digital também viram campos da Marca (a agência pode editar depois)
    kit.inspirations = answers.inspiracoes; kit.avoid = answers.evitar; kit.competitors = answers.concorrentes; kit.perception = answers.percepcao;
    await db.update('clients', { id: `eq.${c.id}` }, { brand_kit: kit });
    await notify({ title: `📋 ${c.name} ${first ? 'respondeu' : 'atualizou'} o onboarding`, body: 'As respostas já estão na aba Marca da pasta do cliente.', url: `/#pasta/${c.id}` });
    send(res, 200, { ok: true, submitted_at: kit.onboarding.submitted_at });
  },
});

export const onbcfgRoute = route({
  GET: async (req, res) => {
    await requireAdmin(req);
    send(res, 200, await onboardingContent());
  },
  PUT: async (req, res) => {
    await requireAdmin(req);
    const b = await readJson(req);
    const cur = (await getState('onboarding_content')) || {};
    for (const k of ONB_TEXT_FIELDS) if (b[k] !== undefined) cur[k] = String(b[k] || '').trim().slice(0, 3000);
    if (b.steps !== undefined) cur.steps = (Array.isArray(b.steps) ? b.steps : String(b.steps).split('\n')).map((s) => String(s).trim().slice(0, 80)).filter(Boolean).slice(0, 14);
    if (b.founder_photo === '') cur.founder_photo = '';
    for (const k of Object.keys(cur)) if (cur[k] === '' && k !== 'founder_photo') delete cur[k]; // vazio = volta ao texto padrão
    await setState('onboarding_content', cur);
    send(res, 200, await onboardingContent());
  },
  POST: async (req, res) => {
    await requireAdmin(req);
    need(query(req).photo, 400, 'Envie a foto.');
    const buf = await readRaw(req);
    need(buf.length > 0 && buf.length <= 4 * 1024 * 1024, 413, 'Foto grande demais (máx. 4 MB).');
    need(buf[0] === 0xff && buf[1] === 0xd8, 415, 'A foto precisa estar em JPEG.');
    const up = await storage.upload(`agency/fundadora-${crypto.randomBytes(6).toString('hex')}.jpg`, buf, 'image/jpeg');
    const cur = (await getState('onboarding_content')) || {};
    const old = cur.founder_photo_path;
    cur.founder_photo = up.url; cur.founder_photo_path = up.path;
    await setState('onboarding_content', cur);
    if (old) await storage.remove(old);
    send(res, 201, await onboardingContent());
  },
});
