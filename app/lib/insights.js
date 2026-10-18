// Leitura do relatório mensal: desempenho por formato e "próximos passos" sugeridos a partir dos números.
// Tudo calculado dos dados reais do mês (nada inventado). A agência pode editar os passos antes de mandar.
const fmtN = (n) => Number(n || 0).toLocaleString('pt-BR');
const day = (iso, tz) => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: tz }).format(new Date(iso));
const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const slotName = (s) => (Number.isInteger(s.weekday) && Number.isInteger(s.hour) ? `${DIAS[s.weekday]} às ${s.hour}h` : s.label);
const PLURAL = { Reels: 'Reels', Carrossel: 'carrosséis', Foto: 'posts de foto', Vídeo: 'vídeos' };

// Média por formato (só formatos com post no mês)
export function formatBreakdown(posts = []) {
  const by = new Map();
  for (const p of posts) {
    const b = by.get(p.type) || { type: p.type, posts: 0, interactions: 0, reach: 0, reachN: 0 };
    b.posts++; b.interactions += p.interactions || 0;
    if (p.reach != null) { b.reach += p.reach; b.reachN++; }
    by.set(p.type, b);
  }
  return [...by.values()].map((b) => ({
    type: b.type, posts: b.posts,
    avg_interactions: Math.round(b.interactions / b.posts),
    avg_reach: b.reachN ? Math.round(b.reach / b.reachN) : null,
  })).sort((a, b) => b.avg_interactions - a.avg_interactions);
}

// Até 5 passos, do mais importante para o menos
export function nextSteps(d, { tz = 'America/Cuiaba' } = {}) {
  const out = [];
  const T = d.totals || {}, P = d.previous || {};
  const posts = d.posts || [];
  const nPosts = T.posts?.value ?? posts.length;
  if (!nPosts) {
    out.push('Não houve posts no período. O primeiro passo é retomar a frequência: pelo menos 2 posts por semana, com dias e horários fixos.');
  }
  // 1) formato que mais funcionou
  const f = d.formats || formatBreakdown(posts);
  if (f.length >= 2 && f[0].avg_interactions > 0) {
    const [a, b] = f;
    const pct = b.avg_interactions ? Math.round((a.avg_interactions / b.avg_interactions - 1) * 100) : null;
    if (pct == null || pct >= 30) out.push(`Os ${PLURAL[a.type] || a.type} tiveram em média ${fmtN(a.avg_interactions)} interações por post${pct != null ? `, ${pct}% a mais que os ${PLURAL[b.type] || b.type}` : ''}. Vale aumentar a proporção desse formato no próximo mês.`);
  }
  // 2) repetir o que deu certo
  const top = (d.top || []).map((id) => posts.find((p) => p.id === id)).filter(Boolean)[0];
  if (top && top.interactions > 0 && nPosts >= 2) out.push(`O post de ${day(top.timestamp, tz)} (${top.type}) foi o que mais engajou, com ${fmtN(top.interactions)} interações. Vale fazer uma continuação ou outra versão desse tema.`);
  // 3) salvamentos e compartilhamentos
  const inter = T.interactions?.value || 0, ss = (T.saves?.value || 0) + (T.shares?.value || 0);
  if (inter >= 20 && ss / inter < 0.1) out.push(`Salvamentos e compartilhamentos ainda são poucos (${fmtN(ss)} de ${fmtN(inter)} interações). Conteúdos úteis, como dicas, listas e passo a passo, costumam ser salvos e enviados: inclua pelo menos 1 por semana.`);
  // 4) crescimento
  const fg = T.followers_gained?.value;
  if (fg != null && fg <= 0) out.push('O perfil não ganhou seguidores no período. Reels com gancho forte nos primeiros segundos e colaborações com perfis parceiros ajudam a chegar em quem ainda não segue.');
  // 5) frequência
  if (P.posts != null && nPosts && nPosts < P.posts && !d.period?.partial) out.push(`Foram ${nPosts} posts, contra ${P.posts} no mês anterior. Manter a frequência ajuda o alcance: a meta é voltar para ${P.posts} ou mais.`);
  // 6) horários
  const bt = d.best_times;
  if (bt?.slots?.length) {
    const list = bt.slots.map(slotName).join(', ').replace(/, ([^,]*)$/, ' e $1');
    const weak = bt.slots.every((s) => (s.n || 1) < 2); // cada horário tem só 1 post: indício, não regra
    out.push(bt.source === 'perfil' && !weak
      ? `Os horários com melhor resposta do público foram ${list}. Concentre os próximos posts nessas faixas e compare o resultado no próximo relatório.`
      : bt.source === 'perfil'
      ? `Os posts com melhor resposta saíram ${list}, mas ainda é 1 post por horário. Vale repetir esses horários algumas vezes para confirmar antes de fixar.`
      : `Ainda há poucos posts para saber o melhor horário deste perfil. Teste ${list} e compare o desempenho ao longo do mês.`);
  }
  return out.slice(0, 5);
}
