import { createHmac, timingSafeEqual } from 'node:crypto';

export interface TelegramWebAppUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export type InitDataResult =
  | { ok: true; user: TelegramWebAppUser; authDate: number }
  | { ok: false; reason: 'missing_hash' | 'bad_hash' | 'expired' | 'no_user' | 'malformed' };

/**
 * Validates Telegram Mini App initData per
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *   secret = HMAC_SHA256(key="WebAppData", msg=bot_token)
 *   hash   = hex(HMAC_SHA256(key=secret, msg=data_check_string))
 */
export function validateInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds: number,
  nowMs: number = Date.now(),
): InitDataResult {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return { ok: false, reason: 'missing_hash' };
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(dataCheckString).digest();
  const given = Buffer.from(hash, 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: 'bad_hash' };
  }

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || authDate <= 0) return { ok: false, reason: 'malformed' };
  const ageSeconds = nowMs / 1000 - authDate;
  // Allow small clock skew into the future, reject anything stale.
  if (ageSeconds > maxAgeSeconds || ageSeconds < -60) return { ok: false, reason: 'expired' };

  const userRaw = params.get('user');
  if (!userRaw) return { ok: false, reason: 'no_user' };
  try {
    const user = JSON.parse(userRaw) as TelegramWebAppUser;
    if (typeof user.id !== 'number') return { ok: false, reason: 'no_user' };
    return { ok: true, user, authDate };
  } catch {
    return { ok: false, reason: 'malformed' };
  }
}

/** Test helper: builds a correctly signed initData string. */
export function signInitData(fields: Record<string, string>, botToken: string): string {
  const dcs = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secret).update(dcs).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}
