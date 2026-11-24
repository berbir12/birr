import { useEffect, useState } from 'react';
import { api, ApiError } from './api';

interface Me {
  id: number;
  firstName: string | null;
  locale: 'en' | 'am';
  calendarMode: 'gregorian' | 'ethiopian';
}

export function App({ insideTelegram }: { insideTelegram: boolean }) {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!insideTelegram) return;
    api<Me>('/me')
      .then(setMe)
      .catch((e: unknown) => setError(e instanceof ApiError && e.status === 403 ? 'not_allowed' : 'failed'));
  }, [insideTelegram]);

  return (
    <main className="mx-auto max-w-md p-4">
      <div className="rounded-2xl bg-section p-5 shadow-sm">
        <h1 className="text-2xl font-semibold">Birr</h1>
        {!insideTelegram && <p className="mt-2 text-hint">Open this from the Birr bot in Telegram.</p>}
        {error === 'not_allowed' && <p className="mt-2 text-danger">This app is private.</p>}
        {error === 'failed' && <p className="mt-2 text-danger">Could not reach the server.</p>}
        {me && <p className="mt-2">Selam {me.firstName ?? ''} 👋 — you’re signed in.</p>}
      </div>
    </main>
  );
}
