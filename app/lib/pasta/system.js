// Rotas de sistema:
//   backup    (admin) GET lista | GET ?path= baixa | POST faz um backup agora
//   push      (admin/equipe) GET chave pública | POST {subscription} inscreve este aparelho | POST ?test=1 | DELETE {endpoint}
//   security  (a própria conta) GET | POST {start:1} gera segredo | POST {code} ativa | DELETE {code} desativa   (2 etapas)
//   mailcfg   (admin) GET | PUT {approval, reminder, charge, report} | POST {to} e-mail de teste
//   nf        (admin) GET | PUT configuração da nota fiscal | POST {client_id, month, n} emite a nota de uma parcela paga
//   privacy   (admin) GET {media_private} | PUT {media_private} liga/desliga "Fotos privadas" (bucket posts)
import { route, send, readJson, query, need, redirect } from '../http.js';
import { requireAdmin, requireStaff } from '../auth.js';
import { db, docs, storage } from '../db.js';
import { setMediaPrivateCache } from '../media.js';
import { listBackups, runBackup } from '../backup.js';
import { vapidKeys, notify } from '../push.js';
import { newSecret, otpauthUrl, verifyTotp, activeSecret, saveSecret, twoFactorOff } from '../totp.js';
import { getState, setState } from '../appstate.js';
import { mailReady, mailSettings, sendMail, layout, MAIL_DEFAULTS } from '../mail.js';
import { nfSettings, issueInvoice, asaasReady, NF_DEFAULTS } from '../asaas.js';

export const backupRoute = route({
  GET: async (req, res) => {
    await requireAdmin(req);
    const { path } = query(req);
    const list = await listBackups();
    if (path) {
      need(list.some((b) => b.path === path), 404, 'Backup não encontrado.');
      return redirect(res, await docs.signedUrl(path, { expiresIn: 120, downloadName: path.split('/').pop() }), { 'Cache-Control': 'no-store' });
    }
    send(res, 200, list);
  },
  POST: async (req, res) => {
    await requireAdmin(req);
    send(res, 201, await runBackup({ reason: 'manual' }));
  },
});

export const pushRoute = route({
  GET: async (req, res) => {
    const u = await requireStaff(req);
    const keys = await vapidKeys();
    const mine = await db.select('push_subs', { select: 'id', ...(u.uid ? { user_id: `eq.${u.uid}` } : { user_id: 'is.null' }) }).catch(() => null);
    send(res, 200, { public_key: keys.publicKey, devices: mine ? mine.length : null });
  },
  POST: async (req, res) => {
    const u = await requireStaff(req);
    if (query(req).test) {
      const n = await notify({ title: '🔔 Notificações ligadas', body: 'É assim que o MC DIGITAL vai te avisar de aprovações, pedidos, pagamentos e falhas.', url: '/#inicio' });
      return send(res, 200, { delivered: n });
    }
    const b = await readJson(req);
    const s = b.subscription || {};
    need(/^https:\/\//.test(s.endpoint || '') && s.keys?.p256dh && s.keys?.auth, 400, 'Inscrição inválida.');
    await db.remove('push_subs', { endpoint: `eq.${s.endpoint}` }).catch(() => {});
    await db.insert('push_subs', { endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth, role: u.role, user_id: u.uid || null, device: String(b.device || '').slice(0, 120) || null });
    send(res, 201, { ok: true });
  },
  DELETE: async (req, res) => {
    await requireStaff(req);
    const b = await readJson(req);
    if (b.endpoint) await db.remove('push_subs', { endpoint: `eq.${b.endpoint}` });
    send(res, 200, { ok: true });
  },
});

const pendingKey = (u) => `totp_pending_${u.uid || 'owner'}`;
export const securityRoute = route({
  GET: async (req, res) => {
    const u = await requireStaff(req);
    send(res, 200, { enabled: Boolean(await activeSecret(u.uid)), disabled_by_env: twoFactorOff() });
  },
  POST: async (req, res) => {
    const u = await requireStaff(req);
    const b = await readJson(req);
    if (b.start) {
      const secret = newSecret();
      await setState(pendingKey(u), { secret, at: new Date().toISOString() });
      return send(res, 200, { secret, otpauth: otpauthUrl(secret, u.name || 'Dono') });
    }
    const pending = await getState(pendingKey(u));
    need(pending?.secret && Date.now() - new Date(pending.at) < 30 * 60e3, 400, 'Comece de novo: clique em "Ativar" para gerar o QR Code.');
    need(verifyTotp(pending.secret, b.code), 400, 'Código incorreto. Confira se o horário do celular está automático e tente o código atual.');
    await saveSecret(u.uid, pending.secret);
    await setState(pendingKey(u), null);
    send(res, 200, { enabled: true });
  },
  DELETE: async (req, res) => {
    const u = await requireStaff(req);
    const b = await readJson(req);
    const secret = await activeSecret(u.uid);
    if (secret && !twoFactorOff()) need(verifyTotp(secret, b.code), 400, 'Para desligar, digite o código atual do app autenticador.');
    await saveSecret(u.uid, null);
    send(res, 200, { enabled: false });
  },
});

export const mailcfgRoute = route({
  GET: async (req, res) => {
    await requireAdmin(req);
    const recent = await db.select('mail_log', { select: 'key,sent_at', order: 'sent_at.desc', limit: 15 }).catch(() => []);
    send(res, 200, { ready: mailReady(), from: process.env.MAIL_FROM || 'MC DIGITAL <onboarding@resend.dev>', settings: await mailSettings(), recent });
  },
  PUT: async (req, res) => {
    await requireAdmin(req);
    const b = await readJson(req);
    const cfg = Object.fromEntries(Object.keys(MAIL_DEFAULTS).map((k) => [k, b[k] !== undefined ? Boolean(b[k]) : undefined]).filter(([, v]) => v !== undefined));
    await setState('mail_settings', { ...(await mailSettings()), ...cfg });
    send(res, 200, { settings: await mailSettings() });
  },
  POST: async (req, res) => {
    await requireAdmin(req);
    const { to } = await readJson(req);
    need(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(to || '')), 400, 'Informe um e-mail válido.');
    need(mailReady(), 503, 'E-mail desligado: falta RESEND_API_KEY na Vercel.');
    try { await sendMail({ to, subject: 'Teste de e-mail do MC DIGITAL', html: layout({ title: 'Os e-mails automáticos estão funcionando ✓', lines: ['É assim que seus clientes vão receber os avisos de aprovação, lembretes, cobranças e relatórios.'] }) }); }
    catch (e) { need(false, 502, e.message); }
    send(res, 200, { ok: true });
  },
});

