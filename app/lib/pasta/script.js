// Roteiros de Reels/Stories, guardados no próprio post (coluna posts.script).
//   script GET  ?hooks=1&client=ID            banco de ganchos do cliente (o que funcionou + aprovados)
//   script POST ?gen=1 {post_id, topic, template, duration, extra}   IA escreve um roteiro (não salva)
//   script PUT  {post_id, script, send}       salva; send=true manda para o cliente aprovar no link
//   script DELETE ?post_id=ID                 apaga o roteiro do post
import { route, send, readJson, query, need, HttpError } from '../http.js';
import { requirePerm, needClient, can } from '../auth.js';
import { db } from '../db.js';
import { askClaude, jsonFrom } from '../ai.js';
import { brandBrief } from '../onboarding.js';
import { logEvent } from '../events.js';
import { notify } from '../push.js';
import { TEMPLATES, NICHE_RULES, cleanScript, checkScript } from '../../public/roteiro.js';

const isUuid = (v) => /^[0-9a-f-]{36}$/i.test(String(v || ''));
const noColumn = (e) => /script|column|schema cache/i.test(e?.message || '');
const MIGRATE = 'Falta a atualização 13 do banco (roteiros). Abra Ajustes, copie o comando e rode uma vez no SQL Editor do Supabase.';

async function postFor(u, id) {
  need(isUuid(id), 400, 'Post inválido.');
  let p;
  try { p = await db.one('posts', { select: '*', id: `eq.${id}` }); } catch (e) { throw noColumn(e) ? new HttpError(409, MIGRATE) : e; }
  need(p, 404, 'Post não encontrado.');
  needClient(u, p.client_id);
  need('script' in p, 409, MIGRATE);
  return p;
}

