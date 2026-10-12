// Envio de mídia dos posts (bucket público "posts").
// POST (corpo = JPEG já otimizado pelo navegador) → guarda a imagem.
// POST ?kind=video&ext=mp4 (sem corpo) → devolve um link assinado para o navegador enviar o vídeo
//   direto ao Supabase (vídeos passam do limite de 4,5 MB da Vercel).
import crypto from 'node:crypto';
import { route, send, readRaw, query, need } from '../lib/http.js';
import { requireStaff } from '../lib/auth.js';
import { storage } from '../lib/db.js';

const MAX = 4 * 1024 * 1024; // a Vercel limita o corpo em ~4,5 MB
const VIDEO_EXT = { mp4: 'mp4', mov: 'mov', m4v: 'mp4' };

export default route({
  POST: async (req, res) => {
    await requireStaff(req);
    const { client, kind, ext } = query(req);
    const folder = /^[0-9a-f-]{36}$/.test(client || '') ? client : 'geral';
    const month = new Date().toISOString().slice(0, 7);
    if (kind === 'video') {
      const e = VIDEO_EXT[String(ext || '').toLowerCase()];
      need(e, 415, 'Use vídeo MP4 ou MOV.');
      return send(res, 201, await storage.signUpload(`${folder}/${month}/${crypto.randomUUID()}.${e}`));
    }
    const buf = await readRaw(req);
    need(buf.length > 0, 400, 'Nenhuma imagem recebida.');
    need(buf.length <= MAX, 413, 'Imagem grande demais (máx. 4 MB).');
    // O Instagram só aceita JPEG: confere a assinatura do arquivo.
    need(buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff, 415, 'A imagem precisa estar em JPEG.');
    const path = `${folder}/${month}/${crypto.randomUUID()}.jpg`;
    const out = await storage.upload(path, buf, 'image/jpeg');
    send(res, 201, { image_url: out.url, image_path: out.path });
  },
});
