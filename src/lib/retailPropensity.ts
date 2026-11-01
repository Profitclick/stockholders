/**
 * Company-level audience affinity (0–100) from open data: price, turnover, short interest, broker share.
 * These describe a company's shareholder base, never an individual investor.
 */
export type PropensityInput = {
  name: string;
  last_price: number | null;
  turnover: number | null;
  retail_pct: number | null;
  short_pct: number | null;
};

export const CRYPTO_RE = /(block|bitcoin|crypto|krypto|chain|coin|web3|token|nbx|digital asset)/i;
const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

/** log10 scale: 0.1 M → 0, 100 M → 100. */
export function liquidityScore(turnover: number | null): number {
  if (!turnover || turnover <= 1e5) return 0;
  return clamp(((Math.log10(turnover) - 5) / 3) * 100);
}

export function gearingScore(r: PropensityInput): number {
  const price = r.last_price;
  const priceScore = price == null ? 0 : price < 2 ? 100 : price < 10 ? 50 : price < 50 ? 15 : 0;
  const shortScore = clamp(((r.short_pct ?? 0) / 5) * 100);
  return clamp(0.45 * priceScore + 0.35 * liquidityScore(r.turnover) + 0.2 * shortScore);
}

export function brokerScore(r: PropensityInput): number {
  return clamp(0.75 * clamp(((r.retail_pct ?? 0) / 30) * 100) + 0.25 * liquidityScore(r.turnover));
}

export function cryptoScore(r: PropensityInput): number {
  if (!CRYPTO_RE.test(r.name)) return 0;
  return clamp(60 + 0.4 * gearingScore(r));
}
