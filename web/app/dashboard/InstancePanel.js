'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useCallback } from 'react';

const TAB_CONTROL = { console: 'Console', settings: 'Settings', files: 'Files' };

export default function InstancePanel({ inst, onClose, onChanged }) {
  const [tab, setTab] = useState('console');
  const [error, setError] = useState('');

  return (
    <div
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        marginTop: 12,
        padding: 16,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <strong>Manage: {inst.name}</strong>
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>
          Status:{' '}
          <b style={{ color: inst.status === 'running' ? 'var(--success)' : 'var(--warning)' }}>
            {inst.status}
          </b>
        </span>
        {inst.public_url && (
          <a className="muted" href={inst.public_url} target="_blank" rel="noreferrer">
            {inst.public_url}
          </a>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {['console', 'settings', 'files'].map((t) => (
            <button
              key={t}
              className={tab === t ? '' : 'secondary'}
              onClick={() => setTab(t)}
              style={{ padding: '4px 12px', fontSize: 13 }}
            >
              {TAB_CONTROL[t]}
            </button>
          ))}
          <button className="secondary" onClick={onClose} style={{ padding: '4px 12px', fontSize: 13 }}>
            Close
          </button>
        </div>
      </div>

      {error && <p style={{ color: 'var(--danger)', marginTop: 8 }}>{error}</p>}

      {tab === 'console' && <ConsoleTab inst={inst} onError={setError} onChanged={onChanged} />}
      {tab === 'settings' && <SettingsTab inst={inst} onError={setError} onChanged={onChanged} />}
      {tab === 'files' && <FilesTab inst={inst} onError={setError} />}
    </div>
  );
}

// ---------------------------------------------------------------- Console ---

function ConsoleTab({ inst, onError, onChanged }) {
  const [lines, setLines] = useState([]);
  const [cursor, setCursor] = useState(0);
  const [running, setRunning] = useState(null);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef(null);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/instances/${inst.id}/logs?after=${cursor}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || res.status);
      }
      const data = await res.json();
      const fresh = (data.lines || []).map((l) => l.s);
      setLines((prev) => [...prev, ...fresh]);
      setCursor(data.cursor || cursor);
      if (data.running !== undefined) setRunning(data.running);
    } catch (e) {
      onError(e.message);
    }
  }, [inst.id, cursor, onError]);

  useEffect(() => {
    const t = setInterval(poll, 2500);
    poll();
    return () => clearInterval(t);
  }, [poll]);

  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  async function act(action) {
    setBusy(true);
    onError('');
    try {
      const res = await fetch(`/api/instances/${inst.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const j = await res.json();
      if (!res.ok) onError(j.error || `${action} failed`);
      if (action === 'restart') {
        setLines([]);
        setCursor(0);
      }
      onChanged && onChanged();
    } finally {
      setBusy(false);
    }
  }

  const canRun = running === false || running === null;
  const canStop = running === true;

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        {canRun && (
          <button onClick={() => act('start')} disabled={busy} style={{ padding: '4px 12px', fontSize: 13 }}>
            Start
          </button>
        )}
        {canStop && (
          <button onClick={() => act('stop')} className="secondary" disabled={busy} style={{ padding: '4px 12px', fontSize: 13 }}>
            Stop
          </button>
        )}
        <button onClick={() => act('restart')} className="secondary" disabled={busy} style={{ padding: '4px 12px', fontSize: 13 }}>
          Restart
        </button>
      </div>

      <div
        ref={boxRef}
        style={{
          background: '#0b0e1a',
          border: '1px solid var(--border)',
          borderRadius: 8,
          height: 360,
          overflowY: 'auto',
          padding: 12,
          fontFamily: 'Consolas, monospace',
          fontSize: 12,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}
      >
        {lines.length === 0 ? (
          <span style={{ color: 'var(--muted)' }}>// waiting for output…</span>
        ) : (
          lines.map((l, i) => (
            <div key={i} style={{ color: '#c9e3c9' }}>
              {l}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// --------------------------------------------------------------- Settings ---

const SETTING_KEYS = [
  { key: 'PLAYFAB_TITLE_ID', label: 'Game title (PlayFab)', hint: 'Which title the backend reports to.' },
  { key: 'DNS_REDIRECT_IP', label: 'DNS redirect IP', hint: 'Public IP clients are redirected to.' },
  { key: 'HOST', label: 'Bind host', hint: 'Usually 0.0.0.0.' },
  { key: 'DISCORD_LOGIN', label: 'Discord login webhook', hint: 'Optional.' },
  { key: 'DISCORD_ROOMS', label: 'Discord rooms webhook', hint: 'Optional.' },
  { key: 'DISCORD_WEBHOOK', label: 'Discord webhook', hint: 'Optional.' },
];

function parseEnv(text) {
  const out = {};
  for (const line of String(text || '').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

function SettingsTab({ inst, onError, onChanged }) {
  const [env, setEnv] = useState({});
  const [raw, setRaw] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/instances/${inst.id}/files?path=${encodeURIComponent('/.env')}&view=1`);
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'load failed');
        const data = await res.json();
        setRaw(data.content || '');
        setEnv(parseEnv(data.content));
      } catch (e) {
        onError(e.message);
      } finally {
        setLoaded(true);
      }
    })();
  }, [inst.id, onError]);

  async function save() {
    setSaving(true);
    onError('');
    try {
      const content = expanded ? raw : Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n');
      const res = await fetch(`/api/instances/${inst.id}/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '/.env', content }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'save failed');
      onChanged && onChanged();
    } catch (e) {
      onError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return <p style={{ color: 'var(--muted)', marginTop: 12 }}>Loading settings…</p>;

  return (
    <div style={{ marginTop: 12 }}>
      <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 8 }}>
        Environment variables for this instance (saved to .env). Restart the server to apply changes.
      </p>

      {!expanded ? (
        <div style={{ display: 'grid', gap: 10 }}>
          {SETTING_KEYS.map(({ key, label, hint }) => (
            <label key={key} style={{ display: 'block' }}>
              <div style={{ fontSize: 13, marginBottom: 4 }}>
                <b>{label}</b> <span className="mono">{key}</span>
              </div>
              <input
                value={env[key] || ''}
                onChange={(e) => setEnv((p) => ({ ...p, [key]: e.target.value }))}
                placeholder={hint}
                className="mono"
                style={{
                  width: '100%',
                  padding: '7px 10px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'var(--bg)',
                  color: 'var(--text)',
                  fontSize: 13,
                }}
              />
            </label>
          ))}
          <label style={{ display: 'block' }}>
            <div style={{ fontSize: 13, marginBottom: 4 }}>
              <b>Anything else</b> <span className="mono">ADDITIONAL_KEYS</span>
            </div>
            <input
              value={env['_extra'] || ''}
              onChange={(e) => setEnv((p) => ({ ...p, _extra: e.target.value }))}
              placeholder="K=V pairs, one per line"
              className="mono"
              style={{
                width: '100%',
                padding: '7px 10px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--bg)',
                color: 'var(--text)',
                fontSize: 13,
              }}
            />
          </label>
        </div>
      ) : (
        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          className="mono"
          style={{
            width: '100%',
            height: 220,
            padding: 10,
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: '#0b0e1a',
            color: '#c9e3c9',
            fontSize: 12,
            fontFamily: 'Consolas, monospace',
          }}
        />
      )}

      <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
        <button onClick={save} disabled={saving} style={{ padding: '6px 16px' }}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button className="secondary" onClick={() => setExpanded((e) => !e)} style={{ padding: '6px 12px', fontSize: 13 }}>
          {expanded ? 'Simple mode' : 'Raw editor'}
        </button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- Files ---

function FilesTab({ inst, onError }) {
  return (
    <div style={{ marginTop: 12, display: 'grid', gap: 12 }}>
      <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>
        Use the full-page editor for file browsing and saving.
      </p>

      <Link
        href={`/dashboard/instances/${inst.id}/files`}
        className="secondary"
        style={{ display: 'inline-flex', alignItems: 'center', width: 'fit-content', padding: '8px 14px' }}
      >
        Open full file manager
      </Link>

      {inst.public_url && (
        <p style={{ color: 'var(--muted)', fontSize: 12, margin: 0 }}>
          Instance URL: <span className="mono">{inst.public_url}</span>
        </p>
      )}
    </div>
  );
}
