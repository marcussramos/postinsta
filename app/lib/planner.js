// Planejamento do mês com IA: usa a identidade da marca, a cota do contrato, os melhores posts dos relatórios,
// os melhores horários e as datas comemorativas do nicho para sugerir o calendário do mês (vira ideias no Fluxo).
import { db } from './db.js';
import { TIMEZONE } from './env.js';
import { HttpError } from './http.js';
import { askClaude, jsonFrom } from './ai.js';
import { deliveries } from './deliveries.js';
import { bestTimes } from './besttime.js';
import { datesBetween, NICHES } from '../public/dates.js';

const FORMATS = ['IMAGE', 'CAROUSEL', 'REELS', 'STORY'];
const FORMAT_LABEL = { IMAGE: 'Foto', CAROUSEL: 'Carrossel', REELS: 'Reels', STORY: 'Story' };

// "2026-11-05" + "19:00" no fuso da agência → ISO UTC
export function zonedISO(date, time, tz = TIMEZONE()) {
  const [y, m, d] = date.split('-').map(Number); const [hh, mm] = (time || '19:00').split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const o = {}; for (const p of f.formatToParts(guess)) o[p.type] = p.value;
  const asUtc = Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour % 24, +o.minute);
  return new Date(guess - (asUtc - guess)).toISOString();
}
const lastDay = (month) => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };

export async function planContext(client, month) {
  const from = `${month}-01`, to = `${month}-${String(lastDay(month)).padStart(2, '0')}`;
  const niche = client.brand_kit?.niche || null;
  const [deliv, reports, existing, best] = await Promise.all([
    deliveries(month, { clientId: client.id }).then((d) => d[client.id] || null).catch(() => null),
    db.select('reports', { select: 'ref_month,data', client_id: `eq.${client.id}`, order: 'ref_month.desc', limit: 2 }).catch(() => []),
    db.select('posts', { select: 'title,caption,scheduled_at,media_type,status', client_id: `eq.${client.id}`, and: `(scheduled_at.gte.${zonedISO(from, '00:00')},scheduled_at.lt.${zonedISO(to, '23:59')})`, limit: 200 }).catch(() => []),
    bestTimes(client.id).catch(() => null),
  ]);
  const top = [];
  for (const r of reports) {
    const posts = r.data?.posts || []; const ids = new Set(r.data?.top || []);
    for (const p of posts.filter((x) => ids.has(x.id))) top.push({ month: r.ref_month, type: p.type, caption: (p.caption || '').slice(0, 160), interactions: p.interactions, reach: p.reach });
  }
  const dates = datesBetween(from, to, niche);
  const k = client.contract_data || {};
  const quota = { posts: k.quota_posts ?? null, reels: k.quota_reels ?? null, stories: k.quota_stories ?? null };
  const planned = { posts: deliv?.posts?.planned || 0, reels: deliv?.reels?.planned || 0, stories: deliv?.stories?.planned || 0 };
  return { from, to, niche, quota, planned, top: top.slice(0, 6), existing, dates, best: best?.slots?.slice(0, 5) || [] };
}

function wanted(ctx) {
  const left = (q, p) => (q == null ? null : Math.max(0, q - p));
  const w = { posts: left(ctx.quota.posts, ctx.planned.posts), reels: left(ctx.quota.reels, ctx.planned.reels), stories: left(ctx.quota.stories, ctx.planned.stories) };
  if (w.posts == null && w.reels == null) { w.posts = 8; w.reels = 4; }
  return { posts: w.posts ?? 0, reels: w.reels ?? 0, stories: Math.min(w.stories ?? 0, 12) };
}

