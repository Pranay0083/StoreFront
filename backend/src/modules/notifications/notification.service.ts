import type { Logger } from 'pino';
import { UnrecoverableJobError, type JobQueue } from '../../core/queue/job-queue';
import type { Channel, EmailProvider, MessagingProvider } from './channels';
import type { NotificationLogRepository } from './notification-log';
import { render, type TemplateData, type TemplateName } from './templates';

export const SEND_NOTIFICATION_JOB = 'notifications.send';

export interface NotificationRequest<K extends TemplateName = TemplateName> {
  /** Stable idempotency key for the business fact, e.g. `order-shipped:<orderId>`. */
  key: string;
  template: K;
  data: TemplateData[K];
  to: { email?: string; phone?: string };
  channels?: Channel[];
}

export type DeliveryOutcome = { channel: Channel; status: 'sent' | 'skipped' | 'unavailable' };

export class NotificationService {
  constructor(
    private readonly email: EmailProvider,
    private readonly messaging: MessagingProvider[],
    private readonly log: NotificationLogRepository,
    private readonly from: string,
    private readonly logger: Logger,
  ) {}

  /** Sends on every requested channel at most once; throws so the job retries only the channels that failed. */
  async deliver(request: NotificationRequest): Promise<DeliveryOutcome[]> {
    const message = render(request.template, request.data);
    const outcomes: DeliveryOutcome[] = [];
    const failures: string[] = [];
    let retryable = false;
    for (const channel of request.channels ?? ['email']) {
      const to = channel === 'email' ? request.to.email : request.to.phone;
      const provider = channel === 'email' ? this.email : this.messaging.find(m => m.channel === channel);
      if (!to || !provider) {
        outcomes.push({ channel, status: 'unavailable' });
        continue;
      }
      const id = `${request.key}:${channel}`;
      if (!(await this.log.claim({ _id: id, key: request.key, template: request.template, channel, to }))) {
        outcomes.push({ channel, status: 'skipped' });
        continue;
      }
      try {
        const receipt =
          channel === 'email'
            ? await this.email.send({
                from: this.from,
                to,
                subject: message.subject,
                text: message.text,
                html: message.html,
                idempotencyKey: id,
              })
            : await (provider as MessagingProvider).send({ to, body: message.short, idempotencyKey: id });
        await this.log.markSent(id, receipt.provider, receipt.providerMessageId);
        outcomes.push({ channel, status: 'sent' });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        await this.log.markFailed(id, error);
        this.logger.warn({ err, key: request.key, channel }, 'Notification delivery failed');
        failures.push(`${channel}: ${error}`);
        if (!(err instanceof UnrecoverableJobError)) retryable = true;
      }
    }
    if (failures.length) {
      const summary = `Notification ${request.key} failed on ${failures.join('; ')}`;
      throw retryable ? new Error(summary) : new UnrecoverableJobError(summary);
    }
    return outcomes;
  }
}

/** Producer side: notifications are always sent from the queue, never inline in a request or handler. */
export class NotificationDispatcher {
  constructor(private readonly jobs: JobQueue) {}

  register(service: NotificationService): void {
    this.jobs.register<NotificationRequest>({
      name: SEND_NOTIFICATION_JOB,
      queue: 'notifications',
      attempts: 6,
      backoffMs: 30_000,
      concurrency: 5,
      handler: async request => void (await service.deliver(request)),
    });
  }

  notify<K extends TemplateName>(request: NotificationRequest<K>): Promise<void> {
    return this.jobs.enqueue(SEND_NOTIFICATION_JOB, request, { jobId: `notify:${request.key}` });
  }
}
