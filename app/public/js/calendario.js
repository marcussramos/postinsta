// MC DIGITAL — calendário do mês, planejamento com IA e duplicar semana.
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
import { fmtTime24, movable, openDay, reschedule, rowPost } from './agenda.js';
import { S, can, clientById, clientName, drawer, noClients, postLabel, render, savePref } from './core.js';
import { CLIENT_COLORS, clientColor, resetColorCache } from './fluxo.js';
import { shiftDay } from './inicio.js';
import { fmtDay, todayLocal } from './pasta.js';
import { openPost, upsert } from './post.js';

// ───────────────────────── calendário do mês
function monthOf(iso) { return partsInTz(iso, S.tz).date.slice(0, 7); }
function shiftMonth(m, delta) {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function monthGrid(m) { // dias de domingo a sábado cobrindo o mês
  const [y, mo] = m.split('-').map(Number);
  const first = new Date(Date.UTC(y, mo - 1, 1));
  const start = new Date(first); start.setUTCDate(1 - first.getUTCDay());
  const last = new Date(Date.UTC(y, mo, 0));
  const end = new Date(last); end.setUTCDate(last.getUTCDate() + (6 - last.getUTCDay()));
  const days = [];
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) days.push(d.toISOString().slice(0, 10));
  return days;
}
async function loadMonth(m, silent = false) {
  const days = monthGrid(m);
  const from = zonedToISO(days[0], '00:00', S.tz);
  const to = zonedToISO(days.at(-1), '23:59', S.tz);
  S.cal.loading = !silent;
  try {
    S.cal.posts = await api(`/api/posts?from=${encodeURIComponent(from)}&to=${encodeURIComponent(new Date(new Date(to).getTime() + 60e3).toISOString())}`);
    S.cal.month = m;
  } catch (e) { toast(e.message, true); }
  S.cal.loading = false;
  if (!silent) render();
}

