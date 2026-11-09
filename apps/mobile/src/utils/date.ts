export function dateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

export function todayDateOnly(): string {
  return dateOnly(new Date());
}

export function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + days);
  return dateOnly(date);
}

export function startOfWeek(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  const offset = (date.getDay() + 6) % 7;
  return addDays(value, -offset);
}

export function startOfMonth(value: string): string {
  return `${value.slice(0, 8)}01`;
}

export function startOfYear(value: string): string {
  return `${value.slice(0, 4)}-01-01`;
}

export function isDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const date = new Date(`${value}T00:00:00`);
  return !Number.isNaN(date.getTime()) && dateOnly(date) === value;
}

export function occurredAtForDate(value: string): string {
  if (value === todayDateOnly()) {
    return new Date().toISOString();
  }

  return new Date(`${value}T12:00:00`).toISOString();
}

export function formatDate(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString();
}

export function formatDateTime(value: string): string {
  return new Date(value).toLocaleString();
}
