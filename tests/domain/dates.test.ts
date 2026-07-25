import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  daysBetween,
  fiscalQuarter,
  monthsBetween,
  quarterBounds,
  termDays,
  termEndDate,
} from '@/domain/dates';

describe('date arithmetic', () => {
  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('clamps month arithmetic to the last valid day', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29'); // leap year
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2026-01-15', 12)).toBe('2027-01-15');
  });

  it('derives term end dates that produce whole-year terms', () => {
    expect(termEndDate('2026-01-01', 12)).toBe('2026-12-31');
    expect(termDays('2026-01-01', '2026-12-31')).toBe(365);
    expect(termEndDate('2026-07-15', 12)).toBe('2027-07-14');
    expect(termEndDate('2026-01-01', 36)).toBe('2028-12-31');
  });

  it('handles a leap-year term as 366 days', () => {
    expect(termDays('2024-01-01', '2024-12-31')).toBe(366);
  });

  it('counts days between dates', () => {
    expect(daysBetween('2026-01-01', '2026-01-31')).toBe(30);
    expect(daysBetween('2026-01-31', '2026-01-01')).toBe(-30);
    expect(daysBetween('2026-01-01', '2026-01-01')).toBe(0);
  });

  it('maps dates onto calendar fiscal quarters', () => {
    expect(fiscalQuarter('2026-01-15')).toBe('2026-Q1');
    expect(fiscalQuarter('2026-04-01')).toBe('2026-Q2');
    expect(fiscalQuarter('2026-12-31')).toBe('2026-Q4');
  });

  it('returns quarter bounds', () => {
    expect(quarterBounds('2026-Q1')).toEqual({ start: '2026-01-01', end: '2026-03-31' });
    expect(quarterBounds('2026-Q4')).toEqual({ start: '2026-10-01', end: '2026-12-31' });
  });

  it('lists the months a range spans', () => {
    expect(monthsBetween('2026-01-15', '2026-04-02')).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
    ]);
    expect(monthsBetween('2026-01-01', '2026-01-31')).toEqual(['2026-01']);
  });
});
