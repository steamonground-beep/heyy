const fs = require('fs');
const path = require('path');

const KEYS_FILE = path.join(__dirname, 'keys.json');

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

function writeKeys(keys) {
    try {
        fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2));
        return true;
    } catch (err) {
        console.error('Error writing keys:', err);
        return false;
    }
}

// Command line usage: node add-key.js [expiryDays] [label]
const args = process.argv.slice(2);
const expiryDays = parseInt(args[0]) || null;
const label = args[1] || null;

const keys = readKeys();
const newKey = generateKey();

let expiresAt = null;
if (expiryDays) {
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + expiryDays);
    expiresAt = expiryDate.toISOString();
}

const keyData = {
    key: newKey,
    label: label || null,
    createdAt: new Date().toISOString(),
    expiresAt: expiresAt,
    usedIp: null,
    usedAt: null
};

keys.push(keyData);
writeKeys(keys);

console.log('Key created successfully!');
console.log(`Key: ${newKey}`);
console.log(`Label: ${label || 'None'}`);
console.log(`Expires: ${expiresAt ? new Date(expiresAt).toLocaleString() : 'Never'}`);
console.log('\nUse this key in UABEANext to activate.');
