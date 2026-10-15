import { useState, type FormEvent } from 'react';

// The admin screen lives at <mount>/admin (IIS serves index.html for it).
export const IS_ADMIN_PATH = /\/admin\/?$/.test(window.location.pathname);

export const ADMIN_STORAGE_KEY = 'bf-admin-password';

export function readStoredPassword(): string | null {
  try { return sessionStorage.getItem(ADMIN_STORAGE_KEY); } catch { return null; }
}

export function storePassword(password: string | null) {
  try {
    if (password) sessionStorage.setItem(ADMIN_STORAGE_KEY, password);
    else sessionStorage.removeItem(ADMIN_STORAGE_KEY);
  } catch { /* storage blocked: login just won't survive a reload */ }
}

// The password is only ever checked by the API (ADMIN_PASSWORD env) - never compared in the browser.
export async function verifyAdmin(password: string): Promise<boolean> {
  const response = await fetch(`${import.meta.env.BASE_URL}api/admin/verify`, {
    method: 'POST',
    // IIS answers 411 to a POST with no Content-Length, so always send a (tiny) body
    headers: { Authorization: `Bearer ${password}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (response.status === 429) throw new Error('Too many failed attempts. Try again in a few minutes.');
  if (response.ok) return true;
  if (response.status === 401) return false;
  throw new Error('Could not verify the password. Is the server running?');
}

export function AdminLogin({ onSubmit }: { onSubmit: (password: string) => Promise<boolean> }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!value) return;
    setBusy(true);
    setError('');
    try {
      if (!(await onSubmit(value))) setError('Incorrect password.');
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Login failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 text-foreground">
      <form onSubmit={submit} data-testid="form-admin-login" className="w-full max-w-sm rounded-2xl border border-slate-800 bg-[#0e1723] p-6 shadow-2xl">
        <h1 className="text-lg font-bold text-slate-100">Blue File Management</h1>
        <p className="mt-1 text-xs text-slate-500">Administrator access</p>
        <input
          data-testid="input-admin-password"
          type="password"
          autoFocus
          autoComplete="current-password"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Password"
          className="mt-5 h-11 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100 outline-none focus:border-sky-500"
        />
        {error && <p data-testid="text-admin-error" className="mt-2 text-xs text-red-300">{error}</p>}
        <button
          data-testid="button-admin-login"
          type="submit"
          disabled={busy}
          className="mt-4 h-11 w-full rounded-lg bg-sky-500 text-sm font-bold text-slate-950 transition hover:bg-sky-400 disabled:opacity-60"
        >
          {busy ? 'Checking...' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

// Public viewing is switched by the server (PUBLIC_VIEW). Probe it so the page and the API can't disagree.
export async function isPublicViewOpen(): Promise<boolean> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}api/blue-file-records/summary`);
    return response.ok;
  } catch {
    return false;
  }
}

export function NotAvailable() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 text-foreground">
      <div data-testid="notice-not-available" className="w-full max-w-sm rounded-2xl border border-slate-800 bg-[#0e1723] p-6 text-center shadow-2xl">
        <h1 className="text-lg font-bold text-slate-100">Blue File Management</h1>
        <p className="mt-3 text-sm text-slate-400">This page is not available yet.</p>
      </div>
    </div>
  );
}
