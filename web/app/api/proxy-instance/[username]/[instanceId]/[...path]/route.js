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

async function getWorkerDaemonUrl(instanceId) {
  const { rows } = await pool.query(
    'SELECT worker_host, port FROM instances WHERE id = $1',
    [instanceId]
  );
  if (!rows.length) return null;
  
  const instance = rows[0];
  // Try to get the daemon URL from the worker registration
  const { rows: workerRows } = await pool.query(
    'SELECT api_url FROM workers WHERE host = $1',
    [instance.worker_host]
  );
  
  if (workerRows.length && workerRows[0].api_url) {
    return workerRows[0].api_url;
  }
  
  // Fallback to direct IP:port if no daemon URL registered
  return `http://${instance.worker_host || 'localhost'}:4770`;
}

export async function GET(request, { params }) {
  const { username, instanceId, path } = params;
  const instance = await getInstanceInfo(instanceId);
  
  if (!instance) {
    return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
  }
  
  if (instance.status !== 'running') {
    return NextResponse.json({ error: 'Instance not running' }, { status: 503 });
  }
  
  const workerDaemonUrl = await getWorkerDaemonUrl(instanceId);
  if (!workerDaemonUrl) {
    return NextResponse.json({ error: 'Worker daemon not available' }, { status: 503 });
  }
  
  const pathString = path && path.length > 0 ? path.join('/') : '';
  const suffix = pathString ? `/${pathString}` : '';
  const query = new URL(request.url).search;
  const targetUrl = `${workerDaemonUrl.replace(/\/+$/, '')}/play/${username}/${instanceId}${suffix}${query}`;
  
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
