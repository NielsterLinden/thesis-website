import { FormEvent, useState } from 'react';
import { ApiError, checkPassword, storePassword } from '../api';

export function PasswordGate({ onUnlock }: { onUnlock: () => void }) {
  const [pw, setPw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!pw || busy) return;
    setBusy(true);
    setError(null);
    try {
      await checkPassword(pw);
      storePassword(pw);
      onUnlock();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('Wrong password.');
      } else if (err instanceof ApiError && err.status === 429) {
        setError('Too many attempts — wait a minute and try again.');
      } else {
        setError('Could not reach the server. Is it running?');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gate">
      <form className="gate-card" onSubmit={submit}>
        <h1>Thesis Companion</h1>
        <p className="gate-sub">
          Ask about the thesis, its codebase, and the frozen experiment database. Access is by shared password.
        </p>
        <input
          type="password"
          autoFocus
          placeholder="Site password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          aria-label="Site password"
        />
        <button type="submit" disabled={!pw || busy}>
          {busy ? 'Checking…' : 'Enter'}
        </button>
        {error && <div className="gate-error">{error}</div>}
      </form>
    </div>
  );
}
