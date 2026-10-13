// Simuladores do Supabase (REST + Storage) e da API do Instagram, para testar sem contas reais.
import crypto from 'node:crypto';

export function installFakes({ supabaseUrl = 'https://fake.supabase.co', igFail = null } = {}) {
  const tables = { clients: [], posts: [], app_state: [], client_files: [], payments: [], reports: [], ig_daily: [], post_events: [], users: [], requests: [], proposals: [], push_subs: [], snippets: [], media_bank: [], mail_log: [], leads: [] };
  const files = new Map();
  const ig = { containers: new Map(), published: [], calls: [], failNext: igFail,
    // métricas simuladas: feed extra, métricas por post e totais da conta
    feed: [], followers: 250, insightsDenied: false,
    mediaInsights: (id) => ({ reach: 1000 + id.length * 10, likes: 50, comments: 5, saved: 7, shares: 3, views: 1500, total_interactions: 65 }),
    account: { reach: 4321, likes: 300, comments: 40, saves: 55, shares: 20, total_interactions: 415, views: 9000 },
    follows: { FOLLOWER: 30, NON_FOLLOWER: 4 } };
  const realFetch = globalThis.fetch;

  const defaults = {
    clients: () => ({ id: crypto.randomUUID(), approval_token: crypto.randomBytes(24).toString('hex'), created_at: new Date().toISOString(),
      contact_whatsapp: null, contact_email: null, brand_voice: null, portal_token: null, ig_user_id: null, ig_username: null, ig_token: null, ig_token_expires_at: null, ig_connected_at: null }),
    app_state: () => ({ updated_at: new Date().toISOString() }),
    client_files: () => ({ id: crypto.randomUUID(), ref_month: null, created_at: new Date().toISOString() }),
    reports: () => ({ id: crypto.randomUUID(), note: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
    ig_daily: () => ({}),
    push_subs: () => ({ id: crypto.randomUUID(), role: 'admin', user_id: null, created_at: new Date().toISOString() }),
    snippets: () => ({ id: crypto.randomUUID(), client_id: null, created_at: new Date().toISOString() }),
    media_bank: () => ({ id: crypto.randomUUID(), created_at: new Date().toISOString() }),
    mail_log: () => ({ sent_at: new Date().toISOString() }),
    leads: () => ({ id: crypto.randomUUID(), stage: 'novo', source: 'manual', wants_contact: false, proposal_id: null, client_id: null, diagnosis: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
    proposals: () => ({ id: crypto.randomUUID(), status: 'draft', accepted: null, accepted_at: null, client_id: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
    post_events: () => ({ id: crypto.randomUUID(), created_at: new Date().toISOString() }),
    users: () => ({ id: crypto.randomUUID(), active: true, perms: null, client_ids: null, created_at: new Date().toISOString() }),
    requests: () => ({ id: crypto.randomUUID(), status: 'open', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
    payments: () => ({ status: 'paid', amount_cents: null, paid_at: null, file_id: null, note: null, updated_at: new Date().toISOString() }),
    posts: () => ({ id: crypto.randomUUID(), status: 'draft', media_type: 'IMAGE', media: null, title: null, notes: null, image_url: null, scheduled_at: null, caption: '', alt_text: null, client_feedback: null, decided_at: null, sent_for_approval_at: null,
      feedback_audio: null, ig_container_id: null, ig_media_id: null, ig_permalink: null, published_at: null, attempts: 0, last_error: null, image_path: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
  };

  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const val = (v) => (v === 'null' ? null : v);
  function test(row, col, expr) {
    const [op, ...rest] = expr.split('.'); const arg = rest.join('.');
    const v = row[col];
    const asTime = (x) => (typeof x === 'string' && /^\d{4}-\d\d-\d\dT/.test(x) ? new Date(x).getTime() : x);
    switch (op) {
      case 'eq': return String(v) === arg;
      case 'neq': return String(v) !== arg;
      case 'in': return arg.replace(/^\(|\)$/g, '').split(',').includes(String(v));
      case 'gte': return asTime(v) >= asTime(arg);
      case 'lte': return asTime(v) <= asTime(arg);
      case 'lt': return asTime(v) < asTime(arg);
      case 'gt': return asTime(v) > asTime(arg);
      case 'is': return v === val(arg);
      case 'cs': { const want = JSON.parse(arg); return Array.isArray(v) && want.every((w) => v.some((x) => Object.entries(w).every(([k2, v2]) => x?.[k2] === v2))); }
      case 'not': { const [op2, a2] = [rest[0], rest.slice(1).join('.')]; return !test(row, col, `${op2}.${a2}`); }
      default: throw new Error(`filtro não suportado: ${expr}`);
    }
  }
  function filterRows(rows, sp) {
    let out = rows;
    for (const [k, v] of sp) {
      if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
      if (k === 'or') {
        const conds = v.replace(/^\(|\)$/g, '').split(',').map((c) => { const [col, ...e] = c.split('.'); return [col, e.join('.')]; });
        out = out.filter((r) => conds.some(([c, e]) => test(r, c, e)));
      } else if (k === 'and') {
        const conds = v.replace(/^\(|\)$/g, '').split(',').map((c) => { const [col, ...e] = c.split('.'); return [col, e.join('.')]; });
        out = out.filter((r) => conds.every(([c, e]) => test(r, c, e)));
      } else out = out.filter((r) => test(r, k, v));
    }
    return out;
  }

  async function supa(url, init) {
    const u = new URL(url); const method = init?.method || 'GET';
    if (u.pathname.startsWith('/storage/v1/object/upload/sign/')) { // link assinado para o navegador enviar vídeo
      const key = decodeURIComponent(u.pathname.replace('/storage/v1/object/upload/sign/', ''));
      return json(200, { url: `/object/upload/sign/${key}?token=up-${encodeURIComponent(key)}` });
    }
    if (u.pathname.startsWith('/storage/v1/object/sign/')) {
      const key = decodeURIComponent(u.pathname.replace('/storage/v1/object/sign/', ''));
      if (!files.has(key)) return json(400, { message: 'Object not found' });
      return json(200, { signedURL: `/object/sign/${key}?token=tok-${encodeURIComponent(key)}` });
    }
    if (u.pathname.startsWith('/storage/v1/object/')) {
      const key = decodeURIComponent(u.pathname.replace('/storage/v1/object/', ''));
      const k = key.replace(/^posts\//, ''); // imagens dos posts ficam sem o prefixo (como nos testes antigos); documentos com "docs/"
      if (method === 'POST') { files.set(k, init.body); return json(200, { Key: key }); }
      if (method === 'DELETE') { files.delete(k); return json(200, {}); }
    }
    const table = u.pathname.replace('/rest/v1/', '');
    const rows = tables[table];
    if (!rows) return json(404, { message: 'tabela inexistente' });
    const sp = u.searchParams;
    if (method === 'GET') {
      let out = filterRows(rows, sp);
      const order = sp.get('order');
      if (order) { const [col, dir] = order.split('.'); out = [...out].sort((a, b) => (a[col] == null) - (b[col] == null) || cmp(a[col], b[col]) * (dir === 'desc' ? -1 : 1)); }
      if (sp.get('offset')) out = out.slice(+sp.get('offset'));
      if (sp.get('limit')) out = out.slice(0, +sp.get('limit'));
      return json(200, out.map((r) => ({ ...r })));
    }
    if (method === 'POST' && Array.isArray(JSON.parse(init.body))) { // inserção/upsert em lote
      for (const one of JSON.parse(init.body)) await supa(url, { ...init, body: JSON.stringify(one) });
      return json(201, []);
    }
    if (method === 'POST') {
      const row = { ...defaults[table](), ...JSON.parse(init.body) };
      if (table === 'app_state') { tables.app_state = rows.filter((r) => r.key !== row.key); tables.app_state.push(row); return json(201, []); }
      if (table === 'payments' || table === 'ig_daily') { // upsert pela chave composta
        const k2 = table === 'payments' ? 'ref_month' : 'day';
        if (table === 'payments') row.installment = row.installment || 1;
        const old = rows.find((r) => r.client_id === row.client_id && r[k2] === row[k2] && (table !== 'payments' || (r.installment || 1) === row.installment));
        if (old) Object.assign(old, JSON.parse(init.body)); else rows.push(row);
        return json(201, []);
      }
      if (table === 'mail_log' && rows.some((x) => x.key === row.key)) return json(409, { message: 'duplicate key value violates unique constraint' });
      rows.push(row); return json(201, [{ ...row }]);
    }
    if (method === 'PATCH') {
      const hit = filterRows(rows, sp); const patch = JSON.parse(init.body);
      for (const r of hit) Object.assign(r, patch, table === 'posts' ? { updated_at: new Date().toISOString() } : {});
      return json(200, hit.map((r) => ({ ...r })));
    }
    if (method === 'DELETE') {
      const hit = filterRows(rows, sp);
      tables[table] = rows.filter((r) => !hit.includes(r));
      if (table === 'clients') tables.posts = tables.posts.filter((p) => !hit.some((c) => c.id === p.client_id));
      return json(200, hit);
    }
  }

  async function instagram(url, init) {
    const u = new URL(url); const method = init?.method || 'GET';
    const body = init?.body instanceof URLSearchParams ? init.body : new URLSearchParams(init?.body || '');
    ig.calls.push(`${method} ${u.host}${u.pathname}`);
    if (ig.failNext) { const f = ig.failNext; ig.failNext = null; return json(f.status || 400, { error: { message: f.message, code: f.code } }); }
    if (u.host === 'api.instagram.com') return json(200, { data: [{ access_token: 'short-tok', user_id: '178400001', permissions: 'instagram_business_basic,instagram_business_content_publish' }] });
    if (u.pathname === '/access_token') return json(200, { access_token: 'long-tok', token_type: 'bearer', expires_in: 5184000 });
    if (u.pathname === '/refresh_access_token') return json(200, { access_token: 'long-tok-2', token_type: 'bearer', expires_in: 5184000 });
    if (u.pathname.endsWith('/me')) return json(200, { user_id: '178400001', username: 'frasesdefunkwow', followers_count: ig.followers, media_count: 10 });
    const deny = () => json(403, { error: { message: '(#10) Application does not have permission for this action', code: 10 } });
    if (u.pathname.endsWith('/media') && method === 'GET') {
      const pub = ig.published.map((p, i) => ({ id: p.id, caption: p.caption, media_type: 'IMAGE', media_product_type: 'FEED', media_url: p.image_url, permalink: `https://www.instagram.com/p/${p.id}/`, timestamp: p.timestamp || new Date().toISOString(), like_count: 10 + i, comments_count: 2 }));
      const all = [...pub, ...ig.feed].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      return json(200, { data: all });
    }
    if ((u.searchParams.get('fields') || '').startsWith('business_discovery')) {
      if (ig.discoveryDenied) return deny();
      const now = Date.now();
      return json(200, { business_discovery: { username: 'padariadobairro', name: 'Padaria do Bairro', biography: 'Pães artesanais em Cuiabá', followers_count: 2000, follows_count: 300, media_count: 120,
        media: { data: [0, 2, 4, 9].map((d, i) => ({ id: `bd${i}`, caption: `post ${i}`, like_count: 40 + i, comments_count: 4, timestamp: new Date(now - d * 864e5).toISOString(), media_type: i === 1 ? 'CAROUSEL_ALBUM' : 'IMAGE', media_product_type: i === 2 ? 'REELS' : 'FEED' })) } } });
    }
    let mm = u.pathname.match(/\/([^/]+)\/insights$/);
    if (mm) {
      if (ig.insightsDenied) return deny();
      const metrics = (u.searchParams.get('metric') || '').split(',');
      if (mm[1] === '178400001') {
        const m = metrics[0];
        if (m === 'follows_and_unfollows') return json(200, { data: ig.follows ? [{ name: m, total_value: { breakdowns: [{ results: Object.entries(ig.follows).map(([k, v]) => ({ dimension_values: [k], value: v })) }] } }] : [] });
        return json(200, { data: ig.account[m] == null ? [] : [{ name: m, total_value: { value: ig.account[m] } }] });
      }
      const vals = ig.mediaInsights(mm[1]);
      return json(200, { data: metrics.filter((m) => vals[m] != null).map((m) => ({ name: m, values: [{ value: vals[m] }] })) });
    }
    if (u.pathname.endsWith('/media') && method === 'POST') {
      const id = `C${ig.containers.size + 1}`;
      ig.containers.set(id, { status: ig.videoInProgress && body.get('media_type') === 'REELS' ? 'IN_PROGRESS' : 'FINISHED', image_url: body.get('image_url'), caption: body.get('caption'),
        media_type: body.get('media_type') || (body.get('is_carousel_item') ? 'ITEM' : 'IMAGE'), video_url: body.get('video_url'), cover_url: body.get('cover_url'), children: body.get('children') });
      return json(200, { id });
    }
    if (u.pathname.endsWith('/media_publish')) {
      const c = ig.containers.get(body.get('creation_id')); c.status = 'PUBLISHED';
      const id = `M${ig.published.length + 1}`; ig.published.push({ id, ...c }); return json(200, { id });
    }
    const m = u.pathname.match(/\/(C\d+|M\d+)$/);
    if (m && m[1].startsWith('C')) return json(200, { status_code: ig.containers.get(m[1]).status, id: m[1] });
    if (m && m[1].startsWith('M')) return json(200, { permalink: `https://www.instagram.com/p/${m[1]}/`, id: m[1] });
    return json(404, { error: { message: `rota simulada inexistente ${u.pathname}` } });
  }

  // Asaas simulado: clientes, cobranças Pix, QR Code e webhooks
  const asaasDb = { customers: [], payments: [], webhooks: [], invoices: [], calls: [] };
  const push = { sent: [], status: 201 };
  const mail = { sent: [] };
  async function asaasFake(url, init = {}) {
    const u = new URL(url); const method = init.method || 'GET'; const path = u.pathname.replace('/v3', '');
    asaasDb.calls.push(`${method} ${path}`);
    if (init.headers?.access_token !== process.env.ASAAS_API_KEY) return json(401, { errors: [{ description: 'chave inválida' }] });
    const body = init.body ? JSON.parse(init.body) : {};
    if (path === '/customers' && method === 'POST') {
      if (!body.cpfCnpj) return json(400, { errors: [{ description: 'CPF/CNPJ obrigatório' }] });
      const c = { id: `cus_${asaasDb.customers.length + 1}`, ...body }; asaasDb.customers.push(c); return json(200, c);
    }
    if (path === '/payments' && method === 'POST') {
      const p = { id: `pay_${asaasDb.payments.length + 1}`, status: 'PENDING', invoiceUrl: `https://sandbox.asaas.com/i/${asaasDb.payments.length + 1}`, ...body }; asaasDb.payments.push(p); return json(200, p);
    }
    let m = path.match(/^\/payments\/([^/]+)\/pixQrCode$/);
    if (m) return json(200, { encodedImage: 'iVBORw0KGgo=', payload: `00020126PIX${m[1]}`, expirationDate: '2027-01-01 23:59:59' });
    m = path.match(/^\/payments\/([^/]+)$/);
    if (m) {
      const p = asaasDb.payments.find((x) => x.id === m[1]);
      if (!p) return json(404, { errors: [{ description: 'não encontrada' }] });
      if (method === 'DELETE') { p.deleted = true; return json(200, { deleted: true, id: p.id }); }
      return json(200, p);
    }
    if (path === '/invoices' && method === 'POST') { const inv = { id: `inv_${asaasDb.invoices.length + 1}`, status: 'SCHEDULED', ...body }; asaasDb.invoices.push(inv); return json(200, inv); }
    if (path === '/finance/balance') return json(200, { balance: 1234.5 });
    if (path === '/webhooks' && method === 'GET') return json(200, { data: asaasDb.webhooks });
    if (path === '/webhooks' && method === 'POST') { const w = { id: `wh_${asaasDb.webhooks.length + 1}`, ...body }; asaasDb.webhooks.push(w); return json(200, w); }
    m = path.match(/^\/webhooks\/([^/]+)$/);
    if (m && method === 'PUT') { const w = asaasDb.webhooks.find((x) => x.id === m[1]); Object.assign(w, body); return json(200, w); }
    return json(404, { errors: [{ description: `rota simulada inexistente ${path}` }] });
  }

  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.startsWith(supabaseUrl)) return supa(url, init);
    if (/instagram\.com/.test(new URL(url).host)) return instagram(url, init);
    if (/asaas\.com$/.test(new URL(url).host)) return asaasFake(url, init);
    if (new URL(url).host === 'push.example.com') { push.sent.push({ url, headers: init.headers, body: Buffer.from(init.body) }); return new Response(null, { status: push.status }); }
    if (new URL(url).host === 'api.resend.com') { mail.sent.push(JSON.parse(init.body)); return json(200, { id: `em_${mail.sent.length}` }); }
    if (new URL(url).host === 'files.asaas.example') return new Response(Buffer.from('%PDF-1.4 nota fiscal'), { status: 200 });
    if (new URL(url).host === 'api.anthropic.com') {
      const req = JSON.parse(init.body); ig.aiCalls = (ig.aiCalls || []).concat([req]);
      const prompt = req.messages[0].content.map((b) => b.text || '').join('');
      if (prompt.startsWith('DIAGNÓSTICO')) return json(200, { content: [{ type: 'text', text: JSON.stringify({ score: 58, headline: 'Boa base, falta constância', areas: [{ name: 'Perfil e bio', score: 70, comment: 'Bio clara.' }, { name: 'Constância', score: 40, comment: 'Posta pouco.' }, { name: 'Conteúdo', score: 60, comment: 'ok' }, { name: 'Engajamento', score: 62, comment: 'ok' }], strengths: ['Fotos bonitas'], actions: [{ title: 'Poste 3x por semana', detail: 'agenda fixa' }, { title: 'Reels', detail: 'x' }, { title: 'Bio', detail: 'y' }], closing: 'Vamos conversar?' }) }] });
      if (prompt.startsWith('REVISÃO')) return json(200, { content: [{ type: 'text', text: JSON.stringify({ issues: [{ level: 'atencao', area: 'legenda', title: 'Erro de digitação', detail: 'voce → você' }], corrected_caption: 'Você vai amar!', changes: ['voce → você'] }) }] });
      if (prompt.startsWith('PLANEJAMENTO')) {
        const month = (prompt.match(/Período: (\d{4}-\d{2})/) || [])[1];
        return json(200, { content: [{ type: 'text', text: JSON.stringify({ strategy: 'Mês de autoridade e datas.', items: [
          { date: `${month}-04`, time: '19:00', format: 'REELS', pillar: 'Atrair', title: 'Dia dos Animais', idea: 'Reels com os pets dos clientes', caption: 'Hoje é dia deles!', hashtags: ['diadosanimais', '#pet'], date_hook: 'Dia dos Animais' },
          { date: `${month}-09`, time: '11:00', format: 'CAROUSEL', pillar: 'Relacionar', title: '5 cuidados', idea: 'Carrossel 5 slides', caption: 'Salve para lembrar.', hashtags: ['#cuidados'] },
          { date: '1999-01-01', title: 'data fora do mês' },
        ] }) }] });
      }
      return json(200, { content: [{ type: 'text', text: 'Aqui:\n{"options":[{"label":"Curta","caption":"Foco no corre.","hashtags":["funk","#corre","foco no corre"]},{"label":"Engajamento","caption":"Marca o parça!","hashtags":["#parça"]}]}' }] });
    }
    return realFetch(input, init);
  };
  return { tables, files, ig, asaas: asaasDb, push, mail, restore: () => { globalThis.fetch = realFetch; } };
}

function json(status, data) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

export function setEnv(extra = {}) {
  Object.assign(process.env, {
    APP_URL: 'http://localhost:4321', ADMIN_PASSWORD: 'senha-teste', SESSION_SECRET: 's'.repeat(40), CRON_SECRET: 'c'.repeat(40),
    SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_SERVICE_KEY: 'service', IG_APP_ID: '123', IG_APP_SECRET: 'segredo', APP_TIMEZONE: 'America/Cuiaba',
    ...extra,
  });
}
