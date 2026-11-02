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
    throw new Error("The restaurant timezone could not be resolved");
  }

  return `${year}-${month}-${day}`;
}

export function businessDateFrom(occurredAt: Date, timeZone: string): Date {
  return dateOnlyToDate(todayInTimeZone(timeZone, occurredAt));
}

export function dateOnlyToDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Date must use YYYY-MM-DD");
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    throw new Error("The date is invalid");
  }

  return date;
}

export function dateToDateOnly(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toISOString().slice(0, 10);
}

export function addDays(date: Date | string, days: number): Date {
  const d = typeof date === "string" ? new Date(date) : date;
  const next = new Date(d.getTime());
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
    throw new Error("startDate must be on or before endDate");
  }

  return { start, endExclusive: addDays(end, 1) };
}