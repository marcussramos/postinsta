// E-mails automáticos pelo Resend (resend.com). Variáveis na Vercel:
//   RESEND_API_KEY   chave da conta Resend
//   MAIL_FROM        remetente, ex.: "MC DIGITAL <contato@mcdigital.com.br>" (domínio verificado no Resend).
//                    Sem domínio verificado o Resend só entrega para o e-mail da própria conta (bom para testar).
// Disparos (pelo agendador, a cada 5 min): posts enviados para aprovação (agrupados), lembrete de aprovação,
// lembrete de cobrança (2 dias antes e no dia seguinte ao vencimento) e relatório mensal pronto.
// Cada envio é registrado em mail_log para nunca repetir.
import { db } from './db.js';
import { appUrl, TIMEZONE } from './env.js';
import { getState } from './appstate.js';
import { billingMonths, dueSoon } from './billing.js';
import { summary } from './reports.js';

export const mailReady = () => Boolean(process.env.RESEND_API_KEY);
export const MAIL_DEFAULTS = { approval: true, reminder: true, charge: true, report: true };
export async function mailSettings() { return { ...MAIL_DEFAULTS, ...((await getState('mail_settings')) || {}) }; }

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const brl = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDay = (d) => d.split('-').reverse().join('/');

function logoTag() {
  try { return `<img src="${appUrl()}/brand/logo.png" width="64" height="64" alt="MC Digital" style="display:block">`; }
  catch { return '<b style="letter-spacing:.06em">MC DIGITAL</b>'; }
}

