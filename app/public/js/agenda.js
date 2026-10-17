// MC DIGITAL — agenda (lista por dia) e agenda do dia.
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
import { S, clientFilter, clientName, drawer, isLate, noClients, postLabel, render, thumb, typeBadge } from './core.js';
import { stageOf } from './fluxo.js';
import { fmtDay, todayLocal } from './pasta.js';
import { openPost, upsert } from './post.js';

// ───────────────────────── agenda (lista por dia)
function viewAgenda() {
  const now = Date.now();
  const relevant = S.posts.filter((p) => p.scheduled_at && (!S.fClient || p.client_id === S.fClient));
  const cards = [
    [['pending_approval'], 'Aguardando cliente', '--s-wait'],
    [['changes_requested'], 'Ajuste pedido', '--s-change'],
    [['approved'], 'Aprovados na fila', '--s-ok'],
    [['planned'], 'Planejados', '--line'],
    [['idea', 'draft', 'internal_review'], 'Em produção', '--s-draft'],
    [['failed'], 'Falharam', '--s-fail'],
  ];
  const key = (sts) => sts.join(',');
  const summary = h('div', { class: 'summary' }, ...cards.map(([sts, label, color]) =>
    h('button', { class: 'sum', 'aria-pressed': String(S.fStatus === key(sts)), onclick: () => { S.fStatus = S.fStatus === key(sts) ? '' : key(sts); render(); } },
      h('span', { class: 'eyebrow' }, h('span', { class: 'dot', style: `background:var(${color})` }), label),
      h('b', {}, String(relevant.filter((p) => sts.includes(stageOf(p))).length)))));

  let list = relevant.filter((p) => !S.fStatus || S.fStatus.split(',').includes(stageOf(p)));
  list = list.filter((p) => p.status !== 'published' || now - new Date(p.published_at || p.scheduled_at) < 86400e3 || S.fStatus === 'published');

  const out = [h('div', { class: 'page-head' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Próximas publicações'), h('h1', {}, 'Agenda')))];
  if (!S.clients.length) return [...out, noClients()];
  out.push(summary, clientFilter());
  const ideas = S.posts.filter((p) => !p.scheduled_at && (!S.fClient || p.client_id === S.fClient)).length;
  if (ideas) out.push(h('p', { class: 'muted', style: 'margin:0' }, `${ideas} ${ideas > 1 ? 'posts sem data estão' : 'post sem data está'} no `, h('a', { href: '#fluxo' }, 'Fluxo'), '.'));
  if (!list.length) {
    out.push(h('div', { class: 'empty' }, h('h3', {}, S.fStatus ? 'Nada neste status' : 'Nenhum post agendado'),
      h('p', { class: 'muted' }, 'Crie um post, envie para o cliente e ele sai sozinho depois de aprovado.'),
      h('button', { class: 'btn primary', onclick: () => openPost() }, '+ Novo post')));
    return out;
  }
  const groups = new Map();
  for (const p of list) { const k = dayKey(p.scheduled_at, S.tz); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
  for (const [, posts] of groups) {
    out.push(h('section', { class: 'day' },
      h('div', { class: 'day-head' }, h('h2', {}, fmtDate(posts[0].scheduled_at, S.tz, true)), h('span', { class: 'rule' }), h('span', { class: 'eyebrow' }, `${posts.length} post${posts.length > 1 ? 's' : ''}`)),
      ...posts.map(rowPost)));
  }
  return out;
}

function rowPost(p) {
  const note = p.status === 'changes_requested' && p.client_feedback ? h('div', { class: 'note' }, `“${p.client_feedback}”`)
    : p.status === 'failed' && p.last_error ? h('div', { class: 'note fail' }, p.last_error) : null;
  return h('button', { class: 'row', onclick: () => openPost(p) },
    thumb(p),
    h('div', { class: 'time' }, p.scheduled_at ? fmtTime(p.scheduled_at, S.tz) : '—'),
    h('div', { class: 'main' }, h('div', { class: 'client' }, clientName(p.client_id), ' ', typeBadge(p)), h('div', { class: 'cap' }, p.title ? p.title : (p.caption || 'Sem legenda')), note),
    h('div', { class: 'side' }, h('span', { class: `pill st-${p.status}` }, STATUS_LABEL[p.status]), isLate(p) ? h('span', { class: 'late' }, 'Horário já passou') : null));
}

// ───────────────────────── agenda do dia (horários)
const STATUS_COLOR = { idea: '#6B4FC4', draft: 'var(--s-draft)', internal_review: 'var(--s-draft)', pending_approval: 'var(--s-wait)', changes_requested: 'var(--s-change)', approved: 'var(--s-ok)', publishing: 'var(--s-pub)', published: 'var(--s-pub)', failed: 'var(--s-fail)' };
const movable = (p) => !['publishing', 'published'].includes(p.status);
const fmtTime24 = (iso) => partsInTz(iso, S.tz).time;
async function reschedule(p, date, time) {
  try {
    const saved = await api(`/api/posts?id=${p.id}`, { method: 'PATCH', body: { scheduled_at: zonedToISO(date, time, S.tz) } });
    upsert(saved, false);
    const i = S.cal.posts.findIndex((x) => x.id === p.id); if (i >= 0) S.cal.posts[i] = { ...S.cal.posts[i], ...saved };
    render();
    toast(`Remarcado para ${fmtDay(date).slice(0, 5)} às ${time}.${['pending_approval', 'approved'].includes(saved.status) ? ' O status continua o mesmo.' : ''}`);
    return saved;
  } catch (e) { toast(e.message, true); return null; }
}
function openDay(d, special = []) {
  const title = fmtDate(zonedToISO(d, '12:00', S.tz), S.tz, true);
  const box = h('div', { class: 'dayplan' });
  let best = [];
  const dayPosts = () => S.cal.posts.filter((p) => p.scheduled_at && dayKey(p.scheduled_at, S.tz) === d && (!S.fClient || p.client_id === S.fClient))
    .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
  const weekday = new Date(`${d}T12:00:00Z`).getUTCDay();
  const isPast = d < todayLocal();
  let openSlot = null;
  const draw = () => {
    const posts = dayPosts();
    const hours = new Set(Array.from({ length: 18 }, (_, i) => i + 6)); // 06h–23h
    posts.forEach((p) => hours.add(Number(fmtTime24(p.scheduled_at).slice(0, 2))));
    const bestHours = new Set(best.filter((b) => b.weekday === weekday).map((b) => b.hour));
    box.replaceChildren(
      special.length ? h('div', { class: 'dayplan-dates' }, ...special.map((x) => h('span', { class: `cal-date${x.major ? ' major' : ''}` }, `🎉 ${x.name}`))) : null,
      h('div', { class: 'muted', style: 'font-size:13px' }, posts.length ? `${posts.length} programaç${posts.length > 1 ? 'ões' : 'ão'} neste dia.` : 'Nada programado ainda.',
        bestHours.size ? ' ★ = melhor horário do perfil.' : '', ' Toque num horário para programar; arraste um post para outro horário.'),
      h('div', { class: 'slots' }, ...[...hours].sort((a, b) => a - b).map((hh) => {
        const hs = String(hh).padStart(2, '0');
        const inSlot = posts.filter((p) => Number(fmtTime24(p.scheduled_at).slice(0, 2)) === hh);
        const slot = h('div', { class: `slot${bestHours.has(hh) ? ' best' : ''}${openSlot === hh ? ' open' : ''}` },
          h('div', { class: 'slot-time mono' }, `${hs}:00`, bestHours.has(hh) ? h('span', { class: 'slot-star', title: 'Melhor horário do perfil' }, '★') : null),
          h('div', { class: 'slot-body' },
            ...inSlot.map((p) => h('button', { class: 'slot-post', style: `border-left-color:${STATUS_COLOR[p.status] || 'var(--line)'}`, type: 'button', draggable: movable(p) ? 'true' : null,
              ondragstart: (e) => { e.dataTransfer.setData('text/plain', p.id); e.dataTransfer.effectAllowed = 'move'; },
              onclick: () => { close(); openPost(p); } },
              p.image_url ? h('img', { src: p.image_url, alt: '' }) : h('span', { class: 'slot-noimg' }, p.status === 'idea' ? '💡' : '🖼'),
              h('span', { class: 'slot-main' }, h('b', {}, `${fmtTime24(p.scheduled_at)} · ${clientName(p.client_id)}`), h('span', {}, postLabel(p))),
              h('span', { class: `pill st-${p.status}` }, STATUS_LABEL[p.status]))),
            openSlot === hh ? slotForm(hh) : h('button', { class: 'slot-add', type: 'button', onclick: () => { openSlot = hh; draw(); box.querySelector('.slot-form textarea')?.focus(); } }, isPast ? '+' : `+ Programar às ${hs}:00`)));
        slot.addEventListener('dragover', (e) => { e.preventDefault(); slot.classList.add('drop-over'); });
        slot.addEventListener('dragleave', (e) => { if (!slot.contains(e.relatedTarget)) slot.classList.remove('drop-over'); });
        slot.addEventListener('drop', async (e) => {
          e.preventDefault(); slot.classList.remove('drop-over');
          const p = S.cal.posts.find((x) => x.id === e.dataTransfer.getData('text/plain'));
          if (!p || Number(fmtTime24(p.scheduled_at).slice(0, 2)) === hh) return;
          if (await reschedule(p, d, `${hs}:${fmtTime24(p.scheduled_at).slice(3)}`)) draw();
        });
        return slot;
      })));
  };
  function slotForm(hh) {
    const hs = String(hh).padStart(2, '0');
    const sel = h('select', { 'aria-label': 'Cliente' }, ...S.clients.map((c) => h('option', { value: c.id, selected: c.id === (S.fClient || S.lastClient || S.clients[0].id) }, c.name)));
    const min = h('select', { 'aria-label': 'Minutos' }, ...['00', '15', '30', '45'].map((m) => h('option', { value: m }, `${hs}:${m}`)));
    const ta = h('textarea', { rows: 2, maxlength: 140, placeholder: special[0] ? `Ex.: ${special[0].name}` : 'Pauta do post (ex.: Promoção de banho e tosa)' });
    const add = async (full) => {
      const time = `${hs}:${min.value}`;
      if (full) { close(); return openPost(null, { date: d, time, client: sel.value, title: ta.value.trim() || special[0]?.name }); }
      const title = ta.value.trim(); if (!title) return ta.focus();
      try {
        const saved = await api('/api/posts', { method: 'POST', body: { client_id: sel.value, title, stage: 'draft', scheduled_at: zonedToISO(d, time, S.tz) } });
        S.lastClient = sel.value; upsert(saved, false); if (!S.cal.posts.some((x) => x.id === saved.id)) S.cal.posts.push(saved);
        openSlot = null; draw(); render(); toast(`Programado: ${clientName(saved.client_id)} às ${time} (em produção).`);
      } catch (e) { toast(e.message, true); }
    };
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); add(false); } if (e.key === 'Escape') { openSlot = null; draw(); } });
    return h('div', { class: 'slot-form' }, h('div', { class: 'slot-form-row' }, sel, min), ta,
      h('div', { class: 'slot-form-row' }, h('button', { class: 'btn primary sm', type: 'button', onclick: () => add(false) }, 'Programar'),
        h('button', { class: 'btn sm', type: 'button', onclick: () => add(true) }, 'Abrir editor completo'),
        h('button', { class: 'linkish', type: 'button', onclick: () => { openSlot = null; draw(); } }, 'Cancelar')));
  }
  draw();
  const cid = S.fClient || (S.clients.length === 1 ? S.clients[0].id : null);
  if (cid) api(`/api/pasta?r=besttime&client=${cid}`).then((r) => { best = r.slots || []; draw(); }).catch(() => {});
  const close = drawer(title, [box], [h('span', { class: 'spacer' }), h('button', { class: 'btn primary', onclick: () => { close(); openPost(null, { date: d, title: special[0]?.name }); } }, '+ Novo post neste dia')]);
}

export { viewAgenda, rowPost, STATUS_COLOR, movable, fmtTime24, reschedule, openDay };
