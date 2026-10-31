/**
 * Store policies: the one place the shop's rules are written down for people.
 *
 * The website renders these documents, the product page and checkout quote their highlights, and
 * the shopping assistant reads them through `get_store_info`, so the three can never disagree.
 * Every number comes from the constant or schema the code enforces; `policies.test.ts` pins each
 * claim to the rule behind it, so changing a rule without changing its wording fails the build.
 */
import { MAX_LINE_QTY } from './cart';
import { FREE_SHIPPING_THRESHOLD, SHIPPING_FEE, formatINR, shippingFor } from './money';
import { CUSTOMER_CANCELLABLE_STATUSES, CreateOrderSchema, REFUND_WINDOW_DAYS, type OrderStatus } from './orders';
import { PAYMENT_METHODS, type PaymentMethod } from './pricing';

/**
 * Minutes an unpaid order holds its stock. Mirrors the API's `RESERVATION_TTL_MINUTES` default;
 * the backend's store-info test fails if the two drift apart.
 */
export const CHECKOUT_HOLD_MINUTES = 15;

export const POLICY_SLUGS = ['shipping', 'returns', 'cancellations', 'payments', 'privacy', 'terms', 'size-guide', 'help'] as const;
export type PolicySlug = (typeof POLICY_SLUGS)[number];

export type PolicyBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'table'; caption: string; columns: string[]; rows: string[][] };

export interface PolicySection {
  /** Stable anchor for links into the page, e.g. `/policies/returns#how-to-return`. */
  id: string;
  heading: string;
  blocks: PolicyBlock[];
}

export interface PolicyDocument {
  slug: PolicySlug;
  title: string;
  /** One line: the index, meta descriptions and the assistant's digest start here. */
  summary: string;
  /** ISO date the wording last changed. */
  lastUpdated: string;
  /** The rules in a few sentences, shown first on the page and handed to the assistant. */
  keyPoints: string[];
  sections: PolicySection[];
}

const UPDATED = '2026-10-31';

// ── Rules, read from the code ────────────────────────────────────────────────────────────────────

const free = formatINR(FREE_SHIPPING_THRESHOLD);
const fee = formatINR(SHIPPING_FEE);
const days = `${REFUND_WINDOW_DAYS} days`;
const hold = `${CHECKOUT_HOLD_MINUTES} minutes`;

/** Each status as the order page labels it. */
const STATUS_LABEL: Record<OrderStatus, string> = {
  created: 'Created',
  paid: 'Paid',
  packed: 'Packed',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  refund_requested: 'Refund requested',
  partially_refunded: 'Partially refunded',
  refunded: 'Refunded',
};

/** Each status as it reads inside a sentence ("while it is …"). */
const STATUS_PHRASE: Record<OrderStatus, string> = {
  created: 'waiting for payment',
  paid: 'paid',
  packed: 'packed',
  shipped: 'shipped',
  delivered: 'delivered',
  cancelled: 'cancelled',
  refund_requested: 'waiting for a refund',
  partially_refunded: 'partly refunded',
  refunded: 'refunded',
};

const METHOD_LABEL: Record<Exclude<PaymentMethod, 'demo'>, string> = {
  card: 'card',
  upi: 'UPI',
  netbanking: 'netbanking',
  wallet: 'wallet',
};