export const nfRoute = route({
  GET: async (req, res) => {
    await requireAdmin(req);
    send(res, 200, { ready: asaasReady(), settings: await nfSettings() });
  },
  PUT: async (req, res) => {
    await requireAdmin(req);
    const b = await readJson(req);
    const cur = await nfSettings();
    const next = { ...cur };
    if (b.enabled !== undefined) next.enabled = Boolean(b.enabled);
    for (const k of ['service_description', 'municipal_service_code', 'municipal_service_name', 'municipal_service_id', 'observations']) if (b[k] !== undefined) next[k] = String(b[k] || '').trim().slice(0, k === 'service_description' || k === 'observations' ? 1000 : 200);
    if (b.iss !== undefined) { const n = Number(String(b.iss).replace(',', '.')); need(Number.isFinite(n) && n >= 0 && n <= 10, 400, 'Alíquota de ISS deve ser de 0 a 10 (%).'); next.iss = n; }
    if (next.enabled) need(next.service_description && (next.municipal_service_code || next.municipal_service_id), 400, 'Para ligar, preencha a descrição do serviço e o código do serviço municipal (veja no Asaas ou com o contador).');
    await setState('nf_settings', { ...NF_DEFAULTS, ...next });
    send(res, 200, { settings: await nfSettings() });
  },
  POST: async (req, res) => {
    await requireAdmin(req);
    const b = await readJson(req);
    const ref = { client_id: String(b.client_id || ''), ref_month: String(b.month || ''), installment: Number(b.n) || 1 };
    const pay = await db.one('payments', { select: 'status', client_id: `eq.${ref.client_id}`, ref_month: `eq.${ref.ref_month}`, installment: `eq.${ref.installment}` });
    need(pay?.status === 'paid', 409, 'A nota só sai para parcela paga.');
    send(res, 200, await issueInvoice(ref, null, { force: true }));
  },
});

// "Fotos privadas": tira o acesso público do bucket das fotos dos posts. A partir daí, painel, página de
// aprovação, área do cliente e a Meta recebem links assinados que vencem em 7 dias.
export const privacyRoute = route({
  GET: async (req, res) => {
    await requireAdmin(req);
    send(res, 200, { media_private: Boolean(await getState('media_private', false)) });
  },
  PUT: async (req, res) => {
    await requireAdmin(req);
    const on = Boolean((await readJson(req)).media_private);
    // ordem segura: ao ligar, primeiro passa a assinar e só depois fecha o bucket; ao desligar, abre antes
    if (on) { await setState('media_private', true); setMediaPrivateCache(true); await storage.setPublic(false); }
    else { await storage.setPublic(true); await setState('media_private', false); setMediaPrivateCache(false); }
    send(res, 200, { media_private: on });
  },
});
