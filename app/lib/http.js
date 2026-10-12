// Utilitários HTTP para as funções da Vercel (sem dependências).

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function send(res, status, data, headers = {}) {
  res.statusCode = status;
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  if (data === undefined) return res.end();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}

export function redirect(res, location, headers = {}) {
  res.statusCode = 302;
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.setHeader('Location', location);
  res.end();
}

async function readStream(req) {
  const chunks = [];
  for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
  return Buffer.concat(chunks);
}

// Lê o corpo cru. Lemos o stream direto (sem tocar em req.body, que na Vercel
// dispara o parser automático); se ele já foi consumido, usamos o que foi parseado.
export async function readRaw(req) {
  if (req.readableEnded || req.complete && req.readable === false) {
    if (Buffer.isBuffer(req.body)) return req.body;
    if (typeof req.body === 'string') return Buffer.from(req.body, 'binary');
    return Buffer.alloc(0);
  }
  return readStream(req);
}

export async function readJson(req) {
  const parsed = 'body' in req ? req.body : undefined;
  if (parsed && typeof parsed === 'object' && !Buffer.isBuffer(parsed)) return parsed;
  const raw = typeof parsed === 'string' ? parsed : Buffer.isBuffer(parsed) ? parsed.toString('utf8') : (await readStream(req)).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new HttpError(400, 'Corpo da requisição inválido.'); }
}

export function query(req) {
  return Object.fromEntries(new URL(req.url, 'http://x').searchParams);
}

// Envolve um mapa { GET: fn, POST: fn } com tratamento de erros padronizado.
export function route(methods) {
  return async (req, res) => {
    const fn = methods[req.method];
    if (!fn) return send(res, 405, { error: 'Método não permitido.' }, { Allow: Object.keys(methods).join(', ') });
    try {
      await fn(req, res);
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error(err);
      // erros de configuração (expose) mostram a mensagem real: dizem o que falta ajustar
      if (!res.writableEnded) send(res, status, { error: status >= 500 && !err.expose ? 'Erro interno. Tente de novo em instantes.' : err.message });
    }
  };
}

export function need(cond, status, message) {
  if (!cond) throw new HttpError(status, message);
}
