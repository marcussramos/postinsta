// MC DIGITAL — Início, equipe de IA, datas comemorativas e notificações.
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
import { S, can, clientName, noClients, render, thumb, typeBadge } from './core.js';
import { hasMedia, isPlanned } from './fluxo.js';
import { approvalReminders, billingMonths, chargesCard, ensureSettings, fmtDay, requestsInbox, todayLocal } from './pasta.js';
import { openPost } from './post.js';
import { openLead, openProposal } from './vendas.js';
import { openConnectShare, connectionDead } from './clientes.js';

// ───────────────────────── INÍCIO: a "entrada" do MC DIGITAL (clique na logo)
function viewHome() {
  if (can('financeiro')) ensureSettings();
  const today = todayLocal();
  const hour = Number(partsInTz(new Date().toISOString(), S.tz).time.slice(0, 2));
  const hello = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  const who0 = S.userName && S.userName !== 'Dono' ? S.userName.split(' ')[0] : (S.settings?.agency?.representante || '').split(' ')[0];
  const who = who0 ? who0.charAt(0).toUpperCase() + who0.slice(1).toLowerCase() : '';
  const ld = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: S.tz }).format(new Date());
  const longDate = ld.charAt(0).toUpperCase() + ld.slice(1);
  const month = today.slice(0, 7);
  const posts = S.posts.filter((p) => p.scheduled_at);
  const todays = posts.filter((p) => dayKey(p.scheduled_at, S.tz) === today && p.status !== 'idea').sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
  const week = posts.filter((p) => { const t = new Date(p.scheduled_at).getTime(); return t > Date.now() && t < Date.now() + 7 * 864e5 && !['idea'].includes(p.status); });
  const waiting = S.posts.filter((p) => p.status === 'pending_approval').length;
  const newReqs = (S.requests || []).filter((r) => r.status === 'open').length;

  const hero = h('section', { class: 'home-hero' },
    h('div', { class: 'home-mark', 'aria-hidden': 'true' }, h('img', { class: 'brand-logo light', src: '/brand/logo.png', alt: '' }), h('img', { class: 'brand-logo dark', src: '/brand/logo-claro.png', alt: '' })),
    h('div', { class: 'home-hello' },
      h('div', { class: 'eyebrow' }, longDate),
      h('h1', {}, who ? [`${hello}, `, h('span', { class: 'script' }, who)] : `${hello}.`),
      h('p', { class: 'muted' }, todays.length ? `Hoje saem ${todays.length} publicaç${todays.length > 1 ? 'ões' : 'ão'}.` : 'Nenhuma publicação marcada para hoje.',
        waiting ? ` ${waiting} post${waiting > 1 ? 's' : ''} esperando aprovação dos clientes.` : '')),
    h('div', { class: 'home-quick' },
      can('conteudo') ? h('button', { class: 'btn primary', onclick: () => openPost() }, '+ Novo post') : null,
      h('a', { class: 'btn', href: '#calendario' }, 'Calendário'),
      h('a', { class: 'btn', href: '#fluxo' }, 'Fluxo'),
      can('vendas') ? h('button', { class: 'btn', onclick: () => openProposal() }, '+ Proposta') : null));

  const clients = S.clients.filter((c) => !c.own); // conta própria da agência fica fora de números e cobranças

  // ── 1. RESOLVA AGORA: o que trava publicação, cliente esperando, dinheiro atrasado
  const alerts = [];
  const failed = S.posts.filter((p) => p.status === 'failed');
  if (failed.length) alerts.push(alertRow('bad', `${failed.length} post${failed.length > 1 ? 's' : ''} não publicou`, 'Abra e tente de novo', () => openPost(failed[0])));
  const lastRun = S.setup?.publisher_last_run ? Date.now() - new Date(S.setup.publisher_last_run).getTime() : null;
  if (S.role === 'admin' && lastRun != null && lastRun > 30 * 60e3) alerts.push(alertRow('bad', `Agendador automático parado há ${lastRun > 2 * 3600e3 ? `${Math.round(lastRun / 3600e3)} h` : `${Math.round(lastRun / 60e3)} min`}`, 'Posts aprovados não estão saindo. Confira em Ajustes', null, '#ajustes'));
  for (const c of S.clients.filter(connectionDead)) alerts.push(alertRow('bad', `Instagram de ${c.name} desconectou`, 'Os posts desse cliente não vão sair sozinhos. Envie o link para reconectar pelo celular.', can('clientes') && c.connect_url ? () => openConnectShare(c) : null, can('clientes') && c.connect_url ? null : '#clientes'));
  const noIg = S.clients.filter((c) => !c.ig_connected && !c.production_only && !c.own);
  if (noIg.length) alerts.push(alertRow('bad', noIg.length === S.clients.filter((c) => !c.production_only && !c.own).length ? 'Nenhum cliente com Instagram conectado' : `${noIg.length} cliente${noIg.length > 1 ? 's' : ''} sem Instagram conectado`,
    `Nada deles é publicado sozinho: ${noIg.map((c) => c.name).join(', ')}`, null, '#clientes'));
  for (const c of S.clients) {
    const exp = c.ig_connected && c.ig_token_expires_at ? Math.round((new Date(c.ig_token_expires_at) - Date.now()) / 864e5) : null;
    if (exp !== null && exp <= 5) alerts.push(alertRow('warn', `${c.name}: conexão do Instagram vence em ${Math.max(0, exp)} dia(s)`, 'Reconecte', null, '#clientes'));
  }
  if (can('vendas') && Array.isArray(S.proposals)) {
    for (const p of S.proposals.filter((x) => x.status === 'accepted' && x.accepted_at && Date.now() - new Date(x.accepted_at) < 10 * 864e5)) {
      alerts.push(alertRow('good', `🎉 ${p.client_name} aceitou a proposta`, 'Gere o contrato e conecte o Instagram', null, p.client_id ? `#pasta/${p.client_id}` : '#propostas'));
    }
    for (const p of S.proposals.filter((x) => x.status === 'sent' && Date.now() - new Date(x.updated_at || x.created_at) > 5 * 864e5)) {
      alerts.push(alertRow('', `${p.client_name}: proposta sem resposta há ${Math.floor((Date.now() - new Date(p.updated_at || p.created_at)) / 864e5)} dias`, 'Que tal um follow-up?', null, '#propostas'));
    }
  }
  if (can('vendas') && Array.isArray(S.leads)) {
    const due = S.leads.filter((l) => !['fechado', 'perdido'].includes(l.stage) && (l.wants_contact && l.stage === 'novo' || (l.next_action_at && l.next_action_at <= today)));
    for (const l of due.slice(0, 4)) alerts.push(alertRow(l.wants_contact ? 'bad' : 'warn', `${l.wants_contact ? '🔥 ' : ''}Follow-up: ${l.name}${l.instagram ? ` (@${l.instagram})` : ''}`, l.next_action || 'Retomar o contato', () => openLead(l)));
    if (due.length > 4) alerts.push(alertRow('', `+${due.length - 4} follow-ups para hoje`, 'Veja em Vendas', null, '#vendas'));
  }
  const nowCard = h('section', { class: 'card' }, h('h3', {}, 'Precisa da sua atenção'),
    alerts.length ? h('div', { class: 'alerts' }, ...alerts) : h('p', { class: 'muted', style: 'margin:0' }, 'Nada travado por aqui ✓'));
  const todayCard = todays.length ? h('section', { class: 'card' }, h('div', { class: 'home-card-head' }, h('h3', {}, 'Sai hoje'), h('a', { href: '#agenda', class: 'muted' }, 'Agenda →')),
    h('div', { class: 'home-today' }, ...todays.map((p) => h('button', { class: 'ht', onclick: () => openPost(p) },
      thumb(p, 'ht-img'), h('span', { class: 'mono' }, fmtTime(p.scheduled_at, S.tz)),
      h('span', { class: 'ht-main' }, h('b', {}, clientName(p.client_id)), ' ', typeBadge(p), h('span', { class: 'muted ht-cap' }, p.title || p.caption || '')),
      h('span', { class: `pill st-${p.status}` }, STATUS_LABEL[p.status]))))) : null;

  // ── 2. SEMANA: o que sai nos próximos 7 dias e o que falta planejar
  const opsTiles = [
    kpi('Próximos 7 dias', String(week.length), week.length ? `${week.filter((p) => p.status === 'approved').length} já aprovado(s)` : 'nada marcado ainda', week.length ? '' : 'warn'),
    kpi('Aguardando clientes', String(waiting), waiting ? 'posts esperando aprovação' : 'nenhum pendente', waiting ? 'warn' : ''),
    newReqs ? kpi('Pedidos novos', String(newReqs), 'vindos da área do cliente', 'warn') : null,
    kpi('Clientes', String(clients.length), `${clients.filter((c) => c.ig_connected && !connectionDead(c)).length} com Instagram conectado${clients.some((c) => c.production_only) ? ` · ${clients.filter((c) => c.production_only).length} só produção` : ''}`, clients.some((c) => !c.ig_connected && !c.production_only) ? 'warn' : ''),
  ].filter(Boolean);
  const days = [...Array(7)].map((_, i) => shiftDay(today, i + 1));
  const weekCard = h('section', { class: 'card' }, h('div', { class: 'home-card-head' }, h('h3', {}, 'Próximos 7 dias'), h('a', { href: '#calendario', class: 'muted' }, 'Calendário →')),
    h('div', { class: 'week-list' }, ...days.map((d) => {
      const list = posts.filter((p) => p.status !== 'idea' && dayKey(p.scheduled_at, S.tz) === d);
      const pend = list.filter((p) => ['idea', 'draft', 'internal_review', 'changes_requested'].includes(p.status)).length;
      const appr = list.filter((p) => p.status === 'pending_approval').length;
      const wd = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`)).replace('.', '');
      return h('a', { class: `week-row${list.length ? '' : ' is-free'}`, href: '#agenda' },
        h('span', { class: 'week-day mono' }, `${wd} ${fmtDay(d).slice(0, 5)}`),
        h('span', { class: 'week-main' }, list.length ? `${list.length} post${list.length > 1 ? 's' : ''} · ${[...new Set(list.map((p) => clientName(p.client_id)))].join(', ')}` : 'livre'),
        pend ? h('span', { class: 'pill st-draft' }, `${pend} em produção`) : appr ? h('span', { class: 'pill st-pending_approval' }, `${appr} p/ aprovar`) : list.length ? h('span', { class: 'pill st-approved' }, 'pronto') : null);
    })));
  const planAlerts = [];
  const dAlerts = commemorativeAlerts();
  for (const a of dAlerts.slice(0, 5)) planAlerts.push(alertRow(a.in_days <= 5 ? 'warn' : '', `${a.name} em ${a.in_days} dia${a.in_days > 1 ? 's' : ''}: sem post para ${a.client}`, `${fmtDay(a.date)} · clique para criar a ideia`, () => openPost(null, { client: a.client_id, date: shiftDay(a.date, a.in_days > 1 ? -1 : 0), title: a.name, stage: 'idea' })));
  if (dAlerts.length > 5) planAlerts.push(alertRow('', `+${dAlerts.length - 5} datas comemorativas sem post`, 'Veja no calendário', null, '#calendario'));
  const planCard = planAlerts.length ? h('section', { class: 'card' }, h('h3', {}, 'Para planejar'), h('div', { class: 'alerts' }, ...planAlerts)) : null;

  // ── 3. MÊS: financeiro (fica por último; dá para esconder os valores no olhinho)
  let monthBlock = null;
  if (can('financeiro')) {
    let mrr = 0, received = 0, toReceive = 0, late = 0, active = 0;
    const parts = [], missing = [], future = [];
    for (const c of clients) {
      if (!c.billing_start || !c.monthly_fee_cents) { if (c.monthly_fee_cents || c.billing_start || c.contract_data) missing.push(c.name); continue; }
      if (c.billing_start.slice(0, 10) <= today) { mrr += c.monthly_fee_cents; active++; parts.push(`${c.name} ${brl(c.monthly_fee_cents)}`); }
      else future.push(`${c.name} começa ${fmtDay(c.billing_start.slice(0, 10))}`);
      for (const m of billingMonths(c)) {
        late += m.late_cents;
        if (m.month === month) { received += m.parcels.filter((p) => p.status === 'paid').reduce((x, p) => x + (p.cents || 0), 0); toReceive += m.open_cents - m.late_cents; }
      }
    }
    const reajList = clients.filter((c) => c.billing_start && c.billing_start.slice(5, 7) === month.slice(5, 7) && c.billing_start.slice(0, 4) < month.slice(0, 4));
    const reaj = reajList.length ? h('section', { class: 'card' }, h('h3', {}, 'Reajustes do mês'),
      h('span', { class: 'muted', style: 'font-size:13.5px' }, 'Contratos que fazem aniversário este mês: hora de aplicar o IPCA de 12 meses (cláusula 6.4) e avisar o cliente.'),
      h('div', { class: 'alerts' }, ...reajList.map((c) => alertRow('', `${c.name} · ${Number(month.slice(0, 4)) - Number(c.billing_start.slice(0, 4))} ano(s) de contrato`, `Mensalidade atual ${brl(c.monthly_fee_cents)}`, null, `#pasta/${c.id}`)))) : null;
    monthBlock = [
      homeHead(`O mês · ${monthLabel(month)}`, null),
      h('div', { class: 'home-kpis' },
        kpi('Receita mensal', brl(mrr), [
          active <= 4 && parts.length ? parts.join(' · ') : `${active} contrato${active === 1 ? '' : 's'} ativo${active === 1 ? '' : 's'}`,
          future.length ? ` · fora da conta: ${future.join(', ')}` : '',
          missing.length ? ` · sem valor ou início: ${missing.join(', ')}` : '',
        ].join(''), missing.length ? 'warn' : ''),
        kpi(`Recebido em ${monthLabel(month, true)}`, brl(received), 'parcelas marcadas como pagas', 'good'),
        kpi('A receber no mês', brl(toReceive), 'ainda no prazo'),
        kpi('Em atraso', late ? brl(late) : 'Nada', late ? 'veja as cobranças acima' : 'tudo em dia', late ? 'bad' : 'good')),
      reaj];
  }

  if (!S.clients.length) return [hero, noClients()];
  const team = teamSection(today, month, newReqs);
  return [hero, pushPrompt(),
    homeHead('Resolva agora', 'O que trava publicação, cliente esperando e cobrança'),
    homeRow([nowCard, todayCard], [approvalReminders(), requestsInbox(), chargesCard()]),
    homeHead('Semana', 'O que sai e o que falta planejar'),
    h('div', { class: 'home-kpis' }, ...opsTiles),
    homeRow([weekCard], [planCard, upcomingDatesCard()]),
    team,
    ...(monthBlock || [])].filter(Boolean);
}
// Duas colunas que terminam na mesma altura (o último quadro de cada coluna estica);
// se um lado não tiver nada, o outro ocupa a largura toda.
function homeRow(left, right) {
  const l = left.filter(Boolean), r = right.filter(Boolean);
  if (!l.length && !r.length) return null;
  if (!l.length || !r.length) return h('div', { class: 'home-grid single' }, h('div', { class: 'home-col' }, ...(l.length ? l : r)));
  return h('div', { class: 'home-grid' }, h('div', { class: 'home-col' }, ...l), h('div', { class: 'home-col' }, ...r));
}
const homeHead = (title, sub) => h('div', { class: 'home-head' }, h('h2', {}, title), sub ? h('span', { class: 'muted' }, sub) : null);
// ───────────────────────── equipe de IA: escritório ao vivo + missões da semana
// Tudo calculado do trabalho real do app; nada é marcado à mão.
function weekRange(today) {
  const d = new Date(`${today}T12:00:00Z`);
  const mon = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 864e5);
  return [mon.toISOString().slice(0, 10), new Date(mon.getTime() + 6 * 864e5).toISOString().slice(0, 10)];
}
function teamSection(today, month, newReqs) {
  const [w0, w1] = weekRange(today);
  const inWeek = S.posts.filter((p) => p.scheduled_at && p.status !== 'idea' && (() => { const k = dayKey(p.scheduled_at, S.tz); return k >= w0 && k <= w1; })());
  const deliveries = S.clients.map((c) => {
    const d = S.deliv?.[c.id]; if (!d) return null;
    const parts = [d.posts, d.reels, d.stories].filter((x) => x && x.quota);
    return parts.length ? { id: c.id, client: c.name, planned: parts.reduce((a, x) => a + (x.planned || 0), 0), quota: parts.reduce((a, x) => a + x.quota, 0) } : null;
  }).filter(Boolean);
  const billing = [];
  if (can('financeiro')) for (const c of S.clients.filter((x) => !x.own)) { const m = billingMonths(c).find((x) => x.month === month); if (m) billing.push({ id: c.id, client: c.name, status: m.status }); }
  const leads = can('vendas') && Array.isArray(S.leads) ? S.leads : [];
  const dueLeads = leads.filter((l) => !['fechado', 'perdido'].includes(l.stage) && ((l.wants_contact && l.stage === 'novo') || (l.next_action_at && l.next_action_at <= today)));
  const missions = weekMissions({ weekPosts: inWeek.map((p) => ({ status: p.status, hasMedia: hasMedia(p) })), deliveries, billing, leads, today, monthName: monthLabel(month).split(' ')[0] });

  const by = (st) => S.posts.filter((p) => p.status === st);
  const noArt = S.posts.filter((p) => ['draft', 'internal_review'].includes(p.status) && !hasMedia(p) && !isPlanned(p));
  const planned = S.posts.filter(isPlanned);
  const late = billing.filter((b) => b.status === 'late');
  const under = deliveries.filter((d) => d.planned < d.quota);
  const load = {
    dir: by('approved').length + by('failed').length + by('internal_review').length,
    plan: by('idea').length + under.length,
    cont: by('draft').length + by('changes_requested').length,
    des: noArt.length + planned.length,
    atd: by('pending_approval').length + newReqs,
    ven: dueLeads.length,
    fin: late.length,
  };
  const n = (x, one, many) => `${x} ${x === 1 ? one : many}`;
  const item = (cond, label, href) => (cond ? { label, href } : null);
  const describe = (id) => {
    const items = {
      dir: [item(by('approved').length, `${n(by('approved').length, 'post aprovado', 'posts aprovados')} esperando a hora de publicar`, '#fluxo'),
        item(by('failed').length, `${n(by('failed').length, 'post não publicou', 'posts não publicaram')}`, '#fluxo'),
        item(by('internal_review').length, `${n(by('internal_review').length, 'post', 'posts')} na revisão interna`, '#fluxo')],
      plan: [item(by('idea').length, `${n(by('idea').length, 'ideia', 'ideias')} para transformar em pauta`, '#fluxo'),
        ...under.map((d) => item(true, `${d.client}: ${d.planned}/${d.quota} entregas no mês`, '#calendario'))],
      cont: [item(by('draft').length, `${n(by('draft').length, 'post', 'posts')} em produção`, '#fluxo'),
        item(by('changes_requested').length, `${n(by('changes_requested').length, 'ajuste pedido', 'ajustes pedidos')} pelo cliente`, '#fluxo')],
      des: [item(planned.length, `${n(planned.length, 'post planejado', 'posts planejados')} esperando arte`, '#fluxo'),
        item(noArt.length, `${n(noArt.length, 'post', 'posts')} em produção sem arte`, '#fluxo')],
      atd: [item(by('pending_approval').length, `${n(by('pending_approval').length, 'post', 'posts')} aguardando o cliente`, '#agenda'),
        item(newReqs, `${n(newReqs, 'pedido novo', 'pedidos novos')} da área do cliente`, '#agenda')],
      ven: dueLeads.slice(0, 5).map((l) => item(true, `Follow-up: ${l.name}`, '#vendas')),
      fin: late.map((b) => item(true, `${b.client}: mensalidade atrasada`, `#pasta/${b.id}`)),
      reu: [],
    }[id] || [];
    const mine = missions.filter((m) => m.s === id && !isDone(m));
    return { sub: id === 'reu' ? 'Toque em “Chamar reunião” para reunir a equipe' : (mine.length ? `${n(mine.length, 'missão aberta', 'missões abertas')} na semana` : 'Missões da semana em dia'), items: items.filter(Boolean) };
  };
  const office = officeCard({ load, missions, describe });

  const lv = weekLevel(missions);
  const open = missions.filter((m) => !isDone(m)), done = missions.filter(isDone);
  const pct = (m) => Math.round((Math.min(m.n, m.total) / m.total) * 100);
  const row = (m) => h('div', { class: `ms${isDone(m) ? ' done' : ''}` },
    h('div', { class: 'ms-row' }, h('span', { class: 'ms-t' }, m.t), h('span', { class: 'mono muted' }, `${m.n}/${m.total}`)),
    h('div', { class: 'dl-bar' }, h('span', { style: `width:${pct(m)}%` })),
    h('span', { class: 'muted ms-who' }, `${AGENTS[m.s]?.pessoa || ''} · ${isDone(m) ? 'concluída' : `vale ${missionXp({ n: 1, total: 1 })} XP`}`),
    m.parts?.length > 1 ? h('details', { class: 'ms-parts' }, h('summary', {}, `Ver os ${m.parts.length} clientes`),
      ...[...m.parts].sort((a, b) => a.n / a.total - b.n / b.total).map((x) => h('div', { class: 'ms-part' },
        h('span', { class: 'ms-part-n' }, x.client), h('div', { class: 'dl-bar' }, h('span', { style: `width:${pct(x)}%` })), h('span', { class: 'mono muted' }, `${x.n}/${x.total}`)))) : null);
  const missionsCard = h('section', { class: 'card missions-card' },
    h('div', { class: 'home-card-head' }, h('h3', {}, 'Missões da semana'), h('span', { class: 'muted', style: 'font-size:13px' }, `${lv.done} de ${missions.length} concluídas`)),
    h('div', { class: 'ms-level' },
      h('div', { class: 'ms-row' }, h('span', { class: 'eyebrow' }, `Nível ${lv.level} · ${lv.title}`), h('span', { class: 'muted mono', style: 'font-size:12px' }, `${lv.xp} XP`)),
      h('div', { class: 'dl-bar ms-xp' }, h('span', { style: `width:${Math.round((lv.into / lv.next) * 100)}%` }))),
    missions.length ? h('div', { class: 'ms-list' }, ...open.map(row)) : h('p', { class: 'muted', style: 'margin:0' }, 'As missões aparecem quando houver posts marcados nesta semana.'),
    done.length ? h('details', { class: 'ms-done' }, h('summary', {}, `${done.length} ${done.length > 1 ? 'missões concluídas' : 'missão concluída'}`), h('div', { class: 'ms-list' }, ...done.map(row))) : null,
    h('p', { class: 'muted', style: 'margin:0;font-size:12px' }, 'Avançam sozinhas com o trabalho no app.'));
  return h('div', { class: 'home-team' }, office, missionsCard);
}
const kpi = (label, value, sub, tone = '') => h('div', { class: `stat ${tone}` }, h('div', { class: 'eyebrow' }, label), h('div', { class: 'stat-v' }, value), h('div', { class: 'muted', style: 'font-size:12.5px' }, sub));
function alertRow(tone, title, sub, onclick, href) {
  const inner = [h('span', { class: `dot ${tone}` }), h('span', { class: 'al-main' }, h('b', {}, title), h('span', { class: 'muted' }, sub)), h('span', { class: 'muted' }, '→')];
  return href ? h('a', { class: 'alert', href }, ...inner) : h('button', { class: 'alert', type: 'button', onclick }, ...inner);
}

// ───────────────────────── datas comemorativas (Início)
const shiftDay = (day, n) => new Date(new Date(`${day}T12:00:00Z`).getTime() + n * 864e5).toISOString().slice(0, 10);
function postDaysOf(clientId) {
  return [...S.posts, ...S.cal.posts].filter((p) => p.client_id === clientId && p.scheduled_at).map((p) => dayKey(p.scheduled_at, S.tz));
}
const dismissedDates = () => { try { return new Set(JSON.parse(localStorage.getItem('mc_dates_off') || '[]')); } catch { return new Set(); } };
function commemorativeAlerts() {
  const clients = S.clients.map((c) => ({ id: c.id, name: c.name, niche: c.brand_kit?.niche || null }));
  const off = dismissedDates();
  return dateAlerts(clients, postDaysOf, todayLocal()).filter((a) => !off.has(`${a.client_id}:${a.date}`));
}
function upcomingDatesCard() {
  const today = todayLocal();
  const niches = new Set(S.clients.map((c) => c.brand_kit?.niche).filter(Boolean));
  const list = datesBetween(shiftDay(today, 1), shiftDay(today, 45)).filter((d) => d.major || d.tags.some((t) => niches.has(t))).slice(0, 7);
  if (!list.length) return null;
  return h('section', { class: 'card' }, h('div', { class: 'home-card-head' }, h('h3', {}, 'Datas que vêm aí'), h('a', { href: '#calendario', class: 'muted' }, 'Calendário →')),
    h('div', { class: 'dates-list' }, ...list.map((d) => {
      const target = S.clients.filter((c) => relevantFor(d, c.brand_kit?.niche));
      const covered = target.filter((c) => [0, 1, 2, 3].some((n) => postDaysOf(c.id).includes(shiftDay(d.date, -n))));
      const n = daysBetween(today, d.date);
      return h('div', { class: 'date-row' },
        h('span', { class: 'date-day mono' }, fmtDay(d.date).slice(0, 5)),
        h('span', { class: 'date-name' }, h('b', {}, d.name), h('span', { class: 'muted' }, ` · em ${n} dia${n > 1 ? 's' : ''}`)),
        target.length ? h('span', { class: `pill ${covered.length === target.length ? 'st-approved' : 'st-pending_approval'}`, title: target.filter((c) => !covered.includes(c)).map((c) => c.name).join(', ') || 'Todos com post' }, `${covered.length}/${target.length} com post`) : h('span', { class: 'muted', style: 'font-size:12.5px' }, 'nicho'));
    })),
    h('span', { class: 'hint muted' }, 'Defina o nicho de cada cliente em Pasta → Marca para ver as datas do segmento dele (Dia dos Animais, Dia do Dentista…).'));
}

// ───────────────────────── notificações no celular (Web Push) e app instalável
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const b64ToBytes = (b64) => { const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4)); return Uint8Array.from(s, (c) => c.charCodeAt(0)); };
const deviceName = () => { const ua = navigator.userAgent; return `${/iphone/i.test(ua) ? 'iPhone' : /ipad/i.test(ua) ? 'iPad' : /android/i.test(ua) ? 'Android' : /mac/i.test(ua) ? 'Mac' : /windows/i.test(ua) ? 'Windows' : 'Navegador'}${isStandalone() ? ' (app)' : ''}`; };
async function loadPushState() {
  if (!pushSupported()) return (S.push = isIOS() && !isStandalone() ? 'ios-install' : 'unsupported');
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    S.push = sub ? 'on' : Notification.permission === 'denied' ? 'denied' : 'off';
  } catch { S.push = 'off'; }
  return S.push;
}
async function enablePush() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('As notificações foram bloqueadas. Libere nas configurações do navegador (cadeado ao lado do endereço) e tente de novo.');
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const { public_key } = await api('/api/pasta?r=push');
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(public_key) });
  await api('/api/pasta?r=push', { method: 'POST', body: { subscription: sub.toJSON(), device: deviceName() } });
  S.push = 'on';
}
async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (sub) { await api('/api/pasta?r=push', { method: 'DELETE', body: { endpoint: sub.endpoint } }).catch(() => {}); await sub.unsubscribe(); }
  S.push = 'off';
}
function pushControls({ compact = false } = {}) {
  if (S.push === undefined) { S.push = null; loadPushState().finally(() => render()); }
  const st = S.push;
  const go = async (e, fn, msg) => { e.target.disabled = true; try { await fn(); toast(msg); } catch (err) { toast(err.message, true); } e.target.disabled = false; render(); };
  if (st === null) return [h('span', { class: 'muted' }, 'Verificando…')];
  if (st === 'ios-install') return [h('span', { class: 'ig-warn' }, '• No iPhone, primeiro instale o app'),
    h('ol', { class: 'steps-ol' }, h('li', {}, 'Abra este painel no Safari.'), h('li', {}, 'Toque em Compartilhar (quadrado com seta) → "Adicionar à Tela de Início".'), h('li', {}, 'Abra o MC DIGITAL pelo ícone novo e volte aqui para ativar.'))];
  if (st === 'unsupported') return [h('span', { class: 'muted' }, 'Este navegador não recebe notificações. Use Chrome, Edge, Firefox ou Safari atualizado.')];
  if (st === 'denied') return [h('span', { class: 'ig-warn' }, '• Notificações bloqueadas neste aparelho'), h('span', { class: 'muted', style: 'font-size:13.5px' }, 'Libere nas configurações do navegador (cadeado ao lado do endereço → Notificações → Permitir) e recarregue a página.')];
  if (st === 'on') return [h('span', { class: 'ig-ok' }, '✓ Este aparelho recebe os avisos'),
    h('div', { class: 'actions' }, h('button', { class: 'btn sm', onclick: (e) => go(e, () => api('/api/pasta?r=push&test=1', { method: 'POST' }), 'Notificação de teste enviada.') }, 'Enviar teste'),
      compact ? null : h('button', { class: 'btn ghost sm', onclick: (e) => go(e, disablePush, 'Notificações desligadas neste aparelho.') }, 'Desligar neste aparelho'))];
  return [h('button', { class: 'btn primary sm', style: 'justify-self:start', onclick: (e) => go(e, enablePush, 'Pronto! Este aparelho vai receber os avisos.') }, '🔔 Ativar notificações neste aparelho')];
}
function pushPrompt() {
  if (S.push === undefined) { S.push = null; loadPushState().finally(() => render()); }
  let off = false; try { off = localStorage.getItem('mc_push_prompt') === 'off'; } catch { /* ok */ }
  if (off || !['off', 'ios-install'].includes(S.push)) return null;
  return h('section', { class: 'card push-prompt' },
    h('div', { class: 'push-ico', 'aria-hidden': 'true' }, '🔔'),
    h('div', { style: 'display:grid;gap:8px;min-width:0' },
      h('b', {}, 'Receba os avisos no celular'),
      h('span', { class: 'muted', style: 'font-size:13.5px' }, 'Cliente aprovou, pediu ajuste, mandou pedido, aceitou proposta, pagou o Pix ou um post falhou: você fica sabendo na hora, sem abrir o painel.'),
      ...pushControls({ compact: true })),
    h('button', { class: 'btn ghost sm', 'aria-label': 'Agora não', onclick: () => { try { localStorage.setItem('mc_push_prompt', 'off'); } catch { /* ok */ } render(); } }, '✕'));
}
function settingsDevice() {
  return [h('div', { class: 'page-head', style: 'margin-top:12px' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Celular'), h('h2', { style: 'font-size:22px' }, 'App e notificações'))),
    h('div', { class: 'grid-clients' },
      h('article', { class: 'card' }, h('div', { class: 'eyebrow' }, 'Avisos na hora'), h('h3', {}, 'Notificações neste aparelho'),
        h('span', { class: 'muted', style: 'font-size:13.5px' }, 'Ative em cada aparelho (celular e computador). Avisa: cliente aprovou ou pediu ajuste, pedido novo, proposta aceita, Pix recebido, nota fiscal e post que falhou.'),
        ...pushControls()),
      h('article', { class: 'card' }, h('div', { class: 'eyebrow' }, 'Tela de início'), h('h3', {}, 'Instalar o MC DIGITAL'),
        isStandalone() ? h('span', { class: 'ig-ok' }, '✓ Você está usando o app instalado') : null,
        h('ol', { class: 'steps-ol' },
          h('li', {}, h('b', {}, 'iPhone: '), 'no Safari, Compartilhar → "Adicionar à Tela de Início".'),
          h('li', {}, h('b', {}, 'Android: '), 'no Chrome, menu ⋮ → "Instalar app" (ou "Adicionar à tela inicial").'),
          h('li', {}, h('b', {}, 'Computador: '), 'no Chrome/Edge, ícone de instalar na barra de endereço.')),
        h('span', { class: 'hint muted' }, 'Abre em tela cheia, com ícone próprio, como um aplicativo.')))];
}

export { homeRow, viewHome, homeHead, weekRange, teamSection, kpi, alertRow, shiftDay, postDaysOf, dismissedDates, commemorativeAlerts, upcomingDatesCard, pushSupported, isStandalone, isIOS, b64ToBytes, deviceName, loadPushState, enablePush, disablePush, pushControls, pushPrompt, settingsDevice };
