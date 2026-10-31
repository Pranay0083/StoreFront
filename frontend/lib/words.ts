const ONES = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

/** Small counts in words, as an editor sets them in running copy ("sixty pieces"); larger ones as figures. */
export function inWords(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 99) return n.toLocaleString('en-IN');
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '');
}

export const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "5 Nov", in the store's time zone. */
export const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