export function layout({ brand = 'MC DIGITAL', title, lines = [], button, footer }) {
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#EBEBE6;font-family:Arial,Helvetica,sans-serif;color:#2B2B2B">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:14px;border:1px solid #D9D8CF">
<tr><td style="padding:22px 26px 6px">${logoTag()}</td></tr>
<tr><td style="padding:10px 26px 4px"><h1 style="font-size:21px;line-height:1.3;margin:0 0 10px">${esc(title)}</h1>
${lines.map((l) => `<p style="font-size:15px;line-height:1.55;margin:0 0 10px;color:#3D3D3A">${l}</p>`).join('')}</td></tr>
${button ? `<tr><td style="padding:8px 26px 22px"><a href="${esc(button.url)}" style="display:inline-block;background:#2B2B2B;color:#EBEBE6;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px;font-size:15px">${esc(button.label)}</a></td></tr>` : ''}
<tr><td style="padding:14px 26px 20px;border-top:1px solid #eeece5;font-size:12px;color:#8a8c93">${esc(footer || `Mensagem automática de ${brand}.`)}</td></tr>
</table></td></tr></table></body></html>`;
}

export async function sendMail({ to, subject, html, replyTo }) {
  if (!mailReady()) throw new Error('E-mail desligado: falta RESEND_API_KEY na Vercel.');
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.MAIL_FROM || 'MC DIGITAL <onboarding@resend.dev>', to: [to], subject, html, reply_to: replyTo || undefined }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`E-mail: ${data.message || data.error || r.status}`);
  return data.id;
}

// Reserva a chave antes de enviar (evita duplicar se duas rodadas se cruzarem); se o envio falhar, libera.
async function once(key, fn) {
  try { await db.insert('mail_log', { key }); } catch { return false; }
  try { await fn(); return true; } catch (e) { await db.remove('mail_log', { key: `eq.${key}` }).catch(() => {}); throw e; }
}

const validEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || '').trim());
const today = (now) => new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE() }).format(now);

export async function runMailer({ now = Date.now(), budgetMs = 15000 } = {}) {
  if (!mailReady()) return null;
  try { await db.select('mail_log', { select: 'key', limit: 1 }); } catch { return null; } // antes da atualização 9
  const started = Date.now();
  const cfg = await mailSettings();
  const agency = (await getState('agency')) || {};
  const brand = agency.marca || 'MC DIGITAL';
  const replyTo = validEmail(agency.email) ? agency.email : undefined;
  const sent = []; const errors = [];
  const clients = (await db.select('clients', { select: '*' })).filter((c) => validEmail(c.contact_email));
  const hello = (c) => `Olá${c.contract_data?.representante ? `, ${esc(c.contract_data.representante.split(' ')[0])}` : ''}!`;
  const go = async (key, c, subject, body) => {
    if (Date.now() - started > budgetMs) return;
    try { if (await once(key, () => sendMail({ to: c.contact_email.trim(), subject, html: layout({ brand, ...body }), replyTo }))) sent.push(key); }
    catch (e) { errors.push(`${c.name}: ${e.message}`); }
  };
  const approvalUrl = (c) => `${appUrl()}/aprovar?t=${c.approval_token}`;

  for (const c of clients) {
    const pending = await db.select('posts', { select: 'id,scheduled_at,sent_for_approval_at,title', client_id: `eq.${c.id}`, status: 'eq.pending_approval' }).catch(() => []);
    // 1) novos posts para aprovar (espera 3 min para juntar os enviados em sequência)
    if (cfg.approval && pending.length) {
      const fresh = pending.filter((p) => p.sent_for_approval_at && now - new Date(p.sent_for_approval_at) > 3 * 60e3 && now - new Date(p.sent_for_approval_at) < 2 * 864e5);
      const latest = fresh.map((p) => p.sent_for_approval_at).sort().at(-1);
      if (latest) {
        await go(`approval:${c.id}:${latest}`, c, `${pending.length > 1 ? `${pending.length} posts` : 'Post'} de ${c.name} para aprovação`, {
          title: `${pending.length > 1 ? `${pending.length} posts esperando` : 'Um post esperando'} sua aprovação`,
          lines: [hello(c), `Os conteúdos de <b>${esc(c.name)}</b> estão prontos. Abra o link, veja cada post e toque em <b>Aprovar</b> ou <b>Pedir ajuste</b>. Depois de aprovado, ele publica sozinho no horário.`],
          button: { label: 'Ver e aprovar', url: approvalUrl(c) },
        });
      }
    }
    // 2) lembrete: pendente há mais de 24 h e sai nas próximas 48 h (1 por dia)
    if (cfg.reminder) {
      const urgent = pending.filter((p) => p.sent_for_approval_at && now - new Date(p.sent_for_approval_at) > 864e5 && p.scheduled_at && new Date(p.scheduled_at) - now < 2 * 864e5 && new Date(p.scheduled_at) > now);
      if (urgent.length) {
        await go(`reminder:${c.id}:${today(now)}`, c, `Lembrete: ${urgent.length > 1 ? `${urgent.length} posts` : 'post'} de ${c.name} aguardando aprovação`, {
          title: 'Falta sua aprovação',
          lines: [hello(c), `${urgent.length > 1 ? `${urgent.length} posts estão marcados` : 'Um post está marcado'} para as próximas 48 horas e ainda ${urgent.length > 1 ? 'precisam' : 'precisa'} da sua aprovação. Sem aprovação, ${urgent.length > 1 ? 'eles não são publicados' : 'ele não é publicado'}.`],
          button: { label: 'Aprovar agora', url: approvalUrl(c) },
        });
      }
    }
    // 3) cobrança: 2 dias antes do vencimento e 1 dia depois (se ainda em aberto)
    if (cfg.charge && c.billing_start && c.monthly_fee_cents != null) {
      const payments = await db.select('payments', { select: '*', client_id: `eq.${c.id}` }).catch(() => []);
      const months = billingMonths(c, payments, { now });
      const t = today(now);
      const link = c.portal_token ? `${appUrl()}/cliente?t=${c.portal_token}` : null;
      const payLine = link ? 'Pela sua área do cliente dá para pagar com Pix (QR Code ou copia e cola) e a baixa é automática.' : agency.pix ? `Chave Pix: <b>${esc(agency.pix)}</b>` : '';
      for (const p of dueSoon(months, t)) {
        if (p.status !== 'open') continue;
        await go(`charge:${c.id}:${p.month}:${p.n}:soon`, c, `Mensalidade de ${c.name}: vence ${fmtDay(p.due)}`, {
          title: `Sua mensalidade vence em ${fmtDay(p.due)}`,
          lines: [hello(c), `Lembrete da ${p.of > 1 ? `${p.n}ª parcela da ` : ''}mensalidade de <b>${esc(c.name)}</b>: <b>${brl(p.cents)}</b>, vencimento ${fmtDay(p.due)}.`, payLine].filter(Boolean),
          button: link ? { label: 'Pagar com Pix', url: link } : null,
        });
      }
      const dayAfter = (d) => new Date(new Date(`${d}T12:00:00Z`).getTime() + 864e5).toISOString().slice(0, 10);
      for (const m of months) for (const p of m.parcels) {
        if (p.status !== 'late' || t < dayAfter(p.due) || t > dayAfter(dayAfter(dayAfter(p.due)))) continue; // só nos 3 primeiros dias de atraso
        await go(`charge:${c.id}:${m.month}:${p.n}:late`, c, `Mensalidade de ${c.name} em aberto`, {
          title: 'Mensalidade em aberto',
          lines: [hello(c), `Não identificamos o pagamento da ${p.of > 1 ? `${p.n}ª parcela da ` : ''}mensalidade de <b>${esc(c.name)}</b> (${brl(p.cents)}, vencida em ${fmtDay(p.due)}). Se já pagou, desconsidere.`, payLine].filter(Boolean),
          button: link ? { label: 'Pagar com Pix', url: link } : null,
        });
      }
    }
    // 4) relatório do mês fechado ficou pronto
    if (cfg.report) {
      const reps = await db.select('reports', { select: 'id,ref_month,share_token,data,created_at', client_id: `eq.${c.id}`, created_at: `gte.${new Date(now - 3 * 864e5).toISOString()}` }).catch(() => []);
      for (const r of reps.filter((x) => !x.data?.period?.partial)) {
        const s = summary(r.data || {});
        const [y, mo] = r.ref_month.split('-');
        const label = new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(+y, +mo - 1, 15)));
        await go(`report:${r.id}`, c, `Relatório de ${label} de ${c.name}`, {
          title: `Seu relatório de ${label} está pronto`,
          lines: [hello(c), `Os resultados do Instagram de <b>${esc(c.name)}</b> em ${label}:`,
            [s.reach != null ? `Alcance: <b>${Number(s.reach).toLocaleString('pt-BR')}</b>` : null, s.interactions != null ? `Interações: <b>${Number(s.interactions).toLocaleString('pt-BR')}</b>` : null,
              s.followers_gained != null ? `Novos seguidores: <b>${Number(s.followers_gained).toLocaleString('pt-BR')}</b>` : null].filter(Boolean).join(' · ') || 'Abra para ver alcance, interações e os melhores posts.'],
          button: { label: 'Abrir relatório', url: `${appUrl()}/relatorio?t=${r.share_token}` },
        });
      }
    }
  }
  return { sent, errors };
}
