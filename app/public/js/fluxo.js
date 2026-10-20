// MC DIGITAL — fluxo (quadro do workflow) e cores dos clientes.
// Parte do painel (public/app.js é a entrada). Módulos importam uns dos outros só funções e constantes usadas dentro de funções.
import { billingMonths as billingMonthsShared, dueSoon, splitCents, planOf } from '/billing.js';
import { QUESTIONS as ONB_QUESTIONS, SECTIONS as ONB_SECTIONS } from '/onboarding-perguntas.js';
import { reviewPost, applyFix } from '/revisor.js';
import { PERMS, TEAM_DEFAULT } from '/permissoes.js';
import { TEMPLATES, DURATIONS, NICHE_RULES, SCRIPT_STATUS, checkScript } from '/roteiro.js';
import { NICHES, datesBetween, dateAlerts, relevantFor, daysBetween } from '/dates.js';
import { officeCard, AGENTS } from '/escritorio.js';
import { weekMissions, weekLevel, isDone, missionXp } from '/missoes.js';
import { h, api, toast, fmtDate, fmtTime, dayKey, zonedToISO, partsInTz, prepareImage, copyText, waLink, mailLink, blobToDataUrl, STATUS_LABEL, brl, brlRaw, isMoneyHidden, setMoneyHidden, monthLabel, fileSize, videoInfo, videoFrame, uploadVideo, MEDIA_LABEL, compressVideo, VIDEO_MAX } from '/shared.js';
import { openPlan } from './calendario.js';
import { S, can, clientFilter, clientName, isLate, noClients, postLabel, render, thumb } from './core.js';
import { maybeNotify, openPost, scriptBadge, upsert } from './post.js';

// ───────────────────────── fluxo (quadro do workflow)
// "Planejado" = em produção mas ainda sem arte (só pauta/data). Não é um status novo: é o rascunho sem mídia.
const hasMedia = (p) => Boolean(p.image_url || (p.media || []).length);
const isPlanned = (p) => p.status === 'draft' && !hasMedia(p);
function stageOf(p) { return isPlanned(p) ? 'planned' : p.status; }
const COLUMNS = [
  { id: 'idea', label: 'Ideia', drop: 'to_idea', next: ['to_production', 'Produzir'] },
  { id: 'planned', status: 'draft', match: isPlanned, label: 'Planejado', drop: 'to_production', open: 'Criar arte' },
  { id: 'draft', match: (p) => p.status === 'draft' && hasMedia(p), label: 'Em produção', drop: 'to_production', next: ['to_review', 'Revisar'] },
  { id: 'internal_review', label: 'Revisão interna', drop: 'to_review', next: ['send', 'Enviar ao cliente'] },
  { id: 'pending_approval', label: 'Aguardando cliente', drop: 'send' },
  { id: 'changes_requested', label: 'Ajuste pedido' },
  { id: 'approved', label: 'Aprovado', drop: 'approve', also: ['publishing', 'failed'] },
  { id: 'published', label: 'Publicado', drop: 'mark_published' },
];

// cor fixa por cliente (etiqueta no estilo Trello)
// A cor escolhida fica na marca do cliente (brand_kit.label_color); quem não escolheu ganha a próxima livre.
const CLIENT_COLORS = [['#D4537E', 'Rosa'], ['#1D9E75', 'Verde-água'], ['#C98A1E', 'Mostarda'], ['#7F77DD', 'Lilás'], ['#378ADD', 'Azul'],
  ['#D85A30', 'Coral'], ['#639922', 'Verde'], ['#993556', 'Vinho'], ['#0F6E7A', 'Petróleo'], ['#8A6A4F', 'Caramelo'], ['#5F5E5A', 'Grafite'], ['#B04FB8', 'Magenta']];
