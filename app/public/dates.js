// Datas comemorativas do Brasil (gerais e por nicho). Usado no calendário, nos alertas do Início e no planejamento com IA.
// Mesmo arquivo no navegador e no servidor (lib/dates.js).

export const NICHES = {
  geral: 'Geral', pet: 'Pet', moda: 'Moda', beleza: 'Beleza e estética', saude: 'Saúde', odonto: 'Odontologia', fitness: 'Fitness',
  alimentacao: 'Alimentação', educacao: 'Educação', varejo: 'Varejo/loja', tecnologia: 'Tecnologia', imobiliario: 'Imobiliário',
  juridico: 'Jurídico', contabil: 'Contabilidade', automotivo: 'Automotivo', turismo: 'Turismo', infantil: 'Infantil', agro: 'Agro', musica: 'Música/eventos',
};

// [MM-DD, nome, nichos, principal?]  principal = vale para quase todo perfil (gera alerta para todos os clientes)
const FIXED = [
  ['01-01', 'Ano Novo', ['geral'], true],
  ['01-20', 'Dia do Farmacêutico', ['saude']],
  ['02-17', 'Dia do Gato', ['pet']],
  ['03-08', 'Dia Internacional da Mulher', ['geral'], true],
  ['03-15', 'Dia do Consumidor', ['varejo', 'moda', 'beleza', 'tecnologia', 'alimentacao', 'pet']],
  ['04-07', 'Dia Mundial da Saúde', ['saude', 'odonto', 'fitness']],
  ['04-14', 'Dia do Café', ['alimentacao']],
  ['04-08', 'Aniversário de Cuiabá', ['geral']],
  ['04-21', 'Tiradentes', ['geral']],
  ['04-25', 'Dia do Contador', ['contabil']],
  ['05-01', 'Dia do Trabalhador', ['geral'], true],
  ['05-12', 'Dia da Enfermagem', ['saude']],
  ['05-25', 'Dia do Orgulho Nerd', ['tecnologia']],
  ['05-28', 'Dia do Hambúrguer', ['alimentacao']],
  ['06-12', 'Dia dos Namorados', ['geral'], true],
  ['06-24', 'São João (Festa Junina)', ['geral', 'alimentacao', 'infantil']],
  ['07-07', 'Dia do Chocolate', ['alimentacao']],
  ['07-10', 'Dia da Pizza', ['alimentacao']],
  ['07-13', 'Dia Mundial do Rock', ['musica']],
  ['07-16', 'Dia do Comerciante', ['varejo']],
  ['07-20', 'Dia do Amigo', ['geral']],
  ['07-25', 'Dia do Motorista', ['automotivo']],
  ['07-26', 'Dia dos Avós', ['geral']],
  ['07-28', 'Dia do Agricultor', ['agro']],
  ['08-11', 'Dia do Estudante e do Advogado', ['educacao', 'juridico']],
  ['08-26', 'Dia do Cachorro', ['pet']],
  ['08-27', 'Dia do Corretor de Imóveis e do Psicólogo', ['imobiliario', 'saude']],
  ['08-31', 'Dia do Nutricionista', ['saude', 'alimentacao', 'fitness']],
  ['09-01', 'Dia do Profissional de Educação Física', ['fitness']],
  ['09-07', 'Independência do Brasil', ['geral']],
  ['09-09', 'Dia do Veterinário e Dia da Beleza', ['pet', 'beleza']],
  ['09-15', 'Dia do Cliente', ['geral'], true],
  ['09-21', 'Dia da Árvore', ['agro']],
  ['09-27', 'Dia do Turismo', ['turismo']],
  ['10-01', 'Início do Outubro Rosa', ['saude', 'beleza', 'geral']],
  ['10-04', 'Dia dos Animais', ['pet']],
  ['10-05', 'Dia do Empreendedor', ['geral']],
  ['10-12', 'Dia das Crianças', ['geral'], true],
  ['10-12', 'Nossa Senhora Aparecida', ['geral']],
  ['10-13', 'Dia do Fisioterapeuta', ['saude']],
  ['10-15', 'Dia do Professor', ['educacao', 'geral']],
  ['10-18', 'Dia do Médico', ['saude']],
  ['10-25', 'Dia do Dentista', ['odonto']],
  ['10-31', 'Halloween', ['infantil', 'alimentacao', 'moda']],
  ['11-01', 'Início do Novembro Azul', ['saude']],
  ['11-19', 'Dia da Mulher Empreendedora', ['geral']],
  ['11-02', 'Finados', ['geral']],
  ['11-15', 'Proclamação da República', ['geral']],
  ['11-20', 'Consciência Negra', ['geral']],
  ['11-22', 'Dia do Músico', ['musica']],
  ['12-25', 'Natal', ['geral'], true],
  ['12-31', 'Réveillon', ['geral']],
];

