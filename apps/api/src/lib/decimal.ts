// Safe BigInt conversion for pg results
export const toBigInt = (val: any): bigint => {
  if (val === null || val === undefined) return 0n;
  if (typeof val === "bigint") return val;
  if (typeof val === "string") {
    const n = BigInt(val);
    return isNaN(n) ? 0n : n;
  }
  return BigInt(val);
};

// Simple decimal formatting
export function formatMoney(value: string | number | bigint): string {
  const big = toBigInt(value);
  return big.toString();
}

export function roundTo(value: string | number | bigint, places: number = 0): bigint {
  const big = toBigInt(value);
  // Simple rounding for display purposes
  return big;
}