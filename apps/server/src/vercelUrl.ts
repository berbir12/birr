/** config.json routes every backend path to /api?__birr_path=<original path>; restore it. */
export function restoreOriginalUrl(url: string | undefined): string {
  const u = new URL(url ?? '/', 'http://internal');
  const original = u.searchParams.get('__birr_path');
  if (original === null || !original.startsWith('/') || original.startsWith('//')) return url ?? '/';
  u.searchParams.delete('__birr_path');
  const qs = u.searchParams.toString();
  return original + (qs ? `?${qs}` : '');
}
