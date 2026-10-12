// Gera o contrato de um cliente a partir do modelo (texto com campos {{assim}}).
//
// Formato do modelo (texto simples, fácil de editar na aba Ajustes):
//   - linha em branco separa parágrafos
//   - linha que começa com "# " vira título; com "## " vira subtítulo (ex.: cláusulas)
//   - **texto** fica em negrito
//   - {{assinaturas}} sozinho numa linha → linhas de assinatura (contratada, contratante e 2 testemunhas)
//   - campos: {{cliente.nome}}, {{contrato.valor}}, {{data.hoje}} … (lista em FIELDS)

export const FIELDS = {
  'agencia.razao_social': 'Razão social da agência',
  'agencia.cnpj': 'CNPJ da agência',
  'agencia.endereco': 'Endereço da agência',
  'agencia.cidade': 'Cidade/UF da agência (foro)',
  'agencia.representante': 'Representante da agência',
  'agencia.email': 'E-mail da agência',
  'agencia.pix': 'Chave PIX da agência',
  'cliente.nome': 'Nome / razão social do cliente',
  'cliente.documento': 'CPF ou CNPJ do cliente',
  'cliente.endereco': 'Endereço do cliente',
  'cliente.representante': 'Representante do cliente',
  'cliente.email': 'E-mail do cliente',
  'cliente.whatsapp': 'WhatsApp do cliente',
  'contrato.servicos': 'Serviços contratados',
  'contrato.valor': 'Valor mensal (R$ 1.500,00)',
  'contrato.valor_extenso': 'Valor mensal por extenso',
  'contrato.vencimento': 'Dia de vencimento',
  'contrato.inicio': 'Data de início',
  'contrato.prazo_meses': 'Prazo (meses)',
  'contrato.forma_pagamento': 'Forma de pagamento',
  'data.hoje': 'Data de hoje por extenso',
};

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export const brl = (cents) => (cents == null ? '' : (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));

export function dateLong(iso) { // '2026-10-12' → '12 de outubro de 2026'
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return `${d} de ${MESES[m - 1]} de ${y}`;
}

