import { describe, expect, it } from 'vitest';
import { signInitData, validateInitData } from './initData.js';

const TOKEN = '123456:TEST-token-abcdefghijklmnopqrstuvwxyz';
const now = 1_790_000_000_000;
const user = JSON.stringify({ id: 42, first_name: 'Test' });
const fresh = { auth_date: String(now / 1000 - 60), query_id: 'AAE', user };

describe('validateInitData', () => {
  it('accepts a correctly signed, fresh payload', () => {
    const r = validateInitData(signInitData(fresh, TOKEN), TOKEN, 3600, now);
    expect(r).toMatchObject({ ok: true, user: { id: 42 } });
  });

  it('rejects a tampered field', () => {
    const qs = new URLSearchParams(signInitData(fresh, TOKEN));
    qs.set('user', JSON.stringify({ id: 999 }));
    expect(validateInitData(qs.toString(), TOKEN, 3600, now)).toEqual({ ok: false, reason: 'bad_hash' });
  });

  it('rejects a payload signed with another bot token', () => {
    const r = validateInitData(signInitData(fresh, '999:other-token-xxxxxxxxxxxxxxx'), TOKEN, 3600, now);
    expect(r).toEqual({ ok: false, reason: 'bad_hash' });
  });

  it('rejects stale auth_date', () => {
    const old = { ...fresh, auth_date: String(now / 1000 - 7200) };
    expect(validateInitData(signInitData(old, TOKEN), TOKEN, 3600, now)).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects auth_date far in the future', () => {
    const fut = { ...fresh, auth_date: String(now / 1000 + 600) };
    expect(validateInitData(signInitData(fut, TOKEN), TOKEN, 3600, now)).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects missing hash', () => {
    expect(validateInitData('auth_date=1&user=%7B%7D', TOKEN, 3600, now)).toEqual({ ok: false, reason: 'missing_hash' });
  });

  it('rejects signed payload without user', () => {
    const r = validateInitData(signInitData({ auth_date: fresh.auth_date }, TOKEN), TOKEN, 3600, now);
    expect(r).toEqual({ ok: false, reason: 'no_user' });
  });
});
