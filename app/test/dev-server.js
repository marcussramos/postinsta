// Servidor local que imita a Vercel (arquivos de public/ + funções de api/), com Supabase e Instagram simulados.
// Uso: node test/dev-server.js   →  http://localhost:4321  (senha: senha-teste)
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installFakes, setEnv } from './fakes.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

export async function startServer(port = 4321) {
  setEnv({ APP_URL: `http://localhost:${port}` });
  const fakes = installFakes();
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    // Vercel define res.status/json? Nossas funções usam só a API nativa do Node.
    // mesmos rewrites do vercel.json: páginas públicas passam pela função que monta a prévia do link
    const PAGES = ['/aprovar', '/cliente', '/relatorio', '/proposta', '/historico', '/boasvindas'];
    if (PAGES.includes(u.pathname)) {
      req.url = `/api/page?p=${u.pathname.slice(1)}&${u.searchParams.toString()}`;
      const mod = await import(pathToFileURL(path.join(ROOT, 'api/page.js')).href);
      return mod.default(req, res);
    }
    if (u.pathname.startsWith('/api/')) {
      const file = path.join(ROOT, `${u.pathname}.js`);
      try {
        const mod = await import(pathToFileURL(file).href);
        return mod.default(req, res);
      } catch (e) { res.statusCode = 404; return res.end(String(e.message)); }
    }
    // imagens "hospedadas" no storage simulado
    if (u.pathname.startsWith('/fake-storage/')) {
      const buf = fakes.files.get(u.pathname.replace('/fake-storage/', ''));
      if (!buf) { res.statusCode = 404; return res.end(); }
      res.setHeader('Content-Type', 'image/jpeg'); return res.end(Buffer.from(buf));
    }
    let p = u.pathname === '/' ? '/index.html' : u.pathname;
    if (!path.extname(p)) p += '.html'; // cleanUrls
    try {
      const data = await fs.readFile(path.join(ROOT, 'public', p));
      res.setHeader('Content-Type', TYPES[path.extname(p)] || 'application/octet-stream');
      res.end(data);
    } catch { res.statusCode = 404; res.end('não encontrado'); }
  });
  await new Promise((r) => server.listen(port, r));
  return { server, fakes, url: `http://localhost:${port}` };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { url } = await startServer();
  console.log(`Pauta (simulado) em ${url}  — senha: senha-teste`);
}