let colorCache = null;
function resetColorCache() { colorCache = null; }
function clientColor(id) {
  if (!colorCache || colorCache.src !== S.clients) {
    const map = new Map();
    const valid = new Set(CLIENT_COLORS.map(([c]) => c));
    for (const c of S.clients) if (valid.has(c.brand_kit?.label_color)) map.set(c.id, c.brand_kit.label_color);
    const used = new Set(map.values());
    const free = CLIENT_COLORS.map(([c]) => c).filter((c) => !used.has(c));
    let i = 0;
    for (const c of S.clients) if (!map.has(c.id)) map.set(c.id, free.length ? free[i++ % free.length] : CLIENT_COLORS[i++ % CLIENT_COLORS.length][0]);
    colorCache = { src: S.clients, map };
  }
  return colorCache.map.get(id) || CLIENT_COLORS[0][0];
}
const initials = (name) => (name || '?').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w[0] || '')).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

function viewBoard() {
  if (!S.clients.length) return [h('div', { class: 'page-head' }, h('h1', {}, 'Fluxo')), noClients()];
  const q = (S.boardQ || '').trim().toLowerCase();
  const posts = S.posts.filter((p) => !S.fClient || p.client_id === S.fClient)
    .filter((p) => p.status !== 'published' || Date.now() - new Date(p.published_at || p.scheduled_at) < 7 * 86400e3)
    .filter((p) => !q || `${p.title || ''} ${p.caption || ''} ${clientName(p.client_id)}`.toLowerCase().includes(q));
  const sortKey = (p) => (p.scheduled_at ? new Date(p.scheduled_at).getTime() : Infinity);
  const board = h('div', { class: 'tboard' }, ...COLUMNS.map((col) => {
    const items = posts.filter((p) => (col.match ? col.match(p) : p.status === col.id) || col.also?.includes(p.status)).sort((a, b) => sortKey(a) - sortKey(b));
    const body = h('div', { class: 'tlist-cards' }, ...items.map((p) => boardCard(p, col)));
    const colEl = h('section', { class: `tlist${col.drop ? ' droppable' : ''}`, 'data-col': col.id, 'aria-label': col.label },
      h('header', { class: 'tlist-head' }, h('span', { class: `tlist-dot st-${col.id}`, 'aria-hidden': 'true' }), h('h2', {}, col.label), h('span', { class: 'tlist-n' }, String(items.length))),
      body,
      ['idea', 'planned', 'internal_review'].includes(col.id) && can('conteudo') ? quickAdd(col) : h('div', { class: 'tlist-foot muted' }, col.id === 'draft' ? 'Chega aqui quando a arte é anexada' : col.id === 'pending_approval' ? 'Envie pelo cartão ou arraste para cá' : col.id === 'approved' ? 'Sai sozinho no horário' : col.id === 'published' ? 'Últimos 7 dias' : 'Volta para produção ao ajustar'));
    if (col.drop) {
      colEl.addEventListener('dragover', (e) => { e.preventDefault(); colEl.classList.add('over'); });
      colEl.addEventListener('dragleave', (e) => { if (!colEl.contains(e.relatedTarget)) colEl.classList.remove('over'); });
      colEl.addEventListener('drop', async (e) => {
        e.preventDefault(); colEl.classList.remove('over');
        const id = e.dataTransfer.getData('text/plain');
        const p = S.posts.find((x) => x.id === id);
        if (!p || p.status === (col.status || col.id)) return;
        if (col.drop === 'mark_published' && prodClient(p.client_id)) { if (confirm(`Marcar "${p.title || 'este post'}" como entregue ao cliente?`)) await movePost(p, 'deliver', 'Entregue ao cliente.'); return; }
        if (col.drop === 'mark_published' && !confirm(`Marcar "${p.title || 'este post'}" como já publicado?\n\nUse só se você postou manualmente no Instagram. O app não vai publicar este post.`)) return;
        await movePost(p, col.drop, `Movido para ${col.label}.`);
      });
    }
    return colEl;
  }));
  const search = h('input', { type: 'search', class: 'tsearch', placeholder: 'Filtrar cartões…', value: S.boardQ || '', 'aria-label': 'Filtrar cartões',
    oninput: (e) => { S.boardQ = e.target.value; clearTimeout(S.boardT); S.boardT = setTimeout(() => { render(); const el = document.querySelector('.tsearch'); el?.focus(); el?.setSelectionRange(el.value.length, el.value.length); }, 250); } });
  return [
    h('div', { class: 'page-head' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Workflow de criação e aprovação'), h('h1', {}, 'Fluxo')), h('div', { class: 'spacer' }),
      h('div', { class: 'actions' }, search, can('ia') ? h('button', { class: 'btn ai sm', onclick: () => openPlan({}) }, '✨ Planejar o mês com IA') : null)),
    clientFilter(),
    h('div', { class: 'tboard-wrap' }, board),
    h('p', { class: 'muted', style: 'margin:0;font-size:13px' }, 'Arraste os cartões entre as listas. Para ir ao cliente ou à fila, o post precisa de mídia e data.'),
  ];
}

// "+ Adicionar um cartão" no fim da lista (cria ideia / post em produção / revisão só com a pauta)
function quickAdd(col) {
  const stage = { idea: 'idea', planned: 'production', draft: 'production', internal_review: 'internal_review' }[col.id];
  const wrap = h('div', { class: 'tadd' });
  const closed = () => wrap.replaceChildren(h('button', { class: 'tadd-btn', type: 'button', onclick: opened }, '+ Adicionar um cartão'));
  function opened() {
    const ta = h('textarea', { class: 'tadd-ta', placeholder: 'Pauta do post (ex.: Dica de banho no inverno)', rows: 3, maxlength: 140 });
    const sel = h('select', { class: 'tadd-sel', 'aria-label': 'Cliente' }, ...S.clients.map((c) => h('option', { value: c.id, selected: c.id === (S.fClient || S.lastClient || S.clients[0].id) }, c.name)));
    const add = async () => {
      const title = ta.value.trim(); if (!title) return ta.focus();
      try {
        const saved = await api('/api/posts', { method: 'POST', body: { client_id: sel.value, title, stage: stage === 'production' ? 'draft' : stage } });
        S.lastClient = sel.value; upsert(saved, false); render();
        const again = document.querySelector(`.tlist[data-col="${col.id}"] .tadd-btn`); again?.click();
      } catch (e) { toast(e.message, true); }
    };
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); add(); } if (e.key === 'Escape') closed(); });
    wrap.replaceChildren(h('div', { class: 'tadd-form' }, ta, S.clients.length > 1 ? sel : null,
      h('div', { class: 'tadd-act' }, h('button', { class: 'btn primary sm', type: 'button', onclick: add }, 'Adicionar cartão'), h('button', { class: 'tadd-x', type: 'button', 'aria-label': 'Cancelar', onclick: closed }, '✕'))));
    ta.focus();
  }
  closed();
  return wrap;
}

