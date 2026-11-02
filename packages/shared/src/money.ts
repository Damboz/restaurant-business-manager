/**
 * Money is stored and transported as integer minor units (tambala for MWK).
 * Never use floating-point arithmetic for financial values.
 */

const CURRENCY_EXPONENTS: Record<string, number> = {
  MWK: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  ZAR: 2
};

const DEFAULT_CURRENCY = "MWK";

export function currencyExponent(currency: string = DEFAULT_CURRENCY): number {
  return CURRENCY_EXPONENTS[currency.toUpperCase()] ?? 2;
}

type ScaledDecimal = {
  value: bigint;
  scale: number;
};

function parseDecimal(input: string): ScaledDecimal {
  const normalized = input.trim().replace(/,/g, "");

  if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
    throw new Error(`Invalid decimal value: ${input}`);
  }

  const negative = normalized.startsWith("-");
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [wholePart = "0", fractionPart = ""] = unsigned.split(".");
  const digits = `${wholePart}${fractionPart}`.replace(/^0+(?=\d)/, "");
  const value = BigInt(digits === "" ? "0" : digits);

  return {
    value: negative ? -value : value,
    scale: fractionPart.length
  };
}

function divideAndRoundHalfUp(value: bigint, divisor: bigint): bigint {
  if (divisor === 0n) {
    throw new Error("Cannot divide by zero");
  }

  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const quotient = absolute / divisor;
  const remainder = absolute % divisor;
  const rounded = remainder * 2n >= divisor ? quotient + 1n : quotient;

  return negative ? -rounded : rounded;
}

/** Parses a human-entered amount such as "25,000.50" into minor units. */
export function parseMoneyToMinor(value: string, currency: string = DEFAULT_CURRENCY): bigint {
  const exponent = currencyExponent(currency);
  const decimal = parseDecimal(value);

  if (decimal.scale <= exponent) {
    return decimal.value * 10n ** BigInt(exponent - decimal.scale);
  }

  const divisor = 10n ** BigInt(decimal.scale - exponent);

  return divideAndRoundHalfUp(decimal.value, divisor);
}

/** Formats minor units for display, for example `MWK 25,000.50`. */
export function formatMoney(
  minor: bigint,
  currency: string = DEFAULT_CURRENCY
): string {
  const exponent = currencyExponent(currency);
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  const divisor = 10n ** BigInt(exponent);
  const whole = absolute / divisor;
  const fraction = absolute % divisor;
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fractionText =
    exponent > 0 ? `.${fraction.toString().padStart(exponent, "0")}` : "";

  return `${negative ? "-" : ""}${currency.toUpperCase()} ${grouped}${fractionText}`;
}

/** Serializes minor units for JSON transport without precision loss. */
export function moneyToJson(minor: bigint): string {
  return minor.toString();
}

/** Line total = round(quantity × unit price), rounded half away from zero. */
export function lineTotalMinor(quantity: string, unitPriceMinor: bigint): bigint {
  const decimal = parseDecimal(quantity);
  const divisor = 10n ** BigInt(decimal.scale);

  return divideAndRoundHalfUp(decimal.value * unitPriceMinor, divisor);
}

/** Converts a decimal quantity string into a fixed-precision number for display. */
export function formatQuantity(quantity: string, fractionDigits = 4): string {
  const decimal = parseDecimal(quantity);
  const divisor = 10n ** BigInt(decimal.scale);
  const negative = decimal.value < 0n;
  const absolute = negative ? -decimal.value : decimal.value;
  const whole = absolute / divisor;
  const fraction = absolute % divisor;
  const fractionText = fraction
    .toString()
    .padStart(decimal.scale, "0")
    .slice(0, fractionDigits)
    .padEnd(fractionDigits, "0");

  return `${negative ? "-" : ""}${whole}${fractionDigits > 0 ? `.${fractionText}` : ""}`;
}
