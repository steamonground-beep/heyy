'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Login failed');
        return;
      }
      window.location.href = '/dashboard';
    } catch {
      setError('Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 420, margin: '0 auto', padding: '64px 20px' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>Snakes Hosting</strong>
        <Link href="/">
          <button className="secondary">Home</button>
        </Link>
      </header>

      <h1 style={{ marginTop: 40 }}>Log in</h1>
      <p style={{ color: 'var(--muted)', marginTop: 8 }}>
        Use the username and password your hosting account came with.
      </p>

      <form
        onSubmit={submit}
        style={{ display: 'grid', gap: 12, marginTop: 24, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}
      >
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Username"
          autoComplete="username"
          required
          style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--text)' }}
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoComplete="current-password"
          required
          style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--text)' }}
        />
        <button type="submit" disabled={busy || !username || !password}>
          {busy ? 'Logging in…' : 'Log in'}
        </button>
      </form>

      {error && <p style={{ color: 'var(--danger)', marginTop: 12 }}>{error}</p>}

      <div style={{ display: 'grid', gap: 8, marginTop: 24, textAlign: 'center' }}>
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>or</div>
        <Link href="/api/auth/discord">
          <button className="btn-discord" style={{ width: '100%' }}>
            Login with Discord
          </button>
        </Link>
      </div>
    </main>
  );
}