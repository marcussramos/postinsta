// Clientes "só produção": a agência capta, edita e entrega; quem posta é o próprio cliente.
// O app não publica os posts deles (nem acusa "Instagram não conectado") e a entrega fecha o post.
import { getState, setState } from './appstate.js';

const KEY = 'production_only';
export async function productionList() { const v = await getState(KEY, []); return Array.isArray(v) ? v : []; }
export async function isProductionOnly(clientId) { return (await productionList()).includes(clientId); }
export async function setProductionOnly(clientId, on) {
  const s = new Set(await productionList());
  if (on) s.add(clientId); else s.delete(clientId);
  await setState(KEY, [...s]);
  return s;
}
