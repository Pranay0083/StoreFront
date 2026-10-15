import { describe, expect, it, vi } from 'vitest';
import { UnrecoverableJobError } from '../../core/queue/job-queue';
import { ResendEmailProvider, SmtpEmailProvider } from './providers';
import { escapeHtml, render, TEMPLATE_NAMES, TEMPLATES } from './templates';

const message = {
  from: 'a@b.c',
  to: 'buyer@test.dev',
  subject: 's',
  text: 't',
  html: '<p>h</p>',
  idempotencyKey: 'order-confirmation:1:email',
};

describe('notification templates', () => {
  it('renders every template with subject, text, html and a short form', () => {
    expect(Object.keys(TEMPLATES).sort()).toEqual([...TEMPLATE_NAMES].sort());
    const msg = render('orderConfirmation', {
      name: 'Asha Verma',
      orderNumber: 'SF-1',
      total: 249_900,
      items: [{ title: 'Oxford Shirt', qty: 2, size: 'M' }],
      orderUrl: 'https://shop.test/orders/1',
    });
    expect(msg.subject).toBe('Order SF-1 confirmed');
    expect(msg.text).toContain('Hi Asha,');
    expect(msg.text).toContain('- Oxford Shirt (M) × 2');
    expect(msg.text).toContain('₹2,499');
    expect(msg.html).toContain('href="https://shop.test/orders/1"');
    expect(msg.short.length).toBeLessThan(160);
  });

  it('escapes user-controlled values in HTML', () => {
    const msg = render('abandonedCart', {
      name: '<img src=x onerror=alert(1)>',
      items: [{ title: '"><script>steal()</script>', qty: 1 }],
      cartUrl: 'https://shop.test/cart',
    });
    expect(msg.html).not.toContain('<script>');
    expect(msg.html).toContain('&quot;&gt;&lt;script&gt;');
    expect(escapeHtml(`<a href='x'>&</a>`)).toBe('&lt;a href=&#39;x&#39;&gt;&amp;&lt;/a&gt;');
  });
});

describe('ResendEmailProvider', () => {
  const response = (status: number, body: unknown) => ({
    ok: status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });

  it('sends with an idempotency key and returns the provider id', async () => {
    const fetchFn = vi.fn().mockResolvedValue(response(200, { id: 'em_123' }));
    const receipt = await new ResendEmailProvider('re_key', fetchFn).send(message);
    expect(receipt).toEqual({ provider: 'resend', providerMessageId: 'em_123' });
    const [, init] = fetchFn.mock.calls[0];
    expect(init.headers).toMatchObject({ Authorization: 'Bearer re_key', 'Idempotency-Key': message.idempotencyKey });
    expect(JSON.parse(init.body)).toMatchObject({ to: ['buyer@test.dev'], subject: 's' });
  });

  it('treats validation errors as permanent and outages as retryable', async () => {
    await expect(
      new ResendEmailProvider('k', vi.fn().mockResolvedValue(response(422, { message: 'bad to' }))).send(message),
    ).rejects.toBeInstanceOf(UnrecoverableJobError);
    const outage = new ResendEmailProvider('k', vi.fn().mockResolvedValue(response(503, {}))).send(message);
    await expect(outage).rejects.toThrow('Resend request failed (503)');
    await expect(new ResendEmailProvider('k', vi.fn().mockResolvedValue(response(429, {}))).send(message)).rejects.not.toBeInstanceOf(
      UnrecoverableJobError,
    );
  });
});

describe('SmtpEmailProvider', () => {
  it('maps permanent SMTP rejections to unrecoverable errors', async () => {
    const transport = { sendMail: vi.fn().mockRejectedValue(Object.assign(new Error('mailbox unavailable'), { responseCode: 550 })) };
    await expect(new SmtpEmailProvider(transport as never).send(message)).rejects.toBeInstanceOf(UnrecoverableJobError);
    const transient = { sendMail: vi.fn().mockRejectedValue(Object.assign(new Error('try later'), { responseCode: 421 })) };
    await expect(new SmtpEmailProvider(transient as never).send(message)).rejects.toThrow('try later');
  });

  it('returns the message id on success', async () => {
    const transport = { sendMail: vi.fn().mockResolvedValue({ messageId: '<abc@mx>' }) };
    expect(await new SmtpEmailProvider(transport as never).send(message)).toEqual({ provider: 'smtp', providerMessageId: '<abc@mx>' });
    expect(transport.sendMail.mock.calls[0][0]).toMatchObject({ to: 'buyer@test.dev', html: '<p>h</p>' });
  });
});
