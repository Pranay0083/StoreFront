/**
 * Everything a tool returns, and any text written by customers (reviews, chat history summaries),
 * is data for the model, never instructions. It is delimited, and instruction-shaped phrases are
 * neutralised so a malicious review cannot steer the agent.
 */

const INJECTION_PATTERNS: RegExp[] = [
  /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(instructions?|prompts?|rules?|messages?|guidelines?)\b/gi,
  /\b(system|developer)\s+(prompt|message|instructions?)\b/gi,
  /\byou are now\b/gi,
  /\b(new|updated) instructions?\b/gi,
  /\bact as (an?|the)\b/gi,
  /\b(call|use|invoke|run)\s+(the\s+)?(tool|function)\b/gi,
  /\b(cancel|refund)_order\b|\badd_to_cart\b|\brequest_refund\b/gi,
  /<\/?\s*(system|assistant|user|tool_result|customer_content|instructions?)[^>]*>/gi,
  /^\s*(system|assistant|developer)\s*:/gim,
];

export const REDACTION = '[removed]';

export function neutralizeText(text: string): { text: string; redactions: number } {
  let redactions = 0;
  let out = text;
  for (const pattern of INJECTION_PATTERNS) {
    out = out.replace(pattern, () => {
      redactions++;
      return REDACTION;
    });
  }
  return { text: out, redactions };
}

/** Deeply neutralises every string in a tool result, counting what was removed. */
export function neutralizeDeep<T>(value: T): { value: T; redactions: number } {
  let redactions = 0;
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const r = neutralizeText(v);
      redactions += r.redactions;
      return r.text;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object' && !(v instanceof Date)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return { value: walk(value) as T, redactions };
}

/** Serialises a tool result inside a delimiter the system prompt tells the model to treat as data. */
export function wrapToolResult(toolName: string, result: unknown): string {
  const { value, redactions } = neutralizeDeep(result);
  const payload = redactions ? { ...(value as object), _notice: 'Instruction-like text was removed from this data.' } : value;
  return `<tool_result name="${toolName}">\n${JSON.stringify(payload)}\n</tool_result>`;
}

export function wrapCustomerContent(text: string): string {
  return `<customer_content>${neutralizeText(text).text}</customer_content>`;
}

/**
 * Blocks replies that quote the system prompt: any sentence of 40+ characters copied verbatim
 * counts as a leak.
 */
export class OutputGuard {
  static readonly LEAK_REPLY = "I can't share how I'm configured, but I'm happy to help you shop. What are you looking for?";

  check(reply: string, systemPrompt: string): { reply: string; leaked: boolean } {
    const normalized = reply.replace(/\s+/g, ' ').toLowerCase();
    const sentences = systemPrompt
      .split(/(?<=[.!?:])\s+|\n+/)
      .map(s => s.replace(/\s+/g, ' ').trim().toLowerCase())
      .filter(s => s.length >= 40);
    const leaked = sentences.some(s => normalized.includes(s));
    return leaked ? { reply: OutputGuard.LEAK_REPLY, leaked } : { reply, leaked };
  }
}
