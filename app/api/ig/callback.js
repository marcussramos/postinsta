// Volta do login do Instagram: troca o código por token e grava no cliente.
import { route, query, redirect } from '../../lib/http.js';
import { verify } from '../../lib/auth.js';
import { connectAccount } from '../../lib/ig.js';
import { db } from '../../lib/db.js';
import { rememberScopedId } from '../../lib/pasta/meta.js';
import { clearHealth } from '../../lib/ighealth.js';
import { notify } from '../../lib/push.js';

function back(res, state, params) {
  const p = new URLSearchParams(params);
  if (state?.back && state.back !== 'panel') return redirect(res, `/conectar?t=${state.back}&${p}`);
  redirect(res, `/equipe?${p}#clientes`);
}

export default route({
  GET: async (req, res) => {
    const q = query(req);
    const state = verify(q.state);
    if (q.error) return back(res, state, { ig: 'cancelado', msg: q.error_description || 'Conexão cancelada.' });
    if (!state?.client) return back(res, null, { ig: 'erro', msg: 'Link de conexão expirado. Tente de novo.' });
    try {
      const { scoped_id, ...acc } = await connectAccount(q.code);
      // O mesmo perfil não pode ficar em dois clientes (publicaria em dobro).
      const dup = await db.one('clients', { select: 'id,name', ig_user_id: `eq.${acc.ig_user_id}`, id: `neq.${state.client}` });
      if (dup) return back(res, state, { ig: 'erro', msg: state.back === 'panel'
        ? `Este Instagram já está conectado ao cliente "${dup.name}".`
        : 'Este Instagram já está conectado em outro cadastro. Fale com a agência.' });
      await db.update('clients', { id: `eq.${state.client}` }, { ...acc, ig_connected_at: new Date().toISOString() });
      await rememberScopedId(scoped_id, state.client).catch(() => {});
      await clearHealth(state.client).catch(() => {});
      if (state.back !== 'panel') {
        const c = await db.one('clients', { select: 'name', id: `eq.${state.client}` }).catch(() => null);
        await notify({ title: `✅ ${c?.name || 'Cliente'} conectou o Instagram`, body: `@${acc.ig_username || 'perfil'} conectado pelo link. Os posts aprovados já saem sozinhos.`, url: '/equipe#clientes', tag: `ig-ok-${state.client}` }).catch(() => {});
      }
      back(res, state, { ig: 'ok', msg: `@${acc.ig_username || 'perfil'} conectado.` });
    } catch (e) {
      console.error(e);
      back(res, state, { ig: 'erro', msg: e.message || 'Não foi possível conectar.' });
    }
  },
});
