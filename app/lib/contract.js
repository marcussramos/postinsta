// Gera o contrato de um cliente a partir do modelo (texto com campos {{assim}}).
//
// Formato do modelo (texto simples, fácil de editar na aba Ajustes):
//   - linha em branco separa parágrafos
//   - linha que começa com "# " vira título; com "## " vira subtítulo (ex.: cláusulas)
//   - **texto** fica em negrito
//   - {{assinaturas}} sozinho numa linha → linhas de assinatura (contratante, contratada e 2 testemunhas)
//   - bloco em que toda linha começa com "|" vira tabela (ex.: "| MENSALIDADE | {{contrato.valor}}")
//   - parágrafo que começa com ">> " fica alinhado à direita (ex.: local e data)
//   - campos: {{cliente.nome}}, {{contrato.valor}}, {{data.hoje}} … (lista em FIELDS)
//   - {{se campo}}…{{fim}} só aparece quando o campo está preenchido; {{senao campo}}…{{fim}} só quando está vazio
//     (pode ficar no meio da frase ou abraçar parágrafos inteiros; itens "2.3." são renumerados quando algo some)
//   - bloco que começa com "!rodape" → linhas do rodapé de todas as páginas (ex.: marca e slogan)
//   - tabela com uma linha de uma célula só ("| QUADRO RESUMO") → título da tabela

