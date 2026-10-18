// MC DIGITAL — pasta do cliente: contrato, financeiro, marca, banco de mídia, modelos, pedidos e onboarding.
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
import { openPix } from './ajustes.js';
import { shiftMonth } from './calendario.js';
import { S, can, clientById, clientName, confirmButton, deliveryLine, drawer, render } from './core.js';
import { openPost } from './post.js';

// ───────────────────────── pasta privada do cliente (contrato, financeiro, relatórios)
const FOLDER_TABS = [['contract', 'Contrato'], ['finance', 'Financeiro'], ['report', 'Relatórios'], ['history', 'Aprovações'], ['requests', 'Pedidos'], ['brand', 'Marca'], ['media', 'Banco de mídia'], ['snippets', 'Modelos'], ['other', 'Outros']];
const TEAM_TABS = ['requests', 'brand', 'media', 'snippets'];
// seções da pasta que a pessoa pode abrir
function folderTabsFor() {
  if (can('financeiro')) return FOLDER_TABS.map(([k]) => k);
  const out = [];
  if (can('relatorios')) out.push('report', 'history');
  if (can('marca')) out.push('requests', 'brand', 'media', 'snippets');
  else if (can('conteudo')) out.push('media', 'snippets');
  return FOLDER_TABS.map(([k]) => k).filter((k) => out.includes(k));
}
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.csv,.txt';
const todayLocal = () => partsInTz(new Date().toISOString(), S.tz).date;
const nextMonth = (m) => shiftMonth(m, 1);

// Situação de cada mês (com parcelas) — mesma regra do servidor e da área do cliente (/billing.js)
const billingMonths = (c) => billingMonthsShared(c, S.payments.filter((p) => p.client_id === c.id), todayLocal());
const lateCount = (c) => billingMonths(c).filter((m) => m.status === 'late').length;
const PAY_LABEL = { paid: ['Pago', 'st-approved'], waived: ['Isento', 'st-draft'], open: ['Em aberto', 'st-pending_approval'], late: ['Atrasado', 'st-failed'] };

async function loadFolder(id) {
  if (!can('financeiro')) { // equipe: só as seções liberadas
    try {
      const [files, reports] = await Promise.all([api(`/api/pasta?r=files&client=${id}`).catch(() => []), can('relatorios') ? api(`/api/pasta?r=reports&client=${id}`).catch(() => null) : null]);
      Object.assign(S.folder, { files, reports, error: null });
    } catch (e) { S.folder.error = e.message; }
    S.folder.loading = false; if (!folderTabsFor().includes(S.folder.tab)) S.folder.tab = folderTabsFor()[0] || 'requests';
    if (S.view === 'pasta' && S.folderId === id) render();
    return;
  }
  try {
    const [files, payments, preview, reports] = await Promise.all([
      api(`/api/pasta?r=files&client=${id}`), api('/api/pasta?r=payments'), api(`/api/pasta?r=contract&client=${id}`),
      api(`/api/pasta?r=reports&client=${id}`).catch(() => null)]); // null = falta a atualização 4 do banco
    Object.assign(S.folder, { files, preview, reports, loading: false, error: null }); S.payments = payments;
  } catch (e) {
    Object.assign(S.folder, { loading: false, error: e.message });
  }
  if (S.view === 'pasta' && S.folderId === id) render();
}

function viewFolder() {
  const c = clientById(S.folderId);
  if (!c) return [h('div', { class: 'empty' }, h('h3', {}, 'Cliente não encontrado'), h('a', { class: 'btn', href: '#clientes' }, 'Voltar para Clientes'))];
  const F = S.folder;
  if (F.id !== c.id) { Object.assign(F, { id: c.id, files: [], preview: null, loading: true, error: null }); loadFolder(c.id); }
  const count = (cat) => F.files.filter((f) => f.category === cat).length;
  const late = lateCount(c);
  const head = h('div', { class: 'page-head' },
    h('div', {}, h('a', { class: 'eyebrow back', href: '#clientes' }, '← Clientes'), h('h1', {}, c.name)),
    h('div', { class: 'spacer' }),
    h('div', { class: 'actions' },
      h('span', { class: 'lock', title: 'Os arquivos ficam num cofre privado. Cada link abre por 2 minutos e só com você logado.' }, can('financeiro') ? '🔒 Pasta privada' : '🔒 Pasta do cliente'),
      can('financeiro') ? h('button', { class: `btn sm${c.portal_url ? '' : ' primary'}`, onclick: () => openPortal(c) }, c.portal_url ? '🔗 Link do cliente' : '🔗 Criar link do cliente') : null));
  const tabs = h('div', { class: 'seg folder-tabs', role: 'group', 'aria-label': 'Seções da pasta' },
    ...FOLDER_TABS.filter(([k]) => folderTabsFor().includes(k)).map(([k, l]) => {
      const n = k === 'finance' ? late : k === 'report' ? count('report') + (F.reports?.length || 0)
        : k === 'requests' ? (S.requests || []).filter((r) => r.client_id === c.id && r.status !== 'done').length
        : ['history', 'brand', 'media', 'snippets'].includes(k) ? 0 : count(k);
      return h('button', { class: 'seg-btn', 'aria-pressed': String(F.tab === k), onclick: () => { F.tab = k; render(); } },
        l, n ? h('span', { class: `seg-n${k === 'finance' || k === 'requests' ? ' bad' : ''}` }, String(n)) : null);
    }));
  if (F.loading) return [head, tabs, h('p', { class: 'muted' }, 'Abrindo a pasta…')];
  if (F.error) {
    const needsDb = S.setup?.migration_sql || /client_files|payments|relation|schema cache|bucket/i.test(F.error);
    return [head, h('article', { class: 'card', style: 'border-color:var(--s-wait)' },
      h('h3', {}, needsDb ? 'A pasta precisa da atualização do banco' : 'Não consegui abrir a pasta'),
      h('span', { class: 'muted' }, needsDb ? 'Rode o comando de atualização que aparece em Ajustes (1 segundo, não apaga nada) e volte aqui.' : F.error),
      h('div', { class: 'actions' }, needsDb ? h('a', { class: 'btn primary sm', href: '#ajustes' }, 'Ir para Ajustes') : null,
        h('button', { class: 'btn sm', onclick: () => { F.id = null; render(); } }, 'Tentar de novo')))];
  }
  const body = { contract: folderContract, finance: folderFinance, report: folderReports, other: folderOther, history: folderHistory, brand: folderBrand, requests: folderRequests, media: folderMedia, snippets: folderSnippets }[F.tab](c);
  return [head, deliveryLine(c.id, { big: true }), tabs, ...body];
}

// ── Contrato
function folderContract(c) {
  const P = S.folder.preview || {};
  const k = c.contract_data || {};
  const dd = (v) => (v ? h('dd', {}, v) : h('dd', {}, h('span', { class: 'muted' }, '—')));
  return [
    h('div', { class: 'grid-2' },
      h('article', { class: 'card' },
        h('div', { class: 'eyebrow' }, 'Contrato gerado'),
        h('h3', {}, 'Contrato de prestação de serviços'),
        P.template_is_default ? h('div', { class: 'banner', style: 'font-size:13.5px' }, 'Usando o modelo provisório. Cole o seu modelo em ', h('a', { href: '#ajustes' }, 'Ajustes → Modelo de contrato'), '.') : null,
        P.missing?.length
          ? h('div', { class: 'feedback' }, h('b', {}, `Faltam ${P.missing.length} dado(s) — vão aparecer marcados no contrato:`), h('span', { style: 'font-size:13.5px' }, P.missing.join(' · ')))
          : h('span', { class: 'ig-ok' }, '✓ Todos os dados preenchidos'),
        h('div', { class: 'actions' },
          h('a', { class: 'btn primary', href: `/contrato?client=${c.id}`, target: '_blank', rel: 'noopener' }, 'Gerar PDF do contrato'),
          h('button', { class: 'btn', onclick: () => openContractData(c) }, 'Editar dados')),
        h('span', { class: 'hint muted', style: 'font-size:12.5px' }, 'Abre o contrato pronto. Clique em "Salvar PDF", mande para o cliente assinar (gov.br, Clicksign, D4Sign…) e envie a versão assinada aqui embaixo.')),
      h('article', { class: 'card' },
        h('div', { class: 'eyebrow' }, 'Dados do contrato'),
        h('dl', { class: 'kv' },
          h('dt', {}, 'Contratante'), dd(k.nome || c.name),
          h('dt', {}, 'CPF/CNPJ'), dd(k.documento),
          h('dt', {}, 'Representante'), dd(k.representante),
          h('dt', {}, 'Mensalidade'), dd(c.monthly_fee_cents != null ? `${brl(c.monthly_fee_cents)}${c.due_day ? ` · vence dia ${c.due_day}` : ''}` : ''),
          h('dt', {}, 'Início'), dd(c.billing_start ? fmtDay(c.billing_start) : ''),
          h('dt', {}, 'Prazo'), dd(k.prazo_meses ? `${k.prazo_meses} meses` : '')),
        h('button', { class: 'btn sm', style: 'justify-self:start', onclick: () => openContractData(c) }, 'Editar dados'))),
    filesSection(c, 'contract', 'Contratos assinados e aditivos', 'Envie aqui o PDF assinado pelo cliente.'),
  ];
}
const fmtDay = (iso) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };

