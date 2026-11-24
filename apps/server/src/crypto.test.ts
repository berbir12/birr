import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decrypt, encrypt, keyedHash } from './crypto.js';

const key = randomBytes(32);

describe('crypto', () => {
  it('round-trips unicode text', () => {
    const msg = 'Dear ብርሃኑ, You have transferred ETB 5,500.00';
    expect(decrypt(encrypt(msg, key), key)).toBe(msg);
  });

  it('uses a fresh IV each time', () => {
    expect(encrypt('x', key).equals(encrypt('x', key))).toBe(false);
  });

  it('fails on tampered ciphertext', () => {
    const blob = encrypt('secret', key);
    blob[blob.length - 1]! ^= 1;
    expect(() => decrypt(blob, key)).toThrow();
  });

  it('keyed hash depends on key', () => {
    expect(keyedHash('a', key)).not.toBe(keyedHash('a', randomBytes(32)));
  });
});