export const FIELDS = {
  'agencia.razao_social': 'Razão social da agência',
  'agencia.cnpj': 'CNPJ da agência',
  'agencia.qualificacao': 'Tipo da empresa (ex.: Empresária Individual)',
  'agencia.endereco': 'Endereço da agência',
  'agencia.cidade': 'Cidade/UF da agência (foro)',
  'agencia.representante': 'Representante da agência',
  'agencia.representante_cpf': 'CPF do representante da agência',
  'agencia.email': 'E-mail da agência',
  'agencia.pix': 'Chave PIX da agência',
  'cliente.nome': 'Nome / razão social do cliente',
  'cliente.documento': 'CPF ou CNPJ do cliente',
  'cliente.identificacao': 'Identificação do cliente (pessoa jurídica/física + CNPJ/CPF)',
  'cliente.endereco': 'Endereço do cliente',
  'cliente.representante': 'Representante do cliente',
  'cliente.representante_cpf': 'CPF do representante do cliente',
  'cliente.email': 'E-mail do cliente',
  'cliente.whatsapp': 'WhatsApp do cliente',
  'contrato.servicos': 'Serviços contratados',
  'contrato.entregas': 'Entregas mensais (ex.: 8 posts e 4 Reels)',
  'contrato.total_conteudos': 'Total de conteúdos por mês',
  'contrato.valor': 'Valor mensal (R$ 1.500,00)',
  'contrato.valor_extenso': 'Valor mensal por extenso',
  'contrato.vencimento': 'Dia de vencimento',
  'contrato.inicio': 'Data de início',
  'contrato.prazo_meses': 'Prazo (meses)',
  'contrato.forma_pagamento': 'Forma de pagamento',
  'contrato.posts': 'Posts por mês por extenso (8 (oito))',
  'contrato.reels': 'Reels por mês por extenso (4 (quatro))',
  'contrato.pagamento_resumo': 'Pagamento (resumo: Via Pix, em 3 parcelas…)',
  'contrato.pagamento_clausula': 'Pagamento (cláusula, com valores por extenso)',
  'contrato.parcelado': 'Mensalidade parcelada (sim/vazio)',
  'contrato.retroativo': 'Data em que o serviço começou (contrato que substitui outro)',
  'contrato.inicio_data': 'Data de início (dd/mm/aaaa)',
  'cliente.sede': '"com sede na" / "residente e domiciliada na"',
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

// "pessoa jurídica de direito privado, inscrita no CNPJ sob o nº ..." conforme o documento informado
function identificacao(doc) {
  if (!doc) return '';
  const n = String(doc).replace(/\D/g, '').length;
  if (n === 14) return `pessoa jurídica de direito privado, inscrita no CNPJ sob o nº ${doc}`;
  if (n === 11) return `pessoa física, inscrita no CPF sob o nº ${doc}`;
  return `inscrita no CPF/CNPJ sob o nº ${doc}`;
}

// Dados públicos do CNPJ da agência (cartão MEI): valem enquanto Ajustes → Dados da agência estiver vazio.
export const AGENCY_DEFAULTS = {
  razao_social: '55.846.288 MARIA CAROLINA SILVESTRI DE FIGUEIREDO', qualificacao: 'Empresária Individual', cnpj: '55.846.288/0001-01',
  cidade: 'Cuiabá/MT', representante: 'MARIA CAROLINA SILVESTRI DE FIGUEIREDO',
};
const qtd = (n) => (n ? `${n} (${inteiro(Number(n))})` : '');
const ddmmyyyy = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
const cap = (t) => (t ? t[0].toUpperCase() + t.slice(1) : '');
const juntar = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join('; ')}; e ${xs.at(-1)}` : xs[0] || '');

// Forma de pagamento montada das parcelas (ou do vencimento único) cadastradas no cliente.
function pagamento(client, forma = 'Pix') {
  const parts = Array.isArray(client.installments) && client.installments.length > 1 ? client.installments : null;
  if (parts) {
    const n = qtd(parts.length);
    return {
      resumo: `Via ${forma}, em ${n} parcelas mensais: ${juntar(parts.map((p, i) => `${brl(p.cents)} no dia ${p.day}${i === parts.length - 1 ? ' de cada mês' : ''}`))}.`,
      clausula: `via ${forma}, dividida em ${n} parcelas: ${juntar(parts.map((p) => `${brl(p.cents)} (${valorPorExtenso(p.cents)}), com vencimento no dia ${p.day} de cada mês`))}`,
      parcelado: 'sim',
    };
  }
  if (!client.due_day) return { resumo: '', clausula: '', parcelado: '' };
  return { resumo: `Via ${forma}, com vencimento no dia ${client.due_day} de cada mês.`, clausula: `via ${forma}, com vencimento no dia ${client.due_day} de cada mês`, parcelado: '' };
}

export function contractValues({ agency: ag = {}, client = {}, today = new Date().toISOString() }) {
  const agency = { ...AGENCY_DEFAULTS, ...Object.fromEntries(Object.entries(ag || {}).filter(([, v]) => String(v ?? '').trim())) };
  const k = client.contract_data || {};
  const fee = client.monthly_fee_cents;
  const posts = Number(k.quota_posts) || 0, reels = Number(k.quota_reels) || 0;
  const entregasAuto = [posts && `${qtd(posts)} posts estáticos`, reels && `${qtd(reels)} Reels`].filter(Boolean).join(' e ');
  // "Pix"/"boleto" = só o meio (o resto sai das parcelas); frase com valores/dias = texto pronto
  const fp = String(k.forma_pagamento || '').trim();
  const frase = /R\$|parcela|vencimento|dia \d/i.test(fp);
  const pg = pagamento(client, !frase && fp && fp.length <= 25 ? fp.replace(/^(via|por|em)\s+/i, '') : 'Pix');
  const pf = String(k.documento || '').replace(/\D/g, '').length === 11;
  return {
    'contrato.posts': qtd(posts), 'contrato.reels': qtd(reels), 'contrato.mix': posts && reels ? 'sim' : '',
    'contrato.pagamento_resumo': frase ? cap(fp).replace(/([^.])$/, '$1.') : pg.resumo,
    'contrato.pagamento_clausula': pg.clausula || fp.replace(/\.$/, ''), 'contrato.parcelado': pg.parcelado,
    'contrato.retroativo': ddmmyyyy(k.retroativo), 'contrato.inicio_data': ddmmyyyy(client.billing_start),
    'cliente.sede': pf ? 'residente e domiciliada na' : 'com sede na',
    'agencia.qualificacao': agency.qualificacao, 'agencia.representante_cpf': agency.representante_cpf,
    'cliente.identificacao': identificacao(k.documento), 'cliente.representante_cpf': k.representante_cpf,
    'contrato.entregas': entregasAuto || k.entregas, 'contrato.total_conteudos': qtd(posts + reels || k.total_conteudos),
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
  const docLabel = (doc) => (String(doc || '').replace(/\D/g, '').length === 11 ? 'CPF' : 'CNPJ');
  const line = (who, name, doc) => `<div class="ass"><div class="ass-linha"></div>${fill(name)}${doc ? `<br>${fill(doc)}` : ''}<br>${who}</div>`;
  const testemunha = (n) => `<div class="test"><div class="test-n"><span>${n}.</span><div class="ass-linha"></div></div>Nome:<br>CPF:</div>`;
  return `<div class="assinaturas">${line('CONTRATANTE', '{{cliente.nome}}', `${docLabel(values['cliente.documento'])} nº {{cliente.documento}}`)}${line('CONTRATADA', '{{agencia.razao_social}}', '')}<div class="testemunhas"><p>TESTEMUNHAS:</p>${testemunha(1)}${testemunha(2)}</div></div>`;
}

// {{se campo}}…{{fim}} / {{senao campo}}…{{fim}}
function conditionals(template, values) {
  let removed = false;
  const has = (key) => { const v = values[key]; return !(v === undefined || v === null || v === ''); };
  const out = String(template || '').replace(/\{\{\s*(se|senao|senão)\s+([\w.]+)\s*\}\}([\s\S]*?)\{\{\s*fim\s*\}\}/g, (_, kind, key, body) => {
    const keep = kind === 'se' ? has(key) : !has(key);
    if (!keep) removed = true;
    return keep ? body : '';
  });
  return { text: out, removed };
}

// Renumera "2.3." → sequência dentro de cada cláusula (quando um item condicional some).
function renumber(blocks) {
  let major = null, n = 0;
  return blocks.map((b) => b.replace(/^(\*\*)?(\d+)\.(\d+)\./, (m, star, a) => {
    if (a !== major) { major = a; n = 0; }
    n += 1;
    return `${star || ''}${a}.${n}.`;
  }));
}

// Devolve o HTML do contrato, a lista de campos que ficaram vazios, o cabeçalho ("# …") e o rodapé ("!rodape").
export function renderContract(template, values) {
  const missing = new Set();
  const fill = (line) => esc(line)
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
      const v = values[key];
      if (v === undefined || v === null || v === '') { missing.add(key); return `<mark class="falta">[${esc(FIELDS[key] || key)}]</mark>`; }
      return `<span class="campo${String(v).length > 80 ? ' longo' : ''}">${esc(v).replace(/\n/g, '<br>')}</span>`;
    })
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  const { text, removed } = conditionals(String(template || '').replace(/\r\n/g, '\n'), values);
  let blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  if (removed) blocks = renumber(blocks);
  let header = null, footer = null;
  const html = blocks.map((t) => {
    if (t === '{{assinaturas}}') return signatures(values, fill);
    if (/^!rodap[eé]\b/i.test(t)) { footer = t.split('\n').slice(1).map((l) => l.trim()).filter(Boolean); return ''; }
    if (t.startsWith('## ')) return `<h2>${t.slice(3).split('\n').map(fill).join('<br>')}</h2>`;
    if (t.startsWith('# ')) {
      const lines = t.slice(2).split('\n');
      if (!header) header = lines.map((l) => l.replace(/\{\{[^}]*\}\}/g, '').trim()).filter(Boolean);
      return `<h1>${lines.map(fill).join('<br>')}</h1>`;
    }
    const lines = t.split('\n');
    if (lines.every((l) => l.trim().startsWith('|'))) {
      const rows = lines.map((l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => fill(c.trim())));
      const cols = Math.max(...rows.map((r) => r.length));
      return `<table class="quadro"><tbody>${rows.map((r) => (r.length === 1 && cols > 1
        ? `<tr class="cap"><th colspan="${cols}">${r[0]}</th></tr>`
        : `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${c}</th>` : `<td>${c}</td>`)).join('')}</tr>`)).join('')}</tbody></table>`;
    }
    const num = (h) => h.replace(/^(<strong>)?(\d+\.\d+\.)/, '$1<span class="num">$2</span>');
    if (t.startsWith('>> ')) return `<p class="direita">${t.slice(3).split('\n').map(fill).join('<br>')}</p>`;
    return `<p>${num(t.split('\n').map(fill).join('<br>'))}</p>`;
  }).filter(Boolean).join('\n');
  return { html, missing: [...missing], header, footer };
}

