import { BadRequestError } from "./errors.js";

export function todayInTimeZone(timeZone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new BadRequestError("The restaurant timezone could not be resolved");
  }

  return `${year}-${month}-${day}`;
}

export function businessDateFrom(occurredAt: Date, timeZone: string): Date {
  return dateOnlyToDate(todayInTimeZone(timeZone, occurredAt));
}

export function dateOnlyToDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestError("Date must use YYYY-MM-DD", { field: "date" });
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    throw new BadRequestError("The date is invalid", { field: "date" });
  }

  return date;
}

export function dateToDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function rangeDates(startDate: string, endDate: string): {
  start: Date;
  endExclusive: Date;
} {
  const start = dateOnlyToDate(startDate);
  const end = dateOnlyToDate(endDate);

  if (start > end) {
    throw new BadRequestError("startDate must be on or before endDate");
  }

  return { start, endExclusive: addDays(end, 1) };
}
