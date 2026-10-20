// MC DIGITAL — lista de clientes e cadastro.
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
import { S, can, confirmButton, deliveryLine, drawer, render } from './core.js';
import { approvalReminders, chargesCard, folderTabsFor, lateCount, requestsInbox } from './pasta.js';
import { approvalMessage, approvalSubject } from './post.js';

// ───────────────────────── clientes
function viewClients() {
  const out = [h('div', { class: 'page-head' },
    h('div', {}, h('div', { class: 'eyebrow' }, `${S.clients.length} de 10 clientes`), h('h1', {}, 'Clientes')),
    h('div', { class: 'spacer' }),
    can('clientes') && !S.limitClients ? h('button', { class: 'btn primary', onclick: () => openClient() }, '+ Novo cliente') : null)];
  if (!S.clients.length) {
    out.push(h('div', { class: 'empty' }, h('h3', {}, 'Nenhum cliente ainda'),
      h('p', { class: 'muted' }, 'Cadastre o cliente, conecte o Instagram dele e mande o link de aprovação.'),
      h('button', { class: 'btn primary', onclick: () => openClient() }, '+ Novo cliente')));
    return out;
  }
  out.push(chargesCard(), approvalReminders(), requestsInbox(), h('div', { class: 'grid-clients' }, ...S.clients.map(cardClient)));
  return out.filter(Boolean);
}

function cardClient(c) {
  const pend = S.posts.filter((p) => p.client_id === c.id && p.status === 'pending_approval').length;
  const exp = c.ig_token_expires_at ? Math.round((new Date(c.ig_token_expires_at) - Date.now()) / 86400e3) : null;
  const expired = exp !== null && exp <= 0;
  const ig = c.production_only && !c.ig_connected ? h('span', { class: 'ig-ok' }, '📦 Só produção · o cliente posta')
    : !c.ig_connected ? h('span', { class: 'ig-off' }, 'Não conectado')
    : expired ? h('span', { class: 'ig-off' }, `@${c.ig_username} · conexão expirou`)
    : h('span', { class: exp !== null && exp < 5 ? 'ig-warn' : 'ig-ok' }, `@${c.ig_username || 'conectado'}`);
  return h('article', { class: 'card' },
    h('h3', { class: 'client-name' }, c.name),
    h('div', { class: 'card-tags' },
      pend ? h('span', { class: 'pill st-pending_approval' }, `${pend} aguardando`) : null,
      lateCount(c) ? h('span', { class: 'pill st-failed', title: 'Mensalidades vencidas sem pagamento' }, `${lateCount(c)} em atraso`) : null,
      c.portal_url ? h('span', { class: `pill ${c.brand_kit?.onboarding?.submitted_at ? 'st-approved' : 'st-draft'}`, title: 'Questionário de onboarding' }, c.brand_kit?.onboarding?.submitted_at ? 'Onboarding ✓' : 'Onboarding pendente') : null),
    deliveryLine(c.id),
    h('dl', { class: 'kv' },
      h('dt', {}, 'Instagram'), h('dd', {}, ig),
      h('dt', {}, 'WhatsApp'), h('dd', {}, c.contact_whatsapp ? `+${c.contact_whatsapp}` : h('span', { class: 'muted' }, '—')),
      h('dt', {}, 'E-mail'), h('dd', {}, c.contact_email || h('span', { class: 'muted' }, '—')),
      h('dt', {}, 'Tom de voz'), h('dd', {}, c.brand_voice ? h('span', { class: 'clamp2' }, c.brand_voice) : h('span', { class: 'muted' }, '— (usado pela IA)'))),
    h('div', { class: 'field' }, h('span', { class: 'eyebrow' }, 'Link fixo de aprovação'),
      h('div', { class: 'linkbox' }, h('code', { translate: 'no' }, c.approval_url), h('button', { class: 'btn sm', onclick: () => copyText(c.approval_url, 'Link copiado.') }, 'Copiar'))),
    h('div', { class: 'actions' },
      c.ig_connected && !expired || !can('clientes') ? null : h('a', { class: 'btn primary sm', href: `/api/ig/connect?client=${c.id}` }, c.ig_connected ? 'Reconectar Instagram' : 'Conectar Instagram'),
      c.contact_whatsapp ? h('a', { class: 'btn wa sm', href: waLink(c.contact_whatsapp, approvalMessage(c)), target: '_blank', rel: 'noopener' }, 'WhatsApp') : null,
      c.contact_email ? h('a', { class: 'btn sm', href: mailLink(c.contact_email, approvalSubject(c), approvalMessage(c)) }, 'E-mail') : null,
      folderTabsFor().length ? h('a', { class: 'btn sm', href: `#pasta/${c.id}` }, can('financeiro') ? '🔒 Pasta' : 'Marca e pedidos') : null,
      can('clientes') ? h('button', { class: 'btn sm', onclick: () => openClient(c) }, 'Editar') : null));
}

