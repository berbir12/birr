import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSms } from './index.js';

const ROOT = join(import.meta.dirname, '../fixtures/sms');
const SENDER: Record<string, string> = { telebirr: '127', cbe: 'CBE' };

for (const dir of ['telebirr', 'cbe']) {
  const files = readdirSync(join(ROOT, dir)).filter((f) => f.endsWith('.txt'));

  describe(`${dir} fixtures`, () => {
    for (const file of files) {
      const body = readFileSync(join(ROOT, dir, file), 'utf8');
      const expected = JSON.parse(readFileSync(join(ROOT, dir, file.replace(/\.txt$/, '.json')), 'utf8'));

      it(`${file} (with sender)`, () => {
        const r = parseSms({ sender: SENDER[dir], body });
        if (!r.ok) throw new Error(`not parsed: ${r.reason}`);
        expect(r.tx).toMatchObject(expected);
        expect(r.tx.raw).toBe(body);
        expect(r.tx.warnings).toEqual([]);
      });

      it(`${file} (pasted, no sender)`, () => {
        const r = parseSms({ body });
        expect(r.ok && r.tx).toMatchObject(expected);
      });

      it(`${file} never exposes a full account/phone number`, () => {
        const r = parseSms({ sender: SENDER[dir], body });
        if (!r.ok) throw new Error('not parsed');
        const { raw: _raw, ...stored } = r.tx;
        const strings = Object.values(stored).filter((v): v is string => typeof v === 'string');
        for (const s of strings) expect(s).not.toMatch(/\d{7,}/);
      });
    }
  });
}

describe('robustness', () => {
  const body = readFileSync(join(ROOT, 'telebirr/t11_transfer_out.txt'), 'utf8');

  it('tolerates CRLF and collapsed whitespace (forwarded/pasted copies)', () => {
    for (const variant of [body.replace(/\n/g, '\r\n'), body.replace(/\s+/g, ' ')]) {
      const r = parseSms({ sender: '127', body: variant });
      expect(r.ok && r.tx.amount).toBe(550_000);
    }
  });

  it('flags CBE charges that do not add up to the stated total', () => {
    const cbe = readFileSync(join(ROOT, 'cbe/c07_debit.txt'), 'utf8').replace('total of ETB 112.00', 'total of ETB 113.00');
    const r = parseSms({ sender: 'CBE', body: cbe });
    if (!r.ok) throw new Error('not parsed');
    expect(r.tx.warnings).toContain('charges_total_mismatch');
    expect(r.tx.confidence).toBeLessThan(0.8);
  });

  it('returns no_template for an unknown message from a known sender', () => {
    const r = parseSms({ sender: '127', body: 'Dear customer, enjoy 50% bonus on all packages this weekend! Dial *999#' });
    expect(r).toMatchObject({ ok: false, reason: 'no_template' });
  });

  it('returns unknown_sender for unrelated text', () => {
    expect(parseSms({ body: 'hello there' })).toMatchObject({ ok: false, reason: 'unknown_sender' });
    expect(parseSms({ sender: 'Safaricom', body: 'You have received ETB 10.00' })).toMatchObject({
      ok: false,
      reason: 'unknown_sender',
    });
  });
});
