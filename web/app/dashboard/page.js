'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

function fmtSeconds(s) {
  s = Number(s) || 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}

export default function Dashboard() {
  const [user, setUser] = useState(null);
  const [instances, setInstances] = useState([]);
  const [limits, setLimits] = useState(null);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    try {
      const meRes = await fetch('/api/me');
      const me = await meRes.json();
      setUser(me.user || null);

      if (me.user) {
        const res = await fetch('/api/instances');
        const data = await res.json();
        if (data.instances) setInstances(data.instances);
        if (data.limits) setLimits(data.limits);
      }
    } catch (e) {
      setError('Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  async function createInstance() {
    setError('');
    const name = newName.trim();
    if (!name) return;
    const res = await fetch('/api/instances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'create failed');
      return;
    }
    setNewName('');
    setRefreshKey((k) => k + 1);
  }

  async function act(id, action) {
    setError('');
    setBusyId(id);
    try {
      const res = await fetch(`/api/instances/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || `${action} failed`);
    } finally {
      setBusyId(null);
      setRefreshKey((k) => k + 1);
    }
  }

  if (loading) return <p style={{ padding: 32 }}>Loading…</p>;

  if (!user) {
    return (
      <main style={{ maxWidth: 720, margin: '0 auto', padding: 48, textAlign: 'center' }}>
        <h1>You’re not logged in</h1>
        <p style={{ color: 'var(--muted)', margin: '16px 0' }}>
          Log in with Discord to manage your hosting instances.
        </p>
        <Link href="/api/auth/discord">
          <button className="btn-discord">Login with Discord</button>
        </Link>
      </main>
    );
  }

  const canCreate = limits ? instances.length < limits.max_instances : false;

  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: 32 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>Snakes Hosting</strong>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span>{user.discord_username} · <b>{user.tier === 'paid' ? 'Paid' : 'Free'}</b></span>
          <Link href="/api/auth/logout">
            <button className="secondary">Log out</button>
          </Link>
        </div>
      </header>

      <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginTop: 24 }}>
        <h2>Your plan</h2>
        <p style={{ color: 'var(--muted)', marginTop: 4 }}>
          {user.tier === 'paid'
            ? 'Paid tier: unlimited runtime, up to 5 instances.'
            : `Free tier: up to ${limits?.max_run_hours ?? 7} hours of runtime, 1 instance.`}
        </p>
        {user.tier === 'free' && limits?.max_run_hours != null && (
          <p style={{ color: 'var(--muted)', marginTop: 4 }}>
            Total used: <b>{fmtSeconds(instances.reduce((a, i) => a + (Number(i.run_seconds) || 0), 0))}</b>{' '}
            / {limits.max_run_hours}h max.
          </p>
        )}
      </div>

      <div style={{ marginTop: 24, display: 'flex', gap: 8 }}>
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Instance name"
          maxLength={40}
          style={{
            flex: 1,
            padding: '8px 12px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--panel)',
            color: 'var(--text)',
          }}
        />
        <button onClick={createInstance} disabled={!canCreate || !newName.trim()}>
          Create
        </button>
      </div>
      {!canCreate && (
        <p style={{ color: 'var(--warning)', fontSize: 13, marginTop: 6 }}>
          Instance limit reached ({limits?.max_instances}).
        </p>
      )}

      {error && <p style={{ color: 'var(--danger)', marginTop: 12 }}>{error}</p>}

      <section style={{ marginTop: 24 }}>
        <h3 style={{ marginBottom: 12 }}>Your instances</h3>
        {instances.length === 0 ? (
          <p style={{ color: 'var(--muted)' }}>No instances yet. Create one above.</p>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {instances.map((inst) => (
              <div
                key={inst.id}
                style={{
                  background: 'var(--panel)',
                  border: '1px solid var(--border)',
                  borderRadius: 12,
                  padding: 16,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  flexWrap: 'wrap',
                }}
              >
                <div>
                  <strong>{inst.name}</strong>
                  <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 2 }}>
                    Status: <b style={{ color: inst.status === 'running' ? 'var(--success)' : 'var(--warning)' }}>{inst.status}</b>
                    {inst.public_url ? ` · ${inst.public_url}` : ''}
                    {' · '}Runtime: {fmtSeconds(inst.run_seconds)}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {(inst.status === 'stopped' || inst.status === 'error') && (
                    <button onClick={() => act(inst.id, 'start')} disabled={busyId === inst.id}>
                      Start
                    </button>
                  )}
                  {(inst.status === 'running' || inst.status === 'starting') && (
                    <button onClick={() => act(inst.id, 'stop')} className="secondary" disabled={busyId === inst.id}>
                      Stop
                    </button>
                  )}
                  <button onClick={() => act(inst.id, 'delete')} className="danger" disabled={busyId === inst.id}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}