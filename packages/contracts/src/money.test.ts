import { describe, expect, it } from 'vitest';
import { FREE_SHIPPING_THRESHOLD, SHIPPING_FEE, formatINR, paiseToRupees, percentOf, rupeesToPaise, shippingFor } from './money';

describe('money helpers', () => {
  it('converts between rupees and integer paise without float drift', () => {
    expect(rupeesToPaise(2499)).toBe(249_900);
    expect(rupeesToPaise(19.99)).toBe(1_999);
    expect(rupeesToPaise(0.1 + 0.2)).toBe(30);
    expect(paiseToRupees(249_950)).toBe(2499.5);
  });

  it('formats paise as Indian rupees', () => {
    expect(formatINR(249_900)).toBe('₹2,499');
    expect(formatINR(1_299_900)).toBe('₹12,999');
    expect(formatINR(10_000_000_00)).toBe('₹1,00,00,000');
    expect(formatINR(249_950)).toBe('₹2,499.50');
    expect(formatINR(undefined)).toBe('₹0');
    expect(formatINR(1)).toBe('₹0.01');
    expect(formatINR(12_345_678)).toBe('₹1,23,456.78');
  });

  it('formats alternately whole and fractional amounts with the right precision', () => {
    expect([100, 150, 200, 205].map(formatINR)).toEqual(['₹1', '₹1.50', '₹2', '₹2.05']);
  });

  it('floors percentage discounts to whole paise', () => {
    expect(percentOf(99_999, 10)).toBe(9_999);
  });

  it('charges shipping below the free-shipping threshold only', () => {
    expect(shippingFor(0)).toBe(0);
    expect(shippingFor(FREE_SHIPPING_THRESHOLD - 1)).toBe(SHIPPING_FEE);
    expect(shippingFor(FREE_SHIPPING_THRESHOLD)).toBe(0);
  });
});
