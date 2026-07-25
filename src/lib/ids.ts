import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/**
 * Deterministic-friendly id generator.
 *
 * Ids are prefixed and human legible (`acc_01hq3k...`) which matters for a CRM:
 * they end up in URLs, exports, integration payloads and support tickets, and
 * they double as the stable external id other systems key against.
 */
export function newId(prefix: string): string {
  const time = Date.now().toString(36).padStart(9, '0');
  const bytes = randomBytes(8);
  let rand = '';
  for (const b of bytes) rand += ALPHABET[b % 36];
  return `${prefix}_${time}${rand}`;
}

/** Seeded, reproducible id generator used by the seeder and the test suite. */
export function makeSequentialIdFactory(seed = 0) {
  let counter = seed;
  return (prefix: string) => `${prefix}_${(counter++).toString(36).padStart(10, '0')}`;
}

/** Short, human-quotable document number, e.g. Q-0042 or SUB-0107. */
export function docNumber(prefix: string, n: number, width = 4): string {
  return `${prefix}-${String(n).padStart(width, '0')}`;
}
