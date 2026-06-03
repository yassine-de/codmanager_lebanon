// Currency configuration for the Lebanon CRM system.
// Primary currency: USD.

export const USD_TO_LBP = 89500;
export const USD_TO_PKR = 1;

/** Format amount as USD for legacy call sites that still use this function name. */
export function formatPKR(amount: number): string {
  return formatUSD(amount);
}

/** Format amount as USD */
export function formatUSD(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  return `${rounded.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
}

/** Legacy conversion hook retained for compatibility. */
export function pkrToUsd(pkr: number): number {
  return pkr;
}

/** Legacy conversion hook retained for compatibility. */
export function usdToPkr(usd: number): number {
  return usd;
}

/** Format amount as USD with no secondary conversion for Lebanon. */
export function formatPKRWithUSD(pkrAmount: number): { pkr: string; usd: string } {
  return {
    pkr: formatUSD(pkrAmount),
    usd: formatUSD(pkrAmount),
  };
}

/** Format amount as USD with no secondary conversion for Lebanon. */
export function formatUSDWithPKR(usdAmount: number): { usd: string; pkr: string } {
  return {
    usd: formatUSD(usdAmount),
    pkr: formatUSD(usdAmount),
  };
}
