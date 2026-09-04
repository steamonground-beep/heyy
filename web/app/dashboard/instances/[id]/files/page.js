'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

function joinPath(base, child) {
  if (!base || base === '/') return `/${String(child || '').replace(/^\/+/, '')}`;
  return `${base.replace(/\/+$/, '')}/${String(child || '').replace(/^\/+/, '')}`;
}

export default function InstanceFilesPage({ params }) {
  const id = params.id;
  const searchParams = useSearchParams();
  const [instance, setInstance] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [cwd, setCwd] = useState('/');
  const [entries, setEntries] = useState([]);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/instances/${id}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load instance');
        setInstance(data.instance);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  useEffect(() => {
    const openPath = searchParams.get('path');
    if (openPath) {
      const normalized = openPath.startsWith('/') ? openPath : `/${openPath}`;
      const folder = normalized.split('/').slice(0, -1).join('/') || '/';
      setCwd(folder);
    }
  }, [searchParams]);

  useEffect(() => {
    (async () => {
      if (loading) return;
      setBusy(true);
      setError('');
      try {
        const res = await fetch(`/api/instances/${id}/files?path=${encodeURIComponent(cwd)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load folder');
        setEntries(data.entries || []);
        const openPath = searchParams.get('path');
        if (openPath) {
          const normalized = openPath.startsWith('/') ? openPath : `/${openPath}`;
          const existing = data.entries?.find((e) => e.path === normalized.replace(/^\/+/, ''));
          if (existing && existing.type === 'file') {
            await openFile(normalized);
            return;
          }
        }
        setFile(null);
      } catch (e) {
        setError(e.message);
      } finally {
        setBusy(false);
      }
    })();
  }, [cwd, id, loading, searchParams]);

  async function openFile(p) {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/instances/${id}/files?path=${encodeURIComponent(p)}&view=1`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to open file');
      setFile({ path: p, content: data.content ?? '' });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveFile() {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/instances/${id}/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: file.path, content: file.content }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to save file');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const dirs = useMemo(() => entries.filter((e) => e.type === 'dir'), [entries]);
  const files = useMemo(() => entries.filter((e) => e.type === 'file'), [entries]);

  if (loading) return <main style={{ padding: 32 }}>Loading…</main>;

  return (
    <main style={{ maxWidth: 1280, margin: '0 auto', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <Link href="/dashboard" className="muted">
            ← Back to dashboard
          </Link>
          <h1 style={{ marginTop: 6 }}>Files</h1>
          <p style={{ color: 'var(--muted)', marginTop: 4 }}>
            {instance ? `${instance.name} · ${instance.status}` : `Instance ${id}`}
          </p>
        </div>
        {instance?.public_url && (
          <a href={instance.public_url} target="_blank" rel="noreferrer" className="muted">
            {instance.public_url}
          </a>
        )}
      </div>

      {error && <p style={{ color: 'var(--danger)', marginTop: 12 }}>{error}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: '320px minmax(0, 1fr)', gap: 16, marginTop: 18 }}>
        <aside style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, minHeight: 720 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
            <span className="mono" style={{ fontSize: 13, color: 'var(--muted)' }}>{cwd}</span>
            {cwd !== '/' && (
              <button className="secondary" onClick={() => setCwd(joinPath(cwd, '..').replace(/\/\.\.?$/, '').replace(/\/+/g, '/'))} style={{ padding: '4px 10px', fontSize: 12 }}>
                ← up
              </button>
            )}
            <button className="secondary" onClick={() => setCwd(cwd)} style={{ padding: '4px 10px', fontSize: 12 }}>
              Refresh
            </button>
          </div>

          {dirs.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <strong style={{ fontSize: 13 }}>Folders</strong>
              <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
                {dirs.map((d) => (
                  <button key={d.path} className="secondary mono" onClick={() => setCwd(`/${d.path}`)} style={{ textAlign: 'left', padding: '6px 10px', fontSize: 12 }}>
                    📁 {d.path}/
                  </button>
                ))}
              </div>
            </div>
          )}

          {files.length > 0 && (
            <div>
              <strong style={{ fontSize: 13 }}>Files</strong>
              <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
                {files.map((f) => (
                  <button key={f.path} className="secondary mono" onClick={() => openFile(f.path)} style={{ textAlign: 'left', padding: '6px 10px', fontSize: 12 }}>
                    📄 {f.path}
                  </button>
                ))}
              </div>
            </div>
          )}

          {entries.length === 0 && !busy && <p style={{ color: 'var(--muted)', fontSize: 13 }}>This folder is empty.</p>}
        </aside>

        <section style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, minHeight: 720 }}>
          {!file ? (
            <div style={{ color: 'var(--muted)' }}>
              Select a file to edit.
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
                <strong className="mono" style={{ fontSize: 13 }}>{file.path}</strong>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="secondary" onClick={() => setFile(null)} style={{ padding: '4px 10px', fontSize: 12 }}>Close</button>
                  <button onClick={saveFile} disabled={busy} style={{ padding: '4px 12px', fontSize: 12 }}>Save</button>
                </div>
              </div>
              <textarea
                value={file.content}
                onChange={(e) => setFile((f) => ({ ...f, content: e.target.value }))}
                className="mono"
                style={{
                  width: '100%',
                  height: 'calc(100vh - 260px)',
                  minHeight: 560,
                  padding: 14,
                  borderRadius: 10,
                  border: '1px solid var(--border)',
                  background: '#0b0e1a',
                  color: '#c9e3c9',
                  fontSize: 13,
                  lineHeight: 1.45,
                  fontFamily: 'Consolas, monospace',
                  resize: 'vertical',
                }}
              />
            </>
          )}
        </section>
      </div>
    </main>
  );
}
