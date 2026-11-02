import { Prisma } from "@prisma/client";

export type DecimalInput = string | number | bigint | Prisma.Decimal;

export function decimal(value: DecimalInput): Prisma.Decimal {
  return new Prisma.Decimal(value.toString());
}

export function roundTo(value: Prisma.Decimal, places = 0): bigint {
  return BigInt(value.toDecimalPlaces(places, Prisma.Decimal.ROUND_HALF_UP).toFixed(0));
}

export function decimalToJson(value: Prisma.Decimal): string {
  return value.toFixed();
}

export function bigintToJson(value: bigint): string {
  return value.toString();
}
