import { NextResponse } from 'next/server';
import db from '../../../../lib/db';
const { query, tierLimits, getInstanceRuntime, rollFreeUsage } = db;
import { getCurrentUser } from '../../../../lib/auth';
import { callWorker } from '../../../../lib/worker-client';

export const runtime = 'nodejs';

async function loadUserInstance(req, params) {
  const user = await getCurrentUser(req, { query });
  if (!user) return { user: null, instance: null };
  const { rows } = await query('SELECT * FROM instances WHERE id = $1 AND owner_id = $2', [
    params.id,
    user.id,
  ]);
  return { user, instance: rows.length ? rows[0] : null };
}

function unauthorized() {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}

export async function GET(req, { params }) {
  const { user, instance } = await loadUserInstance(req, params);
  if (!user) return unauthorized();
  if (!instance) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const runSeconds = await getInstanceRuntime(instance.id);
  return NextResponse.json({ instance: { ...instance, run_seconds: runSeconds } });
}

// ACTIONS: start | stop | delete | rename
export async function POST(req, { params }) {
  const { user, instance } = await loadUserInstance(req, params);
  if (!user) return unauthorized();
  if (!instance) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const action = body.action;
  if (!action) return NextResponse.json({ error: 'action required' }, { status: 400 });

  if (action === 'delete') {
    // Free tier instances are permanent: deleting to reset the runtime clock is
    // not allowed. Only an owner can remove them via the bot.
    const limits = await tierLimits(user.tier);
    if (user.tier === 'free') {
      return NextResponse.json(
        { error: 'Free tier instances are permanent and cannot be deleted. Contact an owner.' },
        { status: 403 }
      );
    }
    try {
      await callWorker(db, instance.id, '/stop', { method: 'POST', body: '{}' });
    } catch (e) {
      // worker unreachable or instance not running — still delete.
    }
    await query('DELETE FROM instances WHERE id = $1', [instance.id]);
    return NextResponse.json({ ok: true });
  }

  if (action === 'rename') {
    const name = String(body.name || '').trim();
    if (!name || name.length > 40) {
      return NextResponse.json({ error: 'invalid name' }, { status: 400 });
    }
    const { rows } = await query('UPDATE instances SET name = $1, updated_at = now() WHERE id = $2 RETURNING *', [
      name,
      instance.id,
    ]);
    return NextResponse.json({ instance: rows[0] });
  }

  if (action === 'start') {
    const limits = await tierLimits(user.tier);
    // Free tier: enforce max runtime per day (7 hours), cumulative across all
    // instances. The daily allowance resets at midnight (GMT).
    if (user.tier === 'free' && limits.max_run_hours != null) {
      const { today_seconds } = await rollFreeUsage(user.id);
      const maxSeconds = limits.max_run_hours * 3600;
      if (today_seconds >= maxSeconds) {
        return NextResponse.json(
          { error: `free tier runtime used up for today (${limits.max_run_hours}h max, resets at midnight)` },
          { status: 400 }
        );
      }
    }
    // Set status to starting; worker picks it up and tries to spawn the process.
    const { rows } = await query(
      `UPDATE instances
       SET status = 'starting', started_at = COALESCE(started_at, now())
       WHERE id = $1 AND status IN ('stopped','error')
       RETURNING *`,
      [instance.id]
    );
    if (!rows.length) {
      return NextResponse.json({ error: 'instance not stoppable' }, { status: 400 });
    }
    return NextResponse.json({ instance: rows[0] });
  }

  if (action === 'stop') {
    const { rows } = await query(
      `UPDATE instances SET status = 'stopping' WHERE id = $1 AND status IN ('running','starting')
       RETURNING *`,
      [instance.id]
    );
    if (!rows.length) return NextResponse.json({ error: 'instance not running' }, { status: 400 });
    return NextResponse.json({ instance: rows[0] });
  }

  if (action === 'restart') {
    // Worker restarts the process in place; status cycles automatically.
    try {
      const data = await callWorker(db, instance.id, '/restart', { method: 'POST', body: '{}' });
      return NextResponse.json({ ok: true, worker: data });
    } catch (e) {
      return NextResponse.json({ error: e.message }, { status: e.status || 502 });
    }
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}