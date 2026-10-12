// Inicia a conexão do Instagram de um cliente.
//   pela agência:  /api/ig/connect?client=<id>       (precisa estar logado no painel)
//   pelo cliente:  /api/ig/connect?t=<token-de-aprovação>  (link que o próprio cliente abre no celular)
import { route, query, need, redirect } from '../../lib/http.js';
import { isAdmin, sign } from '../../lib/auth.js';
import { authorizeUrl } from '../../lib/ig.js';
import { db } from '../../lib/db.js';
import { igReady } from '../../lib/env.js';

export default route({
  GET: async (req, res) => {
    const q = query(req);
    if (!igReady()) {
      // volta para a tela de onde a pessoa veio, com a explicação, em vez de mostrar um erro cru
      const msg = q.t
        ? 'A conexão com o Instagram ainda não foi liberada pela agência. Tente mais tarde.'
        : 'Falta configurar o app da Meta (IG_APP_ID e IG_APP_SECRET na Vercel). Veja a aba Ajustes.';
      const p = new URLSearchParams({ ig: 'erro', msg });
      return redirect(res, q.t ? `/aprovar?t=${encodeURIComponent(q.t)}&${p}` : `/?${p}#ajustes`);
    }
    let client, back = 'panel';
    if (q.t) {
      need(/^[0-9a-f]{32,}$/.test(q.t), 404, 'Link inválido.');
      const c = await db.one('clients', { select: 'id', approval_token: `eq.${q.t}` });
      need(c, 404, 'Este link não existe mais. Peça um novo para a agência.');
      client = c.id; back = q.t;
    } else {
      need(isAdmin(req), 401, 'Entre no painel para conectar o Instagram.');
      need(q.client, 400, 'Cliente não informado.');
      client = q.client;
    }
    // "state" assinado: garante que a volta do Instagram é desta conexão e deste cliente.
    const state = sign({ client, back, exp: Date.now() + 15 * 60 * 1000 });
    redirect(res, authorizeUrl(state));
  },
});
