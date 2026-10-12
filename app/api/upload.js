// Recebe a imagem (JPEG já otimizado pelo navegador) e guarda no bucket público.
import crypto from 'node:crypto';
import { route, send, readRaw, query, need } from '../lib/http.js';
import { requireAdmin } from '../lib/auth.js';
import { storage } from '../lib/db.js';

const MAX = 4 * 1024 * 1024; // a Vercel limita o corpo em ~4,5 MB

export default route({
  POST: async (req, res) => {
    requireAdmin(req);
    const buf = await readRaw(req);
    need(buf.length > 0, 400, 'Nenhuma imagem recebida.');
    need(buf.length <= MAX, 413, 'Imagem grande demais (máx. 4 MB).');
    // O Instagram só aceita JPEG: confere a assinatura do arquivo.
    need(buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff, 415, 'A imagem precisa estar em JPEG.');
    const { client } = query(req);
    const folder = /^[0-9a-f-]{36}$/.test(client || '') ? client : 'geral';
    const month = new Date().toISOString().slice(0, 7);
    const path = `${folder}/${month}/${crypto.randomUUID()}.jpg`;
    const out = await storage.upload(path, buf, 'image/jpeg');
    send(res, 201, { image_url: out.url, image_path: out.path });
  },
});
