import { formatINR, type Paise } from '@storefront/contracts';

export interface LineSummary {
  title: string;
  qty: number;
  size?: string;
}

export interface TemplateData {
  orderConfirmation: { name: string; orderNumber: string; total: Paise; items: LineSummary[]; orderUrl: string };
  orderShipped: { name: string; orderNumber: string; orderUrl: string; note?: string };
  orderDelivered: { name: string; orderNumber: string; orderUrl: string };
  refundCompleted: { name: string; orderNumber: string; amount: Paise; orderUrl: string };
  abandonedCart: { name: string; items: LineSummary[]; cartUrl: string };
}

export type TemplateName = keyof TemplateData;
export const TEMPLATE_NAMES = ['orderConfirmation', 'orderShipped', 'orderDelivered', 'refundCompleted', 'abandonedCart'] as const;

export interface RenderedMessage {
  subject: string;
  text: string;
  html: string;
  /** Short form for SMS/WhatsApp. */
  short: string;
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Everything interpolated into HTML is escaped: product titles, names and notes are user-controlled. */
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ESCAPES[c]);

const firstName = (name: string) => name.trim().split(/\s+/)[0] || 'there';
const lineText = (l: LineSummary) => `- ${l.title}${l.size ? ` (${l.size})` : ''} × ${l.qty}`;
const lineHtml = (l: LineSummary) => `<li>${escapeHtml(l.title)}${l.size ? ` (${escapeHtml(l.size)})` : ''} × ${l.qty}</li>`;

function layout(heading: string, paragraphs: string[], cta?: { label: string; url: string }): string {
  const body = paragraphs.map(p => `<p style="margin:0 0 12px">${p}</p>`).join('');
  const button = cta
    ? `<p style="margin:20px 0"><a href="${escapeHtml(cta.url)}" style="background:#111;color:#fff;padding:10px 18px;text-decoration:none;border-radius:4px">${escapeHtml(cta.label)}</a></p>`
    : '';
  return `<!doctype html><html><body style="font-family:Helvetica,Arial,sans-serif;color:#111;max-width:560px;margin:auto;padding:24px"><p style="letter-spacing:.2em;font-size:12px">STOREFRONT</p><h1 style="font-size:20px">${escapeHtml(heading)}</h1>${body}${button}<p style="color:#888;font-size:12px">Considered clothing · This is a transactional message about your account.</p></body></html>`;
}

type Renderers = { [K in TemplateName]: (data: TemplateData[K]) => RenderedMessage };

/** Typed template registry: adding a template without its data shape (or vice versa) fails to compile. */
export const TEMPLATES: Renderers = {
  orderConfirmation: d => ({
    subject: `Order ${d.orderNumber} confirmed`,
    text: [
      `Hi ${firstName(d.name)},`,
      '',
      `Thanks for your order ${d.orderNumber}.`,
      ...d.items.map(lineText),
      '',
      `Total paid: ${formatINR(d.total)}`,
      `Track it: ${d.orderUrl}`,
    ].join('\n'),
    html: layout(
      `Thanks, ${firstName(d.name)} — your order is confirmed`,
      [
        `Order <strong>${escapeHtml(d.orderNumber)}</strong>`,
        `<ul>${d.items.map(lineHtml).join('')}</ul>`,
        `Total paid: <strong>${formatINR(d.total)}</strong>`,
      ],
      { label: 'View order', url: d.orderUrl },
    ),
    short: `STOREFRONT: order ${d.orderNumber} confirmed (${formatINR(d.total)}). ${d.orderUrl}`,
  }),
  orderShipped: d => ({
    subject: `Order ${d.orderNumber} is on its way`,
    text: [
      `Hi ${firstName(d.name)},`,
      '',
      `Good news: order ${d.orderNumber} has shipped.`,
      ...(d.note ? [d.note] : []),
      `Track it: ${d.orderUrl}`,
    ].join('\n'),
    html: layout(
      `Order ${d.orderNumber} has shipped`,
      [`It usually arrives in 3–5 business days.`, ...(d.note ? [escapeHtml(d.note)] : [])],
      {
        label: 'Track order',
        url: d.orderUrl,
      },
    ),
    short: `STOREFRONT: order ${d.orderNumber} has shipped. Track: ${d.orderUrl}`,
  }),
  orderDelivered: d => ({
    subject: `Order ${d.orderNumber} was delivered`,
    text: [
      `Hi ${firstName(d.name)},`,
      '',
      `Order ${d.orderNumber} was delivered. We hope you love it.`,
      `Returns are open for 7 days: ${d.orderUrl}`,
    ].join('\n'),
    html: layout(`Delivered: order ${d.orderNumber}`, ['We hope you love it. Returns are open for 7 days from delivery.'], {
      label: 'Review your order',
      url: d.orderUrl,
    }),
    short: `STOREFRONT: order ${d.orderNumber} was delivered.`,
  }),
  refundCompleted: d => ({
    subject: `Refund for order ${d.orderNumber} processed`,
    text: [
      `Hi ${firstName(d.name)},`,
      '',
      `We refunded ${formatINR(d.amount)} for order ${d.orderNumber} to your original payment method.`,
      d.orderUrl,
    ].join('\n'),
    html: layout(
      'Your refund is on its way',
      [
        `We refunded <strong>${formatINR(d.amount)}</strong> for order ${escapeHtml(d.orderNumber)} to your original payment method. Banks usually take 5–7 days.`,
      ],
      { label: 'View order', url: d.orderUrl },
    ),
    short: `STOREFRONT: refund of ${formatINR(d.amount)} for ${d.orderNumber} processed.`,
  }),
  abandonedCart: d => ({
    subject: 'You left something in your bag',
    text: [
      `Hi ${firstName(d.name)},`,
      '',
      'Your bag is saved:',
      ...d.items.map(lineText),
      '',
      `Pick up where you left off: ${d.cartUrl}`,
    ].join('\n'),
    html: layout('Still thinking it over?', ['Your bag is saved:', `<ul>${d.items.map(lineHtml).join('')}</ul>`], {
      label: 'Return to bag',
      url: d.cartUrl,
    }),
    short: `STOREFRONT: your bag is saved. ${d.cartUrl}`,
  }),
};

export function render<K extends TemplateName>(template: K, data: TemplateData[K]): RenderedMessage {
  return (TEMPLATES[template] as (d: TemplateData[K]) => RenderedMessage)(data);
}