const firstLine = (t) => String(t || '').split('\n').map((l) => l.replace(/#[\p{L}\p{N}_]+/gu, '').trim()).find((l) => l.length > 3)?.slice(0, 200) || '';

// Banco de ganchos: ganchos dos roteiros e 1ª linha das legendas de Reels publicados, ordenados pelo
// resultado dos relatórios (visualizações, depois alcance). Os aprovados ainda sem resultado vêm depois.
export async function hookBank(clientId, limit = 15) {
  const [posts, reports] = await Promise.all([
    db.select('posts', { select: '*', client_id: `eq.${clientId}`, order: 'scheduled_at.desc.nullslast', limit: 400 }).catch(() => []),
    db.select('reports', { select: 'data', client_id: `eq.${clientId}`, order: 'ref_month.desc', limit: 12 }).catch(() => []),
  ]);
  const stats = new Map();
  for (const r of reports) for (const m of r.data?.posts || []) if (m?.id && !stats.has(m.id)) stats.set(m.id, m);
  const out = [];
  const seen = new Set();
  for (const p of posts) {
    const s = p.script;
    const m = p.ig_media_id ? stats.get(p.ig_media_id) : null;
    let hook = '', source = '';
    if (s?.hooks?.length) { hook = s.hooks[s.hook || 0]; source = 'roteiro'; }
    else if (p.status === 'published' && ['REELS', 'STORY'].includes(p.media_type)) { hook = firstLine(p.caption); source = 'legenda'; }
    if (!hook) continue;
    const approved = s && ['approved'].includes(s.status);
    if (!m && !approved && p.status !== 'published') continue; // rascunho não entra no banco
    if (p.ig_media_id) seen.add(p.ig_media_id);
    out.push({ hook, source, title: p.title || null, views: m?.views ?? null, reach: m?.reach ?? null, saves: m?.saved ?? null, shares: m?.shares ?? null, permalink: p.ig_permalink || m?.permalink || null, at: p.published_at || p.scheduled_at || null, status: p.status === 'published' ? 'publicado' : 'aprovado' });
  }
  for (const m of stats.values()) { // Reels publicados direto no Instagram (fora do app)
    if (seen.has(m.id) || m.type !== 'Reels') continue;
    const hook = firstLine(m.caption);
    if (hook) out.push({ hook, source: 'legenda', title: null, views: m.views ?? null, reach: m.reach ?? null, saves: m.saved ?? null, shares: m.shares ?? null, permalink: m.permalink || null, at: m.timestamp || null, status: 'publicado' });
  }
  const score = (x) => x.views ?? x.reach ?? -1;
  return out.sort((a, b) => score(b) - score(a) || String(b.at).localeCompare(String(a.at))).slice(0, limit);
}

function prompt({ c, p, b, bank }) {
  const k = c.brand_kit || {};
  const tpl = TEMPLATES[b.template] || TEMPLATES.livre;
  const rules = NICHE_RULES[k.niche];
  const fmt = p.media_type === 'STORY' ? 'Story em vídeo (vertical, até 60s, pode ter enquete/caixinha)' : 'Reels do Instagram (vertical 9:16)';
  const worked = bank.filter((x) => x.views != null || x.reach != null).slice(0, 6);
  return `ROTEIRO DE VÍDEO
Você é roteirista sênior de vídeos curtos de uma agência de social media brasileira (MC Digital). Escreva o roteiro de um ${fmt} para gravar com celular.

Cliente: ${c.name}${c.ig_username ? ` (@${c.ig_username})` : ''}
Tom de voz: ${c.brand_voice || 'não definido — natural e próximo'}
${k.style ? `Estilo/posicionamento: ${k.style}\n` : ''}${k.dos ? `Sempre: ${k.dos}\n` : ''}${k.donts ? `Nunca: ${k.donts}\n` : ''}${k.avoid ? `Não associar à marca: ${k.avoid}\n` : ''}${k.notes ? `Observações: ${k.notes}\n` : ''}${brandBrief(c) ? `${brandBrief(c)}\n` : ''}
Tema do vídeo: ${b.topic || p.title || '—'}
${p.notes && !p.notes.startsWith('✨') ? `Briefing da equipe: ${String(p.notes).slice(0, 800)}\n` : ''}${b.extra ? `Pedido extra: ${String(b.extra).slice(0, 600)}\n` : ''}Modelo: ${tpl.label} — ${tpl.beats}
Duração alvo: ${b.duration} segundos (a soma das cenas deve bater com isso, ±5s).
${worked.length ? `\nGanchos deste cliente que já funcionaram (use como referência de estilo, não copie):\n${worked.map((x) => `- "${x.hook}" (${x.views != null ? `${x.views} visualizações` : `${x.reach} de alcance`})`).join('\n')}\n` : ''}${rules ? `\nREGRAS OBRIGATÓRIAS — ${rules.name} (${rules.summary}):\n${rules.rules.map((r) => `- ${r}`).join('\n')}\nSe o tema pedir algo proibido, adapte para uma versão permitida e explique em "warnings".\n` : ''}
Como escrever:
- 3 opções de GANCHO diferentes para os 0–3s (frase falada curta e forte; uma de curiosidade, uma de dor/problema, uma direta/contraintuitiva).
- Cenas numeradas em ordem. Em cada uma: "show" = o que aparece/enquadramento/ação (simples de gravar no consultório/loja/casa), "say" = fala exata em português do Brasil, falada como a pessoa fala de verdade (frases curtas, sem jargão), "text" = texto na tela curto (até 6 palavras) ou vazio, "secs" = duração.
- A 1ª cena é a do gancho (o "say" dela pode ficar vazio — o gancho escolhido entra ali).
- CTA final claro e permitido (salvar, compartilhar, comentar, seguir, link na bio).
- "audio": estilo de trilha sugerido (ex.: "instrumental leve, biblioteca comercial do Instagram"). Nunca indique uma música famosa específica.
- "cover": texto curto da capa (até 5 palavras).
- "caption": legenda curta para o post, com CTA, sem hashtags.
- Nada de clichês de IA ("descubra", "mergulhe", "jornada", "eleve"). Não invente dados, números, preços ou depoimentos.

Responda SOMENTE com JSON válido:
{"hooks":["","",""],"scenes":[{"show":"","say":"","text":"","secs":3}],"cta":"","audio":"","cover":"","caption":"","warnings":["só se precisou adaptar algo por regra"]}`;
}

export const scriptRoute = route({
  GET: async (req, res) => {
    const u = await requirePerm(req, 'conteudo', 'ia');
    const q = query(req);
    need(isUuid(q.client), 400, 'Cliente inválido.');
    needClient(u, q.client);
    send(res, 200, { hooks: await hookBank(q.client) });
  },

  POST: async (req, res) => {
    const u = await requirePerm(req, 'ia');
    const b = await readJson(req);
    const p = await postFor(u, b.post_id);
    const c = await db.one('clients', { select: '*', id: `eq.${p.client_id}` });
    const opts = cleanScript({ template: b.template, duration: b.duration, topic: b.topic });
    need(opts.topic || p.title, 400, 'Escreva o tema do vídeo.');
    const bank = await hookBank(p.client_id, 10);
    const r = jsonFrom(await askClaude([{ type: 'text', text: prompt({ c, p, b: { ...opts, extra: b.extra }, bank }) }], { maxTokens: 4000 }));
    const script = cleanScript({ ...r, template: opts.template, duration: opts.duration, topic: opts.topic || p.title, notes: p.script?.notes || '' });
    need(script.scenes.length && script.hooks.length, 502, 'A IA não montou o roteiro direito. Tente de novo.');
    const warnings = (Array.isArray(r.warnings) ? r.warnings : []).map((w) => String(w).slice(0, 300)).filter(Boolean).slice(0, 5);
    send(res, 200, { script, warnings, checks: checkScript(script, c.brand_kit?.niche) });
  },

  PUT: async (req, res) => {
    const u = await requirePerm(req, 'conteudo');
    const b = await readJson(req);
    const p = await postFor(u, b.post_id);
    const old = p.script || null;
    const next = cleanScript(b.script || {});
    need(next.hooks.length || next.scenes.length, 400, 'O roteiro está vazio.');
    const sameContent = old && JSON.stringify(cleanScript({ ...old, notes: '' })) === JSON.stringify({ ...next, notes: '' });
    let status = old?.status || 'draft';
    const now = new Date().toISOString();
    const extra = {};
    if (b.send) {
      need(can(u, 'enviar'), 403, 'Sem permissão para enviar ao cliente.');
      const c = await db.one('clients', { select: 'brand_kit', id: `eq.${p.client_id}` });
      need(!checkScript(next, c?.brand_kit?.niche).some((i) => i.level === 'erro'), 400, 'O roteiro tem um ponto proibido pelas regras do nicho. Corrija antes de enviar.');
      status = 'sent'; Object.assign(extra, { sent_at: now, feedback: null, feedback_audio: null, decided_at: null });
    } else if (!sameContent && ['sent', 'approved'].includes(status)) {
      status = 'draft'; // mudou depois de enviado: precisa reenviar
    }
    const keep = { feedback: old?.feedback || null, feedback_audio: old?.feedback_audio || null, decided_at: old?.decided_at || null, sent_at: old?.sent_at || null };
    const script = { ...next, status, ...keep, ...extra, updated_at: now };
    const [row] = await db.update('posts', { id: `eq.${p.id}` }, { script });
    if (b.send) await logEvent(row, 'script_sent');
    send(res, 200, row);
  },

  DELETE: async (req, res) => {
    const u = await requirePerm(req, 'conteudo');
    const p = await postFor(u, query(req).post_id);
    const [row] = await db.update('posts', { id: `eq.${p.id}` }, { script: null });
    send(res, 200, row);
  },
});

// Decisão do cliente pelo link de aprovação (chamado por api/approval.js).
export async function decideScript(c, body, audio) {
  need(isUuid(body.post_id), 400, 'Roteiro inválido.');
  const p = await db.one('posts', { select: '*', id: `eq.${body.post_id}`, client_id: `eq.${c.id}` });
  need(p?.script && ['sent', 'approved', 'changes'].includes(p.script.status), 409, 'Este roteiro saiu da aprovação. Atualize a página.');
  const feedback = String(body.feedback || '').trim().slice(0, 1000);
  const ok = body.decision === 'approve';
  need(ok || feedback || audio, 400, 'Escreva ou grave o que você quer mudar.');
  const script = { ...p.script, status: ok ? 'approved' : 'changes', feedback: feedback || (audio ? '🎤 Pedido por áudio' : null), feedback_audio: ok ? null : audio?.id || null, decided_at: new Date().toISOString() };
  const [row] = await db.update('posts', { id: `eq.${p.id}`, client_id: `eq.${c.id}` }, { script });
  await logEvent(row, ok ? 'script_approved' : 'script_changes', [audio ? '🎤 áudio' : null, feedback || null].filter(Boolean).join(' · ') || null);
  const what = row.title || 'roteiro';
  await notify(ok
    ? { title: `🎬 ${c.name} aprovou o roteiro`, body: `${what} — pode gravar.`, url: '/#fluxo', tag: `script-${row.id}` }
    : { title: `🎬 ${c.name} pediu ajuste no roteiro${audio ? ' por áudio 🎤' : ''}`, body: feedback ? `${what}: “${feedback.slice(0, 140)}”` : `${what}: ouça o áudio.`, url: '/#fluxo', tag: `script-${row.id}` });
  return row;
}
