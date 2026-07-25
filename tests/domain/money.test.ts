import { describe, expect, it } from 'vitest';
import {
  allocate,
  applyBps,
  applyDiscount,
  discountBpsFrom,
  formatBps,
  formatMoney,
  normaliseBps,
  ratioBps,
  roundHalfUp,
} from '@/domain/money';

describe('money primitives', () => {
  it('rounds half up symmetrically around zero', () => {
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(-2.5)).toBe(-3);
    expect(roundHalfUp(2.4)).toBe(2);
    expect(roundHalfUp(0)).toBe(0);
  });

  it('applies basis-point rates', () => {
    expect(applyBps(100_00, 1000)).toBe(1000); // 10% of $100 is $10
    expect(applyBps(1_234_56, 750)).toBe(9259); // 7.5%
    expect(applyBps(0, 5000)).toBe(0);
  });

  it('applies and inverts discounts consistently', () => {
    const list = 120_000;
    const net = applyDiscount(list, 1500);
    expect(net).toBe(102_000);
    expect(discountBpsFrom(list, net)).toBe(1500);
  });

  it('treats a zero list price as zero discount rather than dividing by zero', () => {
    expect(discountBpsFrom(0, 0)).toBe(0);
    expect(ratioBps(5, 0)).toBe(0);
  });

  describe('allocate', () => {
    it('never loses or invents cents', () => {
      const parts = allocate(10_000, [1, 1, 1]);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(10_000);
      expect(parts).toEqual([3334, 3333, 3333]);
    });

    it('distributes proportionally to weights', () => {
      const parts = allocate(1000, [50, 30, 20]);
      expect(parts).toEqual([500, 300, 200]);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(1000);
    });

    it('handles a single weight and zero weights', () => {
      expect(allocate(777, [1])).toEqual([777]);
      expect(allocate(777, [0, 0])).toEqual([0, 0]);
    });

    it('survives amounts smaller than the number of buckets', () => {
      const parts = allocate(2, [1, 1, 1, 1]);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(2);
    });

    it('normalises basis points to exactly 10000', () => {
      expect(normaliseBps([1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(10_000);
      expect(normaliseBps([7, 3]).reduce((a, b) => a + b, 0)).toBe(10_000);
    });
  });

  it('formats money and rates for display', () => {
    // Amounts are cents: 12_500_000 cents is $125,000.
    expect(formatMoney(12_500_000)).toBe('$125,000');
    expect(formatMoney(12_500_000, 'USD', { compact: true })).toBe('$125K');
    expect(formatMoney(499, 'USD', { decimals: true })).toBe('$4.99');
    expect(formatBps(1250)).toBe('12.5%');
  });
});
