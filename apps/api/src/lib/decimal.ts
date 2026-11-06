/**
 * Minimal fixed-point decimal implementation used for quantities and money.
 * Values are stored as an unscaled BigInt plus a scale (digits after the dot),
 * so arithmetic never goes through floating point.
 */

export type DecimalInput = string | number | bigint | Decimal;

type ParsedDecimal = {
  value: bigint;
  scale: number;
};

const DECIMAL_PATTERN = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

function parseDecimalString(input: string): ParsedDecimal {
  const normalized = input.trim().replace(/,/g, "");
  const match = DECIMAL_PATTERN.exec(normalized);

  if (!match) {
    throw new Error(`Invalid decimal value: ${input}`);
  }

  const [, sign = "", whole = "", fraction = "", exponentText] = match;

  if (whole === "" && fraction === "") {
    throw new Error(`Invalid decimal value: ${input}`);
  }

  const digits = `${whole}${fraction}`.replace(/^0+(?=\d)/, "");
  let value = BigInt(digits === "" ? "0" : digits);
  let scale = fraction.length;

  if (sign === "-") {
    value = -value;
  }

  if (exponentText) {
    const exponent = Number.parseInt(exponentText, 10);

    if (exponent >= 0) {
      value *= 10n ** BigInt(exponent);
    } else {
      scale += -exponent;
    }
  }

  return { value, scale };
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

function align(a: Decimal, b: Decimal): { left: bigint; right: bigint; scale: number } {
  const scale = Math.max(a.scale, b.scale);

  return {
    left: a.value * 10n ** BigInt(scale - a.scale),
    right: b.value * 10n ** BigInt(scale - b.scale),
    scale
  };
}

function formatScaled(value: bigint, scale: number): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;

  if (scale === 0) {
    return `${negative ? "-" : ""}${absolute.toString()}`;
  }

  const divisor = 10n ** BigInt(scale);
  const whole = absolute / divisor;
  const fraction = (absolute % divisor).toString().padStart(scale, "0");
  const trimmed = fraction.replace(/0+$/, "");

  return `${negative ? "-" : ""}${whole.toString()}${trimmed ? `.${trimmed}` : ""}`;
}

export class Decimal {
  readonly value: bigint;
  readonly scale: number;

  constructor(input: DecimalInput) {
    if (input instanceof Decimal) {
      this.value = input.value;
      this.scale = input.scale;
      return;
    }

    if (typeof input === "bigint") {
      this.value = input;
      this.scale = 0;
      return;
    }

    if (typeof input === "number") {
      if (!Number.isFinite(input)) {
        throw new Error(`Invalid decimal value: ${input}`);
      }

      const parsed = parseDecimalString(input.toString());
      this.value = parsed.value;
      this.scale = parsed.scale;
      return;
    }

    const parsed = parseDecimalString(input);
    this.value = parsed.value;
    this.scale = parsed.scale;
  }

  plus(other: DecimalInput): Decimal {
    const { left, right, scale } = align(this, decimal(other));
    return fromParts(left + right, scale);
  }

  add(other: DecimalInput): Decimal {
    return this.plus(other);
  }

  minus(other: DecimalInput): Decimal {
    const { left, right, scale } = align(this, decimal(other));
    return fromParts(left - right, scale);
  }

  sub(other: DecimalInput): Decimal {
    return this.minus(other);
  }

  mul(other: DecimalInput): Decimal {
    const right = decimal(other);
    return fromParts(this.value * right.value, this.scale + right.scale);
  }

  times(other: DecimalInput): Decimal {
    return this.mul(other);
  }

  div(other: DecimalInput, precision = 12): Decimal {
    const right = decimal(other);

    if (right.value === 0n) {
      throw new Error("Cannot divide by zero");
    }

    const resultScale = Math.max(0, this.scale - right.scale) + precision;
    const exponent = right.scale + resultScale - this.scale;
    const numerator =
      exponent >= 0
        ? this.value * 10n ** BigInt(exponent)
        : this.value / 10n ** BigInt(-exponent);

    return fromParts(divideAndRoundHalfUp(numerator, right.value), resultScale);
  }

  gt(other: DecimalInput): boolean {
    const { left, right } = align(this, decimal(other));
    return left > right;
  }

  gte(other: DecimalInput): boolean {
    const { left, right } = align(this, decimal(other));
    return left >= right;
  }

  lt(other: DecimalInput): boolean {
    const { left, right } = align(this, decimal(other));
    return left < right;
  }

  lte(other: DecimalInput): boolean {
    const { left, right } = align(this, decimal(other));
    return left <= right;
  }

  eq(other: DecimalInput): boolean {
    const { left, right } = align(this, decimal(other));
    return left === right;
  }

  isZero(): boolean {
    return this.value === 0n;
  }

  toDecimalPlaces(places: number): Decimal {
    if (places < 0) {
      throw new Error("Decimal places cannot be negative");
    }

    if (this.scale === places) {
      return this;
    }

    if (this.scale < places) {
      return fromParts(this.value * 10n ** BigInt(places - this.scale), places);
    }

    const divisor = 10n ** BigInt(this.scale - places);
    return fromParts(divideAndRoundHalfUp(this.value, divisor), places);
  }

  toFixed(digits?: number): string {
    if (digits === undefined) {
      return formatScaled(this.value, this.scale);
    }

    const rounded = this.toDecimalPlaces(digits);
    const negative = rounded.value < 0n;
    const absolute = negative ? -rounded.value : rounded.value;

    if (digits === 0) {
      return `${negative ? "-" : ""}${absolute.toString()}`;
    }

    const divisor = 10n ** BigInt(digits);
    const whole = absolute / divisor;
    const fraction = (absolute % divisor).toString().padStart(digits, "0");

    return `${negative ? "-" : ""}${whole.toString()}.${fraction}`;
  }

  toString(): string {
    return this.toFixed();
  }

  toNumber(): number {
    return Number(this.toFixed(12));
  }
}

function fromParts(value: bigint, scale: number): Decimal {
  const decimal = Object.create(Decimal.prototype) as Decimal;
  Object.defineProperty(decimal, "value", { value, enumerable: true });
  Object.defineProperty(decimal, "scale", { value: scale, enumerable: true });
  return decimal;
}

export function decimal(value: DecimalInput): Decimal {
  return value instanceof Decimal ? value : new Decimal(value);
}

export function toBigInt(value: unknown): bigint {
  if (value === null || value === undefined) {
    return 0n;
  }

  if (typeof value === "bigint") {
    return value;
  }

  if (value instanceof Decimal) {
    return BigInt(value.toDecimalPlaces(0).toFixed(0));
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return 0n;
    }
    return BigInt(Math.trunc(value));
  }

  if (typeof value === "string") {
    const normalized = value.trim();

    if (normalized === "") {
      return 0n;
    }

    if (/^-?\d+$/.test(normalized)) {
      return BigInt(normalized);
    }

    return BigInt(decimal(normalized).toDecimalPlaces(0).toFixed(0));
  }

  return BigInt(String(value));
}

export function roundTo(value: DecimalInput, places = 0): bigint {
  return BigInt(decimal(value).toDecimalPlaces(places).toFixed(0));
}

export function decimalToJson(value: DecimalInput): string {
  return decimal(value).toFixed();
}

export function bigintToJson(value: bigint | number | string): string {
  return value.toString();
}