export function planPrompt(client, month, ctx, extra = '') {
  const w = wanted(ctx);
  const k = client.brand_kit || {};
  const monthName = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-15T12:00:00Z`));
  return `PLANEJAMENTO MENSAL DE CONTEÚDO
Você é estrategista de conteúdo e diretor(a) de arte sênior de uma agência brasileira de social media. Monte o planejamento do Instagram de ${monthName} para o cliente abaixo.

Cliente: ${client.name}${client.ig_username ? ` (@${client.ig_username})` : ''}
Nicho: ${NICHES[ctx.niche] || 'não informado (deduza pelo nome, tom e marca)'}
Tom de voz: ${client.brand_voice || 'não definido'}
${k.style ? `Estilo visual/posicionamento: ${k.style}\n` : ''}${k.dos ? `Sempre: ${k.dos}\n` : ''}${k.donts ? `Nunca: ${k.donts}\n` : ''}${k.notes ? `Observações da marca (produtos, datas, concorrentes): ${k.notes}\n` : ''}
Quantidade a planejar (o que falta para fechar a cota do contrato): ${w.posts} posts de feed (Foto ou Carrossel), ${w.reels} Reels${w.stories ? `, ${w.stories} Stories` : ''}.
Período: ${ctx.from} a ${ctx.to}. Distribua ao longo do mês, sem dois conteúdos de feed no mesmo dia, de preferência em dias úteis variados.
Melhores horários do perfil: ${ctx.best.length ? ctx.best.map((s) => s.label).join(', ') : '19:00 em dias úteis, 11:00 aos sábados'}.
Datas comemorativas do mês (use só as que fazem sentido para a marca; o post sai no dia ou 1 dia antes): ${ctx.dates.map((d) => `${d.date.slice(8)}/${d.date.slice(5, 7)} ${d.name}`).join('; ') || 'nenhuma relevante'}.
Posts que mais performaram nos últimos relatórios (aprenda o que funciona, não copie): ${ctx.top.length ? ctx.top.map((t) => `[${t.type}, ${t.interactions} interações] ${t.caption.replace(/\s+/g, ' ')}`).join(' | ') : 'sem histórico ainda'}.
Já existe no calendário deste mês (não repita tema nem data): ${ctx.existing.length ? ctx.existing.map((p) => `${String(p.scheduled_at).slice(0, 10)} ${p.title || (p.caption || '').slice(0, 50)}`).join('; ') : 'nada'}.
${extra ? `Pedido extra da agência: ${extra}\n` : ''}
Regras:
- Misture objetivos: atrair (alcance), relacionar (engajamento/bastidores/prova social) e converter (produto/oferta com CTA). Pelo menos 1/3 de conteúdo que gera salvamento ou compartilhamento.
- Cada item precisa de uma ideia criativa concreta e executável pela equipe (o que mostrar, gancho visual dos 2 primeiros segundos no Reels, estrutura dos slides no carrossel).
- Não invente preços, promoções, prêmios ou fatos que a marca não informou; quando precisar, escreva "[confirmar com o cliente]".
- Legenda em português do Brasil natural, gancho na primeira linha, CTA no fim, sem clichês de IA; 5 a 10 hashtags relevantes. Story não tem legenda (use caption vazio e descreva o texto da arte na ideia).
- Nunca reproduza letras de música, poemas ou textos de terceiros.

Responda SOMENTE com JSON válido:
{"strategy":"2 a 3 frases com a linha estratégica do mês","items":[{"date":"AAAA-MM-DD","time":"HH:MM","format":"IMAGE|CAROUSEL|REELS|STORY","pillar":"Atrair|Relacionar|Converter","title":"pauta curta","idea":"o que produzir, roteiro/estrutura e direção de arte","caption":"legenda sem hashtags","hashtags":["#exemplo"],"date_hook":"nome da data comemorativa ou vazio"}]}`;
}

export function cleanPlan(parsed, month) {
  const last = lastDay(month);
  const items = (Array.isArray(parsed?.items) ? parsed.items : []).map((it) => {
    const day = String(it.date || '').slice(0, 10);
    const okDay = /^\d{4}-\d{2}-\d{2}$/.test(day) && day.startsWith(month) && Number(day.slice(8)) >= 1 && Number(day.slice(8)) <= last;
    const time = /^\d{2}:\d{2}$/.test(it.time || '') ? it.time : '19:00';
    const format = FORMATS.includes(it.format) ? it.format : 'IMAGE';
    const tags = [...new Set((Array.isArray(it.hashtags) ? it.hashtags : []).map((t) => `#${String(t).replace(/^#+/, '').replace(/\s+/g, '')}`).filter((t) => t.length > 1))].slice(0, 15);
    return {
      date: okDay ? day : null, time, format, format_label: FORMAT_LABEL[format], pillar: String(it.pillar || '').slice(0, 30),
      title: String(it.title || '').trim().slice(0, 140), idea: String(it.idea || '').trim().slice(0, 1500),
      caption: format === 'STORY' ? '' : String(it.caption || '').trim().slice(0, 2000), hashtags: format === 'STORY' ? [] : tags, date_hook: String(it.date_hook || '').slice(0, 80),
    };
  }).filter((it) => it.title && it.date).slice(0, 40);
  return { strategy: String(parsed?.strategy || '').slice(0, 800), items: items.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)) };
}

export async function generatePlan(client, month, extra) {
  const ctx = await planContext(client, month);
  const w = wanted(ctx);
  if (!w.posts && !w.reels && !w.stories) throw new HttpError(409, `A cota de ${client.name} para este mês já está completa no calendário. Ajuste a cota no contrato ou peça itens extras no campo de pedido.`);
  const text = await askClaude([{ type: 'text', text: planPrompt(client, month, ctx, extra) }], { maxTokens: 12000 });
  const plan = cleanPlan(jsonFrom(text), month);
  if (!plan.items.length) throw new HttpError(502, 'A IA não trouxe sugestões. Tente de novo.');
  return { ...plan, context: { quota: ctx.quota, planned: ctx.planned, dates: ctx.dates, top_count: ctx.top.length, niche: ctx.niche } };
}

// Cria as ideias escolhidas no Fluxo (status "Ideia", já com data, formato, pauta, roteiro e rascunho de legenda).
export async function createPlanPosts(clientId, items) {
  const rows = [];
  for (const it of items.slice(0, 40)) {
    if (!it?.title || !/^\d{4}-\d{2}-\d{2}$/.test(it.date || '')) continue;
    const format = FORMATS.includes(it.format) ? it.format : 'IMAGE';
    const caption = [String(it.caption || '').trim(), (it.hashtags || []).join(' ')].filter(Boolean).join('\n\n').slice(0, 2200);
    const notes = [`✨ Planejado com IA${it.pillar ? ` · ${it.pillar}` : ''}${it.date_hook ? ` · ${it.date_hook}` : ''}`, String(it.idea || '').trim()].filter(Boolean).join('\n\n').slice(0, 3000);
    rows.push(await db.insert('posts', {
      client_id: clientId, status: 'idea', title: String(it.title).slice(0, 140), notes, caption,
      scheduled_at: zonedISO(it.date, /^\d{2}:\d{2}$/.test(it.time || '') ? it.time : '19:00'), media_type: format,
    }));
  }
  return rows;
}