function openClient(c = null) {
  const name = h('input', { type: 'text', id: 'c-name', value: c?.name || '', placeholder: 'Ex.: Padaria Pão Quente', required: true });
  const wa = h('input', { type: 'tel', id: 'c-wa', value: c?.contact_whatsapp ? c.contact_whatsapp.replace(/^55/, '') : '', placeholder: '65 99999-9999', inputmode: 'tel' });
  const email = h('input', { type: 'email', id: 'c-email', value: c?.contact_email || '', placeholder: 'cliente@empresa.com.br' });
  const own = h('input', { type: 'checkbox', id: 'c-own', checked: Boolean(c?.own) });
  const prod = h('input', { type: 'checkbox', id: 'c-prod', checked: Boolean(c?.production_only) });
  const voice = h('textarea', { id: 'c-voice', style: 'min-height:90px', placeholder: 'Ex.: Linguagem jovem e de rua, gírias de funk, frases curtas de atitude. Nada de palavrão. Público 18–30.' }, c?.brand_voice || '');
  const body = [
    h('div', { class: 'field' }, h('label', { for: 'c-name' }, 'Nome do cliente'), name),
    h('div', { class: 'field' }, h('label', { for: 'c-wa' }, 'WhatsApp de quem aprova'), wa, h('span', { class: 'hint' }, 'Com DDD. Usado no botão de WhatsApp.')),
    h('div', { class: 'field' }, h('label', { for: 'c-email' }, 'E-mail de quem aprova'), email, h('span', { class: 'hint' }, 'Usado no botão de e-mail.')),
    h('div', { class: 'field' }, h('label', { for: 'c-voice' }, 'Tom de voz da marca'), voice, h('span', { class: 'hint' }, 'A IA usa isto para escrever legendas no jeito da marca.')),
    h('label', { class: 'check-row' }, own, h('span', {}, h('b', {}, 'Conta própria da agência'), h('span', { class: 'hint', style: 'display:block' }, 'Ex.: o perfil da própria agência. Continua com posts e calendário, mas fica fora da receita, das cobranças e da contagem de clientes.'))),
    h('label', { class: 'check-row' }, prod, h('span', {}, h('b', {}, 'Só produção (o cliente publica)'), h('span', { class: 'hint', style: 'display:block' }, 'A agência capta, edita e entrega; quem posta é o cliente. O app não publica nem pede Instagram conectado: o aprovado vira "Pronto para entregar" e o cliente baixa o material e a legenda pelo link dele.'))),
  ];
  if (c) {
    body.push(h('div', { class: 'card', style: 'gap:10px;padding:14px' }, h('b', {}, 'Instagram'),
      c.ig_connected ? h('span', {}, `Conectado como @${c.ig_username}. A conexão é renovada sozinha a cada 50 dias.`) : h('span', { class: 'muted' }, 'Ainda não conectado.'),
      h('div', { class: 'actions' },
        h('a', { class: 'btn sm', href: `/api/ig/connect?client=${c.id}` }, c.ig_connected ? 'Reconectar' : 'Conectar Instagram'),
        c.ig_connected ? confirmButton('Desconectar', 'Confirmar', async () => { await saveClient({ disconnect_instagram: true }); }, 'btn ghost sm') : null)));
    body.push(h('div', { class: 'card', style: 'gap:10px;padding:14px' }, h('b', {}, 'Link de aprovação'),
      h('span', { class: 'muted', style: 'font-size:13.5px' }, 'Se o link vazou ou mudou quem aprova, gere um novo. O antigo para de funcionar.'),
      h('div', { class: 'actions' }, confirmButton('Gerar link novo', 'Confirmar: o antigo deixa de abrir', async () => { await saveClient({ new_approval_link: true }); toast('Link novo gerado.'); }, 'btn sm'))));
  }
  async function saveClient(extra = {}) {
    const payload = { name: name.value, contact_whatsapp: wa.value, contact_email: email.value, brand_voice: voice.value, own_account: own.checked, production_only: prod.checked, ...extra };
    try {
      const saved = c ? await api(`/api/clients?id=${c.id}`, { method: 'PATCH', body: payload }) : await api('/api/clients', { method: 'POST', body: payload });
      const i = S.clients.findIndex((x) => x.id === saved.id);
      if (i >= 0) S.clients[i] = saved; else S.clients.push(saved);
      S.clients.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
      close(); render();
      if (!c) toast('Cliente criado. Agora conecte o Instagram dele.');
    } catch (e) { toast(e.message, true); }
  }
  const foot = [];
  if (c) foot.push(confirmButton('Remover cliente', 'Confirmar: apaga posts e a pasta dele', async () => {
    await api(`/api/clients?id=${c.id}`, { method: 'DELETE' });
    S.clients = S.clients.filter((x) => x.id !== c.id); S.posts = S.posts.filter((p) => p.client_id !== c.id);
    close(); render(); toast('Cliente removido.');
  }), h('span', { class: 'spacer' }));
  foot.push(h('button', { class: 'btn primary', onclick: () => saveClient() }, c ? 'Salvar' : 'Criar cliente'));
  const close = drawer(c ? c.name : 'Novo cliente', body, foot);
  name.focus();
}

export { viewClients, cardClient, openClient };
