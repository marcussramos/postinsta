// MC DIGITAL — propostas e funil de vendas.
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
import { S, confirmButton, drawer, render } from './core.js';
import { shiftDay } from './inicio.js';
import { fmtDay, stat, todayLocal } from './pasta.js';

// ───────────────────────── PROPOSTAS comerciais
const PROP_LABEL = { draft: ['Rascunho', 'st-draft'], sent: ['Enviada', 'st-pending_approval'], accepted: ['Aceita', 'st-approved'], declined: ['Recusada', 'st-failed'] };
function viewProposals() {
  if (S.proposals === undefined) { S.proposals = null; api('/api/pasta?r=proposals').then((v) => { S.proposals = v; }).catch(() => { S.proposals = false; }).finally(() => render()); }
  const head = h('div', { class: 'page-head' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Comercial'), h('h1', {}, 'Propostas')), h('div', { class: 'spacer' }),
    h('button', { class: 'btn primary', onclick: () => openProposal() }, '+ Nova proposta'));
  if (S.proposals === false) return [head, h('div', { class: 'banner' }, 'As propostas precisam da atualização do banco. ', h('a', { href: '#ajustes' }, 'Ver em Ajustes'), '.')];
  if (!S.proposals) return [head, h('p', { class: 'muted' }, 'Carregando…')];
  if (!S.proposals.length) return [head, h('div', { class: 'empty' }, h('h3', {}, 'Nenhuma proposta ainda'),
    h('p', { class: 'muted' }, 'Monte a proposta, mande o link pelo WhatsApp e, quando o cliente aceitar, o cadastro, a pasta, o contrato e a área do cliente já ficam prontos.'),
    h('button', { class: 'btn primary', onclick: () => openProposal() }, '+ Nova proposta'))];
  const sent = S.proposals.filter((p) => p.status === 'sent').reduce((s, p) => s + p.monthly_fee_cents, 0);
  const won = S.proposals.filter((p) => p.status === 'accepted');
  return [head,
    h('div', { class: 'stats' },
      stat('Em negociação', brl(sent), `${S.proposals.filter((p) => p.status === 'sent').length} proposta(s) enviada(s) / mês`),
      stat('Fechadas', String(won.length), `${brl(won.reduce((s, p) => s + p.monthly_fee_cents, 0))} / mês`, 'good'),
      stat('Conversão', S.proposals.filter((p) => p.status !== 'draft').length ? `${Math.round(100 * won.length / S.proposals.filter((p) => ['sent', 'accepted', 'declined'].includes(p.status)).length)}%` : '—', 'aceitas ÷ enviadas')),
    h('div', { class: 'grid-clients' }, ...S.proposals.map((p) => {
      const [label, cls] = PROP_LABEL[p.status];
      const msg = `Olá${p.contact?.name ? `, ${p.contact.name.split(' ')[0]}` : ''}! Segue a nossa proposta para o Instagram de ${p.client_name}:\n${p.url}\n\nPor lá você vê tudo o que está incluso e já pode aceitar. Qualquer dúvida, me chama! 🙂`;
      return h('article', { class: 'card' },
        h('div', { style: 'display:flex;align-items:center;gap:10px' }, h('h3', { style: 'flex:1;min-width:0' }, p.client_name), h('span', { class: `pill ${cls}` }, label)),
        h('div', { class: 'stat-v', style: 'font-size:24px' }, brl(p.monthly_fee_cents), h('span', { class: 'muted', style: 'font-size:14px;font-weight:600' }, ' /mês')),
        h('div', { class: 'muted', style: 'font-size:13px' }, [p.entregas, p.valid_until ? `válida até ${fmtDay(p.valid_until)}` : null, p.accepted_at ? `aceita em ${fmtDay(partsInTz(p.accepted_at, S.tz).date)}` : null].filter(Boolean).join(' · ')),
        p.status === 'declined' && p.accepted?.reason ? h('div', { class: 'feedback' }, h('b', {}, 'Motivo:'), h('span', {}, p.accepted.reason)) : null,
        h('div', { class: 'actions' },
          h('a', { class: 'btn sm', href: p.url, target: '_blank', rel: 'noopener' }, p.status === 'draft' ? 'Pré-visualizar' : 'Abrir'),
          p.status === 'sent' ? h('button', { class: 'btn sm', onclick: () => copyText(p.url, 'Link copiado.') }, 'Copiar link') : null,
          p.status === 'sent' && p.contact?.whatsapp ? h('a', { class: 'btn wa sm', href: waLink(p.contact.whatsapp, msg), target: '_blank', rel: 'noopener' }, 'WhatsApp') : null,
          p.status === 'accepted' && p.client_id ? h('a', { class: 'btn primary sm', href: `#pasta/${p.client_id}` }, 'Abrir pasta do cliente') : null,
          p.status !== 'accepted' ? h('button', { class: 'btn sm', onclick: () => openProposal(p) }, 'Editar') : null,
          h('button', { class: 'btn ghost sm', onclick: () => openProposal({ ...p, id: null, status: 'draft', client_name: `${p.client_name} (cópia)` }) }, 'Duplicar'),
          Object.assign(confirmButton('Apagar', 'Confirmar exclusão', async () => {
            try { await api(`/api/pasta?r=proposals&id=${p.id}`, { method: 'DELETE' }); S.proposals = S.proposals.filter((x) => x.id !== p.id); render(); toast(p.status === 'accepted' ? 'Proposta apagada. O cliente e o contrato continuam.' : 'Proposta apagada.'); }
            catch (e) { toast(e.message, true); }
          }, 'btn ghost danger sm'), { style: 'margin-left:auto' })));
    }))];
}

const DEFAULT_ITEMS = [
  { title: 'Planejamento editorial mensal', desc: 'Calendário com temas, formatos e datas alinhados aos objetivos do mês.' },
  { title: 'Criação de artes e vídeos', desc: 'Posts, carrosséis e Reels com a identidade visual da marca.' },
  { title: 'Legendas e hashtags', desc: 'Textos estratégicos no tom de voz da marca.' },
  { title: 'Aprovação pelo celular', desc: 'Você aprova ou pede ajuste em um link, sem baixar nada.' },
  { title: 'Publicação automática', desc: 'Tudo sai sozinho no melhor horário para o seu público.' },
  { title: 'Relatório mensal', desc: 'Alcance, interações, seguidores e os melhores posts do mês.' },
];
function openProposal(p = null) {
  const isNew = !p?.id;
  const v = (x) => x ?? '';
  const inp = (id, label, value, attrs = {}) => { const el = h(attrs.tag || 'input', { id, ...attrs, tag: null }); el.value = v(value); return [el, h('div', { class: 'field' }, h('label', { for: id }, label), el)]; };
  const [name, fName] = inp('pp-name', 'Cliente (empresa ou perfil)', p?.client_name, { placeholder: 'Ex.: MY PET' });
  const [cname, fCname] = inp('pp-cname', 'Nome do contato', p?.contact?.name, { placeholder: 'Ex.: Christina' });
  const [cwa, fCwa] = inp('pp-cwa', 'WhatsApp do contato', p?.contact?.whatsapp ? p.contact.whatsapp.replace(/^55/, '') : '', { type: 'tel', placeholder: '65 99999-9999' });
  const [cmail, fCmail] = inp('pp-cmail', 'E-mail do contato', p?.contact?.email, { type: 'email' });
  const [intro, fIntro] = inp('pp-intro', 'Mensagem de abertura (opcional)', p?.intro, { tag: 'textarea', style: 'min-height:80px', placeholder: 'Se deixar em branco, o app escreve uma abertura padrão com o nome do cliente.' });
  const [qp, fQp] = inp('pp-qp', 'Posts de feed por mês', p?.quota_posts ?? 8, { type: 'number', min: 0 });
  const [qr, fQr] = inp('pp-qr', 'Reels por mês', p?.quota_reels ?? 4, { type: 'number', min: 0 });
  const [entr, fEntr] = inp('pp-entr', 'Entregas (texto que vai no contrato)', p?.entregas, { placeholder: 'calculado automaticamente' });
  const [fee, fFee] = inp('pp-fee', 'Valor mensal (R$)', p?.monthly_fee_cents ? (p.monthly_fee_cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '', { inputmode: 'decimal', placeholder: '1.300,00' });
  const [days, fDays] = inp('pp-days', 'Vencimento(s): dia(s) do mês', (p?.installments || [{ day: 10 }]).map((x) => x.day).join(', '), { placeholder: '10  ou  4, 14, 24 (parcelado)' });
  const [forma, fForma] = inp('pp-forma', 'Forma de pagamento', p?.forma_pagamento ?? 'via Pix', {});
  const [valid, fValid] = inp('pp-valid', 'Válida até', p?.valid_until || new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10), { type: 'date' });
  const [notes, fNotes] = inp('pp-notes', 'Observações para o cliente (opcional)', p?.notes, { tag: 'textarea', style: 'min-height:70px', placeholder: 'Ex.: gravações presenciais 1x por mês incluídas; tráfego pago é orçado à parte.' });
  let items = (p?.items?.length ? p.items : DEFAULT_ITEMS).map((x) => ({ ...x }));
  const itemsBox = h('div', { class: 'pp-items' });
  const drawItems = () => itemsBox.replaceChildren(...items.map((it, i) => h('div', { class: 'pp-item' },
    h('input', { value: it.title, placeholder: 'Item', oninput: (e) => { it.title = e.target.value; } }),
    h('input', { value: it.desc || '', placeholder: 'Descrição curta', oninput: (e) => { it.desc = e.target.value; } }),
    h('button', { type: 'button', class: 'linkish', 'aria-label': 'Remover item', onclick: () => { items.splice(i, 1); drawItems(); } }, '✕'))),
    items.length < 12 ? h('button', { type: 'button', class: 'btn sm', onclick: () => { items.push({ title: '', desc: '' }); drawItems(); } }, '+ Item') : null);
  drawItems();
  const autoEntregas = () => { const a = Number(qp.value) || 0, b = Number(qr.value) || 0; return [a ? `${a} posts no feed` : null, b ? `${b} Reels` : null].filter(Boolean).join(' e ') + (a + b ? ` por mês (até ${a + b} conteúdos)` : ''); };
  entr.placeholder = autoEntregas();
  [qp, qr].forEach((el) => el.addEventListener('input', () => { entr.placeholder = autoEntregas(); }));
  const payload = () => {
    const cents = Math.round(Number(fee.value.replace(/[R$\s]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')) * 100);
    const ds = days.value.split(/[,;\s]+/).map(Number).filter((n) => n >= 1 && n <= 31).slice(0, 6);
    const split = ds.length ? splitCents(cents || 0, ds.length) : [];
    return {
      client_name: name.value, contact: { name: cname.value, whatsapp: cwa.value, email: cmail.value }, intro: intro.value,
      items: items.filter((i) => i.title.trim()), quota_posts: qp.value, quota_reels: qr.value, entregas: entr.value || autoEntregas(),
      monthly_fee: fee.value, installments: ds.length ? ds.map((d, i) => ({ day: d, cents: split[i] })) : [{ day: 10, cents }],
      forma_pagamento: forma.value, valid_until: valid.value, notes: notes.value,
    };
  };
  const save = async (sendIt) => {
    try {
      const body = { ...payload(), send: sendIt, lead_id: p?.lead_id || undefined };
      const row = isNew ? await api('/api/pasta?r=proposals', { method: 'POST', body }) : await api('/api/pasta?r=proposals', { method: 'PATCH', body: { ...body, id: p.id } });
      S.proposals = [row, ...(S.proposals || []).filter((x) => x.id !== row.id)];
      close(); render();
      toast(sendIt ? 'Proposta pronta para enviar. Copie o link ou mande pelo WhatsApp.' : 'Rascunho salvo.');
      if (location.hash !== '#propostas') location.hash = '#propostas';
    } catch (e) { toast(e.message, true); }
  };
  const foot = [];
  if (!isNew) foot.push(confirmButton('Apagar', 'Confirmar exclusão', async () => { await api(`/api/pasta?r=proposals&id=${p.id}`, { method: 'DELETE' }); S.proposals = S.proposals.filter((x) => x.id !== p.id); close(); render(); toast('Proposta apagada.'); }, 'btn ghost danger'));
  foot.push(h('span', { class: 'spacer' }), h('button', { class: 'btn', onclick: () => save(false) }, 'Salvar rascunho'), h('button', { class: 'btn primary', onclick: () => save(true) }, p?.status === 'sent' ? 'Salvar' : 'Salvar e liberar link'));
  const close = drawer(isNew ? 'Nova proposta' : `Proposta · ${p.client_name}`, [
    h('div', { class: 'eyebrow' }, 'Para quem'), fName, h('div', { class: 'grid-2 tight' }, fCname, fCwa), fCmail, fIntro,
    h('div', { class: 'eyebrow' }, 'O que está incluso'), itemsBox,
    h('div', { class: 'eyebrow' }, 'Entregas e investimento'), h('div', { class: 'grid-2 tight' }, fQp, fQr), fEntr,
    h('div', { class: 'grid-2 tight' }, fFee, fDays), h('div', { class: 'grid-2 tight' }, fForma, fValid), fNotes,
    h('p', { class: 'hint muted', style: 'margin:0' }, 'Quando o cliente aceitar, o app cria o cadastro com esses valores, a cota de entregas, as parcelas, os dados do contrato e o link da área do cliente.'),
  ], foot);
  name.focus();
}

// ───────────────────────── VENDAS (funil de leads) + diagnóstico grátis
const STAGES = [['novo', 'Novo lead'], ['contato', 'Em contato'], ['reuniao', 'Reunião'], ['proposta', 'Proposta'], ['fechado', 'Fechado ✓'], ['perdido', 'Perdido']];
const SRC_LABEL = { diagnostico: 'Diagnóstico', manual: 'Manual', indicacao: 'Indicação', instagram: 'Instagram', site: 'Site' };
// Sempre o endereço oficial (APP_URL), mesmo abrindo o painel por um link de teste da Vercel.
const diagUrl = () => `${S.setup?.app_url || location.origin}/diagnostico`;
const daysTo = (d) => daysBetween(todayLocal(), d);
function leadMessage(l) {
  const first = (l.name || '').split(' ')[0];
  if (l.stage === 'novo' && l.diagnosis) return `Oi, ${first}! Aqui é da MC Digital 🙂 Vi o diagnóstico que você fez do @${l.instagram} (nota ${l.diagnosis.score}/100). Separei algumas ideias práticas para o seu perfil, posso te mostrar em uma conversa rápida de 15 minutos?`;
  if (l.stage === 'proposta') return `Oi, ${first}! Conseguiu dar uma olhada na proposta? Fico à disposição para ajustar o que precisar 🙂`;
  if (l.stage === 'reuniao') return `Oi, ${first}! Confirmando a nossa conversa. Qual horário fica melhor para você?`;
  return `Oi, ${first}! Aqui é da MC Digital 🙂 Tudo bem?`;
}
function viewSales() {
  if (S.leads === undefined) { S.leads = null; api('/api/pasta?r=leads').then((v) => { S.leads = v; }).catch(() => { S.leads = false; }).finally(() => render()); }
  const head = h('div', { class: 'page-head' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Comercial'), h('h1', {}, 'Vendas')), h('div', { class: 'spacer' }),
    h('div', { class: 'actions' },
      h('button', { class: 'btn sm', onclick: () => copyText(diagUrl(), 'Link do diagnóstico copiado. Coloque na bio e nos Stories!') }, '🎯 Copiar link do diagnóstico'),
      h('a', { class: 'btn sm', href: diagUrl(), target: '_blank', rel: 'noopener' }, 'Ver página'),
      h('button', { class: 'btn primary', onclick: () => openLead() }, '+ Novo lead')));
  if (S.leads === false) return [head, h('div', { class: 'banner' }, 'O funil de vendas precisa da atualização do banco. ', h('a', { href: '#ajustes' }, 'Ver em Ajustes'), '.')];
  if (!S.leads) return [head, h('p', { class: 'muted' }, 'Carregando…')];
  const L = S.leads;
  const open = L.filter((l) => !['fechado', 'perdido'].includes(l.stage));
  const month = todayLocal().slice(0, 7);
  const wonMonth = L.filter((l) => l.stage === 'fechado' && (l.updated_at || '').slice(0, 7) === month);
  const decided = L.filter((l) => ['fechado', 'perdido'].includes(l.stage));
  const stats = h('div', { class: 'stats' },
    stat('Em negociação', String(open.length), `${brl(open.reduce((s, l) => s + (l.value_cents || 0), 0))} / mês em propostas`),
    stat('Fechados no mês', String(wonMonth.length), `${brl(wonMonth.reduce((s, l) => s + (l.value_cents || 0), 0))} / mês`, 'good'),
    stat('Conversão', decided.length ? `${Math.round((100 * L.filter((l) => l.stage === 'fechado').length) / decided.length)}%` : '—', `${L.filter((l) => l.source === 'diagnostico').length} vieram do diagnóstico`));
  const board = h('div', { class: 'tboard' }, ...STAGES.map(([st, label]) => {
    const items = L.filter((l) => l.stage === st).sort((a, b) => (b.wants_contact - a.wants_contact) || String(a.next_action_at || '9').localeCompare(String(b.next_action_at || '9')));
    const col = h('section', { class: 'tlist droppable', 'data-col': st },
      h('header', { class: 'tlist-head' }, h('h2', {}, label), h('span', { class: 'tlist-n' }, String(items.length))),
      h('div', { class: 'tlist-cards' }, ...items.map(leadCard)),
      st === 'novo' ? h('div', { class: 'tadd' }, h('button', { class: 'tadd-btn', type: 'button', onclick: () => openLead() }, '+ Adicionar lead')) : null);
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('over'); });
    col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('over'); });
    col.addEventListener('drop', async (e) => {
      e.preventDefault(); col.classList.remove('over');
      const l = L.find((x) => x.id === e.dataTransfer.getData('text/plain'));
      if (!l || l.stage === st) return;
      if (st === 'perdido') return openLead(l, { lose: true });
      try { Object.assign(l, await api('/api/pasta?r=leads', { method: 'PATCH', body: { id: l.id, stage: st } })); render(); toast(`Movido para ${label}.`); } catch (err) { toast(err.message, true); }
    });
    return col;
  }));
  return [head, stats, h('div', { class: 'tboard-wrap' }, board),
    h('p', { class: 'muted', style: 'margin:0;font-size:13px' }, 'Arraste os cartões entre as etapas. Quem faz o diagnóstico grátis entra sozinho em "Novo lead"; quando a proposta é aceita, o lead vai para "Fechado".')];
}
function leadCard(l) {
  const d = l.next_action_at ? daysTo(l.next_action_at) : null;
  const card = h('article', { class: 'tcard', draggable: 'true', tabindex: 0, onclick: () => openLead(l), onkeydown: (e) => { if (e.key === 'Enter') openLead(l); } },
    h('div', { class: 'tcard-in' },
      h('div', { class: 'tlabels' },
        l.wants_contact && !['fechado', 'perdido'].includes(l.stage) ? h('span', { class: 'tlabel', style: '--lc:#F87168' }, '🔥 quer conversar') : null,
        h('span', { class: 'tlabel fmt' }, SRC_LABEL[l.source] || l.source),
        l.diagnosis?.score != null ? h('span', { class: 'tlabel', style: `--lc:${l.diagnosis.score >= 70 ? '#4BCE97' : l.diagnosis.score >= 45 ? '#F5CD47' : '#FEA362'}` }, `nota ${l.diagnosis.score}`) : null),
      h('div', { class: 'ttitle' }, h('b', {}, l.name), l.company ? ` · ${l.company}` : ''),
      l.instagram ? h('div', { class: 'muted', style: 'font-size:13px' }, `@${l.instagram}`) : null,
      h('div', { class: 'tbadges' },
        l.value_cents ? h('span', { class: 'tbadge' }, `${brl(l.value_cents)}/mês`) : null,
        d != null && !['fechado', 'perdido'].includes(l.stage) ? h('span', { class: `tbadge${d < 0 ? ' late' : d === 0 ? ' soon' : ''}`, title: l.next_action || 'Próximo contato' }, `📅 ${d < 0 ? `atrasado ${-d}d` : d === 0 ? 'hoje' : fmtDay(l.next_action_at).slice(0, 5)}`) : null,
        l.stage === 'perdido' && l.lost_reason ? h('span', { class: 'tbadge' }, l.lost_reason.slice(0, 40)) : null)));
  card.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', l.id); card.classList.add('dragging'); });
  card.addEventListener('dragend', () => card.classList.remove('dragging'));
  return card;
}
function openLead(l = null, { lose = false } = {}) {
  const isNew = !l;
  const v = (x) => x ?? '';
  const inp = (id, label, value, attrs = {}) => { const el = h(attrs.tag || 'input', { id, ...attrs, tag: null }); el.value = v(value); return [el, h('div', { class: 'field' }, h('label', { for: id }, label), el)]; };
  const [name, fName] = inp('ld-name', 'Nome do contato', l?.name);
  const [company, fCo] = inp('ld-co', 'Empresa', l?.company);
  const [ig, fIg] = inp('ld-ig', 'Instagram', l?.instagram ? `@${l.instagram}` : '', { placeholder: '@perfil' });
  const [wa, fWa] = inp('ld-wa', 'WhatsApp', l?.whatsapp ? l.whatsapp.replace(/^55/, '') : '', { type: 'tel', placeholder: '65 99999-9999' });
  const [email, fEm] = inp('ld-em', 'E-mail', l?.email, { type: 'email' });
  const [val, fVal] = inp('ld-val', 'Valor mensal estimado (R$)', l?.value_cents ? (l.value_cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '', { inputmode: 'decimal', placeholder: '1.500,00' });
  const [next, fNext] = inp('ld-next', 'Próximo passo', l?.next_action, { placeholder: 'Ex.: mandar proposta, ligar, marcar reunião' });
  const [nextAt, fNextAt] = inp('ld-nextat', 'Data do próximo contato', l?.next_action_at, { type: 'date' });
  const [notes, fNotes] = inp('ld-notes', 'Anotações', l?.notes, { tag: 'textarea', style: 'min-height:90px' });
  const src = h('select', { id: 'ld-src' }, ...Object.entries(SRC_LABEL).map(([k, t]) => h('option', { value: k, selected: (l?.source || 'manual') === k }, t)));
  const stage = h('select', { id: 'ld-stage' }, ...STAGES.map(([k, t]) => h('option', { value: k, selected: (l?.stage || 'novo') === k }, t)));
  const [lost, fLost] = inp('ld-lost', 'Motivo da perda', l?.lost_reason, { placeholder: 'Ex.: preço, timing, fechou com outra agência' });
  const syncLost = () => { fLost.hidden = stage.value !== 'perdido'; };
  stage.addEventListener('change', syncLost);
  if (lose) stage.value = 'perdido';
  syncLost();
  const quick = h('div', { class: 'actions' }, ...[['Hoje', 0], ['+1 dia', 1], ['+3 dias', 3], ['+1 semana', 7]].map(([t, n]) => h('button', { class: 'chip', type: 'button', onclick: () => { nextAt.value = shiftDay(todayLocal(), n); } }, t)));
  const body = [];
  if (l?.diagnosis) {
    const D = l.diagnosis;
    body.push(h('div', { class: 'card lead-diag' }, h('div', { class: 'eyebrow' }, `Diagnóstico · ${fmtDate(D.at, S.tz)}`),
      h('div', { style: 'display:flex;gap:14px;align-items:center' }, h('div', { class: 'stat-v' }, `${D.score}`, h('span', { class: 'muted', style: 'font-size:14px' }, '/100')), h('b', {}, D.headline)),
      D.profile ? h('span', { class: 'muted', style: 'font-size:13px' }, `${(D.profile.followers ?? 0).toLocaleString('pt-BR')} seguidores · ${D.profile.posts_per_week ?? '—'} posts/semana · engajamento ${D.profile.engagement_rate ?? '—'}%`) : null,
      h('div', { class: 'diag-areas' }, ...D.areas.map((a) => h('span', { class: 'pill st-draft' }, `${a.name}: ${a.score}`))),
      h('details', {}, h('summary', { class: 'muted' }, 'Ver análise e respostas'),
        h('ol', { style: 'margin:8px 0;padding-left:18px;display:grid;gap:6px;font-size:14px' }, ...D.actions.map((a) => h('li', {}, h('b', {}, a.title), ` — ${a.detail}`))),
        h('dl', { class: 'onb-dl' }, ...Object.entries(D.answers || {}).flatMap(([k, v2]) => [h('dt', {}, k.replace('_', ' ')), h('dd', {}, v2)])))));
  }
  body.push(h('div', { class: 'grid-2 tight' }, fName, fCo), h('div', { class: 'grid-2 tight' }, fIg, fWa), h('div', { class: 'grid-2 tight' }, fEm, fVal),
    h('div', { class: 'grid-2 tight' }, h('div', { class: 'field' }, h('label', { for: 'ld-stage' }, 'Etapa'), stage), h('div', { class: 'field' }, h('label', { for: 'ld-src' }, 'Origem'), src)),
    fLost, fNext, fNextAt, quick, fNotes);
  if (l && l.whatsapp) body.push(h('div', { class: 'actions' },
    h('a', { class: 'btn wa sm', href: waLink(l.whatsapp, leadMessage(l)), target: '_blank', rel: 'noopener' }, 'WhatsApp com mensagem pronta'),
    l.instagram ? h('a', { class: 'btn sm', href: `https://instagram.com/${l.instagram}`, target: '_blank', rel: 'noopener' }, 'Ver Instagram') : null));
  const payload = () => ({ name: name.value, company: company.value, instagram: ig.value, whatsapp: wa.value, email: email.value, value: val.value,
    next_action: next.value, next_action_at: nextAt.value, notes: notes.value, source: src.value, stage: stage.value, lost_reason: lost.value });
  const save = async () => {
    try {
      const row = isNew ? await api('/api/pasta?r=leads', { method: 'POST', body: payload() }) : await api('/api/pasta?r=leads', { method: 'PATCH', body: { ...payload(), id: l.id } });
      if (isNew && stage.value !== 'novo') Object.assign(row, await api('/api/pasta?r=leads', { method: 'PATCH', body: { id: row.id, stage: stage.value } }));
      S.leads = [row, ...(S.leads || []).filter((x) => x.id !== row.id)];
      close(); render(); toast(isNew ? 'Lead criado.' : 'Lead salvo.');
    } catch (e) { toast(e.message, true); }
  };
  const foot = [];
  if (!isNew) foot.push(confirmButton('Apagar', 'Confirmar exclusão', async () => { await api(`/api/pasta?r=leads&id=${l.id}`, { method: 'DELETE' }); S.leads = S.leads.filter((x) => x.id !== l.id); close(); render(); toast('Lead apagado.'); }, 'btn ghost danger'));
  foot.push(h('span', { class: 'spacer' }));
  if (l && !l.proposal_id && !['fechado', 'perdido'].includes(l.stage)) foot.push(h('button', { class: 'btn', onclick: () => { close(); openProposal({ id: null, status: 'draft', client_name: l.company || l.name, contact: { name: l.name, whatsapp: l.whatsapp, email: l.email }, lead_id: l.id, monthly_fee_cents: l.value_cents || undefined }); } }, 'Criar proposta'));
  if (l?.proposal_id) foot.push(h('a', { class: 'btn', href: '#propostas', onclick: () => close() }, 'Ver proposta'));
  foot.push(h('button', { class: 'btn primary', onclick: save }, isNew ? 'Criar lead' : 'Salvar'));
  const close = drawer(isNew ? 'Novo lead' : l.name, body, foot);
  if (lose) lost.focus(); else if (isNew) name.focus();
}
// "Fotos privadas": fecha o acesso público às fotos dos posts (links assinados que vencem em 7 dias).
function settingsPrivacy() {
  if (S.role !== 'admin') return [];
  if (S.priv === undefined) { S.priv = null; api('/api/pasta?r=privacy').then((v) => { S.priv = v; }).catch(() => { S.priv = false; }).finally(() => { if (S.view === 'ajustes') render(); }); }
  const head = h('div', { class: 'page-head', style: 'margin-top:12px' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Segurança e LGPD'), h('h2', { style: 'font-size:22px' }, 'Fotos privadas')));
  if (!S.priv) return [head, h('p', { class: 'muted' }, S.priv === false ? 'Indisponível agora.' : 'Carregando…')];
  const on = S.priv.media_private;
  const go = h('button', { class: on ? 'btn sm' : 'btn primary sm', style: 'justify-self:start', onclick: async () => {
    if (on && !confirmDanger()) return;
    go.disabled = true;
    try { S.priv = await api('/api/pasta?r=privacy', { method: 'PUT', body: { media_private: !on } }); toast(S.priv.media_private ? 'Fotos privadas ligado. As imagens agora só abrem pelo app.' : 'Fotos privadas desligado.'); render(); }
    catch (err) { toast(err.message, true); go.disabled = false; }
  } }, on ? 'Desligar fotos privadas' : 'Ligar fotos privadas');
  function confirmDanger() { return window.confirm('Desligar deixa as fotos dos posts (inclusive de pacientes) abertas para quem tiver o link. Continuar?'); }
  return [head, h('article', { class: 'card' },
    on ? h('div', { class: 'okbox' }, '✓ Ligado. As fotos e vídeos dos posts só abrem por links temporários gerados pelo app (painel, aprovação, área do cliente e publicação na Meta).')
      : h('div', { class: 'errorbox' }, h('b', {}, 'Desligado. '), 'Qualquer pessoa com o link de uma foto consegue abrir a imagem, inclusive fotos de pacientes (antes e depois). Recomendado ligar.'),
    h('span', { class: 'muted', style: 'font-size:13.5px' }, 'Os links gerados valem 7 dias e se renovam sozinhos sempre que o app é aberto. Nada muda no seu dia a dia.'),
    go)];
}

// Mostra se a leitura de dados reais está funcionando e permite testar com um @.
function diagLookupBox(D) {
  if (!D.lookup_client_id) return null;
  const st = D.lookup_status;
  const status = h('div', { class: st?.ok ? 'okbox' : st ? 'errorbox' : 'hint' },
    !st ? 'Ainda não houve leitura. Teste com um @ comercial abaixo.'
      : st.ok ? `✓ Leitura de dados reais funcionando (último: @${st.handle}, ${fmtDate(st.at, S.tz)}).`
      : h('span', {}, h('b', {}, 'Leitura de dados reais não está funcionando. '), st.error, ` (último teste: @${st.handle}, ${fmtDate(st.at, S.tz)})`));
  const who = h('input', { id: 'dg-test', placeholder: '@perfilcomercial', autocapitalize: 'none', style: 'max-width:260px' });
  const go = h('button', { class: 'btn sm', type: 'button', onclick: async () => {
    go.disabled = true;
    try {
      const r = await api('/api/pasta?r=diagcfg', { method: 'POST', body: { handle: who.value } });
      toast(r.ok ? `Funcionou: @${r.handle} tem ${Number(r.followers || 0).toLocaleString('pt-BR')} seguidores.` : `Não funcionou: ${r.error}`, !r.ok);
      S.diag = await api('/api/pasta?r=diagcfg'); render();
    } catch (err) { toast(err.message, true); go.disabled = false; }
  } }, 'Testar leitura');
  return h('div', { class: 'field' }, status, h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, who, go));
}
function settingsDiag() {
  if (S.diag === undefined) { S.diag = null; api('/api/pasta?r=diagcfg').then((v) => { S.diag = v; }).catch(() => { S.diag = false; }).finally(() => { if (S.view === 'ajustes') render(); }); }
  const head = h('div', { class: 'page-head', style: 'margin-top:12px' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Atrair clientes'), h('h2', { style: 'font-size:22px' }, 'Diagnóstico grátis')));
  if (!S.diag) return [head, h('p', { class: 'muted' }, S.diag === false ? 'Indisponível agora.' : 'Carregando…')];
  const D = S.diag;
  const en = h('input', { type: 'checkbox', checked: D.enabled });
  const wa = h('input', { id: 'dg-wa', type: 'tel', value: D.whatsapp ? D.whatsapp.replace(/^55/, '') : '', placeholder: '65 99999-9999' });
  const hl = h('input', { id: 'dg-hl', value: D.headline });
  const cta = h('input', { id: 'dg-cta', value: D.cta });
  const connected = S.clients.filter((c) => c.ig_connected);
  const acc = h('select', { id: 'dg-acc' }, h('option', { value: '' }, '— sem consulta de dados (só as respostas) —'), ...connected.map((c) => h('option', { value: c.id, selected: D.lookup_client_id === c.id }, `@${c.ig_username || c.name}`)));
  return [head, h('article', { class: 'card' },
    h('span', { class: 'muted', style: 'font-size:13.5px' }, 'Uma página pública onde a pessoa coloca o @ e recebe na hora uma análise do perfil feita pela IA (nota, o que está bom e 3 ações). Para ver, ela deixa nome e WhatsApp, e vira lead em Vendas, com aviso no seu celular. Coloque o link na bio, nos Stories e nos anúncios.'),
    h('div', { class: 'linkbox' }, h('code', { translate: 'no' }, diagUrl()), h('button', { class: 'btn sm', onclick: () => copyText(diagUrl(), 'Link copiado.') }, 'Copiar')),
    S.setup?.ai_ready ? null : h('div', { class: 'errorbox' }, S.setup?.app_url && !S.setup.app_url.endsWith(location.host)
      ? `Você está num endereço de teste (${location.host}), onde a IA não está ligada. O diagnóstico oficial em ${S.setup.app_url.replace(/^https?:\/\//, '')} não é afetado. Para ligar aqui também: Vercel → Settings → Environment Variables → ANTHROPIC_API_KEY → marque "Preview".`
      : 'Precisa da IA ligada (ANTHROPIC_API_KEY na Vercel). Sem ela, a página do diagnóstico fica fechada. Cada diagnóstico custa centavos de IA.'),
    h('label', { class: 'toggle' }, en, h('span', {}, 'Página do diagnóstico aberta')),
    h('div', { class: 'grid-2 tight' }, h('div', { class: 'field' }, h('label', { for: 'dg-wa' }, 'Seu WhatsApp (botão "Quero ajuda")'), wa), h('div', { class: 'field' }, h('label', { for: 'dg-cta' }, 'Texto do botão'), cta)),
    h('div', { class: 'field' }, h('label', { for: 'dg-hl' }, 'Título da página'), hl),
    h('div', { class: 'field' }, h('label', { for: 'dg-acc' }, 'Perfil usado para ler os dados públicos'), acc,
      h('span', { class: 'hint' }, 'Com um perfil conectado (o ideal é o da própria MC Digital), o app tenta ler seguidores, frequência e engajamento reais do @ informado. Se a Meta não liberar essa leitura, o diagnóstico usa só as respostas, sem avisar a pessoa.')),
    diagLookupBox(D),
    h('button', { class: 'btn primary sm', style: 'justify-self:start', onclick: async (e) => {
      e.target.disabled = true;
      try { S.diag = await api('/api/pasta?r=diagcfg', { method: 'PUT', body: { enabled: en.checked, whatsapp: wa.value, headline: hl.value, cta: cta.value, lookup_client_id: acc.value } }); toast('Diagnóstico salvo.'); render(); }
      catch (err) { toast(err.message, true); e.target.disabled = false; }
    } }, 'Salvar'))];
}

export { PROP_LABEL, viewProposals, DEFAULT_ITEMS, openProposal, STAGES, SRC_LABEL, diagUrl, daysTo, leadMessage, viewSales, leadCard, openLead, settingsPrivacy, diagLookupBox, settingsDiag };