function openContractData(c) {
  const k = c.contract_data || {};
  const inp = (id, label, value, attrs = {}, hint) => {
    const el = h(attrs.tag || 'input', { id, value: value ?? '', ...attrs, tag: null });
    if (attrs.tag === 'textarea') el.value = value ?? '';
    return [el, h('div', { class: 'field' }, h('label', { for: id }, label), el, hint ? h('span', { class: 'hint' }, hint) : null)];
  };
  const [nome, fNome] = inp('k-nome', 'Nome ou razão social do contratante', k.nome || c.name);
  const [doc, fDoc] = inp('k-doc', 'CPF ou CNPJ', k.documento, { placeholder: '00.000.000/0001-00' });
  const [end, fEnd] = inp('k-end', 'Endereço completo', k.endereco, { placeholder: 'Rua, número, bairro, cidade/UF, CEP' });
  const [rep, fRep] = inp('k-rep', 'Representante (quem assina)', k.representante, { placeholder: 'Nome completo' });
  const [repCpf, fRepCpf] = inp('k-repcpf', 'CPF do representante', k.representante_cpf, { placeholder: '000.000.000-00' });
  const [qp, fQp] = inp('k-qp', 'Posts de feed por mês (foto + carrossel)', k.quota_posts, { type: 'number', min: 0, max: 999, placeholder: '8' });
  const [qr, fQr] = inp('k-qr', 'Reels por mês', k.quota_reels, { type: 'number', min: 0, max: 999, placeholder: '4' });
  const [qs, fQs] = inp('k-qs', 'Stories por mês (opcional)', k.quota_stories, { type: 'number', min: 0, max: 999, placeholder: '—' });
  const [entr, fEntr] = inp('k-entr', 'Entregas mensais (só sem cota)', k.entregas, { placeholder: 'o contrato usa a cota abaixo: 8 (oito) posts estáticos e 4 (quatro) Reels' });
  const [total, fTotal] = inp('k-total', 'Total de conteúdos/mês (só sem cota)', k.total_conteudos, { type: 'number', min: 1, max: 999, placeholder: 'soma da cota' });
  const [serv, fServ] = inp('k-serv', 'Serviços contratados (opcional)', k.servicos, { tag: 'textarea', style: 'min-height:80px', placeholder: 'Só se o seu modelo usar o campo "Serviços contratados".' });
  const [fee0, fFee] = inp('k-fee', 'Valor mensal (R$)', c.monthly_fee_cents != null ? (c.monthly_fee_cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '', { inputmode: 'decimal', placeholder: '1.500,00' });
  const [due, fDue] = inp('k-due', 'Dia do vencimento', c.due_day, { type: 'number', min: 1, max: 31, placeholder: '10' });
  const [start, fStart] = inp('k-start', 'Início do contrato', c.billing_start, { type: 'date' }, 'A cobrança mensal começa neste mês.');
  // Parcelas da mensalidade (ex.: 3 parcelas nos dias 4, 14 e 24)
  const centsOf = (v) => Math.round(Number(String(v || '').replace(/[R$\s]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')) * 100);
  const reais = (cts) => (cts / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
  let parts = Array.isArray(c.installments) && c.installments.length > 1 ? c.installments.map((x) => ({ ...x })) : [];
  const nSel = h('select', { id: 'k-nparc', 'aria-label': 'Parcelas por mês' }, ...[1, 2, 3, 4].map((n) => h('option', { value: n, selected: (parts.length || 1) === n }, n === 1 ? '1 (à vista)' : `${n} parcelas`)));
  const partsBox = h('div', { class: 'parts' });
  const drawParts = () => {
    const n = Number(nSel.value);
    if (n === 1) { parts = []; partsBox.replaceChildren(); due.disabled = false; return; }
    due.disabled = true;
    const fee = centsOf(fee0.value) || 0;
    if (parts.length !== n) {
      const split = splitCents(fee, n), days = [Number(due.value) || 5, 15, 25, 28].slice(0, n);
      parts = split.map((cents, i) => ({ day: parts[i]?.day || (n === 3 ? [4, 14, 24][i] : days[i] || 10 + i * 10), cents }));
    }
    partsBox.replaceChildren(...parts.map((pt, i) => h('div', { class: 'part-row' },
      h('span', { class: 'muted' }, `${i + 1}ª`),
      h('label', {}, 'dia ', h('input', { type: 'number', min: 1, max: 31, value: pt.day, oninput: (e) => { pt.day = Number(e.target.value); } })),
      h('label', {}, 'R$ ', h('input', { inputmode: 'decimal', value: reais(pt.cents), onchange: (e) => { pt.cents = centsOf(e.target.value); check(); } })))),
      sumNote);
    check();
  };
  const sumNote = h('span', { class: 'hint' });
  const check = () => {
    const sum = parts.reduce((a, b) => a + (b.cents || 0), 0), fee = centsOf(fee0.value) || 0;
    sumNote.textContent = sum === fee ? `Soma ${brl(sum)} ✓` : `Atenção: as parcelas somam ${brl(sum)}, a mensalidade é ${brl(fee)}.`;
    sumNote.style.color = sum === fee ? '' : 'var(--s-fail)';
  };
  nSel.addEventListener('change', () => { parts = []; drawParts(); });
  const fParts = h('div', { class: 'field' }, h('label', { for: 'k-nparc' }, 'Como o cliente paga a mensalidade'), nSel, partsBox,
    h('span', { class: 'hint' }, 'Com parcelas, cada uma aparece no Financeiro com vencimento, status e comprovante próprios.'));
  const [retro, fRetro] = inp('k-retro', 'Substitui um contrato anterior? Início do serviço (opcional)', k.retroativo, { type: 'date' }, 'Preencha só se este contrato substitui outro: entram as cláusulas de retroatividade e de substituição.');
  const [prazo, fPrazo] = inp('k-prazo', 'Prazo (meses, opcional)', k.prazo_meses, { type: 'number', min: 1, max: 120, placeholder: 'vazio = indeterminado' });
  const [forma, fForma] = inp('k-forma', 'Forma de pagamento (opcional)', k.forma_pagamento, { tag: 'textarea', style: 'min-height:70px', placeholder: 'Pix' },
    'Escreva só o meio (Pix, boleto): o contrato monta "Via Pix, em 3 (três) parcelas mensais: R$ … no dia 4; …" com as parcelas acima. Uma frase com valores e dias substitui esse texto.');
  const close = drawer(`Dados do contrato · ${c.name}`, [
    h('div', { class: 'eyebrow' }, 'Contratante'), fNome, fDoc, fEnd, h('div', { class: 'grid-2 tight' }, fRep, fRepCpf),
    h('div', { class: 'eyebrow' }, 'Serviço e cobrança'), h('div', { class: 'grid-2 tight' }, fEntr, fTotal), fServ,
    h('div', { class: 'grid-2 tight' }, fFee, fDue), fParts, h('div', { class: 'grid-2 tight' }, fStart, fPrazo), fRetro, fForma,
    h('div', { class: 'eyebrow' }, 'Cota mensal (contador de entregas)'), h('div', { class: 'grid-2 tight' }, fQp, fQr), fQs,
  ], [h('span', { class: 'spacer' }), h('button', { class: 'btn primary', onclick: async (e) => {
    e.target.disabled = true;
    try {
      const saved = await api(`/api/clients?id=${c.id}`, { method: 'PATCH', body: {
        monthly_fee: fee0.value, due_day: due.value, billing_start: start.value, installments: parts.length > 1 ? parts : (c.installments ? [] : undefined),
        contract_data: { nome: nome.value, documento: doc.value, endereco: end.value, representante: rep.value, representante_cpf: repCpf.value, entregas: entr.value, total_conteudos: total.value, quota_posts: qp.value, quota_reels: qr.value, quota_stories: qs.value, servicos: serv.value, prazo_meses: prazo.value, forma_pagamento: forma.value, retroativo: retro.value },
      } });
      const i = S.clients.findIndex((x) => x.id === saved.id); if (i >= 0) S.clients[i] = saved;
      close(); toast('Dados do contrato salvos.');
      S.folder.preview = await api(`/api/pasta?r=contract&client=${c.id}`).catch(() => S.folder.preview);
      render();
    } catch (err) { toast(err.message, true); e.target.disabled = false; }
  } }, 'Salvar')]);
  drawParts(); fee0.addEventListener('change', () => { if (parts.length) { parts = []; drawParts(); } });
  nome.focus();
}

// ── Financeiro
function folderFinance(c) {
  if (!c.billing_start || c.monthly_fee_cents == null) {
    return [h('div', { class: 'empty' }, h('h3', {}, 'Defina a mensalidade'),
      h('p', { class: 'muted' }, 'Informe o valor, as parcelas/vencimento e o início do contrato. A partir daí cada mês aparece aqui como pago, em aberto ou atrasado.'),
      h('button', { class: 'btn primary', onclick: () => openContractData(c) }, 'Preencher dados'))];
  }
  ensureSettings();
  const months = billingMonths(c);
  const lateCents = months.reduce((s, m) => s + m.late_cents, 0);
  const lateParcels = months.flatMap((m) => m.parcels).filter((p) => p.status === 'late').length;
  const year = todayLocal().slice(0, 4);
  const paidYear = months.filter((m) => m.month.startsWith(year)).flatMap((m) => m.parcels).filter((p) => p.status === 'paid').reduce((s, p) => s + (p.cents || 0), 0);
  const plan = planOf(c);
  const fileName = (id) => S.folder.files.find((f) => f.id === id)?.name;
  const soon = new Set(dueSoon(months, todayLocal()).map((p) => `${p.month}#${p.n}`));
  const parcelChip = (m, p) => {
    const [label, cls] = PAY_LABEL[p.status];
    const pay = p.payment;
    return h('div', { class: `parcel${p.status === 'late' ? ' is-late' : ''}` },
      h('div', { class: 'parcel-top' },
        h('b', {}, p.of > 1 ? `${p.n}ª parcela` : 'Mensalidade'),
        h('span', { class: `pill ${cls}` }, label)),
      h('div', { class: 'muted parcel-sub' }, p.status === 'paid' ? `Pago${pay?.paid_at ? ` em ${fmtDay(pay.paid_at)}` : ''} · ${brl(p.cents)}`
        : p.status === 'waived' ? (pay?.note || 'Isento') : `Vence ${fmtDay(p.due)} · ${brl(p.cents)}`),
      h('div', { class: 'parcel-act' },
        pay?.file_id && fileName(pay.file_id) ? h('a', { class: 'btn ghost sm', href: `/api/pasta?r=files&id=${pay.file_id}&open=1`, target: '_blank', rel: 'noopener', title: fileName(pay.file_id) }, '📎')
          : pay?.receipt_url ? h('a', { class: 'btn ghost sm', href: pay.receipt_url, target: '_blank', rel: 'noopener', title: 'Comprovante do Pix' }, '📎') : null,
        S.setup?.asaas && ['open', 'late'].includes(p.status) ? h('button', { class: 'btn ghost sm', title: 'Gerar Pix com baixa automática', onclick: () => openPix(c, m, p) }, pay?.asaas_id ? 'Pix ✓' : 'Pix') : null,
        pay?.nf_status === 'authorized' ? h('a', { class: 'btn ghost sm', href: pay.nf_url || '#', target: '_blank', rel: 'noopener', title: 'Nota fiscal emitida' }, '🧾 NF')
          : pay?.nf_status === 'scheduled' ? h('span', { class: 'pill st-internal_review', title: 'A nota sai assim que a prefeitura autorizar' }, 'NF agendada')
          : p.status === 'paid' && pay?.asaas_id && S.setup?.asaas ? h('button', { class: `btn ${pay?.nf_status === 'error' ? 'danger ' : 'ghost '}sm`, title: pay?.nf_status === 'error' ? 'A prefeitura recusou: confira em Notas fiscais no Asaas e tente de novo' : 'Emitir nota fiscal desta parcela', onclick: async (e) => {
            e.target.disabled = true;
            try { await api('/api/pasta?r=nf', { method: 'POST', body: { client_id: c.id, month: m.month, n: p.n } }); pay.nf_status = 'scheduled'; toast('Nota fiscal enviada para emissão. O PDF chega na pasta quando a prefeitura autorizar.'); render(); }
            catch (err) { toast(err.message, true); e.target.disabled = false; }
          } }, pay?.nf_status === 'error' ? 'NF: tentar de novo' : 'Emitir NF') : null,
        soon.has(`${m.month}#${p.n}`) ? chargeButton(c, m, p) : null,
        h('button', { class: `btn sm${p.status === 'late' ? ' primary' : ''}`, onclick: () => openPayment(c, m, p) }, p.status === 'paid' || p.status === 'waived' ? 'Editar' : 'Registrar')));
  };
  return [
    h('div', { class: 'stats' },
      stat('Mensalidade', brl(c.monthly_fee_cents), plan.length > 1 ? `${plan.length} parcelas: dias ${plan.map((x) => x.day).join(', ')}` : c.due_day ? `vence todo dia ${c.due_day}` : 'vence no fim do mês'),
      stat('Em atraso', lateCents ? brl(lateCents) : 'Nada', lateParcels ? `${lateParcels} parcela(s)` : 'tudo em dia', lateCents ? 'bad' : 'good'),
      stat(`Recebido em ${year}`, brl(paidYear), 'pela marcação de pagos')),
    bulkOld(c, months),
    h('div', { class: 'months' }, ...months.map((m) => {
      const [label, cls] = PAY_LABEL[m.status];
      return h('div', { class: `month-block${m.status === 'late' ? ' is-late' : ''}` },
        h('div', { class: 'month-head' },
          h('div', { class: 'month-name' }, monthLabel(m.month)),
          h('span', { class: `pill ${cls}` }, label),
          h('span', { class: 'muted', style: 'font-size:13px' }, m.parcels.length > 1 ? `${m.paid_count}/${m.parcels.length} pagas · ${brl(m.amount_cents)}` : brl(m.amount_cents))),
        h('div', { class: `parcels n${m.parcels.length}` }, ...m.parcels.map((p) => parcelChip(m, p))));
    })),
    filesSection(c, 'receipt', 'Todos os comprovantes', 'Comprovantes enviados ao registrar pagamentos aparecem aqui. Também dá para enviar direto.', { month: true }),
    filesSection(c, 'invoice', 'Notas fiscais', 'Com a nota automática ligada (Ajustes → Pix automático), o PDF de cada nota autorizada chega aqui sozinho. O cliente também vê na área dele.', { month: true }),
  ];
}
// Cliente antigo cadastrado agora: marca de uma vez os meses anteriores como pagos.
function bulkOld(c, months) {
  const cur = todayLocal().slice(0, 7);
  const old = months.filter((m) => m.month < cur).flatMap((m) => m.parcels.filter((p) => p.status === 'late' || p.status === 'open').map((p) => ({ ref_month: m.month, installment: p.n, amount_cents: p.cents })));
  if (old.length < 3) return null;
  return h('div', { class: 'banner', style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' },
    h('span', { style: 'flex:1;min-width:220px' }, `${old.length} parcelas antigas (antes de ${monthLabel(cur).toLowerCase()}) estão em aberto. Se o cliente já é antigo e pagou tudo, marque de uma vez.`),
    confirmButton('Marcar anteriores como pagas', `Confirmar: ${old.length} parcelas`, async () => {
      const rows = await api('/api/pasta?r=payments', { method: 'PUT', body: { client_id: c.id, status: 'paid', items: old, note: 'marcado em lote' } });
      const key = (x) => `${x.client_id}#${x.ref_month}#${x.installment || 1}`;
      const keys = new Set(rows.map(key));
      S.payments = S.payments.filter((x) => !keys.has(key(x))).concat(rows);
      render(); toast(`${rows.length} parcelas marcadas como pagas.`);
    }, 'btn sm'));
}
const stat = (label, value, sub, tone = '') => h('div', { class: `stat ${tone}` }, h('div', { class: 'eyebrow' }, label), h('div', { class: 'stat-v' }, value), h('div', { class: 'muted', style: 'font-size:13px' }, sub));

// Dados da agência (PIX para a cobrança). Carrega uma vez.
function ensureSettings() {
  if (S.settings !== undefined || !can('financeiro')) return;
  S.settings = null;
  api('/api/pasta?r=settings').then((v) => { S.settings = v; }).catch(() => { S.settings = false; }).finally(() => render());
}

// Mensagem de cobrança pronta (lembrete 2 dias antes ou aviso de atraso).
function chargeMessage(c, m, p) {
  const pix = S.settings?.agency?.pix;
  const what = p.of > 1 ? `a ${p.n}ª parcela (${brlRaw(p.cents)}) da mensalidade de ${monthLabel(m.month).toLowerCase()}` : `a mensalidade de ${monthLabel(m.month).toLowerCase()} (${brlRaw(p.cents)})`;
  const head = p.status === 'late' ? `Olá! Tudo bem? Passando para lembrar que ${what} venceu em ${fmtDay(p.due)} e ainda consta em aberto por aqui.` : `Olá! Tudo bem? Lembrete: ${what} vence em ${fmtDay(p.due)}.`;
  const auto = S.setup?.asaas && c.portal_url ? `\n\nPague com Pix por aqui (a baixa é automática): ${c.portal_url}` : pix ? `\n\nChave PIX: ${pix}` : '';
  return `${head}${auto}\n\nSe já pagou, pode desconsiderar${S.setup?.asaas ? '' : ' e, se puder, me mande o comprovante'}. Obrigado! 🙂`;
}
function chargeButton(c, m, p) {
  const msg = chargeMessage(c, m, p);
  if (c.contact_whatsapp) return h('a', { class: `btn wa sm`, href: waLink(c.contact_whatsapp, msg), target: '_blank', rel: 'noopener', title: 'Mandar lembrete de cobrança pelo WhatsApp' }, p.status === 'late' ? 'Cobrar' : 'Lembrar');
  return h('button', { class: 'btn sm', onclick: () => copyText(msg, 'Mensagem de cobrança copiada.') }, 'Copiar cobrança');
}

// Painel de cobranças: por cliente — atrasado somado + o que vence em até 2 dias.
function chargesCard() {
  if (!can('financeiro')) return null;
  ensureSettings();
  const rows = [];
  for (const c of S.clients.filter((x) => !x.own)) {
    if (!c.billing_start) continue;
    const list = dueSoon(billingMonths(c), todayLocal());
    const late = list.filter((p) => p.status === 'late'), soon = list.filter((p) => p.status !== 'late');
    if (late.length) rows.push({ c, late });
    for (const p of soon) rows.push({ c, p });
  }
  if (!rows.length) return null;
  const nLate = rows.filter((r) => r.late).length;
  const row = (r) => {
    if (r.late) {
      const total = r.late.reduce((s, p) => s + (p.cents || 0), 0);
      const msg = r.late.length === 1 ? chargeMessage(r.c, { month: r.late[0].month }, r.late[0])
        : `Olá! Tudo bem? Passando para lembrar que constam ${r.late.length} parcelas em aberto por aqui, somando ${brlRaw(total)} (a mais antiga venceu em ${fmtDay(r.late[0].due)}).${S.settings?.agency?.pix ? `\n\nChave PIX: ${S.settings.agency.pix}` : ''}\n\nSe já pagou, me mande os comprovantes que eu atualizo. Obrigado! 🙂`;
      return h('div', { class: 'charge is-late' },
        h('div', { style: 'min-width:0' }, h('b', {}, r.c.name), h('div', { class: 'muted', style: 'font-size:13px' }, `${r.late.length} parcela(s) em atraso · ${brl(total)} · desde ${fmtDay(r.late[0].due)}`)),
        h('div', { class: 'actions' },
          r.c.contact_whatsapp ? h('a', { class: 'btn wa sm', href: waLink(r.c.contact_whatsapp, msg), target: '_blank', rel: 'noopener' }, 'Cobrar') : h('button', { class: 'btn sm', onclick: () => copyText(msg, 'Mensagem copiada.') }, 'Copiar cobrança'),
          h('a', { class: 'btn ghost sm', href: `#pasta/${r.c.id}`, onclick: () => { S.folder.tab = 'finance'; } }, 'Abrir')));
    }
    const p = r.p;
    return h('div', { class: 'charge' },
      h('div', { style: 'min-width:0' }, h('b', {}, r.c.name), h('div', { class: 'muted', style: 'font-size:13px' }, `${p.of > 1 ? `${p.n}ª parcela · ` : ''}${monthLabel(p.month)} · ${brl(p.cents)} · vence ${fmtDay(p.due)}`)),
      h('div', { class: 'actions' }, chargeButton(r.c, { month: p.month }, p), h('a', { class: 'btn ghost sm', href: `#pasta/${r.c.id}`, onclick: () => { S.folder.tab = 'finance'; } }, 'Abrir')));
  };
  const list = h('div', { class: 'charge-list' }, ...rows.slice(0, 3).map(row));
  const more = rows.length > 3 ? h('button', { class: 'btn ghost sm more-row', onclick: () => { list.replaceChildren(...rows.map(row)); more.remove(); } }, `Ver todas (${rows.length})`) : null;
  return h('section', { class: 'card charges' },
    h('div', {}, h('h3', {}, 'Cobranças'),
      h('span', { class: 'muted', style: 'font-size:13.5px' }, `${nLate ? `${nLate} cliente(s) com atraso · ` : ''}${rows.length - nLate} parcela(s) vencendo em até 2 dias. Cobrar/Lembrar abre o WhatsApp com a mensagem pronta.`)),
    list, more);
}

function openPayment(c, m, parcel) {
  const p = parcel.payment;
  const n = parcel.n;
  let status = p?.status === 'waived' ? 'waived' : 'paid';
  const paidAt = h('input', { type: 'date', id: 'p-date', value: p?.paid_at || todayLocal() });
  const amount = h('input', { id: 'p-amount', inputmode: 'decimal', value: ((p?.amount_cents ?? parcel.cents ?? 0) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) });
  const note = h('input', { id: 'p-note', value: p?.note || '', placeholder: 'Ex.: pago via PIX / mês de cortesia' });
  const file = h('input', { type: 'file', id: 'p-file', accept: ACCEPT });
  const allWaive = parcel.of > 1 ? h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'p-all' }), ' Isentar todas as parcelas deste mês') : null;
  const paidFields = h('div', { style: 'display:grid;gap:14px' },
    h('div', { class: 'grid-2 tight' },
      h('div', { class: 'field' }, h('label', { for: 'p-date' }, 'Data do pagamento'), paidAt),
      h('div', { class: 'field' }, h('label', { for: 'p-amount' }, 'Valor recebido (R$)'), amount)),
    h('div', { class: 'field' }, h('label', { for: 'p-file' }, p?.file_id ? 'Trocar comprovante (opcional)' : 'Comprovante (opcional)'), file,
      h('span', { class: 'hint' }, 'PDF ou print do PIX/boleto, até 50 MB. Fica guardado na pasta do cliente.')));
  const waiveFields = h('div', {}, allWaive);
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Situação' },
    ...[['paid', 'Pago'], ['waived', 'Isento / cortesia']].map(([k, l]) => h('button', { class: 'seg-btn', type: 'button', 'aria-pressed': String(status === k),
      onclick: (e) => { status = k; for (const b of seg.children) b.setAttribute('aria-pressed', String(b === e.currentTarget)); paidFields.hidden = k !== 'paid'; waiveFields.hidden = k !== 'waived'; } }, l)));
  paidFields.hidden = status !== 'paid'; waiveFields.hidden = status !== 'waived';
  const keyOf = (x) => `${x.client_id}#${x.ref_month}#${x.installment || 1}`;
  const save = h('button', { class: 'btn primary', onclick: async () => {
    save.disabled = true;
    try {
      let fileId = p?.file_id || null;
      if (status === 'paid' && file.files[0]) {
        const up = await uploadDoc(c, file.files[0], 'receipt', m.month);
        S.folder.files.unshift(up); fileId = up.id;
      }
      const cents = Math.round(Number(amount.value.replace(/[R$\s]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')) * 100);
      if (status === 'paid' && !Number.isFinite(cents)) throw new Error('Valor inválido.');
      const targets = status === 'waived' && document.getElementById('p-all')?.checked ? m.parcels.map((x) => x.n) : [n];
      for (const k of targets) {
        const row = await api('/api/pasta?r=payments', { method: 'PUT', body: {
          client_id: c.id, ref_month: m.month, installment: k, status, note: note.value,
          ...(status === 'paid' ? { paid_at: paidAt.value || null, amount_cents: cents, file_id: fileId } : { file_id: null }),
        } });
        row.installment = row.installment || k;
        S.payments = S.payments.filter((x) => keyOf(x) !== keyOf(row)).concat(row);
      }
      const what = parcel.of > 1 && targets.length === 1 ? `${n}ª parcela de ${monthLabel(m.month).toLowerCase()}` : monthLabel(m.month);
      close(); render(); toast(status === 'paid' ? `${what} marcada como paga.` : `${what}: isento.`);
    } catch (e) { toast(e.message, true); save.disabled = false; }
  } }, 'Salvar');
  const foot = [];
  if (p) foot.push(confirmButton('Voltar para em aberto', 'Confirmar', async () => {
    await api(`/api/pasta?r=payments&client=${c.id}&month=${m.month}&n=${n}`, { method: 'DELETE' });
    S.payments = S.payments.filter((x) => !(x.client_id === c.id && x.ref_month === m.month && (x.installment || 1) === n));
    close(); render(); toast('Pagamento desfeito.');
  }, 'btn ghost'));
  foot.push(h('span', { class: 'spacer' }), save);
  const close = drawer(`${c.name} · ${monthLabel(m.month)}${parcel.of > 1 ? ` · ${n}ª parcela` : ''}`, [
    h('div', { class: 'muted', style: 'font-size:14px' }, `${parcel.of > 1 ? `Parcela ${n} de ${parcel.of}` : 'Mensalidade'}: ${brl(parcel.cents)}, vencimento em ${fmtDay(parcel.due)}.`),
    seg, paidFields, waiveFields,
    h('div', { class: 'field' }, h('label', { for: 'p-note' }, 'Observação'), note),
  ], foot);
}

// ── Relatórios e Outros
function folderReports(c) {
  return [igReports(c), filesSection(c, 'report', 'Outros relatórios (arquivos)', 'PDFs, prints ou planilhas que você queira guardar junto. Escolha o mês antes de enviar.', { month: true, group: true })];
}

// ── Relatórios do Instagram (gerados pelo app, com link em português para o cliente)
function reportMessage(c, r) {
  return `Olá! Segue o relatório de desempenho do Instagram de ${c.name} de ${monthLabel(r.ref_month).toLowerCase()}:\n${r.share_url}\n\nDá para baixar em PDF pelo botão no topo da página.`;
}
function igReports(c) {
  const F = S.folder;
  const card = (...kids) => h('section', { class: 'card' }, h('div', { class: 'files-head' },
    h('div', { style: 'flex:1;min-width:220px' }, h('h3', {}, 'Relatórios do Instagram'),
      h('span', { class: 'muted', style: 'font-size:13.5px' }, 'Alcance, curtidas, comentários, salvamentos, compartilhamentos, seguidores ganhos e os melhores posts do mês. Gerado automaticamente todo dia 3 para o mês anterior.'))), ...kids);
  if (F.reports === null) return card(h('div', { class: 'banner' }, 'Falta a atualização do banco para os relatórios. ', h('a', { href: '#ajustes' }, 'Ver em Ajustes'), '.'));
  if (!c.ig_connected) return card(h('div', { class: 'banner' }, 'Conecte o Instagram deste cliente para gerar relatórios. ', h('a', { href: `/api/ig/connect?client=${c.id}` }, 'Conectar agora')));
  const month = h('input', { type: 'month', class: 'month-in', value: shiftMonth(todayLocal().slice(0, 7), -1), max: todayLocal().slice(0, 7), 'aria-label': 'Mês do relatório' });
  const err = h('div');
  const gen = h('button', { class: 'btn primary sm', onclick: () => generate(month.value, gen) }, 'Gerar relatório');
  async function generate(m, btn) {
    if (!m) return toast('Escolha o mês.', true);
    const label = btn.textContent; btn.disabled = true; btn.textContent = 'Lendo o Instagram…'; err.replaceChildren();
    try {
      const r = await api('/api/pasta?r=reports', { method: 'POST', body: { client_id: c.id, ref_month: m } });
      F.reports = [r, ...(F.reports || []).filter((x) => x.id !== r.id)].sort((a, b) => b.ref_month.localeCompare(a.ref_month));
      render(); toast(`Relatório de ${monthLabel(m).toLowerCase()} pronto.`);
    } catch (e) {
      btn.disabled = false; btn.textContent = label;
      err.replaceChildren(h('div', { class: 'errorbox' }, h('b', {}, 'Não deu para gerar: '), e.message,
        e.status === 409 ? h('div', { style: 'margin-top:8px' }, h('a', { class: 'btn primary sm', href: `/api/ig/connect?client=${c.id}` }, 'Reconectar Instagram')) : null));
    }
  }
  const metric = (label, v, suffix = '') => h('div', { class: 'rmetric' }, h('b', {}, v == null ? '—' : `${v.toLocaleString('pt-BR')}${suffix}`), h('span', {}, label));
  const rows = (F.reports || []).map((r) => {
    const s = r.summary;
    return h('article', { class: 'report-row' },
      h('div', { class: 'report-top' },
        h('div', { style: 'min-width:0' }, h('div', { class: 'month-name' }, monthLabel(r.ref_month)),
          h('div', { class: 'muted', style: 'font-size:12.5px' }, `${r.partial ? 'Parcial · ' : ''}atualizado em ${fmtDay(partsInTz(r.updated_at, S.tz).date)}`)),
        h('div', { class: 'actions' },
          h('a', { class: 'btn primary sm', href: r.share_url, target: '_blank', rel: 'noopener' }, 'Abrir'),
          h('button', { class: 'btn sm', onclick: () => copyText(r.share_url, 'Link do relatório copiado.') }, 'Copiar link'),
          c.contact_whatsapp ? h('a', { class: 'btn wa sm', href: waLink(c.contact_whatsapp, reportMessage(c, r)), target: '_blank', rel: 'noopener' }, 'WhatsApp') : null,
          c.contact_email ? h('a', { class: 'btn sm', href: mailLink(c.contact_email, `Relatório de ${monthLabel(r.ref_month).toLowerCase()} · ${c.name}`, reportMessage(c, r)) }, 'E-mail') : null)),
      h('div', { class: 'rmetrics' },
        metric('alcance', s.reach), metric('curtidas', s.likes), metric('comentários', s.comments), metric('salvamentos', s.saves),
        metric('seguidores ganhos', s.followers_gained), metric('posts', s.posts), metric('engajamento', s.engagement, '%')),
      h('div', { class: 'actions' },
        h('button', { class: 'btn ghost sm', onclick: () => openReportNote(c, r) }, '✎ Próximos passos e comentário'),
        h('button', { class: 'btn ghost sm', onclick: (e) => generate(r.ref_month, e.currentTarget) }, '↻ Atualizar números'),
        confirmButton('Apagar', 'Confirmar: o link para de abrir', async () => {
          await api(`/api/pasta?r=reports&id=${r.id}`, { method: 'DELETE' });
          F.reports = F.reports.filter((x) => x.id !== r.id); render(); toast('Relatório apagado.');
        }, 'btn ghost sm danger')));
  });
  return card(h('div', { class: 'files-head' }, h('span', { class: 'muted', style: 'font-size:13.5px;flex:1' }, 'Gerar agora (o mês atual sai parcial):'), month, gen), err,
    rows.length ? h('div', { class: 'reports' }, ...rows) : h('p', { class: 'muted files-empty' }, 'Nenhum relatório ainda. Escolha o mês e clique em Gerar relatório.'));
}

function openReportNote(c, r) {
  const steps = h('textarea', { id: 'r-steps', style: 'min-height:200px', placeholder: 'Um passo por linha' });
  steps.value = (r.next_steps || []).join('\n\n');
  const auto = (r.next_steps_auto || []).join('\n\n');
  const ta = h('textarea', { id: 'r-note', style: 'min-height:140px', placeholder: 'Ex.: Setembro teve o melhor alcance do ano, puxado pelo carrossel de frases.' });
  ta.value = r.note || '';
  const bt = r.best_times?.slots?.length ? h('div', { class: 'card', style: 'gap:6px;padding:12px' }, h('b', {}, 'Melhores horários (aparecem no relatório)'),
    h('span', {}, r.best_times.slots.map((s) => s.label).join(' · ')),
    h('span', { class: 'hint' }, r.best_times.source === 'perfil' ? `Calculado com ${r.best_times.based_on} posts dos últimos 4 meses.` : 'Poucos posts ainda: sugestão inicial para testar.')) : null;
  const close = drawer(`Relatório · ${monthLabel(r.ref_month)}`, [
    bt,
    h('div', { class: 'field' }, h('label', { for: 'r-steps' }, 'Próximos passos'), steps,
      h('span', { class: 'hint' }, r.next_steps_edited ? 'Escrito pela agência. Separe um passo do outro com uma linha em branco.' : 'Sugestão automática, tirada dos números do mês. Edite à vontade antes de mandar (um passo por parágrafo).'),
      auto ? h('button', { type: 'button', class: 'btn ghost sm', style: 'justify-self:start', onclick: () => { steps.value = auto; } }, '↺ Voltar para a sugestão automática') : null),
    h('div', { class: 'field' }, h('label', { for: 'r-note' }, 'Comentários da agência (opcional)'), ta,
      h('span', { class: 'hint' }, 'Análise do mês e destaques. Deixe em branco para não mostrar.'))],
  [h('span', { class: 'spacer' }), h('button', { class: 'btn primary', onclick: async () => {
    try {
      const list = steps.value.split(/\n\s*\n|\n(?=\s*[-•\d]+[.)]?\s)/).map((x) => x.replace(/^\s*[-•]\s*/, '').trim()).filter(Boolean);
      const same = list.join('\n\n') === auto;
      const saved = await api('/api/pasta?r=reports', { method: 'PATCH', body: { id: r.id, note: ta.value, next_steps: same ? null : list } });
      S.folder.reports = S.folder.reports.map((x) => (x.id === saved.id ? saved : x)); close(); render(); toast('Relatório atualizado.');
    } catch (e) { toast(e.message, true); }
  } }, 'Salvar')]);
  steps.focus();
}
function folderOther(c) {
  return [filesSection(c, 'other', 'Outros documentos', 'Briefing, manual de marca, notas fiscais, propostas, acessos documentados…')];
}

async function uploadDoc(c, file, category, refMonth) {
  const qs = new URLSearchParams({ client: c.id, category });
  if (refMonth) qs.set('ref_month', refMonth);
  if (file.size <= 4 * 1024 * 1024) return api(`/api/pasta?r=files&${qs}`, { method: 'POST', raw: file, headers: { 'x-file-name': encodeURIComponent(file.name) } });
  // acima de 4 MB (até 50 MB): o navegador envia direto ao armazenamento e depois registra na pasta
  if (file.size > 50 * 1024 * 1024) throw new Error(`"${file.name}" tem mais de 50 MB. Comprima e tente de novo.`);
  const sig = await api(`/api/pasta?r=files&${qs}&big=1`, { method: 'POST', body: { name: file.name, size: file.size } });
  await new Promise((ok, bad) => {
    const x = new XMLHttpRequest();
    x.open('PUT', sig.upload_url);
    x.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    x.setRequestHeader('x-upsert', 'false');
    x.upload.onprogress = (e) => { if (e.lengthComputable) toast(`Enviando "${file.name}"… ${Math.round((e.loaded / e.total) * 100)}%`); };
    x.onload = () => (x.status < 300 ? ok() : bad(new Error(x.status === 413 ? 'Arquivo grande demais para o armazenamento (máx. 50 MB).' : `Falha ao enviar o arquivo (${x.status}).`)));
    x.onerror = () => bad(new Error('Sem conexão ao enviar o arquivo.'));
    x.send(file);
  });
  return api(`/api/pasta?r=files&${qs}&confirm=1`, { method: 'POST', body: { path: sig.path, name: file.name, size: file.size } });
}

const FILE_ICON = (f) => (f.mime === 'application/pdf' ? 'PDF' : f.mime.startsWith('image/') ? 'IMG' : /sheet|excel|csv/.test(f.mime) ? 'XLS' : /word/.test(f.mime) ? 'DOC' : 'TXT');

function filesSection(c, category, title, hint, { month = false, group = false } = {}) {
  const list = S.folder.files.filter((f) => f.category === category);
  const monthInput = month ? h('input', { type: 'month', value: todayLocal().slice(0, 7), 'aria-label': 'Mês de referência', class: 'month-in' }) : null;
  const status = h('span', { class: 'muted', style: 'font-size:13px' });
  const input = h('input', { type: 'file', accept: ACCEPT, multiple: true, hidden: true, onchange: () => send([...input.files]) });
  async function send(files) {
    if (!files.length) return;
    let ok = 0;
    for (const [i, f] of files.entries()) {
      status.textContent = `Enviando ${i + 1} de ${files.length}…`;
      try { S.folder.files.unshift(await uploadDoc(c, f, category, monthInput?.value || null)); ok++; }
      catch (e) { toast(e.message, true); }
    }
    input.value = ''; status.textContent = '';
    if (ok) { toast(ok > 1 ? `${ok} arquivos guardados.` : 'Arquivo guardado.'); render(); }
  }
  const row = (f) => h('div', { class: 'file' },
    h('span', { class: `file-ic ic-${FILE_ICON(f).toLowerCase()}`, 'aria-hidden': 'true' }, FILE_ICON(f)),
    h('div', { class: 'file-main' },
      h('a', { class: 'file-name', href: `/api/pasta?r=files&id=${f.id}&open=1`, target: '_blank', rel: 'noopener' }, f.name),
      h('span', { class: 'muted' }, [f.ref_month && !group ? monthLabel(f.ref_month, true) : null, fileSize(f.size), `enviado em ${fmtDay(partsInTz(f.created_at, S.tz).date)}`].filter(Boolean).join(' · '))),
    h('div', { class: 'file-act' },
      h('a', { class: 'btn ghost sm', href: `/api/pasta?r=files&id=${f.id}&download=1`, title: 'Baixar' }, 'Baixar'),
      confirmButton('Apagar', 'Confirmar', async () => {
        await api(`/api/pasta?r=files&id=${f.id}`, { method: 'DELETE' });
        S.folder.files = S.folder.files.filter((x) => x.id !== f.id); render(); toast('Arquivo apagado.');
      }, 'btn ghost sm danger')));
  let content;
  if (!list.length) content = h('p', { class: 'muted files-empty' }, 'Nada aqui ainda. Arraste arquivos para cá ou clique em Enviar.');
  else if (group) {
    const by = new Map();
    for (const f of list) { const k = f.ref_month || 'sem-mes'; if (!by.has(k)) by.set(k, []); by.get(k).push(f); }
    content = h('div', { class: 'files' }, ...[...by.keys()].sort().reverse().map((k) => [
      h('div', { class: 'files-month eyebrow' }, k === 'sem-mes' ? 'Sem mês' : monthLabel(k)), ...by.get(k).map(row)]).flat());
  } else content = h('div', { class: 'files' }, ...list.map(row));
  const box = h('section', { class: 'card dropzone',
    ondragover: (e) => { e.preventDefault(); box.classList.add('over'); },
    ondragleave: () => box.classList.remove('over'),
    ondrop: (e) => { e.preventDefault(); box.classList.remove('over'); send([...e.dataTransfer.files]); } },
    h('div', { class: 'files-head' },
      h('div', { style: 'flex:1;min-width:200px' }, h('h3', {}, title), h('span', { class: 'muted', style: 'font-size:13.5px' }, hint)),
      monthInput, h('button', { class: 'btn primary sm', onclick: () => input.click() }, '+ Enviar arquivo'), input),
    status, content);
  return box;
}

// ── Área do cliente: link secreto em que o cliente vê só a pasta dele (contrato, relatórios e financeiro)
function portalMessage(c) {
  return `Olá! Este é o seu acesso exclusivo à área do cliente da agência: contrato, relatórios mensais do Instagram e financeiro, tudo em um só lugar.\n${c.portal_url}\n\nO link é pessoal, não compartilhe.`;
}
function openPortal(c) {
  const save = async (portal, msg) => {
    try {
      const saved = await api(`/api/clients?id=${c.id}`, { method: 'PATCH', body: { portal } });
      const i = S.clients.findIndex((x) => x.id === saved.id); if (i >= 0) S.clients[i] = saved;
      close(); render(); if (msg) toast(msg);
      if (saved.portal_url) openPortal(saved);
    } catch (e) {
      toast(/portal_token|column|schema/i.test(e.message) ? 'Falta a atualização do banco (veja Ajustes).' : e.message, true);
    }
  };
  const body = [h('p', { class: 'muted', style: 'margin:0;font-size:14px' },
    'O cliente abre pelo celular, sem senha, e vê só a pasta dele: contrato assinado, relatórios do Instagram, mensalidades com comprovantes e o atalho para aprovar posts. Ele não vê outros clientes, nem a seção "Outros" nem suas anotações.')];
  const foot = [];
  if (!c.portal_url) {
    foot.push(h('span', { class: 'spacer' }), h('button', { class: 'btn primary', onclick: () => save('enable', 'Link do cliente criado.') }, 'Criar link'));
  } else {
    body.push(h('div', { class: 'linkbox' }, h('code', { translate: 'no' }, c.portal_url), h('button', { class: 'btn sm', onclick: () => copyText(c.portal_url, 'Link copiado.') }, 'Copiar')),
      h('div', { class: 'actions' },
        h('a', { class: 'btn sm', href: c.portal_url, target: '_blank', rel: 'noopener' }, 'Ver como o cliente vê'),
        c.contact_whatsapp ? h('a', { class: 'btn wa sm', href: waLink(c.contact_whatsapp, portalMessage(c)), target: '_blank', rel: 'noopener' }, 'Enviar por WhatsApp') : null,
        c.contact_email ? h('a', { class: 'btn sm', href: mailLink(c.contact_email, `Sua área do cliente · ${c.name}`, portalMessage(c)) }, 'Enviar por e-mail') : null),
      onboardingBox(c),
      portalEditBox(c),
      h('div', { class: 'card', style: 'gap:10px;padding:14px' }, h('b', {}, 'Segurança'),
        h('span', { class: 'muted', style: 'font-size:13.5px' }, 'Se o link vazou ou o contrato terminou, gere um novo (o antigo para de abrir) ou desative.'),
        h('div', { class: 'actions' },
          confirmButton('Gerar link novo', 'Confirmar: o antigo para de abrir', () => save('regenerate', 'Link novo gerado.'), 'btn sm'),
          confirmButton('Desativar', 'Confirmar desativar', () => save('disable', 'Link desativado.'), 'btn ghost sm danger'))));
  }
  const close = drawer(`Link do cliente · ${c.name}`, body, foot);
}

// Liga/desliga, por cliente, a edição do calendário pela área do cliente
function portalEditBox(c) {
  const box = h('label', { class: 'card', style: 'gap:8px;padding:14px;cursor:pointer' });
  const input = h('input', { type: 'checkbox', disabled: true });
  const draw = () => box.replaceChildren(
    h('div', { style: 'display:flex;gap:10px;align-items:center' }, input, h('b', {}, 'Cliente pode reorganizar o calendário')),
    h('span', { class: 'muted', style: 'font-size:13.5px' }, 'Ele arrasta os posts para outro dia (até 48h antes) e sugere ideias em dias livres. As ideias entram como "Ideia" no Fluxo, não contam na cota, e só ele pode apagar as que sugeriu. Cada mudança avisa você e fica no histórico.'));
  draw();
  api('/api/pasta?r=portaledit').then((r) => { input.checked = r.clients.includes(c.id); input.disabled = false; }).catch(() => {});
  input.addEventListener('change', async () => {
    input.disabled = true;
    try { await api('/api/pasta?r=portaledit', { method: 'PUT', body: { client_id: c.id, enabled: input.checked } }); toast(input.checked ? 'Calendário liberado para o cliente.' : 'Calendário só para leitura.'); }
    catch (e) { input.checked = !input.checked; toast(e.message, true); }
    input.disabled = false;
  });
  return box;
}

// ───────────────────────── histórico de aprovações (prova)
const EVENT_LABEL = { sent: 'Enviado para aprovação', reminded: 'Lembrete enviado', approved: 'Aprovado pelo cliente', changes_requested: 'Cliente pediu ajuste', approved_by_agency: 'Aprovado pela agência', published: 'Publicado no Instagram', failed: 'Falha ao publicar', client_moved: 'Cliente mudou a data', client_idea: 'Cliente sugeriu uma ideia', client_idea_removed: 'Cliente retirou a ideia', published_manual: 'Publicado manualmente' };
const EVENT_TONE = { approved: 'st-approved', changes_requested: 'st-changes_requested', published: 'st-published', failed: 'st-failed', approved_by_agency: 'st-internal_review', sent: 'st-pending_approval', reminded: 'st-draft' };
function folderHistory(c) {
  const F = S.folder;
  if (F.history === undefined || F.historyFor !== c.id) {
    F.history = null; F.historyFor = c.id;
    api(`/api/pasta?r=history&client=${c.id}`).then((v) => { F.history = v; }).catch(() => { F.history = false; }).finally(() => render());
    return [h('p', { class: 'muted' }, 'Carregando o histórico…')];
  }
  if (F.history === false) return [h('div', { class: 'banner' }, 'O histórico precisa da atualização do banco. ', h('a', { href: '#ajustes' }, 'Ver em Ajustes'), '.')];
  if (!F.history) return [h('p', { class: 'muted' }, 'Carregando o histórico…')];
  const list = F.history;
  return [h('section', { class: 'card' },
    h('div', { class: 'files-head' },
      h('div', { style: 'flex:1;min-width:220px' }, h('h3', {}, 'Histórico de aprovações'),
        h('span', { class: 'muted', style: 'font-size:13.5px' }, 'Registro com data e hora de cada envio, lembrete, decisão do cliente e publicação. Serve de prova (cláusulas 5.3 e 5.5) e fica guardado mesmo se o post for apagado.')),
      h('a', { class: 'btn sm', href: `/historico?client=${c.id}`, target: '_blank', rel: 'noopener' }, 'Gerar PDF')),
    list.length ? h('div', { class: 'events' }, ...list.map((e) => h('div', { class: 'event' },
      e.snapshot?.image_url ? h('img', { src: e.snapshot.image_url, alt: '', loading: 'lazy' }) : h('span', { class: 'thumb-empty' }),
      h('div', { style: 'min-width:0' },
        h('div', {}, h('span', { class: `pill ${EVENT_TONE[e.type] || 'st-draft'}` }, EVENT_LABEL[e.type] || e.type), ' ',
          h('span', { class: 'muted', style: 'font-size:13px' }, `${fmtDay(partsInTz(e.created_at, S.tz).date)} às ${fmtTime(e.created_at, S.tz)}`)),
        h('div', { class: 'ev-cap' }, e.snapshot?.title || e.snapshot?.caption || 'Post'),
        e.note ? h('div', { class: 'muted', style: 'font-size:13px' }, `“${e.note}”`) : null))))
      : h('p', { class: 'muted files-empty' }, 'Ainda não há registros. Eles começam a aparecer nos próximos envios.'))];
}

// Agenda/Clientes: posts esperando o cliente há 2+ dias → lembrete pronto
function approvalReminders() {
  const limit = Date.now() - 2 * 864e5;
  const by = new Map();
  for (const p of S.posts) if (p.status === 'pending_approval' && p.sent_for_approval_at && new Date(p.sent_for_approval_at).getTime() < limit) by.set(p.client_id, [...(by.get(p.client_id) || []), p]);
  if (!by.size) return null;
  const log = (c, channel) => api('/api/posts', { method: 'POST', body: { remind_client: c.id, channel } }).catch(() => {});
  return h('section', { class: 'card charges' },
    h('h3', {}, 'Aprovações paradas'),
    h('span', { class: 'muted', style: 'font-size:13.5px' }, 'Posts esperando o cliente há mais de 2 dias. Sem resposta não é aprovação automática (cláusula 5.5): mande um lembrete; fica registrado no histórico.'),
    h('div', { class: 'charge-list' }, ...[...by.entries()].map(([cid, posts]) => {
      const c = clientById(cid); if (!c) return null;
      const days = Math.floor((Date.now() - Math.min(...posts.map((p) => new Date(p.sent_for_approval_at).getTime()))) / 864e5);
      const msg = `Oi! Passando para lembrar: ${posts.length > 1 ? `${posts.length} posts estão` : '1 post está'} esperando sua aprovação há ${days} dias.\n${c.approval_url}\n\nSem a aprovação eles não são publicados e o calendário precisa ser reorganizado. 🙂`;
      return h('div', { class: 'charge' },
        h('div', {}, h('b', {}, c.name), h('div', { class: 'muted', style: 'font-size:13px' }, `${posts.length} post(s) · há ${days} dias`)),
        h('div', { class: 'actions' },
          c.contact_whatsapp ? h('a', { class: 'btn wa sm', href: waLink(c.contact_whatsapp, msg), target: '_blank', rel: 'noopener', onclick: () => { log(c, 'whatsapp'); toast('Lembrete registrado no histórico.'); } }, 'Lembrar no WhatsApp') : null,
          c.contact_email ? h('a', { class: 'btn sm', href: mailLink(c.contact_email, `Posts de ${c.name} aguardando aprovação`, msg), onclick: () => log(c, 'e-mail') }, 'E-mail') : null,
          h('button', { class: 'btn ghost sm', onclick: () => { copyText(msg, 'Lembrete copiado.'); log(c, 'cópia'); } }, 'Copiar')));
    })));
}

// ───────────────────────── identidade da marca (equipe e admin)
function folderBrand(c) {
  const F = S.folder;
  if (F.brandFor !== c.id) {
    F.brandFor = c.id; F.brand = null;
    api(`/api/pasta?r=brand&client=${c.id}`).then((v) => { F.brand = v; }).catch(() => { F.brand = false; }).finally(() => render());
  }
  if (F.brand === false) return [h('div', { class: 'banner' }, 'A identidade da marca precisa da atualização do banco. ', S.role === 'admin' ? h('a', { href: '#ajustes' }, 'Ver em Ajustes') : 'Peça ao administrador.')];
  if (!F.brand) return [h('p', { class: 'muted' }, 'Carregando…')];
  const k = F.brand.brand_kit || {};
  let colors = [...(k.colors || [])];
  const colorsBox = h('div', { class: 'swatches' });
  const drawColors = () => colorsBox.replaceChildren(...colors.map((col, i) => h('div', { class: 'swatch' },
    h('input', { type: 'color', value: col, 'aria-label': `Cor ${i + 1}`, oninput: (e) => { colors[i] = e.target.value; e.target.nextSibling.textContent = e.target.value.toUpperCase(); } }),
    h('code', { translate: 'no' }, col.toUpperCase()),
    h('button', { type: 'button', class: 'linkish', 'aria-label': 'Remover cor', onclick: () => { colors.splice(i, 1); drawColors(); } }, '✕'))),
    colors.length < 8 ? h('button', { type: 'button', class: 'btn sm', onclick: () => { colors.push('#7A6200'); drawColors(); } }, '+ Cor') : null);
  drawColors();
  const ta = (id, label, val, ph, hint) => { const el = h('textarea', { id, placeholder: ph, style: 'min-height:70px' }); el.value = val || ''; return [el, h('div', { class: 'field' }, h('label', { for: id }, label), el, hint ? h('span', { class: 'hint' }, hint) : null)]; };
  const fonts = h('input', { id: 'b-fonts', value: k.fonts || '', placeholder: 'Ex.: títulos em Montserrat ExtraBold, textos em Inter' });
  const niche = h('select', { id: 'b-niche' }, h('option', { value: '' }, '— escolha —'), ...Object.entries(NICHES).map(([v, l]) => h('option', { value: v, selected: k.niche === v }, l)));
  const [voice, fVoice] = ta('b-voice', 'Tom de voz', F.brand.brand_voice, 'Ex.: próximo, carinhoso com os pets, divertido sem ser bobo. Fala com tutores de 25–45.', 'A IA de legendas usa isto.');
  const [style, fStyle] = ta('b-style', 'Estilo visual e posicionamento', k.style, 'Ex.: fotos claras e naturais, muito pet real (nada de banco de imagens), fundos limpos.');
  const [dos, fDos] = ta('b-dos', 'Sempre', k.dos, 'Ex.: mostrar o nome do pet, usar emojis de patinha, citar o endereço nos posts de promoção.');
  const [donts, fDonts] = ta('b-donts', 'Nunca', k.donts, 'Ex.: falar de preço sem aprovação, usar a palavra "barato", fotos de pets tristes.', 'A IA evita estes temas e palavras.');
  const [refs, fRefs] = ta('b-refs', 'Referências (links)', k.references, 'Perfis, pastas do Drive, Pinterest…');
  const [notes, fNotes] = ta('b-notes', 'Outras observações', k.notes, 'Datas importantes, produtos-estrela, concorrentes…');
  const [insp, fInsp] = ta('b-insp', 'Marcas, perfis e criadores que admira', k.inspirations, 'E o que chama a atenção na comunicação deles.');
  const [avoid, fAvoid] = ta('b-avoid', 'O que não associar à marca', k.avoid, 'Conteúdos, linguagens, tendências ou abordagens a evitar.', 'A IA evita isto.');
  const [comp, fComp] = ta('b-comp', 'Concorrentes', k.competitors, 'Quem são e o que fazem bem ou deixam de fazer no digital.');
  const [perc, fPerc] = ta('b-perc', 'Percepção desejada', k.perception, 'O que as pessoas devem sentir/associar no primeiro contato com o perfil.', 'Guia o tom das legendas e do planejamento.');
  const save = h('button', { class: 'btn primary', onclick: async () => {
    save.disabled = true;
    try {
      const r = await api('/api/pasta?r=brand', { method: 'PUT', body: { client_id: c.id, brand_voice: voice.value, brand_kit: { niche: niche.value || null, inspirations: insp.value, avoid: avoid.value, competitors: comp.value, perception: perc.value, colors, fonts: fonts.value, style: style.value, dos: dos.value, donts: donts.value, references: refs.value, notes: notes.value } } });
      F.brand = { ...F.brand, ...r };
      const i = S.clients.findIndex((x) => x.id === c.id); if (i >= 0) S.clients[i] = { ...S.clients[i], brand_voice: r.brand_voice, brand_kit: r.brand_kit };
      toast('Identidade da marca salva.');
    } catch (e) { toast(e.message, true); }
    save.disabled = false;
  } }, 'Salvar identidade');
  return [
    h('section', { class: 'card' },
      h('div', { class: 'eyebrow' }, 'Manual rápido da marca'), h('h3', {}, `Identidade de ${c.name}`),
      h('div', { class: 'field' }, h('label', { for: 'b-niche' }, 'Nicho'), niche, h('span', { class: 'hint' }, 'Define as datas comemorativas do calendário, os alertas do Início e o planejamento com IA.')),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Paleta de cores'), colorsBox),
      h('div', { class: 'field' }, h('label', { for: 'b-fonts' }, 'Tipografia'), fonts),
      fVoice, h('div', { class: 'grid-2 tight' }, fStyle, fRefs), h('div', { class: 'grid-2 tight' }, fDos, fDonts), fNotes,
      h('div', { class: 'eyebrow', style: 'margin-top:6px' }, 'Marca no digital (vem do questionário)'),
      h('div', { class: 'grid-2 tight' }, fInsp, fAvoid), h('div', { class: 'grid-2 tight' }, fComp, fPerc),
      h('div', { class: 'actions' }, save)),
    onboardingAnswers(c, k.onboarding),
    filesSection(c, 'brand', 'Logo e referências visuais', 'Logo em PNG/PDF, fontes, fotos de referência, manual da marca.'),
  ];
}

// ───────────────────────── pedidos do cliente (vindos da área do cliente)
const REQ_LABEL = { open: ['Novo', 'st-pending_approval'], doing: ['Em andamento', 'st-internal_review'], done: ['Concluído', 'st-approved'] };
function folderRequests(c) {
  const F = S.folder;
  if (F.reqFor !== c.id) {
    F.reqFor = c.id; F.reqs = null;
    api(`/api/pasta?r=requests&client=${c.id}`).then((v) => { F.reqs = v; }).catch(() => { F.reqs = false; }).finally(() => render());
  }
  if (F.reqs === false) return [h('div', { class: 'banner' }, 'Os pedidos precisam da atualização do banco.')];
  if (!F.reqs) return [h('p', { class: 'muted' }, 'Carregando…')];
  const setStatus = async (r, status) => {
    try {
      const row = await api('/api/pasta?r=requests', { method: 'PATCH', body: { id: r.id, status } });
      Object.assign(r, row); S.requests = (S.requests || []).filter((x) => x.id !== r.id).concat(status === 'done' ? [] : [{ ...r }]);
      render();
    } catch (e) { toast(e.message, true); }
  };
  return [h('section', { class: 'card' },
    h('div', {}, h('h3', {}, 'Pedidos do cliente'),
      h('span', { class: 'muted', style: 'font-size:13.5px' }, c.portal_url !== undefined ? 'O cliente envia pela área do cliente (link exclusivo): ideias, fotos, datas e promoções.' : 'Pedidos enviados pelo cliente na área exclusiva dele.')),
    F.reqs.length ? h('div', { class: 'reqs' }, ...F.reqs.map((r) => {
      const [label, cls] = REQ_LABEL[r.status];
      return h('article', { class: `req${r.status === 'done' ? ' done' : ''}` },
        h('div', { class: 'req-top' }, h('span', { class: `pill ${cls}` }, label),
          h('span', { class: 'muted', style: 'font-size:12.5px' }, `enviado ${fmtDay(partsInTz(r.created_at, S.tz).date)}${r.wanted_date ? ` · para ${fmtDay(r.wanted_date)}` : ''}`)),
        h('p', { class: 'req-text' }, r.text),
        r.files?.length ? h('div', { class: 'req-files' }, ...r.files.map((f) => h('a', { class: 'btn ghost sm', href: `/api/pasta?r=files&id=${f.id}&open=1`, target: '_blank', rel: 'noopener' }, `📎 ${f.name}`))) : null,
        h('div', { class: 'actions' },
          h('button', { class: 'btn sm', onclick: () => openPost(null, { stage: 'idea', client: c.id, title: r.text.split('\n')[0].slice(0, 120), notes: `Pedido do cliente (${fmtDay(partsInTz(r.created_at, S.tz).date)}):\n${r.text}`, date: r.wanted_date || undefined }) }, '💡 Virar ideia de post'),
          r.status !== 'doing' && r.status !== 'done' ? h('button', { class: 'btn ghost sm', onclick: () => setStatus(r, 'doing') }, 'Em andamento') : null,
          r.status !== 'done' ? h('button', { class: 'btn ghost sm', onclick: () => setStatus(r, 'done') }, '✓ Concluir') : h('button', { class: 'btn ghost sm', onclick: () => setStatus(r, 'open') }, 'Reabrir')));
    })) : h('p', { class: 'muted files-empty' }, 'Nenhum pedido ainda. Mande o link da área do cliente para ele usar.')),
    filesSection(c, 'briefing', 'Arquivos enviados pelo cliente', 'Fotos e documentos que vieram junto com os pedidos.')];
}

// Clientes: caixa de entrada de pedidos novos
function requestsInbox() {
  const open = (S.requests || []).filter((r) => r.status === 'open');
  if (!open.length) return null;
  return h('section', { class: 'card' },
    h('h3', {}, `Pedidos novos dos clientes (${open.length})`),
    h('div', { class: 'charge-list' }, ...open.slice(0, 6).map((r) => h('div', { class: 'charge' },
      h('div', { style: 'min-width:0;flex:1' }, h('b', {}, clientName(r.client_id)), h('div', { class: 'muted clamp2', style: 'font-size:13px' }, r.text)),
      h('a', { class: 'btn sm', href: `#pasta/${r.client_id}`, onclick: () => { S.folder.tab = 'requests'; S.folder.reqFor = null; } }, 'Ver')))));
}

// ───────────────────────── banco de mídia
async function loadBank(clientId) { return api(`/api/pasta?r=media&client=${clientId}`); }
async function uploadToBank(clientId, files, onStep) {
  const added = [];
  for (const [i, f] of files.entries()) {
    onStep?.(`Enviando ${i + 1} de ${files.length}…`);
    try {
      const img = await prepareImage(f);
      const up = await api(`/api/upload?client=${clientId}`, { method: 'POST', raw: img.blob });
      added.push(await api('/api/pasta?r=media', { method: 'POST', body: { client_id: clientId, url: up.image_url, path: up.image_path, name: f.name } }));
    } catch (e) { toast(`${f.name}: ${e.message}`, true); }
  }
  return added;
}
function bankGrid(items, { onPick, onDelete } = {}) {
  return h('div', { class: 'bank-grid' }, ...items.map((m) => h('figure', { class: 'bank-item' },
    h('img', { src: m.url, alt: m.name || '', loading: 'lazy' }),
    h('figcaption', {},
      onPick ? h('button', { class: 'btn sm primary', type: 'button', onclick: () => onPick(m) }, 'Usar') : null,
      onDelete ? confirmButton('✕', 'Apagar?', () => onDelete(m), 'btn ghost sm') : null))));
}
function openBankPicker(clientId, onPick) {
  const box = h('div', { style: 'display:grid;gap:12px' }, h('p', { class: 'muted' }, 'Carregando…'));
  const input = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  let close;
  const draw = (items) => box.replaceChildren(
    h('div', { class: 'actions' }, h('button', { class: 'btn sm', type: 'button', onclick: () => input.click() }, '+ Enviar fotos para o banco'), input),
    items.length ? bankGrid(items, { onPick: (m) => { onPick(m); close(); } }) : h('p', { class: 'muted', style: 'margin:0' }, 'Nenhuma foto no banco deste cliente ainda. Envie as fotos do cliente (produtos, equipe, espaço) e reaproveite em vários posts.'));
  input.addEventListener('change', async () => {
    const added = await uploadToBank(clientId, [...input.files], (t) => toast(t));
    input.value = ''; if (added.length) toast(`${added.length} foto(s) no banco.`);
    draw(await loadBank(clientId).catch(() => []));
  });
  loadBank(clientId).then(draw).catch((e) => box.replaceChildren(h('div', { class: 'errorbox' }, /media_bank|relation|schema/i.test(e.message) ? 'O banco de mídia precisa da atualização do banco de dados (veja Ajustes).' : e.message)));
  close = drawer(`Banco de mídia · ${clientName(clientId)}`, [box], []);
}
function folderMedia(c) {
  const F = S.folder;
  if (F.mediaFor !== c.id) { F.mediaFor = c.id; F.media = null; loadBank(c.id).then((v) => { F.media = v; }).catch(() => { F.media = false; }).finally(() => render()); }
  if (F.media === false) return [h('div', { class: 'banner' }, 'O banco de mídia precisa da atualização do banco. ', S.role === 'admin' ? h('a', { href: '#ajustes' }, 'Ver em Ajustes') : 'Peça ao administrador.')];
  if (!F.media) return [h('p', { class: 'muted' }, 'Carregando…')];
  const status = h('span', { class: 'muted', style: 'font-size:13px' });
  const input = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: async () => {
    const added = await uploadToBank(c.id, [...input.files], (t) => { status.textContent = t; });
    F.media = [...added, ...F.media]; status.textContent = ''; input.value = ''; render(); if (added.length) toast(`${added.length} foto(s) no banco.`);
  } });
  const drop = h('div', { class: 'drop', tabindex: 0, role: 'button', onclick: () => input.click() }, h('b', {}, 'Enviar fotos do cliente'), h('span', { class: 'muted' }, 'Arraste aqui ou clique. Produtos, equipe, espaço, bastidores… viram JPEG otimizado para o Instagram.'));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', async (e) => { e.preventDefault(); drop.classList.remove('over'); const fs = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/')); if (!fs.length) return; const added = await uploadToBank(c.id, fs, (t) => { status.textContent = t; }); F.media = [...added, ...F.media]; status.textContent = ''; render(); });
  return [h('section', { class: 'card' },
    h('div', { class: 'eyebrow' }, `${F.media.length} foto${F.media.length === 1 ? '' : 's'}`), h('h3', {}, `Banco de mídia de ${c.name}`),
    h('span', { class: 'muted', style: 'font-size:13.5px' }, 'Fotos do cliente para reaproveitar: no post, clique em "🗂 Banco de mídia" e escolha. Apagar daqui não tira a foto dos posts que já usam.'),
    drop, input, status,
    F.media.length ? bankGrid(F.media, {
      onPick: (m) => openPost(null, { client: c.id, image: m }),
      onDelete: async (m) => { await api(`/api/pasta?r=media&id=${m.id}`, { method: 'DELETE' }); F.media = F.media.filter((x) => x.id !== m.id); render(); toast('Foto removida do banco.'); },
    }) : null)];
}

