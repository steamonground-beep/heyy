const { NextResponse } = require('next/server');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /sslmode=require/.test(process.env.DATABASE_URL || '') ? { rejectUnauthorized: false } : undefined,
});

async function getInstanceInfo(instanceId) {
  const { rows } = await pool.query(
    'SELECT * FROM instances WHERE id = $1',
    [instanceId]
  );
  return rows[0];
}

async function getWorkerDaemonUrl() {
  const { rows } = await pool.query("SELECT value FROM settings WHERE key = 'worker_api'");
  if (rows.length) {
    const parsed = typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value;
    if (parsed && parsed.url) return parsed.url;
  }
  return process.env.WORKER_API_URL || null;
}

export async function GET(request, { params }) {
  const { username, instanceId } = params;
  const instance = await getInstanceInfo(instanceId);
  
  if (!instance) {
    return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
  }
  
  if (instance.status !== 'running') {
    return NextResponse.json({ error: 'Instance not running' }, { status: 503 });
  }
  
  const workerDaemonUrl = await getWorkerDaemonUrl();
  if (!workerDaemonUrl) {
    return NextResponse.json({ error: 'Worker daemon not available' }, { status: 503 });
  }
  
  const query = new URL(request.url).search;
  const targetUrl = `${workerDaemonUrl.replace(/\/+$/, '')}/play/${username}/${instanceId}${query}`;
  
  try {
    const response = await fetch(targetUrl, {
      method: request.method,
      headers: {
        ...Object.fromEntries(request.headers.entries()),
        'ngrok-skip-browser-warning': '1',
      },
      body: request.body,
    });
    
    const responseHeaders = new Headers();
    response.headers.forEach((value, key) => {
      if (key !== 'host') {
        responseHeaders.set(key, value);
      }
    });
    
    // Add CORS headers for game client compatibility
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    responseHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    return new NextResponse(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('Proxy error:', error);
    return NextResponse.json({ error: 'Proxy failed' }, { status: 502 });
  }
}

export async function POST(request, { params }) {
  return GET(request, { params });
}

export async function PUT(request, { params }) {
  return GET(request, { params });
}

export async function DELETE(request, { params }) {
  return GET(request, { params });
}

export async function OPTIONS(request, { params }) {
  const responseHeaders = new Headers();
  responseHeaders.set('Access-Control-Allow-Origin', '*');
  responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  responseHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return new NextResponse(null, { status: 200, headers: responseHeaders });
}