const orList = (items: readonly string[], word = 'or') =>
  items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} ${word} ${items[items.length - 1]}`;

/** The methods Razorpay can take, in the order a shopper thinks of them. */
const razorpayMethods = (['card', 'upi', 'netbanking', 'wallet'] as const)
  .filter(m => PAYMENT_METHODS.includes(m))
  .map(m => METHOD_LABEL[m]);

const cancellable = CUSTOMER_CANCELLABLE_STATUSES.map(s => STATUS_PHRASE[s]);
/** Cancellable statuses after payment: cancelling one of these is a full refund. */
const cancellablePaid = CUSTOMER_CANCELLABLE_STATUSES.filter(s => s !== 'created').map(s => STATUS_PHRASE[s]);
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

type ZodDef = { maxLength?: { value: number } | null; innerType?: { _def: ZodDef } };

/** The `.max()` of an array schema (looking through `.default()`), so the terms state what the API accepts. */
function arrayMax(schema: { _def: unknown }, name: string): number {
  let def = schema._def as ZodDef | undefined;
  while (def && !def.maxLength && def.innerType) def = def.innerType._def;
  if (!def?.maxLength) throw new Error(`CreateOrderSchema.${name} has no maximum to quote in the terms`);
  return def.maxLength.value;
}

export const ORDER_LIMITS = {
  perLine: MAX_LINE_QTY,
  distinctPieces: arrayMax(CreateOrderSchema.shape.items, 'items'),
  promoCodes: arrayMax(CreateOrderSchema.shape.codes, 'codes'),
} as const;

/** Two worked examples of the delivery rule, computed by the same function checkout uses. */
const shippingExamples = [FREE_SHIPPING_THRESHOLD - 50_000, FREE_SHIPPING_THRESHOLD].map(subtotal => {
  const charge = shippingFor(subtotal);
  return [formatINR(subtotal), charge === 0 ? 'Free' : formatINR(charge)];
});

// ── Highlights quoted on the product page and at checkout ────────────────────────────────────────

export interface PolicyHighlight {
  label: string;
  text: string;
  slug: PolicySlug;
  /** Anchor on the policy page this highlight summarises. */
  section?: string;
}

export const POLICY_HIGHLIGHTS = {
  delivery: { label: 'Delivery', text: `Free over ${free}, otherwise ${fee}. Every step shows on your order page.`, slug: 'shipping' },
  cancelling: { label: 'Cancelling', text: 'Any time before the order ships, refunded in full.', slug: 'cancellations' },
  returns: { label: 'Returns', text: `Within ${days} of delivery, refunded at the price you paid.`, slug: 'returns' },
  payment: {
    label: 'Payment',
    text: `You pay on Razorpay’s own screen by ${orList(razorpayMethods)}. We never see your card or bank details.`,
    slug: 'payments',
  },
  demoPayment: {
    label: 'Payment',
    text: 'Payments are in demo mode: paying runs the same confirmation a real payment does, and nothing is charged.',
    slug: 'payments',
    section: 'demo-mode',
  },
  hold: {
    label: 'Checkout',
    text: `When you press Pay, your pieces are held for ${hold} while you pay.`,
    slug: 'payments',
    section: 'stock-hold',
  },
} as const satisfies Record<string, PolicyHighlight>;

// ── The documents ────────────────────────────────────────────────────────────────────────────────

const p = (text: string): PolicyBlock => ({ type: 'paragraph', text });
const list = (...items: string[]): PolicyBlock => ({ type: 'list', items });

const shipping: PolicyDocument = {
  slug: 'shipping',
  title: 'Shipping and delivery',
  summary: `Delivery is free on orders of ${free} or more, and a flat ${fee} below that.`,
  lastUpdated: UPDATED,
  keyPoints: [
    `Orders of ${free} or more ship free. Below that, delivery is a flat ${fee}.`,
    'The threshold is counted on full prices, before markdowns and offers, so a discount never costs you free delivery.',
    'We deliver to addresses in India with a six-digit PIN code.',
    'Every step, from paid to packed, shipped and delivered, shows on your order page with the time it happened.',
  ],
  sections: [
    {
      id: 'cost',
      heading: 'What delivery costs',
      blocks: [
        p(
          `Delivery is free when the pieces in your bag add up to ${free} or more at their full prices. Below that, one flat fee of ${fee} covers the whole order, however many pieces are in it.`,
        ),
        p(
          'Because the threshold uses full prices, markdowns, bundle deals and promo codes lower what you pay without ever adding the delivery fee back. Some offers also take the delivery fee off; when one applies, your receipt shows it as its own line.',
        ),
        {
          type: 'table',
          caption: 'Two bags, priced by the same rule checkout uses',
          columns: ['Bag at full price', 'Delivery'],
          rows: shippingExamples,
        },
      ],
    },
    {
      id: 'where',
      heading: 'Where we deliver',
      blocks: [
        p(
          'We deliver to addresses in India. Checkout asks for the recipient’s name, the street address, city, state, a six-digit PIN code and a ten-digit phone number, and won’t place the order without them.',
        ),
      ],
    },
    {
      id: 'tracking',
      heading: 'Following your order',
      blocks: [
        p('Each order moves through the same steps, and your order page shows when each one happened:'),
        list(
          `${STATUS_LABEL.paid}: your payment is confirmed. We check the payment provider’s signature before an order is marked paid.`,
          `${STATUS_LABEL.packed}: your pieces are packed and waiting to go.`,
          `${STATUS_LABEL.shipped}: the parcel has left us. From here the order can no longer be cancelled.`,
          `${STATUS_LABEL.delivered}: the parcel has arrived, and the ${days} for returns start.`,
        ),
        p('We email you when the order is confirmed, when it ships and when it is delivered.'),
      ],
    },
    {
      id: 'timing',
      heading: 'How long it takes',
      blocks: [
        p(
          'We don’t promise a delivery date at checkout. Your order page is the record of where your order is, and the assistant can read it to you at any time.',
        ),
      ],
    },
  ],
};

const returns: PolicyDocument = {
  slug: 'returns',
  title: 'Returns and refunds',
  summary: `Return the whole order or single pieces within ${days} of delivery, refunded at what you paid.`,
  lastUpdated: UPDATED,
  keyPoints: [
    `You can return the whole order, or individual pieces, within ${days} of delivery.`,
    'Each piece is refunded at the price you actually paid for it, after markdowns and offers.',
    'Delivery is refunded with the return that leaves nothing on the order unrefunded.',
    'Refunds go back to the original payment method.',
  ],
  sections: [
    {
      id: 'window',
      heading: `The ${REFUND_WINDOW_DAYS}-day window`,
      blocks: [
        p(
          `Returns open when your order is marked ${STATUS_LABEL.delivered} and close ${days} later. Inside that window you can return pieces as often as you like, one at a time or all together, until everything has been returned.`,
        ),
        p(
          'Before delivery there is nothing to return yet: while an order is still being prepared you cancel it instead, which refunds it in full. Once it has shipped, wait for it to arrive and return it from there.',
        ),
      ],
    },
    {
      id: 'how-to-return',
      heading: 'How to return',
      blocks: [
        list(
          'Open the order from My orders and choose Return pieces.',
          'Pick the pieces and quantities you are returning, and tell us why in a few words.',
          'Confirm. The refund is sent to the payment provider straight away.',
        ),
        p(
          'The shopping assistant can start a return for you too. It shows you a card saying what it will return, and nothing happens until you press Confirm.',
        ),
      ],
    },
    {
      id: 'amount',
      heading: 'What you get back',
      blocks: [
        p(
          'Every piece is refunded at what it cost you, not its full price. When an offer such as a bundle or a promo code lowered your total, its saving was shared across the pieces it applied to, to the paisa, and each piece comes back at its share.',
        ),
        p(
          'If you bought several of the same piece, the units split the line’s total evenly, with any leftover paisa on the first units, so returning them one by one adds up to exactly what you paid.',
        ),
        p(
          'Delivery is refunded only with the return that leaves nothing on the order unrefunded. Return two of three pieces and delivery stays paid; return the third and it comes back with it.',
        ),
      ],
    },
    {
      id: 'timing',
      heading: 'When the money arrives',
      blocks: [
        p(
          'Refunds go back to the method you paid with, through Razorpay. Some settle at once; others are confirmed by Razorpay a little later, and the order page shows the refund as requested until they are. How long it then takes to reach your account depends on your bank and payment method.',
        ),
        p(
          'If the payment provider declines a refund, your order goes back to the status it had before, so you can ask again. We email you when a refund is completed.',
        ),
      ],
    },
    {
      id: 'exchanges',
      heading: 'Exchanges',
      blocks: [p('There are no direct exchanges. To swap a size, return the piece for a refund and order the size you want.')],
    },
  ],
};

const cancellations: PolicyDocument = {
  slug: 'cancellations',
  title: 'Cancellations',
  summary: 'Cancel any order until it ships; a paid order is refunded in full, delivery included.',
  lastUpdated: UPDATED,
  keyPoints: [
    `You can cancel an order while it is ${orList(cancellable)}, in other words any time before it ships.`,
    'An unpaid order is simply cancelled and nothing is charged.',
    'A paid order is refunded in full, delivery included, to the original payment method.',
    `An order that isn’t paid within ${hold} cancels itself and releases its pieces.`,
  ],
  sections: [
    {
      id: 'when',
      heading: 'When you can cancel',
      blocks: [
        p(
          `Open the order from My orders and choose Cancel order, or Cancel and refund if you have paid. The button is there while the order is ${orList(cancellable)}.`,
        ),
        p(
          `Once an order has shipped it can’t be cancelled. When it arrives you have ${days} to return it, and the return refunds it the same way.`,
        ),
      ],
    },
    {
      id: 'refund',
      heading: 'What happens to your money',
      blocks: [
        list(
          'Not yet paid: the order is cancelled at once, its pieces go back on sale and nothing is charged.',
          `${capitalise(orList(cancellablePaid))}: cancelling refunds the whole order, delivery included, back to the payment method you used.`,
        ),
        p('A cancellation is always the whole order. To keep some pieces, wait for delivery and return the rest.'),
      ],
    },
    {
      id: 'automatic',
      heading: 'When an order cancels itself',
      blocks: [
        p(
          `When you press Pay we hold your pieces for ${hold}. If the payment hasn’t gone through by then, the order is cancelled and the pieces are released for other shoppers.`,
        ),
        p(
          'If a payment still arrives after that, or a piece sold out before your payment was confirmed, the order is cancelled and the payment is refunded automatically. You don’t need to ask.',
        ),
      ],
    },
    {
      id: 'assistant',
      heading: 'Cancelling through the assistant',
      blocks: [
        p(
          'Ask the shopping assistant to cancel an order that hasn’t shipped. It shows you a confirmation card first, and nothing changes until you press Confirm.',
        ),
      ],
    },
  ],
};

const payments: PolicyDocument = {
  slug: 'payments',
  title: 'Payments',
  summary: `Pay securely through Razorpay by ${orList(razorpayMethods)}; we hold your pieces for ${hold} while you pay.`,
  lastUpdated: UPDATED,
  keyPoints: [
    `Payments are taken by Razorpay, by ${orList(razorpayMethods)}. In demo mode the same order flow runs and nothing is charged.`,
    'We never see or store your card number, UPI PIN or bank login.',
    `When you press Pay, your pieces are held for ${hold}.`,
    'The total on your receipt is checked again when you pay; if a price or offer changed meanwhile, we show you the new total before taking payment.',
  ],
  sections: [
    {
      id: 'methods',
      heading: 'How you can pay',
      blocks: [
        p(
          `You pay on Razorpay’s own payment screen, which opens over checkout. Razorpay offers ${orList(razorpayMethods)}, depending on what it supports for your bank and device. All prices are in Indian rupees.`,
        ),
        p(
          'Your order is marked paid only after we verify the cryptographic signature Razorpay sends with the payment. If your browser closes before that, Razorpay’s signed notification completes the order instead, and a payment is never counted twice.',
        ),
      ],
    },
    {
      id: 'demo-mode',
      heading: 'Demo mode',
      blocks: [
        p(
          'STOREFRONT is a demo store. When it runs without live Razorpay keys, checkout says so and the Pay button simulates a successful payment. It goes through the same confirmation, emails and refunds as a real one, and nothing is charged.',
        ),
      ],
    },
    {
      id: 'stock-hold',
      heading: 'Your pieces are held while you pay',
      blocks: [
        p(
          `Pressing Pay places the order and holds its pieces for ${hold}, so nobody else can buy them while you finish paying. If the payment doesn’t complete in that time, the order is cancelled and the pieces go back on sale.`,
        ),
        p('Pressing Pay twice, or retrying after a lost connection, never places a second order.'),
      ],
    },
    {
      id: 'price',
      heading: 'The price you pay',
      blocks: [
        p(
          'Your receipt is priced by the store’s pricing engine, which finds the cheapest combination of the offers you qualify for. When you pay, the server prices the same bag again. If anything changed, for example a price moved or an offer ended or ran out, checkout stops and shows you the new total so you can decide.',
        ),
        p(
          `Each order can carry up to ${ORDER_LIMITS.promoCodes} promo codes. A code that doesn’t lower your total is shown with the reason.`,
        ),
      ],
    },
    {
      id: 'data',
      heading: 'What we keep',
      blocks: [
        p(
          'Card numbers, UPI PINs and bank logins are entered on Razorpay’s screen and never reach STOREFRONT. We store only Razorpay’s reference numbers for the payment and any refunds, and their status.',
        ),
      ],
    },
  ],
};

const privacy: PolicyDocument = {
  slug: 'privacy',
  title: 'Privacy',
  summary: 'What STOREFRONT stores about you, why, and who else sees it.',
  lastUpdated: UPDATED,
  keyPoints: [
    'We keep your account, your orders with their delivery addresses, your saved bag, your reviews and your chats with the assistant.',
    'Payment details are handled by Razorpay and never stored by us.',
    'Chats with the assistant are sent to its AI provider to write replies, and staff can read them to check its answers.',
    'Cookies are used only to keep you signed in and to protect forms; there are no advertising or analytics trackers.',
  ],
  sections: [
    {
      id: 'account',
      heading: 'Your account',
      blocks: [
        p(
          'When you register we store your name, email address and password. The password is kept only as a one-way bcrypt hash, so nobody, including us, can read it back.',
        ),
        p(
          'Each time you sign in we record that session with your IP address and browser name, so a stolen sign-in can be detected and shut down. Session records are deleted when they expire. Failed sign-in attempts are counted by IP address and email for a short time, to slow down password guessing.',
        ),
      ],
    },
    {
      id: 'orders',
      heading: 'Orders and addresses',
      blocks: [
        p(
          'For each order we keep the pieces, the prices and offers applied, the delivery address and phone number you entered, every status change, Razorpay’s payment and refund references, and the reasons you gave for any return. We need these to deliver, refund and account for the order.',
        ),
        p(
          'Addresses are stored with the order they were entered for; there is no separate address book. Staff who handle orders can see them.',
        ),
      ],
    },
    {
      id: 'bag',
      heading: 'Your bag and emails',
      blocks: [
        p(
          'When you are signed in, your bag is saved to your account so it follows you between devices. If you leave pieces in it for a few hours, we may send one reminder email about it, and only one for each version of the bag.',
        ),
        p(
          'We also email you when an order is confirmed, ships, is delivered and when a refund completes. Emails go out through our email provider.',
        ),
      ],
    },
    {
      id: 'reviews',
      heading: 'Reviews',
      blocks: [
        p(
          'A review is public: anyone can read it with your name, rating and comment. Reviews from people who bought the piece are marked as verified purchases.',
        ),
      ],
    },
    {
      id: 'assistant',
      heading: 'Chats with the assistant',
      blocks: [
        p(
          'Aria, the shopping assistant, keeps a transcript of each conversation: your messages, its replies, the store lookups it made and what each reply cost to generate. When you are signed in, the transcript is linked to your name and email.',
        ),
        p(
          'To write each reply, your messages are sent to the AI provider the store is configured with (Anthropic’s Claude or Groq), along with your name and email if you are signed in, your bag and the page you are on. Long conversations are summarised so older turns don’t have to be sent again.',
        ),
        p(
          'Staff with access to the back office can read transcripts to check the assistant’s answers and running costs. Transcripts are not deleted automatically. Please don’t share card numbers or passwords in a chat.',
        ),
      ],
    },
    {
      id: 'experiments',
      heading: 'Experiments',
      blocks: [
        p(
          'Sometimes we test two versions of part of the site. Your browser keeps a random visitor ID, and we record which version that ID was shown and whether it went on to order, so we can tell which version works better. When you sign in, the ID is linked to your account so you keep seeing the same version.',
        ),
      ],
    },
    {
      id: 'cookies',
      heading: 'Cookies and browser storage',
      blocks: [
        p('STOREFRONT sets three cookies, all needed for the site to work:'),
        list(
          'A short-lived sign-in cookie that proves who you are on each request. Scripts on the page can’t read it.',
          'A refresh cookie that keeps you signed in between visits. It is sent only to the sign-in service and replaced every time it is used; if an old copy is ever used again, that sign-in is ended everywhere.',
          'A security token that stops other websites from submitting forms on your behalf.',
        ),
        p(
          'Your browser also stores your bag, the visitor ID used for experiments, the ID of your current assistant conversation and a note that you are signed in. There are no advertising or analytics cookies. Signing out clears the sign-in cookies, and clearing your browser’s site data removes the rest.',
        ),
      ],
    },
    {
      id: 'payments',
      heading: 'Payments',
      blocks: [
        p(
          'Payments are made on Razorpay’s screen. Your card number, UPI PIN and bank login go to Razorpay and never to us; we keep only its reference numbers and the payment status.',
        ),
      ],
    },
    {
      id: 'sharing',
      heading: 'Who else sees your data',
      blocks: [
        list(
          'Razorpay, to take payments and send refunds.',
          'The assistant’s AI provider, for the chats described above.',
          'Our email provider, to deliver order and bag emails.',
          'STOREFRONT staff, each limited to what their role needs. Every change staff make in the back office is written to an audit log.',
        ),
      ],
    },
    {
      id: 'choices',
      heading: 'Your choices',
      blocks: [
        p(
          'You can shop and chat with the assistant without an account; we then keep only the chat and the experiment visitor ID. This demo store has no self-service way to delete an account or chat history yet; ask through the assistant and staff will see the request in the transcript.',
        ),
      ],
    },
  ],
};

const terms: PolicyDocument = {
  slug: 'terms',
  title: 'Terms of use',
  summary: 'The rules for using STOREFRONT, a demo store: accounts, orders, prices and the assistant.',
  lastUpdated: UPDATED,
  keyPoints: [
    'STOREFRONT is a demo store; in demo mode no payment is taken.',
    'An order is placed when you press Pay and confirmed when payment is verified.',
    'The total on your receipt is the price you pay; it is checked again before payment.',
    'The assistant can make mistakes. The store’s pages, your receipt and your order page are the record.',
  ],
  sections: [
    {
      id: 'about',
      heading: 'About STOREFRONT',
      blocks: [
        p(
          'STOREFRONT is a demo store, built to show how a modern shop works from catalogue to refund. Its rules are the ones written on these pages, and each one is what the store’s software actually does.',
        ),
        p('When the store runs in demo mode, checkout says so, payments are simulated and nothing is charged.'),
      ],
    },
    {
      id: 'account',
      heading: 'Your account',
      blocks: [
        p(
          'You need an account to check out, write a review or ask the assistant to change your bag or orders. Keep your password to yourself; you are responsible for what happens under your account. Repeated failed sign-ins are slowed down for a while to protect it.',
        ),
      ],
    },
    {
      id: 'orders',
      heading: 'Orders',
      blocks: [
        p(
          'Pressing Pay places your order and holds its pieces while you pay. The order is confirmed once the payment is verified. If a piece sells out before that, or the payment arrives after the hold has ended, the order is cancelled and any payment is refunded automatically.',
        ),
        list(
          `Up to ${ORDER_LIMITS.perLine} of the same piece and size per order.`,
          `Up to ${ORDER_LIMITS.distinctPieces} different pieces per order.`,
          `Up to ${ORDER_LIMITS.promoCodes} promo codes per order.`,
        ),
        p(
          'Cancelling, returning and refunding follow the Cancellations and Returns and refunds policies. Delivery follows the Shipping and delivery policy.',
        ),
      ],
    },
    {
      id: 'prices',
      heading: 'Prices and offers',
      blocks: [
        p(
          'Prices are in Indian rupees. Offers apply on their own, and the pricing engine keeps the combination that gives you the lowest total. Offers have their own conditions and dates, and your receipt explains which ones applied and why.',
        ),
        p(
          'The price on your receipt is checked again on the server when you pay. If it changed, checkout shows you the new total before any payment is taken, and you decide whether to go ahead.',
        ),
      ],
    },
    {
      id: 'assistant',
      heading: 'The shopping assistant',
      blocks: [
        p(
          'Aria answers from the store’s own catalogue, prices, orders and these policies, but it is an AI and can be wrong. It can add to your bag, cancel an order or start a return only when you ask, and only after you press Confirm on the card it shows you.',
        ),
      ],
    },
    {
      id: 'reviews',
      heading: 'Reviews',
      blocks: [
        p(
          'Reviews are public and show your name. Write about the piece and your own experience of it. Reviews from people who bought the piece are marked as verified purchases.',
        ),
      ],
    },
    {
      id: 'use',
      heading: 'Using the site fairly',
      blocks: [
        p(
          'Don’t try to get into other people’s accounts or orders, overload the store or get around its limits. Requests to the store are rate-limited.',
        ),
      ],
    },
    {
      id: 'changes',
      heading: 'Changes to these terms',
      blocks: [p('When a rule changes, its page changes with it, and the date at the top of the page shows when.')],
    },
  ],
};

const APPAREL_SIZES = [
  ['XS', '84–88', '70–74'],
  ['S', '89–94', '75–80'],
  ['M', '95–100', '81–86'],
  ['L', '101–106', '87–92'],
  ['XL', '107–113', '93–99'],
  ['XXL', '114–120', '100–106'],
];

const FOOTWEAR_SIZES = [
  ['UK 6', '39.5', '7', '24.5'],
  ['UK 7', '41', '8', '25.4'],
  ['UK 8', '42', '9', '26.2'],
  ['UK 9', '43', '10', '27.1'],
  ['UK 10', '44.5', '11', '27.9'],
  ['UK 11', '46', '12', '28.8'],
];

/** Every size label the guide covers, for the assistant and tests. */
export const SIZE_RANGES = {
  apparel: APPAREL_SIZES.map(r => r[0]),
  footwear: FOOTWEAR_SIZES.map(r => r[0]),
} as const;

const sizeGuide: PolicyDocument = {
  slug: 'size-guide',
  title: 'Size guide',
  summary: `Apparel runs ${SIZE_RANGES.apparel[0]} to ${SIZE_RANGES.apparel.at(-1)} and footwear ${SIZE_RANGES.footwear[0]} to ${SIZE_RANGES.footwear.at(-1)}.`,
  lastUpdated: UPDATED,
  keyPoints: [
    `Apparel comes in ${SIZE_RANGES.apparel[0]} to ${SIZE_RANGES.apparel.at(-1)}, footwear in ${SIZE_RANGES.footwear[0]} to ${SIZE_RANGES.footwear.at(-1)}, and accessories in one size.`,
    'Not every piece comes in every size: each product page lists its sizes and how many are left in each.',
    `If something doesn’t fit, return it within ${days} of delivery and order the right size.`,
  ],
  sections: [
    {
      id: 'apparel',
      heading: 'Shirts, knitwear, outerwear and trousers',
      blocks: [
        p(
          'Measure your body, not a garment, and pick the size whose range you fall in. Between two sizes, take the larger for a relaxed fit.',
        ),
        { type: 'table', caption: 'Body measurements in centimetres', columns: ['Size', 'Chest', 'Waist'], rows: APPAREL_SIZES },
      ],
    },
    {
      id: 'footwear',
      heading: 'Footwear',
      blocks: [
        p(
          'Stand on a sheet of paper with your heel against a wall, mark the tip of your longest toe and measure from the wall. Choose the size whose foot length is closest without being shorter.',
        ),
        {
          type: 'table',
          caption: 'Footwear conversions and foot length in centimetres',
          columns: ['UK', 'EU', 'US', 'Foot length'],
          rows: FOOTWEAR_SIZES,
        },
      ],
    },
    {
      id: 'measuring',
      heading: 'How to measure',
      blocks: [
        list(
          'Chest: under your arms, around the fullest part, with the tape level.',
          'Waist: around your natural waistline, where you would wear a belt, without pulling the tape tight.',
          'Feet: measure in the evening, when feet are at their largest, and go by the longer foot.',
        ),
      ],
    },
    {
      id: 'stock',
      heading: 'Sizes in stock',
      blocks: [
        p(
          'Each product page shows the sizes that piece is made in. Sold-out sizes are struck through, and when a size is running low the page tells you how many are left.',
        ),
      ],
    },
  ],
};

const help: PolicyDocument = {
  slug: 'help',
  title: 'Help and contact',
  summary: 'Answers to common questions, and how to reach us about an order.',
  lastUpdated: UPDATED,
  keyPoints: [
    'Everything about an order, from tracking to cancelling and returns, is on its page under My orders.',
    'Aria, the shopping assistant in the corner of every page, can look up an order, and cancel or start a return once you confirm.',
    'STOREFRONT is a demo store and has no phone line or support inbox.',
  ],
  sections: [
    {
      id: 'where-is-my-order',
      heading: 'Where is my order?',
      blocks: [
        p(
          'Sign in and open My orders. Each order shows its status and when every step happened. Not signed in? Give the assistant your order number and the email on your account and it will look the order up.',
        ),
      ],
    },
    {
      id: 'cancel',
      heading: 'Can I still cancel?',
      blocks: [p(`Yes, until the order ships. ${POLICY_HIGHLIGHTS.cancelling.text} After that, return it once it arrives.`)],
    },
    {
      id: 'return',
      heading: 'How do I return something?',
      blocks: [
        p(
          `Open the delivered order and choose Return pieces. You have ${days} from delivery, each piece is refunded at what you paid for it, and delivery is refunded once everything on the order has been returned.`,
        ),
      ],
    },
    {
      id: 'offers',
      heading: 'How do offers and promo codes work?',
      blocks: [
        p(
          'Bundle deals, multi-buys and spend-more tiers apply on their own in your bag: the pricing engine compares every combination you qualify for and keeps the one with the lowest total, then explains it on your receipt. Promo codes go in at checkout. When an offer can’t be combined with another, the receipt says which one it kept and why.',
        ),
      ],
    },
    {
      id: 'delivery-cost',
      heading: 'What does delivery cost?',
      blocks: [p(`${shipping.keyPoints[0]} The threshold uses full prices, so offers never cost you free delivery.`)],
    },
    {
      id: 'payment-safe',
      heading: 'Is paying safe?',
      blocks: [
        p(
          'You pay on Razorpay’s own screen, and your card or bank details never reach STOREFRONT. We mark an order paid only after verifying Razorpay’s signature on the payment.',
        ),
      ],
    },
    {
      id: 'size',
      heading: 'Which size should I take?',
      blocks: [p(`${sizeGuide.keyPoints[0]} The size guide has the measurements for each.`)],
    },
    {
      id: 'contact',
      heading: 'How do I contact you?',
      blocks: [
        p(
          'STOREFRONT is a demo store, so there is no phone line or support inbox. For anything about an order, use its page under My orders, or ask Aria, the assistant in the corner of every page. Signed in, Aria can look up your orders, cancel one that hasn’t shipped or start a return, always after you confirm.',
        ),
      ],
    },
  ],
};

export const POLICIES: readonly PolicyDocument[] = [shipping, returns, cancellations, payments, sizeGuide, privacy, terms, help];

const BY_SLUG = new Map(POLICIES.map(d => [d.slug, d]));

export function getPolicy(slug: string): PolicyDocument | undefined {
  return BY_SLUG.get(slug as PolicySlug);
}

export const policyPath = (slug: PolicySlug, section?: string) => `/policies/${slug}${section ? `#${section}` : ''}`;

/** A policy's key points as plain sentences, the way the assistant receives it. */
export function policyDigest(slug: PolicySlug): string {
  return BY_SLUG.get(slug)!.keyPoints.join(' ');
}

/** A whole policy as plain text, section by section. */
export function policyText(slug: PolicySlug): string {
  const doc = BY_SLUG.get(slug)!;
  const blockText = (b: PolicyBlock) =>
    b.type === 'paragraph'
      ? b.text
      : b.type === 'list'
        ? b.items.map(i => `- ${i}`).join('\n')
        : [b.caption, b.columns.join(' | '), ...b.rows.map(r => r.join(' | '))].join('\n');
  return [doc.title, doc.summary, ...doc.sections.map(s => [s.heading, ...s.blocks.map(blockText)].join('\n'))].join('\n\n');
}
