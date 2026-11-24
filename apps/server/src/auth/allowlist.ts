export const REJECTION_MESSAGE =
  'Sorry, this is a private finance tracker and is not open to new users. 🙏';

export function isAllowed(telegramId: number | undefined, allowlist: readonly number[]): boolean {
  return telegramId !== undefined && allowlist.includes(telegramId);
}