function viewCalendar() {
  if (!S.clients.length) return [h('div', { class: 'page-head' }, h('h1', {}, 'Calendário')), noClients()];
  const today = partsInTz(new Date().toISOString(), S.tz).date;
  if (!S.cal.month) { S.cal.month = today.slice(0, 7); loadMonth(S.cal.month); }
  const m = S.cal.month;
  const raw = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${m}-15T12:00:00Z`));
  const label = raw.charAt(0).toUpperCase() + raw.slice(1);
  const go = (delta) => { S.cal.day = null; loadMonth(delta === 0 ? today.slice(0, 7) : shiftMonth(m, delta)); };
  const monthPosts = S.cal.posts.filter((p) => p.scheduled_at && dayKey(p.scheduled_at, S.tz).slice(0, 7) === m);
  const posts = monthPosts.filter((p) => !S.fClient || p.client_id === S.fClient);
  const byDay = new Map();
  for (const p of posts) { const k = dayKey(p.scheduled_at, S.tz); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(p); }
  for (const l of byDay.values()) l.sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));

  const head = h('div', { class: 'page-head' },
    h('div', {}, h('div', { class: 'eyebrow' }, 'Planejamento'), h('h1', {}, label)),
    h('div', { class: 'spacer' }),
    h('div', { class: 'actions' },
      can('ia') ? h('button', { class: 'btn ai sm', onclick: () => openPlan({ month: m }) }, '✨ Planejar o mês') : null,
      can('conteudo') ? h('button', { class: 'btn sm', onclick: () => openDuplicate() }, 'Duplicar semana') : null,
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Modo de exibição' },
        ...[['thumbs', 'Miniaturas'], ['list', 'Lista']].map(([k, l]) => h('button', { class: 'seg-btn', 'aria-pressed': String(S.cal.mode === k),
          onclick: () => { S.cal.mode = k; savePref('mc_cal_mode', k); render(); } }, l))),
      h('button', { class: 'btn sm', onclick: () => go(-1), 'aria-label': 'Mês anterior' }, '‹'),
      h('button', { class: 'btn sm', onclick: () => go(0) }, 'Hoje'),
      h('button', { class: 'btn sm', onclick: () => go(1), 'aria-label': 'Próximo mês' }, '›')));

  // chips de cliente: filtro de um toque, na cor do cliente, com quantos posts tem no mês
  const count = (id) => monthPosts.filter((p) => p.client_id === id).length;
  const chips = h('div', { class: 'cc-chips', role: 'group', 'aria-label': 'Filtrar por cliente' },
    h('button', { class: 'cc-chip', type: 'button', 'aria-pressed': String(!S.fClient), onclick: () => { S.fClient = ''; render(); } }, `Todos · ${monthPosts.length}`),
    ...S.clients.map((c) => h('button', { class: 'cc-chip', type: 'button', style: `--cc:${clientColor(c.id)}`, 'aria-pressed': String(S.fClient === c.id),
      onclick: () => { S.fClient = S.fClient === c.id ? '' : c.id; render(); } },
      h('span', { class: 'cc-dot', 'aria-hidden': 'true' }), `${c.name} · ${count(c.id)}`)),
    can('conteudo') ? h('button', { class: 'cc-chip ghost', type: 'button', onclick: openColors }, '🎨 Cores') : null);

  // datas comemorativas: as principais + as dos nichos dos clientes (ou do cliente filtrado)
  const gridDays = monthGrid(m);
  const niches = new Set((S.fClient ? [clientById(S.fClient)] : S.clients).map((c) => c?.brand_kit?.niche).filter(Boolean));
  const dayDates = new Map();
  for (const x of datesBetween(gridDays[0], gridDays.at(-1)).filter((x) => x.major || x.tags.some((t) => niches.has(t)))) dayDates.set(x.date, [...(dayDates.get(x.date) || []), x]);
  const FMT_ICON = { REELS: '▶', CAROUSEL: '❐', STORY: '◷' };
  const FMT_NAME = { IMAGE: 'Post', REELS: 'Reels', CAROUSEL: 'Carrossel', STORY: 'Story' };
  const weekend = (d) => [0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay());
  const dropOn = (d) => ({
    ondragover: (e) => { e.preventDefault(); e.currentTarget.classList.add('drop-over'); },
    ondragleave: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.classList.remove('drop-over'); },
    ondrop: (e) => { e.preventDefault(); e.currentTarget.classList.remove('drop-over'); const p = S.cal.posts.find((x) => x.id === e.dataTransfer.getData('text/plain')); if (p && dayKey(p.scheduled_at, S.tz) !== d) reschedule(p, d, fmtTime24(p.scheduled_at)); },
  });
  const drag = (p) => ({ draggable: movable(p) ? 'true' : null, ondragstart: (e) => { e.dataTransfer.setData('text/plain', p.id); e.dataTransfer.effectAllowed = 'move'; } });
  const addBtn = (d, big) => (can('conteudo') && d >= today ? h('button', { class: `cal-add${big ? ' big' : ''}`, type: 'button', 'aria-label': `Criar post em ${d.slice(8)}/${d.slice(5, 7)}`, title: 'Criar post neste dia',
    onclick: (e) => { e.stopPropagation(); openPost(null, { date: d, client: S.fClient || undefined }); } }, big ? '+ Criar post neste dia' : '+') : null);

  let body;
  if (S.cal.mode === 'list') {
    // ── D: agenda por dia (faixa da cor do cliente, foto, horário, formato e status)
    const days = gridDays.filter((d) => d.slice(0, 7) === m);
    const wdName = (d) => new Intl.DateTimeFormat('pt-BR', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));
    const items = [];
    for (const d of days) {
      const list = byDay.get(d) || [];
      if (!list.length && d < today) continue; // dia passado sem post: não ocupa espaço
      const dates = dayDates.get(d) || [];
      const name = `${d === today ? 'Hoje, ' : ''}${wdName(d)} ${Number(d.slice(8))}`;
      items.push(h('section', { class: `ag-day${d < today ? ' past' : ''}${weekend(d) ? ' wkend' : ''}${d === today ? ' today' : ''}`, ...dropOn(d) },
        h('div', { class: 'ag-head' },
          h('b', {}, name.charAt(0).toUpperCase() + name.slice(1)),
          h('span', { class: 'muted' }, list.length ? `${list.length} post${list.length > 1 ? 's' : ''}` : 'dia livre'),
          ...dates.map((x) => h('span', { class: `cal-date${x.major ? ' major' : ''}` }, x.name)),
          h('span', { class: 'spacer' }), list.length ? addBtn(d) : null),
        ...(list.length ? list.map((p) => h('button', { type: 'button', class: 'ag-row', style: `--cc:${clientColor(p.client_id)}`, onclick: () => openPost(p), ...drag(p),
          title: movable(p) ? 'Abrir · arraste para outro dia para remarcar' : 'Abrir' },
          h('span', { class: 'ag-bar', 'aria-hidden': 'true' }),
          h('span', { class: 'ag-time mono' }, fmtTime(p.scheduled_at, S.tz)),
          p.image_url ? h('img', { class: 'ag-ph', src: p.image_url, alt: '', loading: 'lazy' }) : h('span', { class: 'ag-ph empty' }, FMT_ICON[p.media_type] || '▢'),
          h('span', { class: 'ag-main' },
            h('span', { class: 'ag-title' }, postLabel(p)),
            h('span', { class: 'ag-sub' }, h('span', { class: 'cc-tag' }, clientName(p.client_id)), ` ${FMT_ICON[p.media_type] ? `${FMT_ICON[p.media_type]} ` : ''}${FMT_NAME[p.media_type] || 'Post'}`, p.script ? ` · 🎬 ${SCRIPT_STATUS[p.script.status] || 'Roteiro'}` : '')),
          h('span', { class: `pill st-${p.status}` }, STATUS_LABEL[p.status])))
          : [addBtn(d, true) || h('div', { class: 'ag-free muted' }, 'Nenhum post')])));
    }
    body = h('div', { class: `agenda${S.cal.loading ? ' loading' : ''}` }, ...(items.length ? items : [h('p', { class: 'muted' }, 'Nenhum dia para mostrar neste mês.')]));
  } else {
    // ── A: mês em miniaturas com a moldura da cor do cliente
    const week = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
    body = h('div', { class: `cal mode-thumbs${S.cal.loading ? ' loading' : ''}`, role: 'grid', 'aria-label': `Calendário de ${label}` },
      ...week.map((w, i) => h('div', { class: `cal-wd${i === 0 || i === 6 ? ' wkend' : ''}`, role: 'columnheader' }, w)),
      ...gridDays.map((d) => {
        const list = byDay.get(d) || [];
        const out = d.slice(0, 7) !== m;
        const dates = dayDates.get(d) || [];
        return h('div', { class: `cal-day${out ? ' out' : ''}${d === today ? ' today' : ''}${d < today ? ' past' : ''}${weekend(d) ? ' wkend' : ''}${S.cal.day === d ? ' sel' : ''}`, role: 'gridcell', tabindex: 0,
          onclick: (e) => { if (!e.target.closest('.cal-tile, .cal-add')) openDay(d, dates); },
          onkeydown: (e) => { if (e.key === 'Enter') openDay(d, dates); }, ...dropOn(d) },
          dates.length ? h('div', { class: `cal-strip${dates.some((x) => x.major) ? ' major' : ''}`, title: dates.map((x) => x.name).join(' · ') }, dates.map((x) => x.name).join(' · ')) : null,
          h('div', { class: 'cal-top' }, h('span', { class: 'cal-num' }, String(Number(d.slice(8)))), out ? null : addBtn(d)),
          h('div', { class: 'cal-dots', 'aria-hidden': 'true' }, ...list.slice(0, 4).map((p) => h('span', { class: 'dot', style: `color:${clientColor(p.client_id)}` }))),
          list.length ? h('div', { class: 'cal-mini', style: `--cc:${clientColor(list[0].client_id)}`, 'aria-hidden': 'true' },
            list[0].image_url ? h('img', { src: list[0].image_url, alt: '' }) : h('span', { class: 'thumb-empty' }),
            list.length > 1 ? h('span', { class: 'cal-badge' }, String(list.length)) : null) : null,
          h('div', { class: 'cal-thumbs' },
            ...list.slice(0, 4).map((p, i) => h('button', { class: 'cal-tile', type: 'button', style: `--cc:${clientColor(p.client_id)}`,
              title: `${fmtTime(p.scheduled_at, S.tz)} · ${clientName(p.client_id)} · ${postLabel(p)} · ${STATUS_LABEL[p.status]}${movable(p) ? ' · arraste para outro dia' : ''}`, ...drag(p),
              onclick: () => (i === 3 && list.length > 4 ? openDay(d, dates) : openPost(p)) },
              p.image_url ? h('img', { src: p.image_url, alt: postLabel(p), loading: 'lazy' }) : h('span', { class: 'cal-tile-empty' }, postLabel(p)),
              FMT_ICON[p.media_type] ? h('span', { class: 'cal-tile-fmt', title: FMT_NAME[p.media_type] }, FMT_ICON[p.media_type]) : null,
              h('span', { class: 'cal-tile-time mono' }, fmtTime(p.scheduled_at, S.tz)),
              h('span', { class: `cal-tile-st st-${p.status}`, 'aria-hidden': 'true' }),
              i === 3 && list.length > 4 ? h('span', { class: 'cal-tile-more' }, `+${list.length - 3}`) : null))));
      }));
  }

  const out = [head, chips, body,
    h('p', { class: 'muted', style: 'margin:0;font-size:13.5px' }, S.cal.mode === 'list'
      ? 'Toque num post para abrir. Arraste um post para outro dia para remarcar. A barra colorida é a cor do cliente.'
      : 'Clique num dia para ver os horários. Use o + para criar um post naquele dia e arraste um post para outro dia para remarcar. A moldura é a cor do cliente; a bolinha no canto, o status.')];
  if (S.cal.day && S.cal.mode !== 'list') {
    const list = byDay.get(S.cal.day) || [];
    out.push(h('section', { class: 'day' },
      h('div', { class: 'day-head' }, h('h2', {}, fmtDate(zonedToISO(S.cal.day, '12:00', S.tz), S.tz, true)), h('span', { class: 'rule' }),
        h('button', { class: 'btn sm', onclick: () => openPost(null, { date: S.cal.day }) }, '+ Post neste dia')),
      ...(list.length ? list.map(rowPost) : [h('p', { class: 'muted', style: 'margin:0' }, 'Nenhum post neste dia.')])));
  }
  return out;
}

// Cores fixas dos clientes: aparecem no calendário, no Fluxo e nos filtros.
function openColors() {
  const rows = S.clients.map((c) => {
    const cur = clientColor(c.id);
    const row = h('div', { class: 'cc-pick' },
      h('span', { class: 'cc-name' }, h('span', { class: 'cc-dot', style: `--cc:${cur}`, 'aria-hidden': 'true' }), c.name),
      h('div', { class: 'cc-swatches', role: 'radiogroup', 'aria-label': `Cor de ${c.name}` },
        ...CLIENT_COLORS.map(([hex, name]) => {
          const usedBy = S.clients.find((o) => o.id !== c.id && clientColor(o.id) === hex);
          return h('button', { type: 'button', class: 'cc-sw', role: 'radio', 'aria-checked': String(cur === hex), style: `--cc:${hex}`,
            title: usedBy ? `${name} · já usada por ${usedBy.name}` : name, 'aria-label': name,
            onclick: async () => {
              try {
                const r = await api('/api/pasta?r=brand', { method: 'PUT', body: { client_id: c.id, label_color: hex } });
                c.brand_kit = r.brand_kit; resetColorCache(); render(); close(); openColors(); toast(`${c.name}: ${name.toLowerCase()}.`);
              } catch (e) { toast(e.message, true); }
            } }, usedBy ? h('span', { class: 'cc-used', 'aria-hidden': 'true' }, '•') : null);
        })));
    return row;
  });
  const close = drawer('Cores dos clientes', [h('p', { class: 'muted', style: 'margin:0' }, 'Cada cliente com uma cor fixa no calendário, no Fluxo e nos filtros. As marcadas com • já estão com outro cliente.'), ...rows], []);
}

// ───────────────────────── planejamento do mês com IA
function openPlan({ client, month } = {}) {
  if (!S.clients.length) return toast('Cadastre um cliente primeiro.', true);
  if (!S.setup?.ai_ready && S.role === 'admin') return toast('A IA ainda não está ligada. Veja a aba Ajustes → Inteligência Artificial.', true);
  const cur = todayLocal().slice(0, 7);
  const sel = h('select', { id: 'pl-client' }, ...S.clients.map((c) => h('option', { value: c.id, selected: c.id === (client || S.fClient || S.clients[0].id) }, c.name)));
  const mIn = h('input', { type: 'month', id: 'pl-month', value: month && month >= cur ? month : (Number(todayLocal().slice(8)) > 20 ? shiftMonth(cur, 1) : cur) });
  const extra = h('textarea', { id: 'pl-extra', style: 'min-height:70px', placeholder: 'Opcional. Ex.: lançamento do plano de banho mensal no dia 15; evitar promoções; 2 Reels de bastidores.' });
  const out = h('div', { class: 'plan-out' });
  const info = h('div', { class: 'muted', style: 'font-size:13.5px' });
  const drawInfo = () => {
    const c = clientById(sel.value); const k = c?.contract_data || {};
    info.replaceChildren(`A IA usa a marca (${c?.brand_kit?.niche ? NICHES[c.brand_kit.niche] : 'nicho não definido'}), o tom de voz, a cota (${k.quota_posts ?? '—'} posts · ${k.quota_reels ?? '—'} Reels por mês), os melhores posts dos relatórios, os melhores horários e as datas comemorativas. Planeja só o que falta no calendário do mês.`);
  };
  sel.addEventListener('change', drawInfo); drawInfo();
  let plan = null; const chosen = new Set();
  const gen = h('button', { class: 'btn ai', onclick: run }, '✨ Gerar planejamento');
  const create = h('button', { class: 'btn primary', hidden: true, onclick: createIdeas }, 'Criar ideias no Fluxo');
  async function run() {
    gen.disabled = true; create.hidden = true;
    out.replaceChildren(h('div', { class: 'plan-wait' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('span', {}, 'Estudando a marca, os resultados e as datas do mês… leva uns 30 segundos.')));
    try {
      plan = await api('/api/pasta?r=plan', { method: 'POST', body: { client_id: sel.value, month: mIn.value, extra: extra.value } });
      chosen.clear(); plan.items.forEach((_, i) => chosen.add(i));
      drawPlan();
    } catch (e) { out.replaceChildren(h('div', { class: 'errorbox' }, e.message)); }
    gen.disabled = false; gen.textContent = '↻ Gerar de novo';
  }
  function drawPlan() {
    const fmtD = (d) => new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));
    out.replaceChildren(
      plan.strategy ? h('div', { class: 'feedback' }, h('b', {}, 'Linha do mês:'), h('span', {}, plan.strategy)) : null,
      h('div', { class: 'plan-list' }, ...plan.items.map((it, i) => h('label', { class: `plan-item${chosen.has(i) ? ' on' : ''}` },
        h('input', { type: 'checkbox', checked: chosen.has(i), onchange: (e) => { if (e.target.checked) chosen.add(i); else chosen.delete(i); e.target.closest('.plan-item').classList.toggle('on', e.target.checked); create.textContent = `Criar ${chosen.size} ideia${chosen.size === 1 ? '' : 's'} no Fluxo`; } }),
        h('div', { class: 'plan-main' },
          h('div', { class: 'plan-top' }, h('span', { class: 'mono' }, `${fmtD(it.date)} · ${it.time}`), h('span', { class: 'type-badge' }, it.format_label), it.pillar ? h('span', { class: 'muted' }, it.pillar) : null, it.date_hook ? h('span', { class: 'cal-date major' }, it.date_hook) : null),
          h('b', {}, it.title),
          h('span', { class: 'muted plan-idea' }, it.idea),
          it.caption ? h('details', {}, h('summary', { class: 'muted' }, 'Rascunho de legenda'), h('p', { style: 'margin:6px 0 0;white-space:pre-line' }, it.caption), h('p', { class: 'mono', style: 'margin:4px 0 0;font-size:12.5px;color:var(--accent)' }, it.hashtags.join(' '))) : null)))),
      h('span', { class: 'hint muted' }, 'As ideias entram no Fluxo com data, formato, roteiro (nas notas da equipe) e rascunho de legenda. É só produzir a arte e seguir o fluxo normal de aprovação.'));
    create.hidden = false; create.textContent = `Criar ${chosen.size} ideia${chosen.size === 1 ? '' : 's'} no Fluxo`;
  }
  async function createIdeas() {
    if (!chosen.size) return toast('Marque pelo menos uma ideia.', true);
    create.disabled = true;
    try {
      const rows = await api('/api/pasta?r=plan', { method: 'POST', body: { client_id: sel.value, create: true, items: plan.items.filter((_, i) => chosen.has(i)) } });
      rows.forEach((p) => upsert(p, false));
      close(); S.fClient = sel.value; S.cal.month = null; location.hash = '#calendario'; render();
      toast(`${rows.length} ideias criadas para ${clientName(sel.value)}. Estão no calendário e no Fluxo.`);
    } catch (e) { toast(e.message, true); create.disabled = false; }
  }
  const close = drawer('Planejar o mês com IA', [
    h('div', { class: 'grid-2 tight' }, h('div', { class: 'field' }, h('label', { for: 'pl-client' }, 'Cliente'), sel), h('div', { class: 'field' }, h('label', { for: 'pl-month' }, 'Mês'), mIn)),
    h('div', { class: 'field' }, h('label', { for: 'pl-extra' }, 'Pedido para este mês'), extra), info, gen, out,
  ], [h('span', { class: 'spacer' }), create]);
}

// ───────────────────────── duplicar semana
function openDuplicate() {
  const today = todayLocal();
  const t = new Date(`${today}T12:00:00Z`);
  const sunday = shiftDay(today, -t.getUTCDay());
  const from = h('input', { type: 'date', id: 'dp-from', value: shiftDay(sunday, -7) });
  const to = h('input', { type: 'date', id: 'dp-to', value: sunday });
  const sel = h('select', { id: 'dp-client' }, h('option', { value: '' }, 'Todos os clientes'), ...S.clients.map((c) => h('option', { value: c.id, selected: c.id === S.fClient }, c.name)));
  const preview = h('div', { class: 'muted', style: 'font-size:13.5px' });
  const upd = () => {
    const a = from.value, b = to.value; if (!a || !b) return;
    const shift = daysBetween(a, b);
    const n = [...S.posts, ...S.cal.posts].filter((p, i, arr) => arr.findIndex((x) => x.id === p.id) === i && p.scheduled_at && (!sel.value || p.client_id === sel.value)).filter((p) => { const d = dayKey(p.scheduled_at, S.tz); return d >= a && d < shiftDay(a, 7); }).length;
    preview.replaceChildren(shift < 1 ? 'A semana de destino precisa ser depois da semana copiada.' : `${n} post${n === 1 ? '' : 's'} de ${fmtDay(a)} a ${fmtDay(shiftDay(a, 6))} → mesmos dias e horários a partir de ${fmtDay(b)} (+${shift} dias). Viram rascunhos "Em produção" (ideias continuam ideias), com as mesmas artes e legendas para você ajustar.`);
  };
  [from, to, sel].forEach((el) => el.addEventListener('change', upd)); upd();
  const go = h('button', { class: 'btn primary', onclick: async () => {
    const shift = daysBetween(from.value, to.value);
    if (shift < 1) return toast('Escolha uma semana de destino depois da copiada.', true);
    go.disabled = true;
    try {
      const rows = await api('/api/pasta?r=duplicate', { method: 'POST', body: { from: from.value, days: 7, shift, client_id: sel.value || undefined } });
      rows.forEach((p) => upsert(p, false));
      close(); if (S.view === 'calendario') await loadMonth(S.cal.month, true); render();
      toast(`${rows.length} post${rows.length === 1 ? '' : 's'} duplicado${rows.length === 1 ? '' : 's'}.`);
    } catch (e) { toast(e.message, true); go.disabled = false; }
  } }, 'Duplicar');
  const close = drawer('Duplicar semana', [
    h('div', { class: 'grid-2 tight' }, h('div', { class: 'field' }, h('label', { for: 'dp-from' }, 'Copiar a semana que começa em'), from), h('div', { class: 'field' }, h('label', { for: 'dp-to' }, 'Colar na semana que começa em'), to)),
    h('div', { class: 'field' }, h('label', { for: 'dp-client' }, 'Cliente'), sel), preview,
  ], [h('span', { class: 'spacer' }), go]);
}

export { monthOf, shiftMonth, monthGrid, loadMonth, viewCalendar, openColors, openPlan, openDuplicate };
