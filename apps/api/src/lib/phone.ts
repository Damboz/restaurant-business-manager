import { parsePhoneNumberFromString } from "libphonenumber-js";
import { BadRequestError } from "./errors.js";

export function normalizePhone(input: string): string {
  const trimmed = input.trim();
  const parsed = parsePhoneNumberFromString(trimmed, "MW");

  if (!parsed || !parsed.isValid()) {
    throw new BadRequestError("Enter a valid phone number", { field: "phone" });
  }

  return parsed.number;
}

export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}
