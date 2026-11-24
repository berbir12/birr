import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseAmount } from './amount.js';
import { parseSmsDate } from './date.js';
import { maskId, scrubNumbers } from './mask.js';
import { splitMessages } from './split.js';

describe('parseAmount', () => {
  it.each([
    ['ETB 1,234.56', 123456],
    ['1,234.56', 123456],
    ['173,697.00', 17369700],
    ['0.87', 87],
    ['0.5', 50],
    ['1234', 123400],
    ['1,500', 150000],
    ['Birr 250', 25000],
    ['250 Birr', 25000],
    ['Br 99.9', 9990],
    ['Br.1,000.00', 100000],
    ['ETB1,000.00', 100000],
    ['etb 12.30', 1230],
  ])('%s -> %d cents', (input, cents) => {
    expect(parseAmount(input)).toBe(cents);
  });

  it.each(['', 'abc', 'ETB', '1.234.5'])('rejects %j', (input) => {
    expect(parseAmount(input)).toBeNull();
  });

  it('does not suffer float drift', () => {
    expect(parseAmount('0.29')).toBe(29);
    expect(parseAmount('1,005.15')).toBe(100515);
  });
});

describe('parseSmsDate (Africa/Addis_Ababa, UTC+3, no DST)', () => {
  it.each([
    ['24/11/2026 20:31:20', '2026-11-24T20:31:20+03:00'],
    ['4/1/2026 9:05', '2026-01-04T09:05:00+03:00'],
    ['24-11-2026 20:31', '2026-11-24T20:31:00+03:00'],
    ['24-Nov-2026 08:15:00', '2026-11-24T08:15:00+03:00'],
    ['24-nov-2026 8:15 PM', '2026-11-24T20:15:00+03:00'],
    ['24 Nov 2026 12:00 AM', '2026-11-24T00:00:00+03:00'],
    ['24/11/2026 12:30:00 PM', '2026-11-24T12:30:00+03:00'],
    ['24/11/2026', '2026-11-24T00:00:00+03:00'],
  ])('%s', (input, iso) => {
    expect(parseSmsDate(input)).toBe(iso);
  });

  it.each(['31/02/2026 10:00', '24/13/2026', '24/11/2026 25:00', 'yesterday'])('rejects %s', (input) => {
    expect(parseSmsDate(input)).toBeNull();
  });
});

describe('maskId', () => {
  it.each([
    ['251900001111', '****1111'],
    ['2519****2201', '****2201'],
    ['1********4321', '****4321'],
    ['013200000005678', '****5678'],
    ['123', '****123'],
  ])('%s -> %s', (input, out) => expect(maskId(input)).toBe(out));
});

describe('scrubNumbers', () => {
  it('masks long digit runs but leaves amounts and dates alone', () => {
    expect(scrubNumbers('account 251900001111 paid ETB 1,234.56 on 24/11/2026')).toBe(
      'account ****1111 paid ETB 1,234.56 on 24/11/2026',
    );
  });
});

const ROOT = join(import.meta.dirname, '../fixtures/sms');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('splitMessages', () => {
  it('splits a multi-message telebirr paste separated by blank lines', () => {
    const paste = [
      read('telebirr/t07_transfer_out.txt'),
      read('telebirr/t06_transfer_out.txt'),
      read('telebirr/t10_wallet_to_bank.txt'),
    ].join('\n\n\n');
    const parts = splitMessages(paste);
    expect(parts).toHaveLength(3);
    expect(parts[0]).toContain('DKO8AB7C07');
    expect(parts[2]).toContain('Ethio telecom');
  });

  it('splits CBE messages even when glued on one line', () => {
    const paste = read('cbe/c01_transfer_in.txt') + ' ' + read('cbe/c02_transfer_out.txt');
    expect(splitMessages(paste)).toHaveLength(2);
  });

  it('keeps a single message intact', () => {
    const one = read('telebirr/t11_transfer_out.txt');
    expect(splitMessages(one)).toEqual([one]);
  });

  it('ignores empty input', () => {
    expect(splitMessages('  \n ')).toEqual([]);
  });
});
