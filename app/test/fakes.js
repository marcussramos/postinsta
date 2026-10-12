// Simuladores do Supabase (REST + Storage) e da API do Instagram, para testar sem contas reais.
import crypto from 'node:crypto';

export function installFakes({ supabaseUrl = 'https://fake.supabase.co', igFail = null } = {}) {
  const tables = { clients: [], posts: [], app_state: [] };
  const files = new Map();
  const ig = { containers: new Map(), published: [], calls: [], failNext: igFail };
  const realFetch = globalThis.fetch;

  const defaults = {
    clients: () => ({ id: crypto.randomUUID(), approval_token: crypto.randomBytes(24).toString('hex'), created_at: new Date().toISOString(),
      contact_whatsapp: null, contact_email: null, brand_voice: null, ig_user_id: null, ig_username: null, ig_token: null, ig_token_expires_at: null, ig_connected_at: null }),
    app_state: () => ({ updated_at: new Date().toISOString() }),
    posts: () => ({ id: crypto.randomUUID(), status: 'draft', title: null, notes: null, image_url: null, scheduled_at: null, caption: '', alt_text: null, client_feedback: null, decided_at: null, sent_for_approval_at: null,
      ig_container_id: null, ig_media_id: null, ig_permalink: null, published_at: null, attempts: 0, last_error: null, image_path: null,
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
      case 'not': { const [op2, a2] = [rest[0], rest.slice(1).join('.')]; return !test(row, col, `${op2}.${a2}`); }
      default: throw new Error(`filtro não suportado: ${expr}`);
    }
  }
  function filterRows(rows, sp) {
    let out = rows;
    for (const [k, v] of sp) {
      if (['select', 'order', 'limit'].includes(k)) continue;
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
    if (u.pathname.startsWith('/storage/v1/object/')) {
      const path = u.pathname.replace('/storage/v1/object/posts/', '');
      if (method === 'POST') { files.set(path, init.body); return json(200, { Key: `posts/${path}` }); }
      if (method === 'DELETE') { files.delete(path); return json(200, {}); }
    }
    const table = u.pathname.replace('/rest/v1/', '');
    const rows = tables[table];
    if (!rows) return json(404, { message: 'tabela inexistente' });
    const sp = u.searchParams;
    if (method === 'GET') {
      let out = filterRows(rows, sp);
      const order = sp.get('order');
      if (order) { const [col, dir] = order.split('.'); out = [...out].sort((a, b) => (a[col] == null) - (b[col] == null) || cmp(a[col], b[col]) * (dir === 'desc' ? -1 : 1)); }
      if (sp.get('limit')) out = out.slice(0, +sp.get('limit'));
      return json(200, out.map((r) => ({ ...r })));
    }
    if (method === 'POST') {
      const row = { ...defaults[table](), ...JSON.parse(init.body) };
      if (table === 'app_state') { tables.app_state = rows.filter((r) => r.key !== row.key); tables.app_state.push(row); return json(201, []); }
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
    if (u.pathname.endsWith('/me')) return json(200, { user_id: '178400001', username: 'frasesdefunkwow' });
    if (u.pathname.endsWith('/media') && method === 'POST') {
      const id = `C${ig.containers.size + 1}`; ig.containers.set(id, { status: 'FINISHED', image_url: body.get('image_url'), caption: body.get('caption') });
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

  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.startsWith(supabaseUrl)) return supa(url, init);
    if (/instagram\.com/.test(new URL(url).host)) return instagram(url, init);
    if (new URL(url).host === 'api.anthropic.com') {
      const req = JSON.parse(init.body); ig.aiCalls = (ig.aiCalls || []).concat([req]);
      return json(200, { content: [{ type: 'text', text: 'Aqui:\n{"options":[{"label":"Curta","caption":"Foco no corre.","hashtags":["funk","#corre","foco no corre"]},{"label":"Engajamento","caption":"Marca o parça!","hashtags":["#parça"]}]}' }] });
    }
    return realFetch(input, init);
  };
  return { tables, files, ig, restore: () => { globalThis.fetch = realFetch; } };
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
