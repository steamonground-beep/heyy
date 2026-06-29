const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;
const KEYS_FILE = path.join(__dirname, 'keys.json');
const ADMIN_KEY = process.env.ADMIN_KEY || '2549'; // Change this in production

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Admin authentication middleware
function requireAdminKey(req, res, next) {
    const authHeader = req.headers['authorization'];
    const providedKey = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
    
    if (providedKey === ADMIN_KEY) {
        next();
    } else {
        res.status(401).json({ success: false, message: 'Unauthorized' });
    }
}

// Helper function to read keys
function readKeys() {
    try {
        if (fs.existsSync(KEYS_FILE)) {
            const data = fs.readFileSync(KEYS_FILE, 'utf8');
            return JSON.parse(data);
        }
        return [];
    } catch (err) {
        console.error('Error reading keys:', err);
        return [];
    }
}

// Helper function to write keys
function writeKeys(keys) {
    try {
        fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2));
        return true;
    } catch (err) {
        console.error('Error writing keys:', err);
        return false;
    }
}

// Helper function to generate a random key
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

// API: Validate key
app.post('/api/validate', (req, res) => {
    const { key, ip } = req.body;
    
    if (!key) {
        return res.json({ valid: false, message: 'Key is required' });
    }
    
    const keys = readKeys();
    const keyData = keys.find(k => k.key === key);
    
    if (!keyData) {
        return res.json({ valid: false, message: 'Invalid license key' });
    }
    
    // Check if key is expired
    if (keyData.expiresAt && new Date(keyData.expiresAt) < new Date()) {
        return res.json({ valid: false, message: 'License key has expired' });
    }
    
    // Check if key is already used
    if (keyData.usedIp) {
        // Key is locked to an IP address
        if (keyData.usedIp !== ip) {
            // Allow re-activation if hwid changes (e.g., after rebuild)
            // Reset the lock to the new hwid
            keyData.usedIp = ip;
            keyData.usedAt = new Date().toISOString();
            writeKeys(keys);
            return res.json({ valid: true, message: 'License re-activated with new device ID', lockedIp: ip });
        }
        return res.json({ valid: true, message: 'License validated', lockedIp: keyData.usedIp });
    }

    // Key is not used yet - lock it to this IP address
    keyData.usedIp = ip;
    keyData.usedAt = new Date().toISOString();
    writeKeys(keys);

    return res.json({ valid: true, message: 'License activated and locked to IP', lockedIp: ip });
});

// API: Add a new key (for manual key creation)
app.post('/api/keys', requireAdminKey, (req, res) => {
    const { key, expiryDays, label } = req.body;
    
    const keys = readKeys();
    
    // Generate key if not provided
    const newKey = key || generateKey();
    
    // Calculate expiry date
    let ExpiresAt = null;
    if (expiryDays) {
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + expiryDays);
        ExpiresAt = expiryDate.toISOString();
    }
    
    const keyData = {
        key: newKey,
        label: label || null,
        createdAt: new Date().toISOString(),
        expiresAt: ExpiresAt,
        usedIp: null,
        usedAt: null
    };
    
    keys.push(keyData);
    writeKeys(keys);
    
    res.json({ success: true, key: keyData });
});

// API: List all keys
app.get('/api/keys', requireAdminKey, (req, res) => {
    const keys = readKeys();
    res.json(keys);
});

// API: Verify admin key (for login)
app.post('/api/verify-admin', (req, res) => {
    const { key } = req.body;
    
    console.log('=== Admin Key Verification ===');
    console.log('Received key:', JSON.stringify(key));
    console.log('Received key type:', typeof key);
    console.log('Received key length:', key ? key.length : 'N/A');
    console.log('Expected ADMIN_KEY:', JSON.stringify(ADMIN_KEY));
    console.log('Expected ADMIN_KEY type:', typeof ADMIN_KEY);
    console.log('Expected ADMIN_KEY length:', ADMIN_KEY ? ADMIN_KEY.length : 'N/A');
    console.log('Keys match:', key === ADMIN_KEY);
    
    if (key === ADMIN_KEY) {
        console.log('Admin key verified successfully');
        res.json({ valid: true });
    } else {
        console.log('Admin key verification failed');
        res.status(401).json({ valid: false, message: 'Invalid admin key' });
    }
});

// API: Delete a key
app.delete('/api/keys/:key', requireAdminKey, (req, res) => {
    const { key } = req.params;
    const keys = readKeys();
    const index = keys.findIndex(k => k.key === key);
    
    if (index === -1) {
        return res.json({ success: false, message: 'Key not found' });
    }
    
    keys.splice(index, 1);
    writeKeys(keys);
    
    res.json({ success: true });
});

// API: Reset key IP lock (admin function)
app.post('/api/keys/:key/reset', requireAdminKey, (req, res) => {
    const { key } = req.params;
    const keys = readKeys();
    const keyData = keys.find(k => k.key === key);
    
    if (!keyData) {
        return res.json({ success: false, message: 'Key not found' });
    }
    
    keyData.usedIp = null;
    keyData.usedAt = null;
    writeKeys(keys);
    
    res.json({ success: true, message: 'Key IP lock reset' });
});

// Start server
app.listen(PORT, () => {
    console.log(`Key System server running on port ${PORT}`);
    console.log(`Keys file: ${KEYS_FILE}`);
});