// ── valor por extenso (reais e centavos), até 999.999.999
const UN = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZ = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CEN = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
function ate999(n) {
  if (n === 0) return '';
  if (n === 100) return 'cem';
  const c = Math.floor(n / 100), r = n % 100, parts = [];
  if (c) parts.push(CEN[c]);
  if (r) parts.push(r < 20 ? UN[r] : DEZ[Math.floor(r / 10)] + (r % 10 ? ` e ${UN[r % 10]}` : ''));
  return parts.join(' e ');
}
function inteiro(n) {
  if (n === 0) return 'zero';
  const mi = Math.floor(n / 1e6), mil = Math.floor((n % 1e6) / 1000), resto = n % 1000, out = [];
  if (mi) out.push([mi, mi === 1 ? 'um milhão' : `${ate999(mi)} milhões`]);
  if (mil) out.push([mil, mil === 1 ? 'mil' : `${ate999(mil)} mil`]);
  if (resto) out.push([resto, ate999(resto)]);
  // "e" antes do último grupo quando ele é < 100 ou centena redonda (mil e quinhentos, dois milhões e quinhentos mil)
  const [lastN, lastTxt] = out.at(-1);
  if (out.length > 1 && (lastN < 100 || lastN % 100 === 0)) return `${out.slice(0, -1).map((x) => x[1]).join(' ')} e ${lastTxt}`;
  return out.map((x) => x[1]).join(' ');
}
export function valorPorExtenso(cents) {
  if (cents == null) return '';
  const reais = Math.floor(cents / 100), cent = cents % 100;
  const r = reais ? `${inteiro(reais)}${reais % 1e6 === 0 && reais >= 1e6 ? ' de' : ''} ${reais === 1 ? 'real' : 'reais'}` : '';
  const c = cent ? `${inteiro(cent)} ${cent === 1 ? 'centavo' : 'centavos'}` : '';
  return [r, c].filter(Boolean).join(' e ') || 'zero reais';
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

export function contractValues({ agency = {}, client = {}, today = new Date().toISOString() }) {
  const k = client.contract_data || {};
  const fee = client.monthly_fee_cents;
  return {
    'agencia.razao_social': agency.razao_social, 'agencia.cnpj': agency.cnpj, 'agencia.endereco': agency.endereco,
    'agencia.cidade': agency.cidade, 'agencia.representante': agency.representante, 'agencia.email': agency.email, 'agencia.pix': agency.pix,
    'cliente.nome': k.nome || client.name, 'cliente.documento': k.documento, 'cliente.endereco': k.endereco,
    'cliente.representante': k.representante, 'cliente.email': client.contact_email,
    'cliente.whatsapp': client.contact_whatsapp ? `+${client.contact_whatsapp}` : '',
    'contrato.servicos': k.servicos, 'contrato.valor': brl(fee), 'contrato.valor_extenso': valorPorExtenso(fee),
    'contrato.vencimento': client.due_day ? `dia ${client.due_day}` : '', 'contrato.inicio': dateLong(client.billing_start),
    'contrato.prazo_meses': k.prazo_meses ? `${k.prazo_meses} (${inteiro(Number(k.prazo_meses))}) meses` : '',
    'contrato.forma_pagamento': k.forma_pagamento, 'data.hoje': dateLong(today),
  };
}

// Bloco de assinaturas: escreva {{assinaturas}} sozinho numa linha do modelo.
function signatures(values, fill) {
  const line = (who, name, doc) => `<div class="ass"><div class="ass-linha"></div><b>${who}</b><br>${fill(name)}${doc ? `<br>${fill(doc)}` : ''}</div>`;
  const testemunha = (n) => `<div class="ass"><div class="ass-linha"></div><b>Testemunha ${n}</b><br>Nome:<br>CPF:</div>`;
  return `<div class="assinaturas">${line('CONTRATADA', '{{agencia.razao_social}}', 'CNPJ {{agencia.cnpj}}')}${line('CONTRATANTE', '{{cliente.nome}}', 'CPF/CNPJ {{cliente.documento}}')}${testemunha(1)}${testemunha(2)}</div>`;
}

// Devolve o HTML do contrato e a lista de campos que ficaram vazios.
export function renderContract(template, values) {
  const missing = new Set();
  const fill = (line) => esc(line)
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
      const v = values[key];
      if (v === undefined || v === null || v === '') { missing.add(key); return `<mark class="falta">[${esc(FIELDS[key] || key)}]</mark>`; }
      return `<span class="campo${String(v).length > 80 ? ' longo' : ''}">${esc(v).replace(/\n/g, '<br>')}</span>`;
    })
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  const html = String(template || '').replace(/\r\n/g, '\n').split(/\n{2,}/).map((block) => {
    const t = block.trim();
    if (!t) return '';
    if (t === '{{assinaturas}}') return signatures(values, fill);
    if (t.startsWith('## ')) return `<h2>${fill(t.slice(3))}</h2>`;
    if (t.startsWith('# ')) return `<h1>${fill(t.slice(2))}</h1>`;
    return `<p>${t.split('\n').map(fill).join('<br>')}</p>`;
  }).join('\n');
  return { html, missing: [...missing] };
}

export const DEFAULT_TEMPLATE = `# CONTRATO DE PRESTAÇÃO DE SERVIÇOS

**CONTRATADA:** {{agencia.razao_social}}, CNPJ {{agencia.cnpj}}, com sede em {{agencia.endereco}}, representada por {{agencia.representante}}.

**CONTRATANTE:** {{cliente.nome}}, CPF/CNPJ {{cliente.documento}}, com endereço em {{cliente.endereco}}, representada por {{cliente.representante}}.

## OBJETO

{{contrato.servicos}}

## VALOR E PAGAMENTO

Valor mensal de {{contrato.valor}} ({{contrato.valor_extenso}}), com vencimento no {{contrato.vencimento}} de cada mês, por {{contrato.forma_pagamento}}.

## PRAZO

Início em {{contrato.inicio}}, pelo prazo de {{contrato.prazo_meses}}.

{{agencia.cidade}}, {{data.hoje}}.

{{assinaturas}}`;
