// Key System API — backed by JSONBin.io for storage (no Vercel KV needed)

const JSONBIN_API_KEY = '$2a$10$KuXAkl1xSVi8xDx5xErZc.zfMjotyUxh3fmMISS9sskG81s9eN2HO';
const JSONBIN_BIN_ID = '6a3fd48fda38895dfe07847e';
const JSONBIN_BASE = 'https://api.jsonbin.io/v3/b';

function generateKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const segments = [];
    for (let i = 0; i < 4; i++) {
        let segment = '';
        for (let j = 0; j < 4; j++) {
            segment += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        segments.push(segment);
    }
    return segments.join('-');
}

// Read keys array from JSONBin
async function readKeys() {
    try {
        const response = await fetch(`${JSONBIN_BASE}/${JSONBIN_BIN_ID}/latest`, {
            headers: {
                'X-Master-Key': JSONBIN_API_KEY
            }
        });
        if (!response.ok) {
            console.error('JSONBin read failed:', response.status, await response.text());
            return [];
        }
        const data = await response.json();
        return data.record.keys || [];
    } catch (error) {
        console.error('Error reading keys:', error);
        return [];
    }
}

// Write keys array to JSONBin
async function writeKeys(keys) {
    try {
        const response = await fetch(`${JSONBIN_BASE}/${JSONBIN_BIN_ID}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-Master-Key': JSONBIN_API_KEY
            },
            body: JSON.stringify({ keys })
        });
        if (!response.ok) {
            console.error('JSONBin write failed:', response.status, await response.text());
            return false;
        }
        return true;
    } catch (error) {
        console.error('Error writing keys:', error);
        return false;
    }
}

export default async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // Safely parse body
    let body = req.body;
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (e) { body = {}; }
    }
    body = body || {};

    const { url, method } = req;

    // Determine the path
    let path = url.replace('/api', '').split('?')[0];
    if (req.query && req.query.path) {
        path = '/' + req.query.path;
    } else if (req.headers['x-now-route-matches']) {
        const matches = req.headers['x-now-route-matches'];
        const match = matches.split('&').find(m => m.startsWith('path='));
        if (match) path = '/' + decodeURIComponent(match.split('=')[1]);
    }

    // POST /api/validate
    if (path === '/validate' && method === 'POST') {
        const { key, ip } = body;
        if (!key) return res.json({ valid: false, message: 'Key is required' });

        try {
            const keys = await readKeys();
            const keyData = keys.find(k => k.key === key);
            if (!keyData) return res.json({ valid: false, message: 'Invalid license key' });
            if (keyData.expiresAt && new Date(keyData.expiresAt) < new Date()) {
                return res.json({ valid: false, message: 'License key has expired' });
            }
            if (keyData.usedIp) {
                if (keyData.usedIp !== ip) {
                    return res.json({ valid: false, message: 'License key is locked to a different IP address' });
                }
                return res.json({ valid: true, message: 'License validated', lockedIp: keyData.usedIp });
            }
            keyData.usedIp = ip;
            keyData.usedAt = new Date().toISOString();
            const saved = await writeKeys(keys);
            if (!saved) return res.status(500).json({ valid: false, message: 'Storage error' });
            return res.json({ valid: true, message: 'License activated and locked to IP', lockedIp: ip });
        } catch (error) {
            console.error('Error:', error);
            return res.status(500).json({ valid: false, message: 'Internal error: ' + error.message });
        }
    }

    // POST /api/keys  — create new key
    if (path === '/keys' && method === 'POST') {
        const { key, expiryDays, label } = body;
        try {
            const keys = await readKeys();
            const newKey = key || generateKey();
            let expiresAt = null;
            if (expiryDays) {
                const d = new Date();
                d.setDate(d.getDate() + parseInt(expiryDays));
                expiresAt = d.toISOString();
            }
            const keyData = {
                key: newKey,
                label: label || null,
                createdAt: new Date().toISOString(),
                expiresAt,
                usedIp: null,
                usedAt: null
            };
            keys.push(keyData);
            const saved = await writeKeys(keys);
            if (!saved) return res.status(500).json({ success: false, message: 'Failed to save key to JSONBin' });
            return res.json({ success: true, key: keyData });
        } catch (error) {
            console.error('Error:', error);
            return res.status(500).json({ success: false, message: 'Internal error: ' + error.message });
        }
    }

    // GET /api/keys
    if (path === '/keys' && method === 'GET') {
        try {
            const keys = await readKeys();
            return res.json(keys);
        } catch (error) {
            console.error('Error:', error);
            return res.status(500).json({ error: 'Storage error' });
        }
    }

    // DELETE /api/keys/:key
    if (path.startsWith('/keys/') && method === 'DELETE' && !path.includes('/reset')) {
        const key = path.split('/')[2];
        try {
            const keys = await readKeys();
            const index = keys.findIndex(k => k.key === key);
            if (index === -1) return res.json({ success: false, message: 'Key not found' });
            keys.splice(index, 1);
            const saved = await writeKeys(keys);
            if (!saved) return res.status(500).json({ success: false, message: 'Storage error' });
            return res.json({ success: true });
        } catch (error) {
            console.error('Error:', error);
            return res.status(500).json({ success: false, message: 'Internal error: ' + error.message });
        }
    }

    // POST /api/keys/:key/reset
    if (path.endsWith('/reset') && method === 'POST') {
        const key = path.split('/')[2];
        try {
            const keys = await readKeys();
            const keyData = keys.find(k => k.key === key);
            if (!keyData) return res.json({ success: false, message: 'Key not found' });
            keyData.usedIp = null;
            keyData.usedAt = null;
            const saved = await writeKeys(keys);
            if (!saved) return res.status(500).json({ success: false, message: 'Storage error' });
            return res.json({ success: true, message: 'Key IP lock reset' });
        } catch (error) {
            console.error('Error:', error);
            return res.status(500).json({ success: false, message: 'Internal error: ' + error.message });
        }
    }

    res.status(404).json({ error: 'Not found' });
}