export const DEFAULT_TEMPLATE = `# CONTRATO DE PRESTAÇÃO DE SERVIÇOS
SOCIAL MEDIA

**CONTRATADA**: **{{agencia.razao_social}}**, {{agencia.qualificacao}}, inscrita no CNPJ sob o nº {{agencia.cnpj}}, com sede na {{agencia.endereco}}, neste ato representada por sua titular, **{{agencia.representante}}**, inscrita no CPF sob o nº {{agencia.representante_cpf}}, doravante denominada simplesmente **CONTRATADA**.

**CONTRATANTE**: **{{cliente.nome}}**, {{cliente.identificacao}}, {{cliente.sede}} {{cliente.endereco}}{{se cliente.representante}}, neste ato representada por **{{cliente.representante}}**, inscrita no CPF sob o nº {{cliente.representante_cpf}}{{fim}}, doravante denominada simplesmente **CONTRATANTE**.

As partes acima identificadas têm, entre si, justo e contratado o presente Contrato de Prestação de Serviços de Social Media, {{se contrato.retroativo}}que substitui, para todos os efeitos futuros, o instrumento anteriormente firmado entre elas, preservados os serviços já executados, os pagamentos já realizados e as obrigações eventualmente vencidas até a presente data, e {{fim}}que se regerá pelas cláusulas e condições a seguir.

| QUADRO RESUMO DO SERVIÇO
| PERFIL GERENCIADO | Perfil profissional da CONTRATANTE no Instagram.
| ENTREGAS MENSAIS | {{contrato.entregas}} — até {{contrato.total_conteudos}} conteúdos mensais.
| MENSALIDADE | {{contrato.valor}} ({{contrato.valor_extenso}}).
| FORMA DE PAGAMENTO | {{contrato.pagamento_resumo}}
| VIGÊNCIA | Prazo indeterminado, {{se contrato.retroativo}}com efeitos retroativos a {{contrato.retroativo}}{{fim}}{{senao contrato.retroativo}}a partir de {{contrato.inicio_data}}{{fim}}, nos termos da Cláusula Segunda.
| RESCISÃO | Mediante aviso prévio escrito de 30 (trinta) dias.

## CLÁUSULA PRIMEIRA – DO OBJETO

1.1. O presente contrato tem por objeto a prestação, pela CONTRATADA à CONTRATANTE, de serviços de social media, limitados ao planejamento, à criação e à publicação de conteúdos para um único perfil profissional da CONTRATANTE na plataforma Instagram, nos termos e limites deste instrumento.

{{se contrato.retroativo}}1.2. O presente contrato substitui, a partir de sua assinatura, o contrato de prestação de serviços de social media anteriormente firmado entre as partes, sem novação ou quitação automática de valores ou obrigações eventualmente pendentes até a presente data, os quais permanecem regidos pelo instrumento anterior e exigíveis normalmente.{{fim}}

## CLÁUSULA SEGUNDA – DA VIGÊNCIA{{se contrato.retroativo}} E DA RETROATIVIDADE{{fim}}

2.1. O presente contrato vigorará por prazo indeterminado, com renovação automática a cada ciclo mensal, enquanto não sobrevier rescisão nos termos da Cláusula Nona.

{{se contrato.retroativo}}2.2. As partes reconhecem que a prestação dos serviços de social media entre elas é contínua desde {{contrato.retroativo}}, razão pela qual as condições ora pactuadas neste instrumento produzem efeitos retroativos a essa data, para fins de regularização e consolidação da relação contratual em curso.

2.3. A retroatividade prevista no item 2.2 não implica reconhecimento de inadimplemento, alteração de valores já pagos ou revisão de entregas já realizadas no período anterior à assinatura deste instrumento, servindo exclusivamente para conferir segurança jurídica à continuidade da prestação de serviços.

2.4. A data de assinatura deste instrumento é a que consta ao final do documento, sendo a retroatividade prevista nesta cláusula uma disposição contratual expressa entre as partes, e não uma data falsa de assinatura.{{fim}}

## CLÁUSULA TERCEIRA – DO ESCOPO DOS SERVIÇOS

3.1. Em cada ciclo mensal, a CONTRATADA entregará {{contrato.entregas}}, totalizando até {{contrato.total_conteudos}} conteúdos mensais, compreendendo planejamento editorial, pauta, elaboração de calendário ou programação de publicações, criação de artes, elaboração de legendas e textos, gravação de materiais quando aplicável, edição de imagens e vídeos, e publicação no Instagram da CONTRATANTE.

{{se contrato.mix}}3.2. Os {{contrato.posts}} posts e os {{contrato.reels}} Reels constituem entregas distintas e não fungíveis entre si, não podendo ser somados ou convertidos em outra modalidade de conteúdo, nem acumulados para ciclos seguintes, salvo nas hipóteses de prorrogação previstas na Cláusula Quinta.{{fim}}

3.3. A definição dos temas, dos formatos, das datas e da distribuição dos conteúdos ao longo do mês ocorrerá conforme as necessidades da CONTRATANTE e o alinhamento prévio entre as partes, observado o planejamento editorial da CONTRATADA, sem que isso implique aumento da quantidade mensal de entregas contratada.

3.4. A gravação e a produção de materiais estão vinculadas exclusivamente às {{contrato.total_conteudos}} entregas mensais previstas no item 3.1, não constituindo disponibilidade da CONTRATADA para captações ilimitadas, gravações autônomas ou produção de materiais além das quantidades contratadas.

3.5. As datas de gravação, criação, aprovação e publicação dos conteúdos serão organizadas de acordo com o planejamento editorial e a disponibilidade de agenda da CONTRATADA, em alinhamento prévio com a CONTRATANTE.

## CLÁUSULA QUARTA – DOS SERVIÇOS NÃO INCLUÍDOS

4.1. Não estão incluídos na prestação de serviços, salvo contratação adicional e expressa, nos termos da Cláusula Décima Quinta:

a) resposta a mensagens diretas (direct);

b) resposta a comentários;

c) atendimento ao consumidor ou serviço de atendimento ao cliente (SAC);

d) gestão de avaliações;

e) gestão de tráfego pago ou investimento em anúncios;

f) atendimento comercial da CONTRATANTE;

g) entregas além das quantidades mensais previstas na Cláusula Terceira;

h) arquivos editáveis, brutos ou projetos-fonte.

4.2. Qualquer atividade ou entrega não prevista neste contrato dependerá de alinhamento prévio, disponibilidade de agenda da CONTRATADA e orçamento adicional aceito por escrito pela CONTRATANTE.

## CLÁUSULA QUINTA – DAS ALTERAÇÕES, DAS APROVAÇÕES E DOS ATRASOS DA CONTRATANTE

5.1. A CONTRATANTE poderá solicitar alterações nos conteúdos, sem número previamente fixado, desde que as solicitações: (i) permaneçam dentro do briefing, do planejamento e do escopo originalmente aprovados; (ii) não impliquem a criação de conteúdo inteiramente novo; (iii) não representem mudança substancial de estratégia, campanha, identidade visual ou direcionamento; (iv) sejam solicitadas em prazo compatível com o calendário editorial; e (v) não ultrapassem o volume mensal contratado.

5.2. Mudanças de briefing, refações integrais, substituição de conteúdo já aprovado, criação de novas peças, ou quaisquer alterações que configurem, na prática, novo trabalho, poderão ser consideradas serviço adicional, sujeitas a orçamento e pagamento à parte, nos termos da Cláusula Décima Quinta.

5.3. Nenhum conteúdo será publicado antes do alinhamento ou da aprovação da CONTRATANTE, ressalvado o disposto no item 5.5 quanto à ausência de resposta.

5.4. Caso a CONTRATANTE atrase o envio de informações, materiais, acessos, orientações ou aprovações necessárias à execução dos serviços, os prazos e o calendário editorial da CONTRATADA serão automaticamente prorrogados pelo período necessário à reorganização do trabalho, sem que isso caracterize atraso ou inadimplemento da CONTRATADA.

5.5. A ausência de resposta da CONTRATANTE em prazo compatível com o calendário não importará aprovação automática, suspenderá a publicação do conteúdo afetado e autorizará a readequação do calendário editorial, sem responsabilidade da CONTRATADA por atraso, perda de oportunidade ou redução do período útil de divulgação.

5.6. A CONTRATADA não será obrigada a concentrar, acumular ou executar de forma urgente entregas atrasadas por responsabilidade da CONTRATANTE, podendo redistribuí-las ao longo dos ciclos seguintes conforme sua disponibilidade de agenda.

5.7. Informações, preços, datas, nomes, promoções e demais dados fornecidos ou aprovados pela CONTRATANTE são de sua exclusiva responsabilidade, não respondendo a CONTRATADA por sua exatidão, legalidade ou atualização.

## CLÁUSULA SEXTA – DO VALOR E DA FORMA DE PAGAMENTO

6.1. Pela prestação dos serviços, a CONTRATANTE pagará à CONTRATADA a mensalidade de {{contrato.valor}} ({{contrato.valor_extenso}}), {{contrato.pagamento_clausula}}.

{{se contrato.parcelado}}6.2. O parcelamento previsto no item 6.1 constitui mera forma de pagamento e não transforma cada parcela em serviço independente, integrando todas elas a mesma mensalidade de {{contrato.valor}} ({{contrato.valor_extenso}}), devida integralmente em cada ciclo mensal.{{fim}}

6.3. O pagamento remunera a disponibilidade técnica e a execução do respectivo ciclo mensal, não estando condicionado à publicação integral dos conteúdos quando houver atraso, omissão, falta de aprovação ou impossibilidade causada pela CONTRATANTE, nos termos da Cláusula Quinta.

6.4. A mensalidade poderá ser reajustada a cada 12 (doze) meses, contados da data de assinatura deste instrumento, pela variação acumulada do IPCA, ou por outro índice oficial que venha a substituí-lo.

## CLÁUSULA SÉTIMA – DO INADIMPLEMENTO E DA SUSPENSÃO DOS SERVIÇOS

7.1. O não pagamento de qualquer das parcelas previstas na Cláusula Sexta, nos respectivos vencimentos, sujeitará a CONTRATANTE a multa moratória de 2% (dois por cento) sobre o valor em aberto, a juros de mora de 1% (um por cento) ao mês, calculados proporcionalmente aos dias de atraso, e à atualização monetária pelo IPCA ou por outro índice oficial que venha a substituí-lo.

7.2. Persistindo o atraso por mais de 5 (cinco) dias corridos após o vencimento de qualquer parcela, a CONTRATADA poderá suspender o planejamento, a criação, a produção, a publicação e o suporte, até a regularização integral do débito, sem obrigação de repor o período suspenso ou de prorrogar o ciclo mensal.

7.3. Durante a suspensão por inadimplência, a CONTRATADA não estará obrigada a publicar ou produzir novos conteúdos, e o cronograma editorial será reorganizado a critério da CONTRATADA quando da regularização do débito, sem qualquer obrigação de recuperação gratuita do período afetado.

7.4. A suspensão prevista nesta cláusula não configura descumprimento contratual pela CONTRATADA, tampouco gera direito a abatimento, desconto ou compensação em favor da CONTRATANTE.

7.5. Permanecem devidos, em qualquer hipótese, os valores relativos aos serviços já realizados, iniciados ou disponibilizados até a data da suspensão.

7.6. A CONTRATADA poderá promover a cobrança extrajudicial e/ou judicial dos valores em aberto, respondendo a CONTRATANTE pelas despesas, custas processuais e honorários advocatícios decorrentes da cobrança, quando juridicamente cabível.

## CLÁUSULA OITAVA – DAS OBRIGAÇÕES DAS PARTES

8.1. São obrigações da CONTRATADA:

a) executar os serviços descritos na Cláusula Terceira com diligência, organização e qualidade técnica;

b) elaborar e organizar o planejamento editorial mensal;

c) submeter os conteúdos à aprovação da CONTRATANTE antes da publicação, nos termos da Cláusula Quinta;

d) respeitar as diretrizes e a identidade visual fornecidas pela CONTRATANTE;

e) manter sigilo sobre informações pessoais, estratégicas, comerciais e credenciais recebidas; e

f) emitir o documento fiscal correspondente, quando legalmente aplicável.

8.2. São obrigações da CONTRATANTE:

a) pagar pontualmente a mensalidade, nas condições e nos prazos previstos na Cláusula Sexta;

b) disponibilizar e manter os acessos necessários ao perfil do Instagram, nos termos da Cláusula Décima Primeira;

c) fornecer as informações, orientações e materiais necessários à elaboração dos conteúdos, inclusive mídias produzidas pela própria CONTRATANTE;

d) aprovar ou solicitar ajustes no planejamento em prazo compatível com o calendário editorial;

e) garantir que as informações, imagens, marcas e demais materiais fornecidos sejam verdadeiros, completos, atualizados e lícitos; e

f) não responsabilizar a CONTRATADA por atrasos ou impossibilidade de execução decorrentes da ausência de informações, materiais, acessos ou aprovação por parte da própria CONTRATANTE.

## CLÁUSULA NONA – DA RESCISÃO E DO AVISO PRÉVIO

9.1. Qualquer das partes poderá rescindir o presente contrato, sem necessidade de justificativa, mediante aviso prévio por escrito com antecedência mínima de 30 (trinta) dias corridos.

9.2. Durante o período de aviso prévio, a prestação dos serviços e os pagamentos permanecem normalmente exigíveis, devendo as partes cumprir as obrigações assumidas neste contrato, inclusive quanto às entregas mensais e à colaboração da CONTRATANTE com aprovações, informações e materiais.

9.3. Caso a CONTRATANTE encerre a relação de forma imediata, sem observância do aviso prévio de 30 (trinta) dias, ou impeça a continuidade da prestação dos serviços durante esse período, permanecerá responsável pelo pagamento do valor correspondente ao período de aviso não observado, calculado proporcionalmente à mensalidade vigente, além dos valores já vencidos, dos serviços já executados e das despesas já assumidas pela CONTRATADA.

9.4. Será admitida a rescisão imediata, sem necessidade de cumprimento do aviso prévio, nas seguintes hipóteses: (i) inadimplemento da CONTRATANTE não regularizado no prazo do item 7.2; (ii) ausência reiterada de colaboração da CONTRATANTE que inviabilize a execução dos serviços; (iii) fornecimento de conteúdo, informação ou material ilícito; (iv) utilização indevida do trabalho, da marca ou dos materiais da CONTRATADA; ou (v) outra violação relevante das obrigações contratuais.

9.5. No encerramento do contrato, por qualquer motivo, serão devidos os valores vencidos, os serviços já executados e a remuneração correspondente ao aviso prévio, quando aplicável, não se convertendo em crédito, reembolso ou obrigação de execução posterior as entregas não realizadas por motivo imputável à CONTRATANTE.

## CLÁUSULA DÉCIMA – DA PROPRIEDADE INTELECTUAL E DOS MATERIAIS

10.1. A CONTRATANTE receberá os materiais finais produzidos pela CONTRATADA para utilização em suas atividades institucionais e comerciais, ficando tal utilização condicionada ao pagamento das obrigações correspondentes ao respectivo ciclo mensal.

10.2. Não integram o objeto deste contrato os arquivos editáveis, os arquivos brutos, os projetos-fonte, os templates, os métodos, os processos, as estratégias e os demais materiais de trabalho utilizados pela CONTRATADA na produção dos conteúdos, os quais permanecem de sua titularidade exclusiva.

10.3. Os conteúdos e materiais fornecidos pela CONTRATANTE (textos, imagens, mídias, marcas e informações) permanecem sob sua exclusiva responsabilidade, declarando a CONTRATANTE possuir os direitos ou as autorizações necessárias para sua utilização, respondendo por eventuais violações de direitos de terceiros. Materiais de terceiros eventualmente incorporados permanecem sujeitos às respectivas licenças.

10.4. Não há autorização automática para utilização da marca, dos conteúdos ou dos materiais da CONTRATANTE em portfólio, redes sociais, publicidade ou divulgação da CONTRATADA, salvo autorização específica e expressa da CONTRATANTE.

## CLÁUSULA DÉCIMA PRIMEIRA – DOS ACESSOS, DA SEGURANÇA E DOS DADOS PESSOAIS

11.1. A CONTRATANTE deverá fornecer e manter, durante toda a vigência do contrato, os acessos necessários à execução dos serviços no perfil do Instagram.

11.2. A CONTRATADA utilizará os acessos exclusivamente para a execução dos serviços contratados, guardará sigilo sobre as informações e credenciais recebidas, e adotará cuidados razoáveis de segurança na sua utilização.

11.3. A CONTRATADA comunicará à CONTRATANTE, sem demora injustificada, eventual incidente relevante de segurança de que tiver conhecimento no exercício dos acessos concedidos.

11.4. Encerrado o contrato, a CONTRATADA removerá os acessos recebidos e deixará de utilizá-los, ressalvadas as hipóteses de conservação exigidas por lei ou necessárias à defesa de direitos.

11.5. A CONTRATADA não será responsável por invasões, acessos indevidos, falhas de plataforma, bloqueios, indisponibilidades, alterações de algoritmo ou atos praticados pela CONTRATANTE ou por terceiros, inclusive eventos anteriores à concessão dos acessos à CONTRATADA.

11.6. Como a resposta a mensagens diretas e a comentários não integra o objeto deste contrato, nos termos da Cláusula Quarta, a CONTRATADA não assume qualquer obrigação de atendimento, resposta ou acompanhamento de mensagens recebidas no perfil da CONTRATANTE.

11.7. Cada parte tratará os dados pessoais eventualmente acessados em razão da execução deste contrato em conformidade com a Lei nº 13.709/2018 – Lei Geral de Proteção de Dados Pessoais, utilizando-os somente para as finalidades relacionadas à prestação dos serviços ora contratados.

## CLÁUSULA DÉCIMA SEGUNDA – DA NATUREZA DA OBRIGAÇÃO E DA AUSÊNCIA DE GARANTIA DE RESULTADOS

12.1. A prestação assumida pela CONTRATADA constitui obrigação de meio, executada com técnica e diligência, não sendo garantidos vendas, faturamento, número de seguidores, alcance, engajamento, conversões, viralização, posicionamento ou qualquer resultado comercial específico.

12.2. Os resultados da atuação em redes sociais dependem de fatores externos e alheios ao controle da CONTRATADA, incluindo alterações de algoritmo, condições de mercado, características do produto ou serviço oferecido pela CONTRATANTE, política de preços, qualidade do atendimento prestado pela própria CONTRATANTE, comportamento do público e decisões unilaterais da plataforma utilizada.

## CLÁUSULA DÉCIMA TERCEIRA – DA CONFIDENCIALIDADE

13.1. As partes deverão manter sigilo sobre informações pessoais, estratégicas, comerciais, financeiras, técnicas e demais informações não públicas obtidas em razão deste contrato, não podendo utilizá-las para finalidade diversa da execução dos serviços, nem compartilhá-las com terceiros, salvo mediante autorização da parte titular, obrigação legal ou ordem de autoridade competente.

13.2. A obrigação de confidencialidade permanecerá vigente após o encerramento do contrato, enquanto as informações conservarem sua natureza sigilosa.

## CLÁUSULA DÉCIMA QUARTA – DA FORÇA MAIOR

14.1. Nenhuma das partes responderá por descumprimento ou atraso decorrente de caso fortuito ou força maior, devendo a parte afetada comunicar o evento à outra assim que possível, e as partes buscarão, de boa-fé, a readequação do cronograma e das entregas afetadas.

## CLÁUSULA DÉCIMA QUINTA – DOS SERVIÇOS ADICIONAIS

15.1. Demandas adicionais, entregas além das quantidades mensais contratadas, ou serviços não previstos neste contrato dependerão de disponibilidade de agenda da CONTRATADA e de orçamento prévio aceito por escrito pela CONTRATANTE, não se presumindo incluídos pelo silêncio, pela urgência ou pela afinidade com o objeto contratado.

## CLÁUSULA DÉCIMA SEXTA – DA AUTONOMIA E DA INEXISTÊNCIA DE VÍNCULO

16.1. A CONTRATADA atuará com autonomia técnica, administrativa e organizacional, sem subordinação, pessoalidade obrigatória, controle de jornada, exclusividade ou vínculo empregatício de qualquer natureza com a CONTRATANTE.

16.2. A CONTRATADA poderá utilizar colaboradores ou prestadores de serviços de apoio sob sua coordenação, permanecendo responsável pela qualidade das entregas e pela observância da confidencialidade.

16.3. A CONTRATADA poderá prestar serviços a outros clientes, inclusive do mesmo segmento da CONTRATANTE, desde que preserve as informações confidenciais e não utilize materiais exclusivos da CONTRATANTE.

16.4. O presente contrato não estabelece sociedade, representação comercial, associação, mandato, parceria empresarial, exclusividade ou responsabilidade solidária entre as partes.

## CLÁUSULA DÉCIMA SÉTIMA – DAS COMUNICAÇÕES E DAS DISPOSIÇÕES GERAIS

17.1. Serão consideradas válidas as comunicações realizadas pelos endereços de e-mail e pelos números de WhatsApp habitualmente utilizados pelas partes, inclusive aprovações, solicitações, avisos e notificações, inclusive de cancelamento ou rescisão.

17.2. Alterações de escopo, preço ou condições permanentes dependerão de acordo escrito entre as partes, inclusive por meio eletrônico, admitida a modificação por termo aditivo ou proposta aceita vinculada a este contrato.

17.3. A tolerância de uma das partes quanto ao descumprimento de qualquer obrigação será considerada mera liberalidade, não implicando novação, renúncia, perdão ou alteração contratual.

17.4. Caso alguma disposição deste contrato seja considerada inválida, ilegal ou inexequível, as demais permanecerão válidas e eficazes, devendo a disposição inválida ser interpretada ou substituída de maneira que preserve, na maior medida possível, sua finalidade econômica e jurídica.

## CLÁUSULA DÉCIMA OITAVA – DA ASSINATURA ELETRÔNICA E DO TÍTULO EXECUTIVO EXTRAJUDICIAL

18.1. As partes reconhecem como válidas as assinaturas eletrônicas realizadas por plataforma capaz de identificar os signatários e preservar a integridade do documento, ainda que não utilizem certificado digital emitido no âmbito da ICP-Brasil.

18.2. O presente instrumento poderá ser assinado eletronicamente, produzindo os mesmos efeitos jurídicos do documento físico, inclusive para fins probatórios e executivos, quando atendidos os requisitos legais.

18.3. Quando celebrado em meio eletrônico, a assinatura das testemunhas será dispensada quando a autoria e a integridade do documento forem conferidas por provedor de assinatura eletrônica, nos termos do artigo 784, § 4º, do Código de Processo Civil. Quando celebrado em formato físico, o instrumento será assinado pelas partes e por 2 (duas) testemunhas, nos termos do artigo 784, inciso III, do Código de Processo Civil.

18.4. O presente contrato constituirá título executivo extrajudicial quanto às obrigações certas, líquidas e exigíveis nele previstas, desde que atendidos os requisitos legais aplicáveis, podendo a parte credora promover sua execução em caso de inadimplemento, não afastando a liquidez da obrigação a eventual apuração do valor devido mediante simples cálculo aritmético, conforme o artigo 786, parágrafo único, do Código de Processo Civil.

## CLÁUSULA DÉCIMA NONA – DO FORO

19.1. Fica eleito o foro da Comarca de {{agencia.cidade}} para dirimir quaisquer controvérsias decorrentes deste contrato, com renúncia a qualquer outro, por mais privilegiado que seja, ressalvado eventual foro inderrogável previsto em lei.

Por estarem justas e contratadas, as partes assinam o presente instrumento.

>> {{agencia.cidade}}, {{data.hoje}}.

{{assinaturas}}

!rodape
MCAROLINA DIGITAL
SOCIAL MEDIA | VIDEO MAKER`;