// Mídias do post na ordem de exibição (carrossel, vídeo do Reels ou a imagem única).
function mediaItems(p) {
  const list = (p.media || []).filter((m) => m?.url).map((m) => ({ kind: m.kind === 'video' ? 'video' : 'image', url: m.url }));
  if (!list.length && p.image_url) list.push({ kind: 'image', url: p.image_url });
  return list;
}
// Capa do cartão: clicar abre a mídia em tela cheia (o resto do cartão continua abrindo o editor).
function coverButton(p) {
  const items = mediaItems(p);
  if (!items.length) return null;
  const video = items.find((m) => m.kind === 'video');
  const thumb = p.image_url
    ? h('img', { src: p.image_url, alt: '', loading: 'lazy', draggable: 'false' })
    : h('video', { src: `${video.url}#t=0.5`, muted: true, preload: 'metadata', playsinline: true, 'aria-hidden': 'true' });
  const badge = video ? '▶' : items.length > 1 ? `❐ ${items.length}` : null;
  return h('button', { type: 'button', class: `tcover${p.media_type === 'STORY' || p.media_type === 'REELS' ? ' tall' : ''}`,
    'aria-label': `Ver ${video ? 'vídeo' : items.length > 1 ? `as ${items.length} imagens` : 'imagem'} de ${postLabel(p)} em tela cheia`,
    onclick: (e) => { e.stopPropagation(); openViewer(p); } },
    thumb, badge ? h('span', { class: 'tcover-badge', 'aria-hidden': 'true' }, badge) : null, h('span', { class: 'tcover-zoom', 'aria-hidden': 'true' }, '⤢'));
}
// Visualizador em tela cheia: setas, teclado (← → Esc), deslizar no celular, vídeo com controles.
function openViewer(p, start = 0) {
  const items = mediaItems(p);
  if (!items.length) return;
  let i = Math.min(start, items.length - 1);
  const prevFocus = document.activeElement;
  const stage = h('div', { class: 'vw-stage' });
  const count = h('span', { class: 'vw-count', 'aria-live': 'polite' });
  const dots = h('div', { class: 'vw-dots', 'aria-hidden': 'true' });
  const prev = h('button', { type: 'button', class: 'vw-nav prev', 'aria-label': 'Anterior', onclick: (e) => { e.stopPropagation(); go(-1); } }, '‹');
  const next = h('button', { type: 'button', class: 'vw-nav next', 'aria-label': 'Próxima', onclick: (e) => { e.stopPropagation(); go(1); } }, '›');
  const close = h('button', { type: 'button', class: 'vw-close', 'aria-label': 'Fechar', onclick: () => done() }, '×');
  const edit = can('conteudo') ? h('button', { type: 'button', class: 'btn sm', onclick: () => { done(); openPost(p); } }, 'Abrir post') : null;
  const box = h('div', { class: 'viewer', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Mídia de ${postLabel(p)}`, tabindex: '-1',
    onclick: (e) => { if (e.target === box || e.target === stage) done(); } },
    h('div', { class: 'vw-top' }, h('div', { class: 'vw-title' }, h('b', {}, clientName(p.client_id)), h('span', {}, postLabel(p))), h('div', { class: 'vw-actions' }, count, edit, close)),
    stage, items.length > 1 ? [prev, next, dots] : null);
  function draw() {
    stage.querySelector('video')?.pause();
    const m = items[i];
    stage.replaceChildren(m.kind === 'video'
      ? h('video', { src: m.url, controls: true, autoplay: true, playsinline: true, class: 'vw-media' })
      : h('img', { src: m.url, alt: `${postLabel(p)} — ${i + 1} de ${items.length}`, class: 'vw-media' }));
    count.textContent = items.length > 1 ? `${i + 1} / ${items.length}` : '';
    dots.replaceChildren(...items.map((_, k) => h('span', { class: k === i ? 'on' : '' })));
    prev.disabled = i === 0; next.disabled = i === items.length - 1;
  }
  function go(d) { const n = i + d; if (n < 0 || n >= items.length) return; i = n; draw(); }
  function key(e) { if (e.key === 'Escape') done(); else if (e.key === 'ArrowLeft') go(-1); else if (e.key === 'ArrowRight') go(1); }
  let x0 = null;
  box.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  box.addEventListener('touchend', (e) => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1); x0 = null; });
  function done() { stage.querySelector('video')?.pause(); document.removeEventListener('keydown', key); box.remove(); document.body.classList.remove('vw-open'); prevFocus?.focus?.(); }
  document.addEventListener('keydown', key);
  document.body.append(box); document.body.classList.add('vw-open');
  draw(); box.focus();
}

const prodClient = (id) => Boolean(S.clients.find((c) => c.id === id)?.production_only); // cliente só de produção: ele mesmo posta

function boardCard(p, col) {
  const late = isLate(p);
  const t = p.scheduled_at ? new Date(p.scheduled_at) : null;
  const dateBadge = t ? h('span', { class: `tbadge${p.status === 'published' ? ' ok' : late ? ' late' : t - Date.now() < 2 * 864e5 && t > Date.now() ? ' soon' : ''}`, title: late ? 'Horário já passou' : 'Data de publicação' },
    '🕒 ', `${fmtDate(p.scheduled_at, S.tz)} ${fmtTime(p.scheduled_at, S.tz)}`) : h('span', { class: 'tbadge muted' }, 'sem data');
  const fmt = { REELS: 'Reels', CAROUSEL: `Carrossel${(p.media || []).length ? ` · ${(p.media || []).length}` : ''}`, STORY: 'Story' }[p.media_type] || (p.image_url ? 'Foto' : null);
  const card = h('article', { class: `tcard${p.status === 'failed' ? ' failed' : ''}`, draggable: 'true', tabindex: 0, onclick: (e) => { if (!e.target.closest('button')) openPost(p); },
    onkeydown: (e) => { if (e.key === 'Enter') openPost(p); } },
    coverButton(p),
    h('div', { class: 'tcard-in' },
      h('div', { class: 'tlabels' },
        h('span', { class: 'tlabel', style: `--lc:${clientColor(p.client_id)}`, title: clientName(p.client_id) }, clientName(p.client_id)),
        fmt ? h('span', { class: 'tlabel fmt' }, fmt) : null,
        (p.notes || '').startsWith('✨') ? h('span', { class: 'tlabel ia', title: 'Planejado com IA' }, '✨ IA') : null,
        (p.notes || '').startsWith('💡 Ideia sugerida pelo cliente') ? h('span', { class: 'tlabel ia', title: 'Sugerida pelo cliente na área do cliente' }, '💡 Do cliente') : null,
        scriptBadge(p),
        prodClient(p.client_id) ? h('span', { class: 'tlabel ia', title: 'Cliente só de produção: o app não publica, a agência entrega o material' }, p.status === 'published' ? '📦 Entregue' : '📦 Cliente posta') : null),
      h('div', { class: 'ttitle' }, postLabel(p)),
      p.status === 'changes_requested' && (p.client_feedback || p.feedback_audio) ? h('div', { class: 'tnote' }, p.feedback_audio ? '🎤 ' : '', p.client_feedback && p.client_feedback !== '🎤 Pedido por áudio' ? `“${p.client_feedback}”` : 'Ajuste pedido por áudio') : null,
      p.status === 'failed' ? h('div', { class: 'tnote fail' }, `Falhou: ${p.last_error || ''}`) : null,
      h('div', { class: 'tbadges' },
        dateBadge,
        p.status === 'publishing' ? h('span', { class: 'tbadge soon' }, 'Publicando…') : null,
        p.caption ? h('span', { class: 'tbadge', title: 'Tem legenda' }, '≡') : null,
        p.notes && !/^(✨|💡 Ideia sugerida pelo cliente)/.test(p.notes) ? h('span', { class: 'tbadge', title: 'Tem notas da equipe' }, '✎') : null,
        h('span', { class: 'tavatar', style: `--lc:${clientColor(p.client_id)}`, title: clientName(p.client_id) }, initials(clientName(p.client_id)))),
      col.next || col.open || p.status === 'changes_requested' ? h('div', { class: 'tcard-act' },
        col.open && can('conteudo') ? h('button', { class: 'tnext', type: 'button', onclick: () => openPost(p) }, `${col.open} →`) : null,
        col.next && (col.next[0] !== 'send' || can('enviar')) && can('conteudo') ? h('button', { class: 'tnext', type: 'button', onclick: () => movePost(p, col.next[0], col.next[0] === 'send' ? 'Enviado ao cliente.' : 'Avançou de etapa.') }, `${col.next[1]} →`) : null,
        p.status === 'changes_requested' ? h('button', { class: 'tnext', type: 'button', onclick: () => openPost(p) }, 'Ajustar →') : null,
        null) : null));
  card.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', p.id); e.dataTransfer.effectAllowed = 'move'; card.classList.add('dragging'); });
  card.addEventListener('dragend', () => card.classList.remove('dragging'));
  return card;
}

async function movePost(p, action, msg) {
  try {
    const saved = await api(`/api/posts?id=${p.id}`, { method: 'PATCH', body: { action } });
    upsert(saved); toast(msg);
    if (action === 'send') maybeNotify([saved]);
  } catch (e) {
    toast(e.message, true);
    if (/imagem|data/i.test(e.message)) openPost(p);
  }
}

export { hasMedia, isPlanned, stageOf, COLUMNS, CLIENT_COLORS, colorCache, resetColorCache, clientColor, initials, viewBoard, quickAdd, mediaItems, coverButton, openViewer, boardCard, movePost };
