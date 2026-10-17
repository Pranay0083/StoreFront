import { describe, expect, it } from 'vitest';
import { bucket, inRollout, matchesAudience, pickVariant } from './bucketing';
import { normalCdf, twoProportionZTest } from './stats';

const subjects = Array.from({ length: 20_000 }, (_, i) => `subject-${i}`);
const v = (key: string, weight: number) => ({ key, weight, description: '' });

describe('bucketing', () => {
  it('is deterministic per salt and subject', () => {
    expect(bucket('flag:a', 'u1')).toBe(bucket('flag:a', 'u1'));
    expect(bucket('flag:a', 'u1')).not.toBe(bucket('flag:b', 'u1'));
    expect(pickVariant('exp', 'u1', [v('a', 50), v('b', 50)])).toBe(pickVariant('exp', 'u1', [v('a', 50), v('b', 50)]));
  });

  it('spreads buckets uniformly across [0, 1)', () => {
    const deciles = new Array(10).fill(0);
    for (const s of subjects) deciles[Math.floor(bucket('flag:uniform', s) * 10)]++;
    for (const count of deciles) expect(Math.abs(count / subjects.length - 0.1)).toBeLessThan(0.01);
  });

  it('honours rollout percentages within a percentage point', () => {
    for (const percent of [0, 5, 25, 50, 100]) {
      const share = subjects.filter(s => inRollout('checkout-v2', s, percent)).length / subjects.length;
      expect(Math.abs(share * 100 - percent)).toBeLessThan(1);
    }
  });

  it('keeps users in when a rollout grows', () => {
    const at10 = subjects.filter(s => inRollout('grow', s, 10));
    expect(at10.every(s => inRollout('grow', s, 30))).toBe(true);
  });

  it('splits experiment traffic according to weights', () => {
    const treated = subjects.filter(s => pickVariant('weights', s, [v('control', 70), v('treatment', 30)]) === 'treatment').length;
    expect(Math.abs(treated / subjects.length - 0.3)).toBeLessThan(0.015);
  });

  it('targets audiences by role and segment', () => {
    expect(matchesAudience({}, {})).toBe(true);
    expect(matchesAudience({ segments: ['guest'] }, {})).toBe(true);
    expect(matchesAudience({ segments: ['guest'] }, { role: 'customer' })).toBe(false);
    expect(matchesAudience({ segments: ['staff'] }, { role: 'support' })).toBe(true);
    expect(matchesAudience({ roles: ['admin'] }, { role: 'customer' })).toBe(false);
    expect(matchesAudience({ roles: ['admin'] }, {})).toBe(false);
  });
});

describe('two-proportion z-test', () => {
  it('matches normal CDF reference points', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 5);
    expect(normalCdf(-1.644854)).toBeCloseTo(0.05, 5);
  });

  it('computes z and a two-sided p-value for a known example', () => {
    const { zScore, pValue } = twoProportionZTest(200, 1000, 250, 1000);
    expect(zScore).toBeCloseTo(2.6774, 3);
    expect(pValue).toBeCloseTo(0.00742, 4);
  });

  it('is antisymmetric and gives p=1 for identical arms', () => {
    const same = twoProportionZTest(50, 500, 50, 500);
    expect(same.zScore).toBe(0);
    expect(same.pValue).toBeCloseTo(1, 6);
    expect(twoProportionZTest(250, 1000, 200, 1000).zScore).toBeCloseTo(-2.6774, 3);
  });

  it('returns nulls for empty or degenerate arms', () => {
    expect(twoProportionZTest(0, 0, 3, 10)).toEqual({ zScore: null, pValue: null });
    expect(twoProportionZTest(0, 100, 0, 100)).toEqual({ zScore: null, pValue: null });
  });
});
