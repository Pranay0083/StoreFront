/** Standard normal CDF via the Abramowitz–Stegun 7.1.26 erf approximation (absolute error < 1.5e-7). */
export function normalCdf(x: number): number {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-z * z);
  return x >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

export interface ZTestResult {
  zScore: number | null;
  pValue: number | null;
}

/**
 * Two-sided two-proportion z-test with a pooled standard error, comparing treatment (b) against
 * control (a). Returns nulls when either arm is empty or the pooled rate is degenerate (0 or 1).
 */
export function twoProportionZTest(conversionsA: number, visitorsA: number, conversionsB: number, visitorsB: number): ZTestResult {
  if (visitorsA <= 0 || visitorsB <= 0) return { zScore: null, pValue: null };
  const pooled = (conversionsA + conversionsB) / (visitorsA + visitorsB);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / visitorsA + 1 / visitorsB));
  if (se === 0) return { zScore: null, pValue: null };
  const zScore = (conversionsB / visitorsB - conversionsA / visitorsA) / se;
  const pValue = Math.min(1, 2 * (1 - normalCdf(Math.abs(zScore))));
  return { zScore, pValue };
}
