/**
 * Date arithmetic for subscription terms.
 *
 * Every business date in the system is an ISO `YYYY-MM-DD` string. Terms,
 * proration and renewals are calculated on whole calendar days in UTC so the
 * same inputs always produce the same money, regardless of server timezone.
 */

export type IsoDate = string;

const MS_PER_DAY = 86_400_000;

export function toIso(d: Date): IsoDate {
  return d.toISOString().slice(0, 10);
}

export function parseIso(d: IsoDate): Date {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

export function today(now: Date = new Date()): IsoDate {
  return toIso(now);
}

export function addDays(d: IsoDate, days: number): IsoDate {
  return toIso(new Date(parseIso(d).getTime() + days * MS_PER_DAY));
}

/** Calendar-month arithmetic, clamping to the last valid day of the target month. */
export function addMonths(d: IsoDate, months: number): IsoDate {
  const dt = parseIso(d);
  const day = dt.getUTCDate();
  const target = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return toIso(target);
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((parseIso(to).getTime() - parseIso(from).getTime()) / MS_PER_DAY);
}

/**
 * A term runs from `start` up to but not including the day after `end`, so a
 * 12-month term starting 2026-01-01 ends 2026-12-31 and covers 365 days.
 */
export function termEndDate(start: IsoDate, months: number): IsoDate {
  return addDays(addMonths(start, months), -1);
}

export function termDays(start: IsoDate, end: IsoDate): number {
  return daysBetween(start, end) + 1;
}

export function isBefore(a: IsoDate, b: IsoDate): boolean {
  return a < b;
}

export function isAfter(a: IsoDate, b: IsoDate): boolean {
  return a > b;
}

export function minDate(a: IsoDate, b: IsoDate): IsoDate {
  return a <= b ? a : b;
}

export function maxDate(a: IsoDate, b: IsoDate): IsoDate {
  return a >= b ? a : b;
}

export function clampDate(d: IsoDate, lo: IsoDate, hi: IsoDate): IsoDate {
  return minDate(maxDate(d, lo), hi);
}

/* ------------------------------------------------------------ fiscal periods */

/** Calendar fiscal year: FY2026 Q1 is January–March 2026. */
export function fiscalPeriod(d: IsoDate): string {
  return d.slice(0, 7);
}

export function fiscalQuarter(d: IsoDate): string {
  const dt = parseIso(d);
  const q = Math.floor(dt.getUTCMonth() / 3) + 1;
  return `${dt.getUTCFullYear()}-Q${q}`;
}

export function fiscalYear(d: IsoDate): string {
  return d.slice(0, 4);
}

export function quarterBounds(quarter: string): { start: IsoDate; end: IsoDate } {
  const [yearStr, qStr] = quarter.split('-Q');
  const year = Number(yearStr);
  const q = Number(qStr);
  const startMonth = (q - 1) * 3;
  const start = toIso(new Date(Date.UTC(year, startMonth, 1)));
  const end = toIso(new Date(Date.UTC(year, startMonth + 3, 0)));
  return { start, end };
}

export function monthBounds(period: string): { start: IsoDate; end: IsoDate } {
  const [y, m] = period.split('-').map(Number);
  return {
    start: toIso(new Date(Date.UTC(y, m - 1, 1))),
    end: toIso(new Date(Date.UTC(y, m, 0))),
  };
}

/** Inclusive list of `YYYY-MM` periods spanned by a date range. */
export function monthsBetween(from: IsoDate, to: IsoDate): string[] {
  const out: string[] = [];
  let cursor = `${from.slice(0, 7)}-01`;
  while (cursor.slice(0, 7) <= to.slice(0, 7)) {
    out.push(cursor.slice(0, 7));
    cursor = addMonths(cursor, 1);
  }
  return out;
}

export function overlaps(
  aStart: IsoDate,
  aEnd: IsoDate,
  bStart: IsoDate,
  bEnd: IsoDate,
): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}
