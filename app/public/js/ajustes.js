// MC DIGITAL — Ajustes: instalação, equipe, Pix, 2 etapas, e-mails, backup e nota fiscal.
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
import { S, can, clientName, confirmButton, drawer, render, savePref, savedPref } from './core.js';
import { connectionDead, needsConnect, openConnectShare } from './clientes.js';
import { settingsDevice } from './inicio.js';
import { fmtDay, settingsOnboarding } from './pasta.js';
import { settingsDiag, settingsPrivacy } from './vendas.js';

// ───────────────────────── ajustes (estado da instalação)
function setupPending() {
  const st = S.setup; if (!st) return [];
  const out = [];
  if (st.missing_env?.length) out.push(`variáveis ${st.missing_env.join(', ')} na Vercel`);
  if (st.key_problem) out.push('chave do Supabase errada (use a secreta)');
  if (st.migration_sql) out.push('atualização do banco de dados');
  if (!st.ig_ready) out.push('app da Meta (Instagram)');
  if (st.cron_sql && !st.publisher_last_run) out.push('agendador automático');
  return out;
}

function viewSettings() {
  const st = S.setup || {};
  const ago = st.publisher_last_run ? Math.round((Date.now() - new Date(st.publisher_last_run)) / 60000) : null;
  const ok = (cond, yes, no) => h('span', { class: cond ? 'ig-ok' : 'ig-warn' }, cond ? `✓ ${yes}` : `• ${no}`);
  // shown = o que aparece na tela (pode esconder segredos); o botão copia o texto completo
  const codeBox = (text, label, shown = text) => h('div', { style: 'display:grid;gap:8px' },
    h('pre', { class: 'mono notranslate', translate: 'no', style: 'margin:0;white-space:pre-wrap;overflow-wrap:anywhere;background:var(--surface-2);border:1px solid var(--line);border-radius:10px;padding:12px;font-size:12.5px;max-height:260px;overflow:auto' }, shown),
    h('button', { class: 'btn sm', style: 'justify-self:start', onclick: () => copyText(text, `${label} copiado.`) }, `Copiar ${label}`));
  const sistema = [
    statusOverview(st, ago),
    st.migration_sql ? h('article', { class: 'card', style: 'border-color:var(--s-wait)' },
      h('div', { class: 'eyebrow' }, 'Atualização necessária'),
      h('h3', {}, 'Atualizar o banco de dados'),
      h('span', { class: 'muted', style: 'font-size:14px' }, 'As novidades (Fluxo, ideias sem data, tom de voz da IA) precisam de uma atualização no banco. No Supabase, abra SQL Editor → New query, cole o comando e clique em Run. Leva 1 segundo e não apaga nada.'),
      codeBox(st.migration_sql, 'comando')) : null,
    h('div', { class: 'grid-clients' },
      h('article', { class: 'card' },
        h('div', { class: 'eyebrow' }, 'Etapa 2 · App no ar'),
        h('h3', {}, 'Endereço e banco de dados'),
        ok(!st.missing_env?.length && !st.key_problem, 'Banco de dados e senha configurados', st.key_problem ? 'Chave do Supabase errada' : `Faltam: ${(st.missing_env || []).join(', ')}`),
        st.key_problem ? h('div', { class: 'errorbox' }, st.key_problem) : null,
        st.app_url ? h('div', { class: 'linkbox' }, h('code', { translate: 'no' }, st.app_url), h('button', { class: 'btn sm', onclick: () => copyText(st.app_url, 'Endereço copiado.') }, 'Copiar')) : null),
      h('article', { class: 'card' },
        h('div', { class: 'eyebrow' }, 'Etapa 3 · Meta'),
        h('h3', {}, 'App do Instagram'),
        ok(st.ig_ready, 'IG_APP_ID e IG_APP_SECRET configurados', 'Falta colocar IG_APP_ID e IG_APP_SECRET na Vercel'),
        h('span', { class: 'muted', style: 'font-size:14px' }, 'Cole este endereço em "URLs de redirecionamento OAuth" no app da Meta:'),
        st.redirect_uri ? codeBox(st.redirect_uri, 'endereço') : null,
        st.app_url ? h('details', { class: 'meta-urls' },
          h('summary', {}, 'Links para a revisão da Meta'),
          st.legal_missing?.length ? h('div', { class: 'errorbox' }, `Preencha em "Dados da agência" (abaixo): ${st.legal_missing.join(', ')}. Esses dados aparecem na Política de Privacidade que a Meta confere.`) : null,
          h('span', { class: 'muted', style: 'font-size:14px' }, 'Política de privacidade:'), codeBox(`${st.app_url}/privacidade`, 'link'),
          h('span', { class: 'muted', style: 'font-size:14px' }, 'Termos de uso:'), codeBox(`${st.app_url}/termos`, 'link'),
          h('span', { class: 'muted', style: 'font-size:14px' }, 'Instruções de exclusão de dados:'), codeBox(`${st.app_url}/exclusao-de-dados`, 'link'),
          h('span', { class: 'muted', style: 'font-size:14px' }, 'URL de cancelamento de autorização (Deauthorize callback):'), codeBox(`${st.app_url}/api/pasta?r=igdeauth`, 'link'),
          h('span', { class: 'muted', style: 'font-size:14px' }, 'URL de solicitação de exclusão de dados (Data deletion request):'), codeBox(`${st.app_url}/api/pasta?r=igdelete`, 'link'),
          h('span', { class: 'muted', style: 'font-size:14px' }, 'Ícone do app 1024×1024:'), h('a', { class: 'btn sm', href: '/icons/app-icon-1024.png', download: 'mc-digital-1024.png' }, 'Baixar ícone')) : null),
      h('article', { class: 'card' },
        h('div', { class: 'eyebrow' }, 'Inteligência Artificial'),
        h('h3', {}, 'Legendas e hashtags com IA'),
        ok(st.ai_ready, 'IA ligada', 'IA desligada'),
        st.ai_ready
          ? h('span', { class: 'muted', style: 'font-size:14px' }, 'No post, clique em "✨ Legenda com IA". A IA lê a imagem e o tom de voz do cliente e sugere 3 legendas com hashtags.')
          : h('ol', { style: 'margin:0;padding-left:18px;display:grid;gap:6px;font-size:14px' },
              h('li', {}, 'Crie uma conta em console.anthropic.com e adicione créditos (o uso é cobrado por legenda gerada; você define um limite de gasto).'),
              h('li', {}, 'Em API Keys, clique em Create Key e copie a chave.'),
              h('li', {}, 'Na Vercel, adicione a variável ANTHROPIC_API_KEY com essa chave e faça Redeploy.'))),
      h('article', { class: 'card', style: 'grid-column:1/-1' },
        h('div', { class: 'eyebrow' }, 'Etapa 4 · Agendador'),
        h('h3', {}, 'Publicação automática a cada 5 minutos'),
        st.publisher_last_run
          ? ok(ago <= 15, `Funcionando · última execução há ${ago} min`, `Última execução há ${ago} min — confira o agendador no Supabase`)
          : ok(false, '', 'Ainda não configurado'),
        st.publisher_state_error ? h('div', { class: 'errorbox', translate: 'no' }, h('b', {}, 'Detalhe técnico: '), st.publisher_state_error) : null,
        st.cron_sql
          ? (() => {
              // o código secreto nunca aparece na tela; "Copiar comando" leva o texto completo
              const box = [h('span', { class: 'muted', style: 'font-size:14px' }, 'No Supabase, abra SQL Editor → New query, cole o comando abaixo e clique em Run. Ele já vem com o seu endereço e o código secreto (escondido na tela); não precisa mudar nada.'),
                codeBox(st.cron_sql, 'comando', st.cron_sql.replace(/Bearer [^']+/, 'Bearer ••••••••••••'))];
              return ago != null && ago <= 15 ? h('details', {}, h('summary', { class: 'muted', style: 'cursor:pointer;font-size:14px' }, 'Ver o comando do agendador'), ...box) : box;
            })()
          : h('span', { class: 'muted' }, 'Aparece aqui depois que o banco de dados estiver configurado.'),
        h('button', { class: 'btn sm', style: 'justify-self:start', onclick: async () => { const s = await api('/api/session'); S.setup = s.setup; render(); toast('Atualizado.'); } }, 'Verificar de novo')),
    ),
  ];
  const sections = [
    ['sistema', 'Sistema e publicação', sistema],
    ['conexoes', 'Conexões do Instagram', settingsConnections()],
    ['equipe', 'Equipe e acessos', settingsTeam()],
    ['agencia', 'Agência e contrato', settingsContract()],
    ['cobranca', 'Cobrança e Pix', settingsPix()],
    ['vendas', 'Diagnóstico e boas-vindas', [...settingsDiag(), ...settingsOnboarding()]],
    ['avisos', 'Notificações e e-mails', [...settingsDevice(), ...settingsMail()]],
    ['seguranca', 'Segurança, privacidade e backup', [...settingsSecurity(), ...settingsPrivacy(), ...settingsBackup()]],
  ].map(([id, label, items]) => [id, label, (items || []).filter(Boolean)]).filter(([, , items]) => items.length);
  if (S.setTab === undefined) S.setTab = savedPref('mc_set_tab', 'sistema');
  const cur = sections.find(([id]) => id === S.setTab) || sections[0];
  const pick = (id) => { S.setTab = id; savePref('mc_set_tab', id); render(); scrollTo({ top: 0 }); };
  return [
    h('div', { class: 'page-head' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Agência'), h('h1', {}, 'Ajustes'))),
    h('div', { class: 'set-layout' },
      h('nav', { class: 'set-nav', 'aria-label': 'Seções dos ajustes' },
        ...sections.map(([id, label]) => h('button', { type: 'button', class: 'set-link', 'aria-current': id === cur[0] ? 'page' : null, onclick: () => pick(id) }, label))),
      h('div', { class: 'set-body' }, h('h2', { class: 'set-title' }, cur[1]), ...cur[2])),
  ];
}

// Topo de Ajustes: o estado do sistema em três cartões
function statusOverview(st, ago) {
  const dead = S.clients.filter(connectionDead).length;
  const conn = S.clients.filter((c) => c.ig_connected && !connectionDead(c)).length;
  const tile = (tone, label, big, sub) => h('div', { class: `set-stat ${tone}` }, h('span', { class: 'set-stat-l' }, label), h('b', {}, big), h('span', { class: 'muted' }, sub));
  return h('div', { class: 'set-stats' },
    st.publisher_last_run ? tile(ago <= 15 ? 'ok' : 'bad', 'Publicação automática', ago <= 15 ? 'Funcionando' : 'Parada', `Última rodada há ${ago} min`) : tile('warn', 'Publicação automática', 'Não configurada', 'Veja a etapa 4 abaixo'),
    tile(dead ? 'bad' : 'ok', 'Conexões do Instagram', dead ? `${dead} caiu` : `${conn} funcionando`, dead ? 'Envie o link para reconectar' : 'Testadas automaticamente'),
    tile(st.ig_ready ? 'ok' : 'warn', 'App da Meta', st.ig_ready ? 'Configurado' : 'Falta configurar', 'IG_APP_ID e IG_APP_SECRET'));
}

// Ajustes → conexões: todas as contas, quando foram testadas e o link para o cliente reconectar
function settingsConnections() {
  const list = S.clients.filter((c) => !c.own || c.ig_connected);
  if (!list.length) return [];
  const row = (c) => {
    const dead = connectionDead(c);
    const state = c.production_only && !c.ig_connected ? ['', 'Só produção · o cliente posta'] : dead ? ['bad', 'Caiu · senha trocada ou acesso removido'] : c.ig_connected ? ['ok', c.ig_health?.at ? `Funcionando · testada ${fmtDate(c.ig_health.at, S.tz)} ${fmtTime(c.ig_health.at, S.tz)}` : 'Conectado'] : ['warn', 'Sem Instagram conectado'];
    return h('div', { class: 'conn-row' },
      h('span', { class: `dot ${state[0] === 'ok' ? 'good' : state[0]}` }),
      h('span', { class: 'conn-main' }, h('b', {}, c.ig_username ? `@${c.ig_username}` : c.name), h('span', { class: 'muted' }, `${c.ig_username ? `${c.name} · ` : ''}${state[1]}`)),
      can('clientes') && c.connect_url && needsConnect(c) ? h('button', { class: 'btn primary sm', type: 'button', onclick: () => openConnectShare(c) }, dead ? 'Enviar link para reconectar' : 'Enviar link de conexão') : null);
  };
  return [h('article', { class: 'card' },
    h('span', { class: 'muted', style: 'font-size:14px' }, 'O app testa todas as conexões toda manhã e a cada 6 horas. Se alguma cair, você recebe um aviso no celular. O mais seguro é o próprio cliente conectar pelo celular dele, com o link.'),
    h('div', { class: 'conn-list' }, ...list.map(row)),
    can('clientes') ? h('button', { class: 'btn sm', style: 'justify-self:start', type: 'button', onclick: async (e) => { const b = e.currentTarget; b.disabled = true; b.textContent = 'Testando…'; try { const r = await api('/api/clients', { method: 'PUT' }); S.clients = await api('/api/clients'); render(); toast(r.dead?.length ? `Conexão caiu: ${r.dead.join(', ')}.` : 'Todas as conexões funcionando.', Boolean(r.dead?.length)); } catch (err) { toast(err.message, true); b.disabled = false; b.textContent = 'Testar agora'; } } }, 'Testar agora') : null)];
}

// Ajustes → dados da agência e modelo de contrato
function settingsContract() {
  if (S.settings === undefined) {
    S.settings = null;
    api('/api/pasta?r=settings').then((v) => { S.settings = v; }).catch(() => { S.settings = false; }).finally(() => { if (S.view === 'ajustes') render(); });
  }
  const head = h('div', { class: 'page-head', style: 'margin-top:12px' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Pastas dos clientes'), h('h2', { style: 'font-size:22px' }, 'Contrato')));
  if (!S.settings) return [head, h('p', { class: 'muted' }, S.settings === false ? 'Disponível depois da atualização do banco de dados.' : 'Carregando…')];
  const A = S.settings.agency || {};
  const fields = [['razao_social', 'Razão social (como no CNPJ)', '00.000.000 NOME COMPLETO'], ['qualificacao', 'Tipo da empresa', 'Empresária Individual'],
    ['cnpj', 'CNPJ', '00.000.000/0001-00'], ['endereco', 'Endereço completo', 'Rua, número, bairro, Cuiabá/MT, CEP 00.000-000'],
    ['cidade', 'Cidade/UF (foro e assinatura)', 'Cuiabá/MT'], ['representante', 'Representante legal (quem assina)', 'Nome completo'],
    ['representante_cpf', 'CPF do representante', '000.000.000-00'], ['email', 'E-mail', 'contato@…'], ['pix', 'Chave PIX', ''],
    ['marca', 'Marca no rodapé do contrato', 'MCAROLINA DIGITAL'], ['slogan', 'Linha abaixo da marca', 'SOCIAL MEDIA | VIDEO MAKER']];
  const inputs = {};
  const agencyCard = h('article', { class: 'card', style: 'grid-column:1/-1' },
    h('div', { class: 'eyebrow' }, 'Contratada'), h('h3', {}, 'Dados da agência'),
    h('span', { class: 'muted', style: 'font-size:13.5px' }, 'Use os dados do CNPJ que vai assinar os contratos. Entram em todos os contratos gerados.'),
    h('div', { class: 'grid-2 tight' }, ...fields.map(([k, label, ph]) => { inputs[k] = h('input', { id: `ag-${k}`, value: A[k] || '', placeholder: ph }); return h('div', { class: 'field' }, h('label', { for: `ag-${k}` }, label), inputs[k]); })),
    h('button', { class: 'btn primary sm', style: 'justify-self:start', onclick: async (e) => {
      e.target.disabled = true;
      try { S.settings = await api('/api/pasta?r=settings', { method: 'PUT', body: { agency: Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value])) } }); S.folder.id = null; toast('Dados da agência salvos.'); render(); }
      catch (err) { toast(err.message, true); e.target.disabled = false; }
    } }, 'Salvar dados'));
  const ta = h('textarea', { id: 'tpl', class: 'mono tpl', spellcheck: 'false', translate: 'no', value: S.settings.contract_template });
  const insert = (key) => {
    const tag = `{{${key}}}`; const a = ta.selectionStart ?? ta.value.length;
    ta.setRangeText(tag, a, ta.selectionEnd ?? a, 'end'); ta.focus();
  };
  const tplCard = h('article', { class: 'card', style: 'grid-column:1/-1' },
    h('div', { class: 'eyebrow' }, S.settings.template_is_default ? 'Modelo padrão MC Digital' : 'Modelo personalizado'), h('h3', {}, 'Modelo de contrato'),
    h('span', { class: 'muted', style: 'font-size:13.5px' }, 'O modelo padrão é o contrato da MC Digital (quadro resumo, 19 cláusulas, marca-d\'água e rodapé). Os campos entre {{ }} são preenchidos com os dados do cliente. "# " vira o cabeçalho de todas as páginas, "## " vira cláusula, **texto** fica destacado, linhas com "|" viram tabela, ">> " alinha à direita, {{assinaturas}} cria as assinaturas, {{se campo}}…{{fim}} só aparece quando o campo está preenchido e o bloco "!rodape" define o rodapé.'),
    h('div', { class: 'pick tpl-fields' }, ...Object.entries({ ...S.settings.fields, assinaturas: 'Linhas de assinatura' }).map(([k, label]) =>
      h('button', { class: 'chip', type: 'button', title: label, onclick: () => insert(k) }, label))),
    ta,
    h('div', { class: 'actions' },
      h('label', { class: 'btn sm', style: 'cursor:pointer' }, 'Carregar de arquivo .txt',
        h('input', { type: 'file', accept: '.txt,text/plain', hidden: true, onchange: async (e) => {
          const f = e.target.files[0]; if (!f) return;
          ta.value = await f.text(); toast('Modelo carregado. Confira e clique em Salvar modelo.');
        } })),
      h('button', { class: 'btn primary sm', onclick: async (e) => {
        e.target.disabled = true;
        try { S.settings = await api('/api/pasta?r=settings', { method: 'PUT', body: { contract_template: ta.value } }); S.folder.id = null; toast('Modelo salvo. Os próximos contratos já saem com ele.'); render(); }
        catch (err) { toast(err.message, true); e.target.disabled = false; }
      } }, 'Salvar modelo'),
      S.settings.template_is_default ? null : confirmButton('Voltar ao modelo padrão', 'Confirmar: apaga o modelo personalizado', async () => {
        S.settings = await api('/api/pasta?r=settings', { method: 'PUT', body: { contract_template: '' } }); render(); toast('Modelo padrão restaurado.');
      }, 'btn ghost sm')));
  return [head, h('div', { class: 'grid-clients' }, agencyCard, tplCard)];
}

// ───────────────────────── Ajustes → equipe
function settingsTeam() {
  if (S.team === undefined) {
    S.team = null;
    api('/api/pasta?r=users').then((v) => { S.team = v; }).catch(() => { S.team = false; }).finally(() => { if (S.view === 'ajustes') render(); });
  }
  const head = h('div', { class: 'page-head', style: 'margin-top:12px' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Acessos'), h('h2', { style: 'font-size:22px' }, 'Equipe')),
    h('div', { class: 'spacer' }), S.team ? h('button', { class: 'btn primary sm', onclick: () => openMember() }, '+ Adicionar pessoa') : null);
  if (S.team === false) return [head, h('p', { class: 'muted' }, 'Disponível depois da atualização do banco de dados.')];
  if (!S.team) return [head, h('p', { class: 'muted' }, 'Carregando…')];
  return [head, h('article', { class: 'card' },
    h('span', { class: 'muted', style: 'font-size:13.5px' }, 'Cada pessoa entra com o próprio e-mail e senha. Em "Editar" você escolhe exatamente o que ela acessa (posts, IA, marca, relatórios, financeiro, vendas…) e de quais clientes. "Administrador" vê tudo, inclusive Ajustes. Você (senha principal) é sempre administrador.'),
    S.team.length ? h('div', { class: 'charge-list' }, ...S.team.map((u) => h('div', { class: 'charge' },
      h('div', {}, h('b', {}, u.name), ' ', h('span', { class: `pill ${u.active ? (u.role === 'admin' ? 'st-published' : 'st-internal_review') : 'st-draft'}` }, u.active ? (u.role === 'admin' ? 'Administrador' : 'Equipe') : 'Desativado'),
        h('div', { class: 'muted', style: 'font-size:13px' }, u.email),
        u.role !== 'admin' ? h('div', { class: 'perm-sum' }, ...PERMS.filter(([k]) => (u.perms || TEAM_DEFAULT)[k]).map(([, l]) => h('span', { class: 'pill st-draft' }, l)),
          h('span', { class: 'pill st-pending_approval' }, u.client_ids?.length ? `${u.client_ids.length} cliente(s)` : 'Todos os clientes')) : null),
      h('button', { class: 'btn sm', onclick: () => openMember(u) }, 'Editar'))))
      : h('p', { class: 'muted files-empty' }, 'Só você por enquanto.'))];
}
function openMember(u = null) {
  const name = h('input', { id: 'u-name', value: u?.name || '', placeholder: 'Nome' });
  const email = h('input', { id: 'u-email', type: 'email', value: u?.email || '', placeholder: 'pessoa@email.com', disabled: Boolean(u) });
  const pw = h('input', { id: 'u-pw', type: 'password', autocomplete: 'new-password', placeholder: u ? 'deixe em branco para manter' : 'mínimo 8 caracteres' });
  let role = u?.role || 'team';
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Papel' }, ...[['team', 'Equipe'], ['admin', 'Administrador']].map(([k, l]) => h('button', { type: 'button', class: 'seg-btn', 'aria-pressed': String(role === k),
    onclick: (e) => { role = k; for (const b of seg.children) b.setAttribute('aria-pressed', String(b === e.currentTarget)); drawPerms(); } }, l)));
  // permissões (só para "Equipe")
  const perms = { ...TEAM_DEFAULT, ...(u?.perms || {}) };
  let onlySome = Boolean(u?.client_ids?.length);
  const chosen = new Set(u?.client_ids || []);
  const permBox = h('div', { class: 'perm-box' });
  const drawPerms = () => {
    permBox.hidden = role === 'admin';
    permBox.replaceChildren(
      h('div', { class: 'perm-head' }, h('b', {}, 'O que pode fazer'), h('span', { class: 'muted' }, 'Marque só o que a pessoa precisa.')),
      ...PERMS.map(([k, label, hint]) => h('label', { class: 'perm' }, h('input', { type: 'checkbox', checked: perms[k], onchange: (e) => { perms[k] = e.target.checked; if (k === 'conteudo' && !e.target.checked) { perms.enviar = false; perms.apagar = false; drawPerms(); } } }),
        h('span', {}, h('b', {}, label), hint ? h('small', {}, hint) : null))),
      h('div', { class: 'perm-head', style: 'margin-top:8px' }, h('b', {}, 'Quais clientes')),
      h('div', { class: 'seg', role: 'group' }, ...[[false, 'Todos os clientes'], [true, 'Só alguns']].map(([v, l]) => h('button', { type: 'button', class: 'seg-btn', 'aria-pressed': String(onlySome === v), onclick: () => { onlySome = v; drawPerms(); } }, l))),
      onlySome ? h('div', { class: 'pick' }, ...S.clients.map((c) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(chosen.has(c.id)), onclick: () => { if (chosen.has(c.id)) chosen.delete(c.id); else chosen.add(c.id); drawPerms(); } }, c.name))) : null,
      onlySome ? h('span', { class: 'hint muted' }, 'A pessoa só vê posts, calendário, pastas e pedidos desses clientes.') : null);
  };
  const access = () => (role === 'admin' ? {} : { perms, client_ids: onlySome ? [...chosen] : null });
  const done = (row, msg) => { S.team = [...S.team.filter((x) => x.id !== row.id), row].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')); close(); render(); toast(msg); };
  const foot = [];
  if (u) foot.push(
    confirmButton('Excluir', 'Confirmar exclusão', async () => { await api(`/api/pasta?r=users&id=${u.id}`, { method: 'DELETE' }); S.team = S.team.filter((x) => x.id !== u.id); close(); render(); toast('Conta excluída.'); }, 'btn ghost danger'),
    h('button', { class: 'btn ghost', onclick: async () => { try { done(await api('/api/pasta?r=users', { method: 'PATCH', body: { id: u.id, active: !u.active } }), u.active ? 'Acesso desativado.' : 'Acesso reativado.'); } catch (e) { toast(e.message, true); } } }, u.active ? 'Desativar' : 'Reativar'));
  foot.push(h('span', { class: 'spacer' }), h('button', { class: 'btn primary', onclick: async () => {
    try {
      const row = u
        ? await api('/api/pasta?r=users', { method: 'PATCH', body: { id: u.id, name: name.value, role, password: pw.value || undefined, ...access() } })
        : await api('/api/pasta?r=users', { method: 'POST', body: { name: name.value, email: email.value, role, password: pw.value, ...access() } });
      if (onlySome && role !== 'admin' && !chosen.size) return toast('Escolha pelo menos um cliente ou marque "Todos os clientes".', true);
      done(row, u ? 'Conta atualizada. Vale no próximo clique da pessoa (se estiver logada, ela só precisa atualizar a página).' : `Conta criada. Mande o e-mail e a senha para ${row.name} entrar.`);
    } catch (e) { toast(e.message, true); }
  } }, u ? 'Salvar' : 'Criar conta'));
  const close = drawer(u ? `Equipe · ${u.name}` : 'Nova pessoa na equipe', [
    h('div', { class: 'field' }, h('label', { for: 'u-name' }, 'Nome'), name),
    h('div', { class: 'field' }, h('label', { for: 'u-email' }, 'E-mail (login)'), email),
    h('div', { class: 'field' }, h('label', { for: 'u-pw' }, u ? 'Nova senha' : 'Senha inicial'), pw, h('span', { class: 'hint' }, 'Combine a senha com a pessoa por um canal seguro.')),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Papel'), seg, h('span', { class: 'hint' }, 'Administrador vê e faz tudo, inclusive Ajustes e as contas da equipe.')),
    permBox,
  ], foot);
  drawPerms();
  name.focus();
}

// ───────────────────────── Pix automático (Asaas)
function openPix(c, m, p) {
  const box = h('div', { class: 'pix-box' }, h('p', { class: 'muted' }, 'Gerando o Pix…'));
  drawer(`Pix · ${c.name}`, [box], []);
  api('/api/pasta?r=pix', { method: 'POST', body: { client_id: c.id, month: m.month, n: p.n } }).then((r) => {
    const msg = `Olá! Segue o Pix ${r.label.toLowerCase()} (${brlRaw(r.value_cents)}), vencimento ${fmtDay(r.due)}.\n\nPix copia e cola:\n${r.payload}\n\nAssim que pagar, a baixa é automática por aqui. Obrigado! 🙂`;
    box.replaceChildren(
      h('div', { class: 'eyebrow' }, r.label),
      h('div', { class: 'stat-v' }, brl(r.value_cents)),
      h('span', { class: 'muted', style: 'font-size:13.5px' }, `Vencimento ${fmtDay(r.due)} · cobrança exclusiva desta parcela: quando o cliente pagar, ela é baixada sozinha e o comprovante fica no financeiro.`),
      r.image ? h('img', { class: 'pix-qr', src: r.image, alt: 'QR Code do Pix' }) : null,
      h('div', { class: 'linkbox' }, h('code', { translate: 'no' }, r.payload), h('button', { class: 'btn sm', onclick: () => copyText(r.payload, 'Pix copia e cola copiado.') }, 'Copiar')),
      h('div', { class: 'actions' },
        c.contact_whatsapp ? h('a', { class: 'btn wa', href: waLink(c.contact_whatsapp, msg), target: '_blank', rel: 'noopener' }, 'Enviar no WhatsApp') : null,
        h('button', { class: 'btn', onclick: () => copyText(msg, 'Mensagem copiada.') }, 'Copiar mensagem')));
    const i = S.payments.findIndex((x) => x.client_id === c.id && x.ref_month === m.month && (x.installment || 1) === p.n);
    const row = { client_id: c.id, ref_month: m.month, installment: p.n, status: 'pending', amount_cents: r.value_cents, asaas_id: r.asaas_id, pix_payload: r.payload };
    if (i >= 0) S.payments[i] = { ...S.payments[i], ...row }; else S.payments.push(row);
  }).catch((e) => box.replaceChildren(h('div', { class: 'errorbox' }, e.message)));
}

function settingsPix() {
  const st = S.setup || {};
  const head = h('div', { class: 'page-head', style: 'margin-top:12px' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Financeiro'), h('h2', { style: 'font-size:22px' }, 'Pix automático')));
  if (!st.asaas) {
    return [head, h('article', { class: 'card' },
      h('span', { class: 'ig-warn' }, '• Desligado'),
      h('span', { class: 'muted', style: 'font-size:14px' }, 'Com o Pix automático, cada parcela ganha um Pix exclusivo (QR Code e copia-e-cola). Quando o cliente paga, o app dá baixa sozinho e guarda o comprovante. Usa o Asaas como cobrador (o Nubank não tem integração de Pix): R$ 1,99 por Pix recebido (R$ 0,99 nos 3 primeiros meses), sem custo para gerar.'),
      h('ol', { style: 'margin:0;padding-left:18px;display:grid;gap:6px;font-size:14px' },
        h('li', {}, 'Crie a conta PJ no asaas.com com o CNPJ da agência e cadastre uma chave Pix dentro do Asaas.'),
        h('li', {}, 'No Asaas, ative a transferência automática do saldo para a sua conta Nubank (assim o dinheiro chega lá sozinho).'),
        h('li', {}, 'Em Integrações → Chave de API, gere a chave e copie.'),
        h('li', {}, 'Na Vercel, adicione a variável ASAAS_API_KEY com essa chave e faça Redeploy. Volte aqui para ligar o aviso automático.')),
      h('span', { class: 'hint muted' }, 'Quer testar antes sem dinheiro de verdade? Use uma chave do sandbox do Asaas (começa com $aact_hmlg_). Depois troque pela de produção.'))];
  }
  if (S.pixStatus === undefined) { S.pixStatus = null; api('/api/pasta?r=pix').then((v) => { S.pixStatus = v; }).catch((e) => { S.pixStatus = { error: e.message }; }).finally(() => { if (S.view === 'ajustes') render(); }); }
  const ps = S.pixStatus;
  const email = h('input', { type: 'email', id: 'asaas-mail', value: S.settings?.agency?.email || '', placeholder: 'e-mail para avisos de falha' });
  const hookOk = ps?.webhook?.enabled && !ps.webhook.interrupted;
  return [head, h('article', { class: 'card' },
    ps === null ? h('span', { class: 'muted' }, 'Verificando a conexão com o Asaas…')
      : ps.error ? h('div', { class: 'errorbox' }, h('b', {}, 'Asaas: '), ps.error)
      : h('span', { class: 'ig-ok' }, `✓ Conectado ao Asaas (${st.asaas.env === 'sandbox' ? 'modo teste/sandbox' : 'produção'})${ps.account?.balance != null ? ` · saldo ${brl(Math.round(ps.account.balance * 100))}` : ''}`),
    ps && !ps.error ? (hookOk ? h('span', { class: 'ig-ok' }, '✓ Baixa automática ligada') : h('span', { class: 'ig-warn' }, ps.webhook?.interrupted ? '• Aviso automático pausado pelo Asaas (falhas seguidas) — ligue de novo' : '• Baixa automática ainda não ligada')) : null,
    h('div', { class: 'field' }, h('label', { for: 'asaas-mail' }, 'E-mail para o Asaas avisar se algo falhar'), email),
    h('div', { class: 'actions' },
      h('button', { class: `btn ${hookOk ? '' : 'primary'} sm`, onclick: async (e) => {
        e.target.disabled = true;
        try { await api('/api/pasta?r=pix&setup=1', { method: 'POST', body: { email: email.value } }); S.pixStatus = undefined; toast('Baixa automática ligada.'); render(); }
        catch (err) { toast(err.message, true); e.target.disabled = false; }
      } }, hookOk ? 'Reconfigurar aviso' : 'Ligar baixa automática')),
    h('span', { class: 'muted', style: 'font-size:13px' }, 'Como usar: no Financeiro de cada cliente aparece o botão "Pix" nas parcelas em aberto; na área do cliente aparece "Pagar com Pix". As mensagens de cobrança já levam o link. Se você der baixa manual numa parcela com Pix gerado, o app cancela a cobrança no Asaas.')), nfCard()];
}

// ───────────────────────── verificação em duas etapas
function loadScript(src) { return new Promise((ok, bad) => { if (document.querySelector(`script[src="${src}"]`)) return ok(); const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = bad; document.head.append(s); }); }
function settingsSecurity() {
  if (S.sec === undefined) { S.sec = null; api('/api/pasta?r=security').then((v) => { S.sec = v; }).catch(() => { S.sec = false; }).finally(() => { if (S.view === 'ajustes') render(); }); }
  const head = h('div', { class: 'page-head', style: 'margin-top:12px' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Segurança'), h('h2', { style: 'font-size:22px' }, 'Verificação em duas etapas')));
  const card = h('article', { class: 'card' });
  if (S.sec === false) card.append(h('span', { class: 'muted' }, 'Disponível depois da atualização do banco de dados.'));
  else if (!S.sec) card.append(h('span', { class: 'muted' }, 'Carregando…'));
  else if (S.sec.enabled) {
    const code = h('input', { class: 'mono otp', inputmode: 'numeric', maxlength: 7, placeholder: '000000', 'aria-label': 'Código atual' });
    card.append(h('span', { class: 'ig-ok' }, '✓ Ligada: para entrar, além da senha, pede o código do app autenticador'),
      S.sec.disabled_by_env ? h('div', { class: 'errorbox' }, 'A variável DISABLE_2FA=1 está ativa na Vercel: o código não está sendo pedido. Apague-a e faça Redeploy assim que recuperar o acesso.') : null,
      h('span', { class: 'muted', style: 'font-size:13.5px' }, 'Perdeu o celular? Na Vercel, crie a variável DISABLE_2FA com valor 1, faça Redeploy, entre só com a senha, desligue e ative de novo no celular novo. Depois apague a variável.'),
      h('div', { class: 'actions' }, code, h('button', { class: 'btn ghost sm', onclick: async (e) => {
        e.target.disabled = true;
        try { S.sec = await api('/api/pasta?r=security', { method: 'DELETE', body: { code: code.value } }); toast('Verificação em duas etapas desligada.'); render(); }
        catch (err) { toast(err.message, true); e.target.disabled = false; }
      } }, 'Desligar')));
  } else {
    const box = h('div', { style: 'display:grid;gap:12px' });
    card.append(h('span', { class: 'ig-warn' }, '• Desligada'),
      h('span', { class: 'muted', style: 'font-size:13.5px' }, 'Protege o painel (financeiro, contratos, dados dos clientes) mesmo se alguém descobrir a sua senha: para entrar, também é preciso o código de 6 números que muda a cada 30 segundos no seu celular. Use Google Authenticator, Microsoft Authenticator ou Authy (grátis).'),
      box);
    const start = h('button', { class: 'btn primary sm', style: 'justify-self:start', onclick: async () => {
      start.disabled = true;
      try {
        const r = await api('/api/pasta?r=security', { method: 'POST', body: { start: 1 } });
        const qr = h('div', { class: 'qr' });
        const code = h('input', { class: 'mono otp', inputmode: 'numeric', maxlength: 7, placeholder: '000000', 'aria-label': 'Código de 6 números' });
        box.replaceChildren(
          h('ol', { class: 'steps-ol' }, h('li', {}, 'No app autenticador, toque em + e escaneie o QR Code.'), h('li', {}, 'Digite abaixo o código de 6 números que apareceu para MC DIGITAL.')),
          qr, h('div', { class: 'linkbox' }, h('code', { translate: 'no' }, r.secret.replace(/(.{4})/g, '$1 ').trim()), h('button', { class: 'btn sm', onclick: () => copyText(r.secret, 'Chave copiada.') }, 'Copiar chave')),
          h('div', { class: 'actions' }, code, h('button', { class: 'btn primary sm', onclick: async (e) => {
            e.target.disabled = true;
            try { S.sec = await api('/api/pasta?r=security', { method: 'POST', body: { code: code.value } }); S.sec = { ...S.sec, enabled: true }; toast('Verificação em duas etapas ligada. No próximo login o app pede o código.'); render(); }
            catch (err) { toast(err.message, true); e.target.disabled = false; }
          } }, 'Confirmar e ligar')));
        try { await loadScript('https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'); new window.QRCode(qr, { text: r.otpauth, width: 180, height: 180, correctLevel: window.QRCode.CorrectLevel.M }); }
        catch { qr.append(h('span', { class: 'muted' }, 'Não consegui desenhar o QR Code: no app, escolha "inserir chave" e cole a chave abaixo.')); }
        code.focus();
      } catch (e) { toast(e.message, true); start.disabled = false; }
    } }, 'Ativar no meu celular');
    box.append(start);
  }
  return [head, h('div', { class: 'grid-clients' }, card)];
}

// ───────────────────────── e-mails automáticos
function settingsMail() {
  const st = S.setup || {};
  const head = h('div', { class: 'page-head', style: 'margin-top:12px' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Clientes'), h('h2', { style: 'font-size:22px' }, 'E-mails automáticos')));
  if (!st.mail_ready) {
    return [head, h('article', { class: 'card' }, h('span', { class: 'ig-warn' }, '• Desligados'),
      h('span', { class: 'muted', style: 'font-size:14px' }, 'O app manda sozinho, para o e-mail de cada cliente: posts esperando aprovação (agrupados), lembrete quando o post sai em 48 h sem aprovação, lembrete de mensalidade (2 dias antes e no dia seguinte ao vencimento, com o Pix) e "seu relatório do mês está pronto".'),
      h('ol', { class: 'steps-ol' },
        h('li', {}, 'Crie uma conta grátis em resend.com (3.000 e-mails/mês grátis).'),
        h('li', {}, 'Em Domains, adicione o domínio da agência e copie os registros DNS que ele mostrar para o seu provedor de domínio (sem domínio próprio, o Resend só entrega para o seu próprio e-mail — dá para testar).'),
        h('li', {}, 'Em API Keys, crie uma chave. Na Vercel, adicione RESEND_API_KEY com ela e MAIL_FROM com o remetente, ex.: MC DIGITAL <contato@seudominio.com.br>. Faça Redeploy.')))];
  }
  if (S.mail === undefined) { S.mail = null; api('/api/pasta?r=mailcfg').then((v) => { S.mail = v; }).catch(() => { S.mail = false; }).finally(() => { if (S.view === 'ajustes') render(); }); }
  if (!S.mail) return [head, h('article', { class: 'card' }, h('span', { class: 'muted' }, S.mail === false ? 'Disponível depois da atualização do banco de dados.' : 'Carregando…'))];
  const labels = { approval: 'Posts enviados para aprovação', reminder: 'Lembrete de aprovação (post sai em 48 h)', charge: 'Lembrete de mensalidade', report: 'Relatório do mês pronto' };
  const to = h('input', { type: 'email', value: S.settings?.agency?.email || '', placeholder: 'seu@email.com', 'aria-label': 'E-mail para teste' });
  return [head, h('article', { class: 'card' },
    h('span', { class: 'ig-ok' }, `✓ Ligados · remetente ${S.mail.from}`),
    h('div', { class: 'toggles' }, ...Object.entries(labels).map(([k, l]) => h('label', { class: 'toggle' },
      h('input', { type: 'checkbox', checked: S.mail.settings[k], onchange: async (e) => {
        try { S.mail = { ...S.mail, ...(await api('/api/pasta?r=mailcfg', { method: 'PUT', body: { [k]: e.target.checked } })) }; toast('Salvo.'); } catch (err) { toast(err.message, true); e.target.checked = !e.target.checked; }
      } }), h('span', {}, l)))),
    h('span', { class: 'hint muted' }, 'Vai para o e-mail cadastrado em cada cliente (Clientes → Editar). As respostas chegam no e-mail da agência.'),
    h('div', { class: 'actions' }, to, h('button', { class: 'btn sm', onclick: async (e) => {
      e.target.disabled = true;
      try { await api('/api/pasta?r=mailcfg', { method: 'POST', body: { to: to.value } }); toast('E-mail de teste enviado. Confira a caixa de entrada (e o spam).'); } catch (err) { toast(err.message, true); }
      e.target.disabled = false;
    } }, 'Enviar e-mail de teste')),
    S.mail.recent?.length ? h('details', {}, h('summary', { class: 'muted' }, `Últimos envios (${S.mail.recent.length})`),
      h('ul', { class: 'mail-log' }, ...S.mail.recent.map((m) => h('li', {}, h('span', { class: 'mono' }, `${fmtDate(m.sent_at, S.tz)} ${fmtTime(m.sent_at, S.tz)}`), ' ', ({ approval: 'aprovação', reminder: 'lembrete de aprovação', charge: 'cobrança', report: 'relatório' })[m.key.split(':')[0]] || m.key.split(':')[0], ' · ', clientName(m.key.split(':')[1]))))) : null)];
}

// ───────────────────────── backup
function settingsBackup() {
  if (S.backups === undefined) { S.backups = null; api('/api/pasta?r=backup').then((v) => { S.backups = v; }).catch(() => { S.backups = false; }).finally(() => { if (S.view === 'ajustes') render(); }); }
  if (S.backupCheck === undefined) { S.backupCheck = null; api('/api/pasta?r=backup&check=1').then((v) => { S.backupCheck = v || false; }).catch(() => { S.backupCheck = false; }).finally(() => { if (S.view === 'ajustes') render(); }); }
  const ck = S.backupCheck;
  const checkLine = ck ? h('span', { class: ck.ok ? 'ig-ok' : 'ig-warn' }, ck.ok
    ? `✓ Conferido ${fmtDate(ck.at, S.tz)}: o último backup abre e está inteiro (${ck.rows} registros${ck.tables?.clients != null ? `, ${ck.tables.clients} clientes` : ''})`
    : `• Problema na conferência de ${fmtDate(ck.at, S.tz)}: ${(ck.problems || []).join(' ')}`) : null;
  const checkBtn = h('button', { class: 'btn sm', onclick: async (e) => {
    e.target.disabled = true; e.target.textContent = 'Conferindo…';
    try { S.backupCheck = await api('/api/pasta?r=backup&check=1', { method: 'POST' }); toast(S.backupCheck?.ok ? 'Backup conferido: abre e está inteiro.' : 'Encontrei um problema no backup.', !S.backupCheck?.ok); render(); }
    catch (err) { toast(err.message, true); e.target.disabled = false; e.target.textContent = 'Conferir último backup'; }
  } }, 'Conferir último backup');
  const head = h('div', { class: 'page-head', style: 'margin-top:12px' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Proteção dos dados'), h('h2', { style: 'font-size:22px' }, 'Backup')));
  const list = S.backups || [];
  const last = list[0];
  const age = last ? Math.floor((Date.now() - new Date(last.at)) / 864e5) : null;
  return [head, h('article', { class: 'card' },
    S.backups === null ? h('span', { class: 'muted' }, 'Carregando…')
      : last ? h('span', { class: age <= 8 ? 'ig-ok' : 'ig-warn' }, `${age <= 8 ? '✓' : '•'} Último backup ${age === 0 ? 'hoje' : `há ${age} dia${age > 1 ? 's' : ''}`} · ${last.rows} registros`)
      : h('span', { class: 'ig-warn' }, '• Nenhum backup ainda (o primeiro sai sozinho na próxima rodada do agendador)'),
    h('span', { class: 'muted', style: 'font-size:13.5px' }, 'Toda semana o app copia sozinho todos os dados (clientes, posts, contratos, pagamentos, relatórios, propostas…) para um arquivo no cofre privado. Ficam as 8 últimas cópias. Baixe uma de vez em quando e guarde no seu Google Drive: se algo der errado no Supabase, os dados voltam a partir dele.'),
    list.length ? h('div', { class: 'backup-list' }, ...list.map((b) => h('div', { class: 'backup-row' },
      h('span', {}, h('b', {}, `${fmtDate(b.at, S.tz)} ${fmtTime(b.at, S.tz)}`), h('span', { class: 'muted' }, ` · ${b.reason === 'manual' ? 'manual' : 'automático'} · ${fileSize(b.size)}`)),
      h('a', { class: 'btn sm', href: `/api/pasta?r=backup&path=${encodeURIComponent(b.path)}` }, 'Baixar')))) : null,
    checkLine,
    h('div', { class: 'actions' }, h('button', { class: 'btn sm', onclick: async (e) => {
      e.target.disabled = true;
      try { const b = await api('/api/pasta?r=backup', { method: 'POST' }); S.backups = [b, ...(S.backups || []).filter((x) => x.path !== b.path)].slice(0, 8); toast('Backup feito.'); render(); }
      catch (err) { toast(err.message, true); e.target.disabled = false; }
    } }, 'Fazer backup agora'), list.length ? checkBtn : null),
    h('span', { class: 'hint muted' }, 'Toda semana o app também confere sozinho se o último backup abre e está inteiro, e avisa no celular se algo der errado. Para restaurar numa emergência, use o script scripts/restaurar-backup.mjs (veja o SETUP.md).'),
    h('span', { class: 'hint muted' }, 'O arquivo tem dados sensíveis (contratos, tokens do Instagram): guarde em lugar seguro e não compartilhe.'))];
}

// ───────────────────────── nota fiscal automática (dentro de Pix automático)
function nfCard() {
  if (S.nf === undefined) { S.nf = null; api('/api/pasta?r=nf').then((v) => { S.nf = v; }).catch(() => { S.nf = false; }).finally(() => { if (S.view === 'ajustes') render(); }); }
  if (!S.nf) return null;
  const n = S.nf.settings;
  const inp = (id, label, value, ph, hint) => { const el = h('input', { id, value: value ?? '', placeholder: ph }); return [el, h('div', { class: 'field' }, h('label', { for: id }, label), el, hint ? h('span', { class: 'hint' }, hint) : null)]; };
  const [desc, fDesc] = inp('nf-desc', 'Descrição do serviço na nota', n.service_description, 'Gestão de redes sociais (social media)');
  const [code, fCode] = inp('nf-code', 'Código do serviço municipal', n.municipal_service_code, 'Ex.: 17.06', 'Item da lista de serviços (LC 116) usado pela sua prefeitura. Para social media costuma ser 17.06 ou 17.01 — confirme com o contador.');
  const [name, fName] = inp('nf-name', 'Nome do serviço municipal (opcional)', n.municipal_service_name, 'Propaganda e publicidade…');
  const [iss, fIss] = inp('nf-iss', 'Alíquota de ISS (%)', String(n.iss ?? 0), '2', 'No Simples Nacional/MEI, use a que o contador indicar.');
  const [obs, fObs] = inp('nf-obs', 'Observações (opcional)', n.observations, 'Deixe em branco para "Mensalidade MM/AAAA"');
  const enabled = h('input', { type: 'checkbox', checked: n.enabled });
  return h('article', { class: 'card', style: 'margin-top:12px' },
    h('div', { class: 'eyebrow' }, 'Nota fiscal automática'), h('h3', {}, 'Emitir NFS-e quando o Pix cair'),
    h('span', { class: 'muted', style: 'font-size:13.5px' }, 'Quando o cliente paga o Pix, o Asaas emite a nota de serviço na prefeitura e o PDF autorizado vai sozinho para a pasta do cliente (Financeiro → Notas fiscais) e para a área dele. Antes, configure a emissão no Asaas: Notas fiscais → Configurações (dados da prefeitura, regime e certificado/senha, conforme a cidade).'),
    h('label', { class: 'toggle' }, enabled, h('span', {}, 'Emitir a nota automaticamente a cada Pix recebido')),
    fDesc, h('div', { class: 'grid-2 tight' }, fCode, fIss), fName, fObs,
    h('button', { class: 'btn primary sm', style: 'justify-self:start', onclick: async (e) => {
      e.target.disabled = true;
      try { S.nf = { ...S.nf, ...(await api('/api/pasta?r=nf', { method: 'PUT', body: { enabled: enabled.checked, service_description: desc.value, municipal_service_code: code.value, municipal_service_name: name.value, iss: iss.value, observations: obs.value } })) }; toast('Nota fiscal salva.'); render(); }
      catch (err) { toast(err.message, true); e.target.disabled = false; }
    } }, 'Salvar'),
    h('span', { class: 'hint muted' }, 'Depois de salvar, clique em "Reconfigurar aviso" acima uma vez, para o Asaas também avisar quando a nota for autorizada.'));
}

export { setupPending, viewSettings, settingsContract, settingsTeam, openMember, openPix, settingsPix, loadScript, settingsSecurity, settingsMail, settingsBackup, nfCard };
