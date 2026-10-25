// Saúde das conexões do Instagram: testa o token de cada cliente conectado.
// Quando a pessoa troca a senha, remove o app ou a Meta invalida o acesso, o token "morre"
// sem aviso — o app só descobriria na hora de publicar. Aqui descobrimos antes e avisamos.
import { db } from './db.js';
import * as ig from './ig.js';
import { getState, setState } from './appstate.js';
import { notify } from './push.js';

const KEY = 'ig_health';
const EVERY_MS = 6 * 3600e3; // no agendador de 5 min, testa a cada 6 h (o cron diário sempre testa)

// Erros que significam "este acesso não vale mais" (e não instabilidade passageira).
export const isDeadToken = (e) => e?.code === 190 || e?.code === 102 || /session has been invalidated|error validating access token|has not authorized application|password|expired/i.test(e?.message || '');

export async function healthMap() {
  const v = await getState(KEY, null);
  return v && typeof v === 'object' ? v : { clients: {} };
}

export async function markDead(clientId, error) {
  const h = await healthMap();
  h.clients = h.clients || {};
  const was = h.clients[clientId];
  h.clients[clientId] = { ok: false, at: new Date().toISOString(), error: String(error || 'Conexão inválida').slice(0, 200) };
  await setState(KEY, h);
  return !was || was.ok !== false;
}

export async function clearHealth(clientId) {
  const h = await healthMap();
  if (h.clients?.[clientId]) { delete h.clients[clientId]; await setState(KEY, h); }
}

// Testa todos (ou só os vencidos há mais de 6 h, com { force: false }). Devolve o que mudou.
export async function checkConnections({ force = true, now = Date.now() } = {}) {
  const h = await healthMap();
  if (!force && h.at && now - new Date(h.at).getTime() < EVERY_MS) return { skipped: true };
  const clients = await db.select('clients', { select: 'id,name,ig_token,ig_username', ig_token: 'not.is.null' });
  const out = { checked: 0, ok: [], dead: [], newlyDead: [], errors: [] };
  h.clients = h.clients || {};
  for (const c of clients) {
    out.checked++;
    try {
      await ig.profile(c.ig_token);
      h.clients[c.id] = { ok: true, at: new Date(now).toISOString() };
      out.ok.push(c.name);
    } catch (e) {
      if (isDeadToken(e)) {
        const before = h.clients[c.id];
        h.clients[c.id] = { ok: false, at: new Date(now).toISOString(), error: String(e.message || '').slice(0, 200) };
        out.dead.push(c.name);
        if (!before || before.ok !== false) out.newlyDead.push(c);
      } else out.errors.push({ client: c.name, error: e.message }); // instabilidade: não muda nada
    }
  }
  // tira da lista quem não está mais conectado
  for (const id of Object.keys(h.clients)) if (!clients.some((c) => c.id === id)) delete h.clients[id];
  h.at = new Date(now).toISOString();
  await setState(KEY, h);
  for (const c of out.newlyDead) {
    await notify({ title: `⚠️ Instagram de ${c.name} desconectou`, body: 'Os posts desse cliente não vão sair sozinhos. Mande o link de conexão para o cliente reconectar pelo celular.', url: '/#clientes', tag: `ig-dead-${c.id}` }).catch(() => {});
  }
  out.newlyDead = out.newlyDead.map((c) => c.name);
  return out;
}
