import { describe, expect, it } from 'vitest';
import { offerBadges, offerKindOf, type Offer } from './offers';
import { defaultShowOnStorefront, PromotionInputSchema } from './pricing';

const piece = (productId: string) => ({
  productId,
  slug: productId,
  title: productId,
  category: 'Men',
  price: 100_000,
  size: 'M',
  stock: 3,
});

function offer(overrides: Partial<Offer>): Offer {
  return {
    id: 'o1',
    version: 1,
    name: 'Offer',
    description: '',
    kind: 'set',
    actionType: 'fixedBundle',
    summary: '',
    headline: '',
    terms: [],
    pieces: [],
    ...overrides,
  };
}

describe('offer contracts', () => {
  it('advertises automatic offers by default and keeps codes private', () => {
    expect(defaultShowOnStorefront('auto')).toBe(true);
    expect(defaultShowOnStorefront(undefined)).toBe(true);
    expect(defaultShowOnStorefront('code')).toBe(false);
    const parsed = PromotionInputSchema.parse({
      name: 'Welcome',
      activation: 'code',
      code: 'WELCOME10',
      showOnStorefront: true,
      action: { type: 'percentOff', percent: 10 },
    });
    expect(parsed.showOnStorefront).toBe(true);
  });

  it('groups offers by what the shopper does to get them', () => {
    expect(offerKindOf({ activation: 'auto', action: { type: 'fixedBundle' } })).toBe('set');
    expect(offerKindOf({ activation: 'auto', action: { type: 'buyXGetY' } })).toBe('multiBuy');
    expect(offerKindOf({ activation: 'auto', action: { type: 'tiered' } })).toBe('spendMore');
    expect(offerKindOf({ activation: 'auto', action: { type: 'flatOff' }, hasMinSpend: true })).toBe('spendMore');
    expect(offerKindOf({ activation: 'auto', action: { type: 'percentOff' } })).toBe('sale');
    expect(offerKindOf({ activation: 'auto', action: { type: 'freeShipping' } })).toBe('delivery');
    expect(offerKindOf({ activation: 'code', action: { type: 'fixedBundle' } })).toBe('code');
  });

  it('gives each piece one badge, preferring the set that names it', () => {
    const set = offer({
      id: 'set',
      name: 'Weekend Uniform',
      example: {
        lines: [
          { ...piece('shirt'), qty: 1 },
          { ...piece('jeans'), qty: 1 },
        ],
        listTotal: 709_800,
        total: 599_900,
        saving: 109_900,
        offerSaving: 109_900,
        shipping: 0,
        alsoApplied: [],
      },
    });
    const multi = offer({
      id: 'multi',
      name: 'Any 3 shirts',
      kind: 'multiBuy',
      actionType: 'mixAndMatch',
      pieces: [piece('shirt'), piece('tee')],
    });
    const badges = offerBadges([multi, set]);
    expect(badges.shirt).toMatchObject({ offerId: 'set', saving: 109_900 });
    expect(badges.jeans).toMatchObject({ offerId: 'set' });
    expect(badges.tee).toMatchObject({ offerId: 'multi', kind: 'multiBuy' });
    expect(badges.tee.saving).toBeUndefined();
  });
});
