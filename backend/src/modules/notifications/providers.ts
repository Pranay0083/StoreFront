import nodemailer, { type Transporter } from 'nodemailer';
import type { Logger } from 'pino';
import { UnrecoverableJobError } from '../../core/queue/job-queue';
import { ConsoleEmailProvider, type DeliveryReceipt, type EmailMessage, type EmailProvider } from './channels';

/** SMTP via nodemailer. 5xx replies are permanent rejections (bad mailbox, policy) and are not retried. */
export class SmtpEmailProvider implements EmailProvider {
  readonly name = 'smtp';
  private readonly transport: Transporter;

  constructor(urlOrTransport: string | Transporter) {
    this.transport = typeof urlOrTransport === 'string' ? nodemailer.createTransport(urlOrTransport) : urlOrTransport;
  }

  async send(message: EmailMessage): Promise<DeliveryReceipt> {
    try {
      const info = await this.transport.sendMail({
        from: message.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        headers: { 'X-Entity-Ref-ID': message.idempotencyKey },
      });
      return { provider: this.name, providerMessageId: info.messageId };
    } catch (err) {
      const code = (err as { responseCode?: number }).responseCode;
      if (code && code >= 500 && code < 600) throw new UnrecoverableJobError(`SMTP rejected the message (${code})`);
      throw err;
    }
  }
}

type FetchFn = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

/** Resend HTTP API. Its Idempotency-Key header makes retried sends safe at the provider too. */
export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';

  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: FetchFn = fetch as unknown as FetchFn,
    private readonly endpoint = 'https://api.resend.com/emails',
  ) {}

  async send(message: EmailMessage): Promise<DeliveryReceipt> {
    const res = await this.fetchFn(this.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': message.idempotencyKey.slice(0, 256),
      },
      body: JSON.stringify({ from: message.from, to: [message.to], subject: message.subject, text: message.text, html: message.html }),
    });
    if (res.ok) {
      const body = (await res.json()) as { id?: string };
      return { provider: this.name, ...(body.id && { providerMessageId: body.id }) };
    }
    const detail = (await res.text()).slice(0, 300);
    if (res.status >= 400 && res.status < 500 && res.status !== 429) {
      throw new UnrecoverableJobError(`Resend rejected the message (${res.status}): ${detail}`);
    }
    throw Object.assign(new Error(`Resend request failed (${res.status}): ${detail}`), { status: res.status });
  }
}

export function createEmailProvider(config: { RESEND_API_KEY?: string; SMTP_URL?: string }, logger: Logger): EmailProvider {
  if (config.RESEND_API_KEY) return new ResendEmailProvider(config.RESEND_API_KEY);
  if (config.SMTP_URL) return new SmtpEmailProvider(config.SMTP_URL);
  return new ConsoleEmailProvider(logger);
}