const iso = (d) => d.toISOString().slice(0, 10);
function easter(y) { // algoritmo de Meeus/Jones/Butcher
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, month - 1, day));
}
const plus = (d, n) => new Date(d.getTime() + n * 864e5);
function nthWeekday(y, month, weekday, n) { // n-ésimo dia da semana do mês (weekday 0 = domingo)
  const first = new Date(Date.UTC(y, month - 1, 1));
  return plus(first, ((weekday - first.getUTCDay() + 7) % 7) + (n - 1) * 7);
}

// Feriados (nacionais + Cuiabá). Aparecem no calendário marcados como feriado:
// dia de alcance diferente (gente em casa/viajando) e de comércio/consultório fechado.
const HOLIDAYS = {
  'Ano Novo': 'Feriado nacional', 'Sexta-feira Santa': 'Feriado nacional', 'Tiradentes': 'Feriado nacional',
  'Dia do Trabalhador': 'Feriado nacional', 'Independência do Brasil': 'Feriado nacional', 'Nossa Senhora Aparecida': 'Feriado nacional',
  'Finados': 'Feriado nacional', 'Proclamação da República': 'Feriado nacional', 'Consciência Negra': 'Feriado nacional', 'Natal': 'Feriado nacional',
  'Aniversário de Cuiabá': 'Feriado em Cuiabá', 'Carnaval': 'Ponto facultativo', 'Corpus Christi': 'Ponto facultativo',
};

export function datesOfYear(y) {
  const e = easter(y);
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const list = FIXED.map(([md, name, tags, major]) => ({ date: `${y}-${md}`, name, tags, major: Boolean(major) }));
  list.push(
    { date: iso(plus(e, -47)), name: 'Carnaval', tags: ['geral'], major: true },
    { date: iso(plus(e, -2)), name: 'Sexta-feira Santa', tags: ['geral'] },
    { date: iso(e), name: 'Páscoa', tags: ['geral', 'alimentacao', 'infantil'], major: true },
    { date: iso(plus(e, 60)), name: 'Corpus Christi', tags: ['geral'] },
    { date: iso(nthWeekday(y, 5, 0, 2)), name: 'Dia das Mães', tags: ['geral'], major: true },
    { date: iso(nthWeekday(y, 8, 0, 2)), name: 'Dia dos Pais', tags: ['geral'], major: true },
    { date: iso(plus(nthWeekday(y, 11, 4, 4), 1)), name: 'Black Friday', tags: ['geral', 'varejo'], major: true },
    { date: leap ? `${y}-09-12` : `${y}-09-13`, name: 'Dia do Programador', tags: ['tecnologia'] },
  );
  for (const d of list) if (HOLIDAYS[d.name]) d.holiday = HOLIDAYS[d.name]; // aparece no calendário de todos, sem virar sugestão de post
  return list.sort((a, b) => a.date.localeCompare(b.date));
}

// Datas entre from e to (AAAA-MM-DD, inclusive). niche: só gerais + as do nicho (sem niche: todas).
export function datesBetween(from, to, niche = null) {
  const out = [];
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) out.push(...datesOfYear(y));
  return out.filter((d) => d.date >= from && d.date <= to && (!niche || d.tags.includes('geral') || d.tags.includes(niche)));
}

// Datas que merecem alerta para um cliente: principais + as do nicho dele.
export const relevantFor = (d, niche) => d.major || (niche && niche !== 'geral' && d.tags.includes(niche));

const addDays = (day, n) => iso(plus(new Date(`${day}T12:00:00Z`), n));
export const daysBetween = (a, b) => Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 864e5);

// Alertas "Dia das Crianças em 12 dias — sem post planejado para a MY PET".
// postDays(clientId) → lista de dias (AAAA-MM-DD) com post do cliente. Coberto = post entre 3 dias antes e o dia.
export function dateAlerts(clients, postDays, today, { horizon = 14 } = {}) {
  const upcoming = datesBetween(addDays(today, 1), addDays(today, horizon));
  const out = [];
  for (const c of clients) {
    const niche = c.niche || null;
    const days = new Set(postDays(c.id));
    for (const d of upcoming.filter((x) => relevantFor(x, niche))) {
      const covered = [0, 1, 2, 3].some((n) => days.has(addDays(d.date, -n)));
      if (!covered) out.push({ client_id: c.id, client: c.name, date: d.date, name: d.name, in_days: daysBetween(today, d.date) });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.client.localeCompare(b.client));
}