// ───────────────────────── modelos de legenda e grupos de hashtags
const SNIP_KIND = { caption: 'Modelo de legenda', hashtags: 'Grupo de hashtags' };
function snippetBar(getClient, cap, upd) {
  const bar = h('div', { class: 'snip-bar' });
  let loadedFor = null;
  const insertAt = (text) => { const a = cap.selectionStart ?? cap.value.length; cap.setRangeText(text, a, cap.selectionEnd ?? a, 'end'); cap.focus(); upd(); };
  const addTags = (text) => {
    const have = new Set((cap.value.match(/#[\p{L}\p{N}_]+/gu) || []).map((t) => t.toLowerCase()));
    const add = text.split(/\s+/).filter((t) => t && !have.has(t.toLowerCase()));
    if (!add.length) return toast('Essas hashtags já estão na legenda.');
    cap.value = `${cap.value.trimEnd()}${cap.value.trim() ? '\n\n' : ''}${add.join(' ')}`; upd(); toast(`${add.length} hashtag(s) adicionada(s).`);
  };
  const draw = async () => {
    const cid = getClient();
    if (loadedFor === cid) return; loadedFor = cid;
    let list = [];
    try { list = await api(`/api/pasta?r=snippets&client=${cid}`); } catch { bar.replaceChildren(); return; }
    const caps = list.filter((x) => x.kind === 'caption'), tags = list.filter((x) => x.kind === 'hashtags');
    const nameIn = h('input', { placeholder: 'Nome do modelo', maxlength: 60, class: 'snip-name' });
    const saveBox = h('div', { class: 'snip-save', hidden: true }, nameIn,
      h('button', { class: 'btn sm', type: 'button', onclick: async () => {
        try { await api('/api/pasta?r=snippets', { method: 'POST', body: { kind: 'caption', name: nameIn.value, text: cap.value, client_id: cid } }); loadedFor = null; toast('Modelo salvo para este cliente.'); draw(); }
        catch (e) { toast(e.message, true); }
      } }, 'Salvar'));
    bar.replaceChildren(
      caps.length ? h('div', { class: 'snip-row' }, h('span', { class: 'label' }, 'Modelos'), ...caps.map((x) => h('button', { type: 'button', class: 'chip', title: x.text, onclick: () => insertAt(x.text) }, x.name))) : null,
      tags.length ? h('div', { class: 'snip-row' }, h('span', { class: 'label' }, '# Hashtags'), ...tags.map((x) => h('button', { type: 'button', class: 'chip', title: x.text, onclick: () => addTags(x.text) }, x.name))) : null,
      h('div', { class: 'snip-row' },
        h('button', { type: 'button', class: 'linkish', onclick: () => { if (!cap.value.trim()) return toast('Escreva a legenda antes de salvar como modelo.', true); saveBox.hidden = !saveBox.hidden; if (!saveBox.hidden) nameIn.focus(); } }, '+ Salvar legenda como modelo'),
        h('a', { class: 'linkish', href: `#pasta/${cid}`, onclick: () => { S.folder.tab = 'snippets'; document.querySelectorAll('.drawer, .scrim').forEach((x) => x.remove()); } }, caps.length || tags.length ? 'Gerenciar modelos' : 'Criar grupos de hashtags')),
      saveBox);
  };
  draw();
  bar.addEventListener('mouseenter', draw); // trocou o cliente no post: recarrega
  return bar;
}
function folderSnippets(c) {
  const F = S.folder;
  if (F.snipFor !== c.id) { F.snipFor = c.id; F.snips = null; api(`/api/pasta?r=snippets&client=${c.id}`).then((v) => { F.snips = v; }).catch(() => { F.snips = false; }).finally(() => render()); }
  if (F.snips === false) return [h('div', { class: 'banner' }, 'Os modelos precisam da atualização do banco. ', S.role === 'admin' ? h('a', { href: '#ajustes' }, 'Ver em Ajustes') : 'Peça ao administrador.')];
  if (!F.snips) return [h('p', { class: 'muted' }, 'Carregando…')];
  const kind = h('select', { id: 'sn-kind' }, h('option', { value: 'hashtags' }, SNIP_KIND.hashtags), h('option', { value: 'caption' }, SNIP_KIND.caption));
  const name = h('input', { id: 'sn-name', placeholder: 'Ex.: Pet geral, CTA agendamento, Assinatura', maxlength: 60 });
  const text = h('textarea', { id: 'sn-text', style: 'min-height:80px', placeholder: 'Hashtags separadas por espaço (com ou sem #) ou o texto do modelo de legenda.' });
  const all = h('input', { type: 'checkbox', id: 'sn-all' });
  const add = h('button', { class: 'btn primary sm', style: 'justify-self:start', onclick: async () => {
    add.disabled = true;
    try { const row = await api('/api/pasta?r=snippets', { method: 'POST', body: { kind: kind.value, name: name.value, text: text.value, client_id: all.checked ? null : c.id } }); F.snips = [...F.snips, row].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')); toast('Modelo criado.'); render(); }
    catch (e) { toast(e.message, true); add.disabled = false; }
  } }, 'Adicionar');
  const section = (k) => {
    const list = F.snips.filter((x) => x.kind === k);
    return h('section', { class: 'card' }, h('h3', {}, k === 'hashtags' ? 'Grupos de hashtags' : 'Modelos de legenda'),
      list.length ? h('div', { class: 'snip-list' }, ...list.map((x) => h('div', { class: 'snip-item' },
        h('div', { class: 'snip-head' }, h('b', {}, x.name), x.client_id ? null : h('span', { class: 'pill st-draft' }, 'todos os clientes'),
          h('span', { class: 'spacer' }), h('button', { class: 'btn ghost sm', onclick: () => copyText(x.text, 'Copiado.') }, 'Copiar'),
          confirmButton('Apagar', 'Confirmar', async () => { await api(`/api/pasta?r=snippets&id=${x.id}`, { method: 'DELETE' }); F.snips = F.snips.filter((y) => y.id !== x.id); render(); }, 'btn ghost sm')),
        h('p', { class: k === 'hashtags' ? 'mono snip-text tags' : 'snip-text' }, x.text))))
        : h('p', { class: 'muted', style: 'margin:0' }, k === 'hashtags' ? 'Nenhum grupo ainda. Crie grupos por tema (ex.: "Pet geral", "Banho e tosa", "Cuiabá") e adicione com 1 clique na legenda.' : 'Nenhum modelo ainda. Bom para assinaturas, CTAs e formatos que se repetem.'));
  };
  return [h('section', { class: 'card' }, h('div', { class: 'eyebrow' }, 'Produtividade'), h('h3', {}, 'Novo modelo'),
    h('div', { class: 'grid-2 tight' }, h('div', { class: 'field' }, h('label', { for: 'sn-kind' }, 'Tipo'), kind), h('div', { class: 'field' }, h('label', { for: 'sn-name' }, 'Nome'), name)),
    h('div', { class: 'field' }, h('label', { for: 'sn-text' }, 'Texto'), text),
    h('label', { class: 'toggle' }, all, h('span', {}, 'Usar em todos os clientes (ex.: assinatura da agência)')), add),
  h('div', { class: 'grid-2' }, section('hashtags'), section('caption'))];
}

// ───────────────────────── onboarding (boas-vindas + questionário da marca)
const onboardingUrl = (c) => (c.portal_url ? c.portal_url.replace('/cliente?', '/boasvindas?') : null);
function welcomeMessage(c) {
  const first = (c.contract_data?.representante || '').trim().split(/\s+/)[0];
  return `Oi${first ? `, ${first}` : ''}! Seja muito bem-vindo(a) à MC Digital 🤍\n\nPreparei o seu manual de boas-vindas: lá você conhece como vamos trabalhar juntos e responde o questionário da sua marca (leva uns 15 minutos). Ele é a base de todo o seu planejamento:\n${onboardingUrl(c)}`;
}
function onboardingBox(c) {
  const url = onboardingUrl(c); if (!url) return null;
  const done = c.brand_kit?.onboarding?.submitted_at;
  return h('div', { class: 'card', style: 'gap:10px;padding:14px' }, h('b', {}, 'Boas-vindas e questionário'),
    h('span', { class: 'muted', style: 'font-size:13.5px' }, done ? `Respondido em ${fmtDate(done, S.tz)}. As respostas estão na aba Marca.` : 'Apresenta a MC Digital (fundadora, missão, valores, processo, checklist e aprovação) e termina no questionário. As respostas vão sozinhas para a Marca do cliente.'),
    h('div', { class: 'linkbox' }, h('code', { translate: 'no' }, url), h('button', { class: 'btn sm', onclick: () => copyText(url, 'Link copiado.') }, 'Copiar')),
    h('div', { class: 'actions' },
      h('a', { class: 'btn sm', href: url, target: '_blank', rel: 'noopener' }, 'Ver como o cliente vê'),
      c.contact_whatsapp ? h('a', { class: 'btn wa sm', href: waLink(c.contact_whatsapp, welcomeMessage(c)), target: '_blank', rel: 'noopener' }, 'Enviar boas-vindas no WhatsApp') : null,
      h('button', { class: 'btn sm', onclick: () => copyText(welcomeMessage(c), 'Mensagem copiada.') }, 'Copiar mensagem')));
}
function onboardingAnswers(c, onb) {
  if (!onb?.answers) {
    return h('section', { class: 'card' }, h('div', { class: 'eyebrow' }, 'Questionário de onboarding'), h('h3', {}, 'Ainda não respondido'),
      h('span', { class: 'muted', style: 'font-size:13.5px' }, c.portal_url ? 'Mande o link de boas-vindas para o cliente: as respostas aparecem aqui e preenchem os campos da marca.' : 'Crie o link do cliente (botão "Criar link do cliente" no topo da pasta) e envie as boas-vindas.'),
      c.portal_url ? h('div', { class: 'actions' }, c.contact_whatsapp ? h('a', { class: 'btn wa sm', href: waLink(c.contact_whatsapp, welcomeMessage(c)), target: '_blank', rel: 'noopener' }, 'Enviar boas-vindas no WhatsApp') : null,
        h('button', { class: 'btn sm', onclick: () => copyText(onboardingUrl(c), 'Link copiado.') }, 'Copiar link')) : null);
  }
  const text = ONB_SECTIONS.map((sec) => `${sec.title.toUpperCase()}\n${ONB_QUESTIONS.filter((q) => q.section === sec.id).map((q) => `${q.q}\n${onb.answers[q.id] || '—'}`).join('\n\n')}`).join('\n\n');
  return h('section', { class: 'card' },
    h('div', { class: 'home-card-head' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Questionário de onboarding'), h('h3', {}, `Respostas de ${c.name}`)),
      h('button', { class: 'btn sm', onclick: () => copyText(text, 'Respostas copiadas.') }, 'Copiar tudo')),
    h('span', { class: 'muted', style: 'font-size:13px' }, `Respondido em ${fmtDate(onb.submitted_at, S.tz)} ${fmtTime(onb.submitted_at, S.tz)}. A IA de legendas e o planejamento usam estas respostas.`),
    ...ONB_SECTIONS.map((sec) => h('details', { class: 'onb-sec', open: sec.id === 'digital' || sec.id === 'publico' },
      h('summary', {}, sec.title),
      h('dl', { class: 'onb-dl' }, ...ONB_QUESTIONS.filter((q) => q.section === sec.id).flatMap((q) => [h('dt', {}, q.q), h('dd', {}, onb.answers[q.id] || '—')])))));
}
function settingsOnboarding() {
  if (S.onb === undefined) { S.onb = null; api('/api/pasta?r=onbcfg').then((v) => { S.onb = v; }).catch(() => { S.onb = false; }).finally(() => { if (S.view === 'ajustes') render(); }); }
  const head = h('div', { class: 'page-head', style: 'margin-top:12px' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Novos clientes'), h('h2', { style: 'font-size:22px' }, 'Boas-vindas (onboarding)')));
  if (!S.onb) return [head, h('p', { class: 'muted' }, S.onb === false ? 'Indisponível agora.' : 'Carregando…')];
  const O = S.onb;
  const fields = {};
  const fld = (k, label, { area = false, rows = 3, hint } = {}) => {
    const el = h(area ? 'textarea' : 'input', { id: `on-${k}`, style: area ? `min-height:${rows * 26}px` : null });
    el.value = k === 'steps' ? (O.steps || []).join('\n') : (O[k] ?? '');
    fields[k] = el;
    return h('div', { class: 'field' }, h('label', { for: `on-${k}` }, label), el, hint ? h('span', { class: 'hint' }, hint) : null);
  };
  const photoIn = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async () => {
    const f = photoIn.files[0]; if (!f) return;
    try {
      const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' });
      const sc = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * sc); cv.height = Math.round(bmp.height * sc);
      cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
      const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.88));
      S.onb = await api('/api/pasta?r=onbcfg&photo=1', { method: 'POST', raw: blob }); toast('Foto atualizada.'); render();
    } catch (e) { toast(e.message, true); }
  } });
  const sample = S.clients.find((c) => c.portal_url);
  return [head, h('article', { class: 'card' },
    h('span', { class: 'muted', style: 'font-size:13.5px' }, 'Depois que o cliente fecha, mande o link de boas-vindas (fica na pasta do cliente → "Link do cliente"). É o seu manual de onboarding em página: saudação com o nome dele, você, missão, valores, etapas, checklist que se marca sozinho, como funciona a aprovação e o questionário. As respostas vão para a aba Marca. Use **palavra** para destacar em negrito.'),
    h('div', { class: 'onb-photo' },
      O.founder_photo ? h('img', { src: O.founder_photo, alt: 'Foto da fundadora' }) : h('div', { class: 'onb-photo-empty' }, 'sem foto'),
      h('div', { style: 'display:grid;gap:8px' }, h('b', {}, 'Foto da fundadora'), h('span', { class: 'muted', style: 'font-size:13px' }, 'Vertical, como no manual (a de câmera na mão fica ótima).'),
        h('div', { class: 'actions' }, h('button', { class: 'btn sm', onclick: () => photoIn.click() }, O.founder_photo ? 'Trocar foto' : 'Enviar foto'), photoIn))),
    h('div', { class: 'grid-2 tight' }, fld('founder_name', 'Nome'), fld('founder_role', 'Cargo (aparece entre chaves)')),
    fld('founder_bio', 'Apresentação', { area: true, rows: 6 }),
    fld('hello_sub', 'Frase abaixo do "Oi, nome!"'),
    h('div', { class: 'grid-2 tight' }, fld('mission', 'Missão', { area: true, rows: 5 }), fld('values', 'Propósito e valores', { area: true, rows: 5 })),
    h('div', { class: 'grid-2 tight' }, fld('steps', 'Etapas do processo (uma por linha)', { area: true, rows: 9 }), fld('approval', 'Aprovação de conteúdo', { area: true, rows: 9 })),
    h('div', { class: 'grid-2 tight' }, fld('cta_title', 'Chamada do questionário'), fld('cta_strong', 'Pergunta em destaque')),
    fld('cta_text', 'Texto antes do questionário'),
    h('div', { class: 'grid-2 tight' }, fld('thanks_title', 'Encerramento'), fld('thanks_text', 'Frase final')),
    fld('instagram', 'Instagram da agência'),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary sm', onclick: async (e) => {
        e.target.disabled = true;
        try { S.onb = await api('/api/pasta?r=onbcfg', { method: 'PUT', body: Object.fromEntries(Object.entries(fields).map(([k, el]) => [k, el.value])) }); toast('Boas-vindas salvas.'); render(); }
        catch (err) { toast(err.message, true); e.target.disabled = false; }
      } }, 'Salvar textos'),
      sample ? h('a', { class: 'btn sm', href: onboardingUrl(sample), target: '_blank', rel: 'noopener' }, `Pré-visualizar (como ${sample.name})`) : h('span', { class: 'muted', style: 'font-size:13px' }, 'Crie o link de um cliente para pré-visualizar.')),
    h('span', { class: 'hint muted' }, 'Apagar um campo e salvar volta ao texto original do manual.'))];
}

export { FOLDER_TABS, TEAM_TABS, folderTabsFor, ACCEPT, todayLocal, nextMonth, billingMonths, lateCount, PAY_LABEL, loadFolder, viewFolder, folderContract, fmtDay, openContractData, folderFinance, bulkOld, stat, ensureSettings, chargeMessage, chargeButton, chargesCard, openPayment, folderReports, reportMessage, igReports, openReportNote, folderOther, uploadDoc, FILE_ICON, filesSection, portalMessage, openPortal, portalEditBox, EVENT_LABEL, EVENT_TONE, folderHistory, approvalReminders, folderBrand, REQ_LABEL, folderRequests, requestsInbox, loadBank, uploadToBank, bankGrid, openBankPicker, folderMedia, SNIP_KIND, snippetBar, folderSnippets, onboardingUrl, welcomeMessage, onboardingBox, onboardingAnswers, settingsOnboarding };
