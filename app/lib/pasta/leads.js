// Funil de vendas e diagnóstico grátis.
//   leads       (admin)  GET | POST | PATCH {id,...} | DELETE ?id=
//   diagnostico (público) GET textos | POST {handle, name, whatsapp, answers} → análise | POST ?want=1 {id, key} quer conversa
//   diagcfg     (admin)  GET | PUT configuração do diagnóstico
import crypto from 'node:crypto';
import { route, send, readJson, query, need } from '../http.js';
import { requirePerm, requireAdmin } from '../auth.js';
import { db } from '../db.js';
import { sessionSecret } from '../env.js';
import { setState, getState } from '../appstate.js';
import { notify } from '../push.js';
import { loadSettings } from './settings.js';
import { runDiagnosis, diagSettings, cleanHandle, validHandle, probeProfile, DIAG_DEFAULTS, DIAG_QUESTIONS } from '../diagnosis.js';

export const STAGES = ['novo', 'contato', 'reuniao', 'proposta', 'fechado', 'perdido'];
const txt = (v, n) => { const s = String(v ?? '').trim().slice(0, n); return s || null; };
const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
const phone = (v) => { const d = String(v || '').replace(/\D/g, ''); return d ? (d.length <= 11 ? `55${d}` : d) : null; };
const money = (v) => { if (v === '' || v == null) return null; if (typeof v === 'number') return Math.round(v); const n = Number(String(v).replace(/[R$\s]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')); return Number.isFinite(n) ? Math.round(n * 100) : null; };
const keyOf = (id) => crypto.createHmac('sha256', sessionSecret()).update(`lead:${id}`).digest('hex').slice(0, 32);

function cleanLead(b, partial = false) {
  const o = {};
  if (!partial || b.name !== undefined) { o.name = txt(b.name, 120); need(o.name, 400, 'Informe o nome do contato.'); }
  for (const [k, n] of [['company', 120], ['email', 160], ['niche', 60], ['next_action', 200], ['notes', 4000], ['lost_reason', 300]]) if (b[k] !== undefined) o[k] = txt(b[k], n);
  if (b.instagram !== undefined) o.instagram = cleanHandle(b.instagram) || null;
  if (b.whatsapp !== undefined) o.whatsapp = phone(b.whatsapp);
  if (b.stage !== undefined) { need(STAGES.includes(b.stage), 400, 'Etapa inválida.'); o.stage = b.stage; }
  if (b.value !== undefined || b.value_cents !== undefined) o.value_cents = b.value_cents !== undefined ? (b.value_cents == null ? null : Math.round(b.value_cents)) : money(b.value);
  if (b.next_action_at !== undefined) { need(!b.next_action_at || isDay(b.next_action_at), 400, 'Data inválida.'); o.next_action_at = b.next_action_at || null; }
  if (b.source !== undefined) o.source = txt(b.source, 30) || 'manual';
  return o;
}

export const leadsRoute = route({
  GET: async (req, res) => {
    await requirePerm(req, 'vendas');
    send(res, 200, await db.select('leads', { select: '*', order: 'updated_at.desc', limit: 500 }));
  },
  POST: async (req, res) => {
    await requirePerm(req, 'vendas');
    const row = await db.insert('leads', { ...cleanLead(await readJson(req)), stage: 'novo' });
    send(res, 201, row);
  },
  PATCH: async (req, res) => {
    await requirePerm(req, 'vendas');
    const b = await readJson(req);
    need(b.id, 400, 'Lead não informado.');
    const [row] = await db.update('leads', { id: `eq.${b.id}` }, { ...cleanLead(b, true), updated_at: new Date().toISOString() });
    need(row, 404, 'Lead não encontrado.');
    send(res, 200, row);
  },
  DELETE: async (req, res) => {
    await requirePerm(req, 'vendas');
    const { id } = query(req);
    need(id, 400, 'Lead não informado.');
    await db.remove('leads', { id: `eq.${id}` });
    send(res, 200, { ok: true });
  },
});

export const diagnosticoRoute = route({
  GET: async (req, res) => {
    const [cfg, { agency }] = await Promise.all([diagSettings(), loadSettings()]);
    send(res, 200, { enabled: cfg.enabled, headline: cfg.headline, cta: cfg.cta, whatsapp: cfg.whatsapp || null, marca: agency.marca || 'MC DIGITAL', ai: Boolean(process.env.ANTHROPIC_API_KEY), questions: DIAG_QUESTIONS }, { 'Cache-Control': 'no-store' });
  },
  POST: async (req, res) => {
    const b = await readJson(req);
    if (query(req).want) { // "quero ajuda": marca o lead como quente
      need(b.id && b.key && b.key === keyOf(b.id), 404, 'Diagnóstico não encontrado.');
      const [row] = await db.update('leads', { id: `eq.${b.id}` }, { wants_contact: true, next_action: 'Pediu conversa pelo diagnóstico', next_action_at: new Date().toISOString().slice(0, 10), updated_at: new Date().toISOString() });
      if (row) await notify({ title: `🔥 ${row.name} quer conversar`, body: `@${row.instagram} pediu ajuda depois do diagnóstico. Chame no WhatsApp!`, url: '/#vendas' }, { adminOnly: true });
      return send(res, 200, { ok: true });
    }
    const cfg = await diagSettings();
    need(cfg.enabled, 404, 'O diagnóstico está fechado no momento.');
    need(!b.website, 400, 'Não foi possível enviar.'); // campo-isca contra robôs
    const handle = cleanHandle(b.handle);
    need(validHandle(handle), 400, 'Digite o @ do seu Instagram (só letras, números, ponto e _).');
    const name = txt(b.name, 120); need(name, 400, 'Digite o seu nome.');
    const whatsapp = phone(b.whatsapp); need(whatsapp && whatsapp.length >= 12, 400, 'Digite o seu WhatsApp com DDD.');
    const answers = Object.fromEntries(Object.keys(DIAG_QUESTIONS).map((k) => [k, txt(Array.isArray(b.answers?.[k]) ? b.answers[k].join(', ') : b.answers?.[k], 400)]).filter(([, v]) => v));
    const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
    const ip_hash = crypto.createHmac('sha256', sessionSecret()).update(`ip:${ip}`).digest('hex').slice(0, 24);
    const since = new Date(Date.now() - 864e5).toISOString();
    const [mine, today] = await Promise.all([
      db.select('leads', { select: 'id', ip_hash: `eq.${ip_hash}`, created_at: `gte.${since}` }),
      db.select('leads', { select: 'id', source: 'eq.diagnostico', created_at: `gte.${since}`, limit: 400 }),
    ]);
    need(mine.length < 5, 429, 'Você já fez vários diagnósticos hoje. Tente amanhã ou fale com a gente no WhatsApp.');
    need(today.length < 300, 429, 'Muitos diagnósticos hoje. Tente de novo amanhã.');
    const result = await runDiagnosis({ handle, company: txt(b.company, 120), answers });
    const base = { name, company: txt(b.company, 120), instagram: handle, whatsapp, email: txt(b.email, 160), niche: answers.nicho || null, diagnosis: { ...result, answers }, updated_at: new Date().toISOString() };
    const old = await db.one('leads', { select: 'id,stage', instagram: `eq.${handle}`, source: 'eq.diagnostico' });
    const row = old ? (await db.update('leads', { id: `eq.${old.id}` }, base))[0]
      : await db.insert('leads', { ...base, source: 'diagnostico', stage: 'novo', ip_hash, next_action: 'Chamar no WhatsApp e comentar o diagnóstico', next_action_at: new Date().toISOString().slice(0, 10) });
    await notify({ title: `🎯 Novo lead: @${handle}`, body: `${name} fez o diagnóstico (nota ${result.score}/100). Está no funil de vendas.`, url: '/#vendas' }, { adminOnly: true });
    send(res, 200, { id: row.id, key: keyOf(row.id), result, whatsapp: cfg.whatsapp || null, cta: cfg.cta });
  },
});

export const diagcfgRoute = route({
  GET: async (req, res) => {
    await requireAdmin(req);
    const [cfg, lookup_status] = await Promise.all([diagSettings(), getState('diag_lookup_status')]);
    send(res, 200, { ...cfg, lookup_status });
  },
  // Testa a leitura de dados públicos de um @ com o perfil escolhido (não gasta IA, não cria lead).
  POST: async (req, res) => {
    await requireAdmin(req);
    const handle = cleanHandle((await readJson(req)).handle);
    need(validHandle(handle), 400, 'Digite um @ válido para testar.');
    const { profile, error } = await probeProfile(handle);
    need(error !== 'off', 400, 'Escolha um perfil conectado em "Perfil usado para ler os dados públicos" e salve antes de testar.');
    send(res, 200, profile
      ? { ok: true, handle, followers: profile.followers, posts_per_week: profile.posts_per_week, engagement_rate: profile.engagement_rate }
      : { ok: false, handle, error });
  },
  PUT: async (req, res) => {
    await requireAdmin(req);
    const b = await readJson(req);
    const cur = await diagSettings();
    const next = { ...cur };
    if (b.enabled !== undefined) next.enabled = Boolean(b.enabled);
    if (b.lookup_client_id !== undefined) next.lookup_client_id = /^[0-9a-f-]{36}$/i.test(b.lookup_client_id || '') ? b.lookup_client_id : '';
    if (b.whatsapp !== undefined) next.whatsapp = phone(b.whatsapp) || '';
    for (const k of ['headline', 'cta']) if (b[k] !== undefined) next[k] = String(b[k] || '').trim().slice(0, 200) || DIAG_DEFAULTS[k];
    await setState('diag_settings', next);
    send(res, 200, { ...next, lookup_status: await getState('diag_lookup_status') });
  },
});
