import type { Logger } from 'pino';

export type Channel = 'email' | 'sms' | 'whatsapp';

export interface EmailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Forwarded to providers that deduplicate, so a retried job never sends twice upstream. */
  idempotencyKey: string;
}

export interface ShortMessage {
  to: string;
  body: string;
  idempotencyKey: string;
}

export interface DeliveryReceipt {
  provider: string;
  providerMessageId?: string;
}

/** Strategy interface per e-mail provider. */
export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<DeliveryReceipt>;
}

/** Strategy interface for SMS/WhatsApp providers. */
export interface MessagingProvider {
  readonly name: string;
  readonly channel: Extract<Channel, 'sms' | 'whatsapp'>;
  send(message: ShortMessage): Promise<DeliveryReceipt>;
}

/** Development provider: logs instead of sending and keeps the last messages for inspection. */
export class ConsoleEmailProvider implements EmailProvider {
  readonly name = 'console';
  readonly sent: EmailMessage[] = [];

  constructor(
    private readonly logger: Logger,
    private readonly keep = 50,
  ) {}

  async send(message: EmailMessage): Promise<DeliveryReceipt> {
    this.sent.push(message);
    if (this.sent.length > this.keep) this.sent.shift();
    this.logger.info({ to: message.to, subject: message.subject }, 'E-mail (console provider)');
    return { provider: this.name };
  }
}

export class ConsoleMessagingProvider implements MessagingProvider {
  readonly name = 'console';
  readonly sent: ShortMessage[] = [];

  constructor(
    readonly channel: MessagingProvider['channel'],
    private readonly logger: Logger,
    private readonly keep = 50,
  ) {}

  async send(message: ShortMessage): Promise<DeliveryReceipt> {
    this.sent.push(message);
    if (this.sent.length > this.keep) this.sent.shift();
    this.logger.info({ to: message.to, channel: this.channel }, 'Message (console provider)');
    return { provider: this.name };
  }
}
