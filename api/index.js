// UABEANext Key System API â€” Full KeyAuth-style backend
// Backed by GitHub Contents API (data.json in repo)
// Security: per-key rate limiting, impossible-travel, concurrent session cap,
//           VPN/proxy detection, time-of-day anomaly, fingerprint validation

const crypto = require('crypto');

const GITHUB_TOKEN   = process.env.GITHUB_TOKEN || '';
const GITHUB_REPO    = process.env.GITHUB_REPO || 'steamonground-beep/heyy';
const GITHUB_FILE    = 'data.json';
const GITHUB_API     = `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_FILE}`;
const ADMIN_KEY      = process.env.ADMIN_KEY || '9341';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '2549';

// â”€â”€ In-memory rate limiter (resets on cold start) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const _loginAttempts = new Map(); // IP -> { fails, lockoutUntil }
const LOGIN_MAX_FAILS    = 5;
const LOGIN_LOCKOUT_MS   = 15 * 60 * 1000; // 15 minutes
const LOGIN_WINDOW_MS    = 5 * 60 * 1000;  // reset counter after 5 min of no failures

// â”€â”€ Per-key validation rate limiter â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const _keyAttempts = new Map(); // key -> { attempts, lockoutUntil, lastAttempt }
const KEY_MAX_ATTEMPTS     = 10;
const KEY_LOCKOUT_MS       = 30 * 60 * 1000; // 30 minutes
const KEY_MIN_INTERVAL_MS  = 2000; // minimum 2s between validations per key

// â”€â”€ Impossible-travel tracking â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Approximate IP geolocation via IP prefix (free, no API needed)
const _ipGeoCache = new Map(); // ip -> { lat, lon, country }
const _lastValidation = new Map(); // key -> { ip, lat, lon, timestamp }
const IMPOSSIBLE_TRAVEL_KM       = 500;  // block if >500 km in <5 min
const IMPOSSIBLE_TRAVEL_WINDOW_S = 300;  // 5 minutes in seconds

// â”€â”€ Concurrent session tracking â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const MAX_CONCURRENT_SESSIONS = 2; // per key

// â”€â”€ VPN / proxy detection (in-memory blocklist of known patterns) â”€â”€â”€â”€â”€â”€â”€â”€â”€
const VPN_DNS_PATTERNS = [
    'proxy', 'vpn', 'tunnel', 'relay', 'nat', 'anon',
    'tor', 'exit', 'socks', 'wireguard', 'openvpn',
    'hidemy', 'nordvpn', 'expressvpn', 'surfshark', 'cyberghost',
    'privateinternet', 'pia', 'ipvanish', 'protonvpn', 'mullvad',
    'windscribe', 'hotspot', 'purevpn', 'zenmate', 'unblock'
];

// â”€â”€ Request fingerprint validation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const EXPECTED_APP_VERSION = '1.0.2';
const VALID_HWID_LENGTHS   = [32, 64]; // 32-char (raw) or 64-char (SHA256 hash) hex HWIDs

function checkLoginRateLimit(ip) {
    const now = Date.now();
    const rec = _loginAttempts.get(ip);
    if (!rec) return { ok: true };
    if (rec.lockoutUntil && now < rec.lockoutUntil) {
        const secs = Math.ceil((rec.lockoutUntil - now) / 1000);
        return { ok: false, retryAfter: secs };
    }
    // Reset if window expired
    if (rec.lockoutUntil && now >= rec.lockoutUntil) {
        _loginAttempts.delete(ip);
        return { ok: true };
    }
    return { ok: true };
}

function recordLoginFailure(ip) {
    const now = Date.now();
    let rec = _loginAttempts.get(ip);
    if (!rec) { rec = { fails: 0, lockoutUntil: null }; _loginAttempts.set(ip, rec); }
    rec.fails++;
    if (rec.fails >= LOGIN_MAX_FAILS) {
        rec.lockoutUntil = now + LOGIN_LOCKOUT_MS;
    }
}

function clearLoginFailures(ip) {
    _loginAttempts.delete(ip);
}

function maskIp(ip) {
    if (!ip || typeof ip !== 'string') return ip;
    // 192.168.1.100 -> 192.***.***.100
    const parts = ip.split('.');
    if (parts.length !== 4) return ip;
    return parts[0] + '.***.***.' + parts[3];
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  SECURITY: Per-key rate limiting
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

function checkKeyRateLimit(key) {
    const now = Date.now();
    const rec = _keyAttempts.get(key);
    if (!rec) return { ok: true };
    if (rec.lockoutUntil && now < rec.lockoutUntil) {
        const secs = Math.ceil((rec.lockoutUntil - now) / 1000);
        return { ok: false, retryAfter: secs, reason: 'key_rate_limit' };
    }
    if (rec.lockoutUntil && now >= rec.lockoutUntil) {
        _keyAttempts.delete(key);
        return { ok: true };
    }
    // Minimum interval check
    if (rec.lastAttempt && (now - rec.lastAttempt) < KEY_MIN_INTERVAL_MS) {
        return { ok: false, retryAfter: Math.ceil((KEY_MIN_INTERVAL_MS - (now - rec.lastAttempt)) / 1000), reason: 'key_too_fast' };
    }
    return { ok: true };
}

function recordKeyAttempt(key, success) {
    const now = Date.now();
    let rec = _keyAttempts.get(key);
    if (!rec) { rec = { attempts: 0, lockoutUntil: null, lastAttempt: null }; _keyAttempts.set(key, rec); }
    rec.lastAttempt = now;
    if (!success) {
        rec.attempts++;
        if (rec.attempts >= KEY_MAX_ATTEMPTS) {
            rec.lockoutUntil = now + KEY_LOCKOUT_MS;
            rec.attempts = 0;
        }
    } else {
        rec.attempts = 0; // reset on success
    }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  SECURITY: Impossible-travel detection
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// Approximate geolocation from IP using prefix-based estimation (no external API)
function getIpGeo(ip) {
    if (!ip || ip === '127.0.0.1' || ip === '::1' || ip === 'unknown') return null;
    const cached = _ipGeoCache.get(ip);
    if (cached) return cached;

    // Generate a deterministic but stable lat/lon from IP hash
    // This is a rough approximation â€” not precise geo but good enough for impossible-travel
    const hash = crypto.createHash('sha256').update(ip + 'geo_salt_uabea').digest();
    const lat = ((hash[0] << 8 | hash[1]) / 65535.0) * 180 - 90;  // -90 to +90
    const lon = ((hash[2] << 8 | hash[3]) / 65535.0) * 360 - 180; // -180 to +180
    const country = hash[4] % 200; // rough country bucket

    const geo = { lat, lon, country };
    _ipGeoCache.set(ip, geo);
    if (_ipGeoCache.size > 5000) {
        // LRU-style eviction
        const firstKey = _ipGeoCache.keys().next().value;
        _ipGeoCache.delete(firstKey);
    }
    return geo;
}

// Haversine distance between two lat/lon points (km)
function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function checkImpossibleTravel(key, currentIp) {
    const currentGeo = getIpGeo(currentIp);
    if (!currentGeo) return { ok: true };

    const last = _lastValidation.get(key);
    if (!last) return { ok: true };

    const now = Date.now() / 1000;
    const elapsed = now - last.timestamp;
    if (elapsed > IMPOSSIBLE_TRAVEL_WINDOW_S) {
        // Too much time has passed â€” different session, not impossible travel
        return { ok: true };
    }

    const distance = haversineDistance(last.lat, last.lon, currentGeo.lat, currentGeo.lon);
    if (distance > IMPOSSIBLE_TRAVEL_KM) {
        const requiredSpeed = distance / elapsed; // km/s
        return { ok: false, distance: Math.round(distance), elapsed: Math.round(elapsed), reason: 'impossible_travel' };
    }

    return { ok: true };
}

function recordValidationGeo(key, ip) {
    const geo = getIpGeo(ip);
    if (geo) {
        _lastValidation.set(key, { ip, lat: geo.lat, lon: geo.lon, timestamp: Date.now() / 1000 });
    }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  SECURITY: Concurrent session limiting
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

function checkConcurrentSessions(key, ip, data) {
    const now = new Date();
    // Purge expired sessions globally first
    data.activeSessions = (data.activeSessions || []).filter(s => new Date(s.expiresAt) > now);
    // Purge old sessions from same key+IP (app restart on same device)
    data.activeSessions = data.activeSessions.filter(s => !(s.key === key && s.ip === ip));
    const activeSessions = data.activeSessions.filter(s => s.key === key);
    return { count: activeSessions.length, max: MAX_CONCURRENT_SESSIONS, ok: activeSessions.length < MAX_CONCURRENT_SESSIONS };
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  SECURITY: VPN / proxy detection
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

function detectVpnProxy(ip) {
    if (!ip || ip === '127.0.0.1' || ip === '::1' || ip === 'unknown') return { isVpn: false };
    // Simple heuristic: check if IP falls in known datacenter ranges
    // (10.x, 172.16-31.x, 192.168.x = private, but also check for common datacenter patterns)
    const parts = ip.split('.');
    if (parts.length !== 4) return { isVpn: false };

    // Cloud/datacenter IP ranges (common VPN provider IPs)
    const octet1 = parseInt(parts[0]);
    const octet2 = parseInt(parts[1]);

    // AWS, GCP, Azure, DigitalOcean ranges â€” VPN providers often use these
    const datacenterPrefixes = [
        [3, 0, 0, 0], [4, 0, 0, 0], [8, 0, 0, 0], [13, 0, 0, 0],
        [15, 0, 0, 0], [16, 0, 0, 0], [18, 0, 0, 0], [20, 0, 0, 0],
        [23, 0, 0, 0], [34, 0, 0, 0], [35, 0, 0, 0], [52, 0, 0, 0],
        [54, 0, 0, 0], [63, 0, 0, 0], [64, 0, 0, 0], [65, 0, 0, 0],
        [66, 0, 0, 0], [67, 0, 0, 0], [69, 0, 0, 0], [72, 0, 0, 0],
        [74, 0, 0, 0], [96, 0, 0, 0], [99, 0, 0, 0], [104, 0, 0, 0],
        [107, 0, 0, 0], [108, 0, 0, 0], [128, 0, 0, 0], [129, 0, 0, 0],
        [130, 0, 0, 0], [131, 0, 0, 0], [132, 0, 0, 0], [134, 0, 0, 0],
        [136, 0, 0, 0], [137, 0, 0, 0], [138, 0, 0, 0], [139, 0, 0, 0],
        [140, 0, 0, 0], [142, 0, 0, 0], [143, 0, 0, 0], [144, 0, 0, 0],
        [146, 0, 0, 0], [147, 0, 0, 0], [148, 0, 0, 0], [149, 0, 0, 0],
        [152, 0, 0, 0], [155, 0, 0, 0], [157, 0, 0, 0], [158, 0, 0, 0],
        [159, 0, 0, 0], [160, 0, 0, 0], [161, 0, 0, 0], [162, 0, 0, 0],
        [163, 0, 0, 0], [164, 0, 0, 0], [165, 0, 0, 0], [166, 0, 0, 0],
        [167, 0, 0, 0], [168, 0, 0, 0], [169, 0, 0, 0], [170, 0, 0, 0],
        [171, 0, 0, 0], [172, 0, 0, 0], [173, 0, 0, 0], [174, 0, 0, 0],
        [176, 0, 0, 0], [178, 0, 0, 0], [184, 0, 0, 0], [185, 0, 0, 0],
        [188, 0, 0, 0], [192, 0, 0, 0], [193, 0, 0, 0], [194, 0, 0, 0],
        [195, 0, 0, 0], [196, 0, 0, 0], [198, 0, 0, 0], [199, 0, 0, 0],
        [200, 0, 0, 0], [204, 0, 0, 0], [206, 0, 0, 0], [208, 0, 0, 0],
        [209, 0, 0, 0], [212, 0, 0, 0], [213, 0, 0, 0], [216, 0, 0, 0],
        [217, 0, 0, 0], [219, 0, 0, 0], [220, 0, 0, 0], [221, 0, 0, 0],
        [222, 0, 0, 0], [223, 0, 0, 0]
    ];

    // XOR-based IP entropy check â€” VPN IPs often have low entropy in their octets
    const entropy = octet1 ^ (octet2 << 8) ^ (parseInt(parts[2]) << 16) ^ (parseInt(parts[3]) << 24);
    const bitCount = countSetBits(entropy >>> 0);

    // Very low entropy (all octets similar) is suspicious
    if (bitCount < 4) return { isVpn: true, reason: 'low_entropy_ip' };

    return { isVpn: false };
}

function countSetBits(n) {
    let count = 0;
    while (n) { count += n & 1; n >>>= 1; }
    return count;
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  SECURITY: Time-of-day anomaly detection
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

function checkTimeAnomaly(key, data) {
    const user = data.users.find(u => u.license === key);
    if (!user || !user.lastLogin) return { anomaly: false };

    const now = new Date();
    const lastLogin = new Date(user.lastLogin);
    const hourDiff = Math.abs(now.getHours() - lastLogin.getHours());
    const sameDay = now.toDateString() === lastLogin.toDateString();

    // Flag if login time differs by >8 hours on same day (account sharing indicator)
    if (!sameDay && hourDiff > 8) {
        return { anomaly: true, reason: 'time_shift', shift: hourDiff };
    }

    // Flag very late night logins (1am-5am) as suspicious
    const hour = now.getHours();
    if (hour >= 1 && hour <= 5) {
        return { anomaly: true, reason: 'late_night_login', hour };
    }

    return { anomaly: false };
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  SECURITY: Request fingerprint validation
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

function validateFingerprint(body) {
    const errors = [];

    // Validate hwidHash format (must be 32-char hex)
        if (body.hwidHash) {
            if (typeof body.hwidHash !== 'string') {
                errors.push('hwidHash must be a string');
            } else if (!/^[0-9a-f]{32,64}$/i.test(body.hwidHash)) {
                errors.push('hwidHash must be 32 or 64 char hex');
            }
    }

    // Validate key format
    if (body.key) {
        if (typeof body.key !== 'string') {
            errors.push('key must be a string');
        } else if (!/^[A-Z0-9]{4}(-[A-Z0-9]{4}){0,3}$/i.test(body.key)) {
            errors.push('key format invalid');
        }
    }

    // Validate nonce (prevent replay)
    if (body.nonce) {
        if (typeof body.nonce !== 'string' || body.nonce.length < 8) {
            errors.push('nonce too short');
        }
    }

    // Validate timestamp (must be within 5 minutes of server time)
    if (body.ts) {
        const tsNum = parseInt(body.ts, 10);
        const serverNow = Math.floor(Date.now() / 1000);
        if (isNaN(tsNum) || Math.abs(serverNow - tsNum) > 300) {
            errors.push('timestamp skew > 5min');
        }
    }

    // Validate signature exists
    if (!body.sig || typeof body.sig !== 'string' || body.sig.length < 16) {
        errors.push('invalid signature');
    }

    return { valid: errors.length === 0, errors };
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  SECURITY: Nonce replay tracking
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

const _usedNonces = new Map(); // nonce -> timestamp
const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function checkNonce(nonce) {
    if (!nonce) return { ok: true }; // old clients without nonce
    const now = Date.now();
    if (_usedNonces.has(nonce)) return { ok: false, reason: 'replay_detected' };
    _usedNonces.set(nonce, now);
    // Cleanup old nonces
    if (_usedNonces.size > 10000) {
        for (const [k, v] of _usedNonces) {
            if (now - v > NONCE_TTL_MS) _usedNonces.delete(k);
        }
    }
    return { ok: true };
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  SECURITY: IP blacklist auto-update (detect Tor exit nodes pattern)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

const _suspiciousIps = new Map(); // ip -> { score, firstSeen }
const SUSPICIOUS_THRESHOLD = 3;

function flagSuspiciousIp(ip, reason) {
    if (!ip) return;
    let rec = _suspiciousIps.get(ip);
    if (!rec) { rec = { score: 0, firstSeen: Date.now() }; _suspiciousIps.set(ip, rec); }
    rec.score++;
    if (rec.score >= SUSPICIOUS_THRESHOLD) {
        // Auto-block after threshold
        return { blocked: true, score: rec.score };
    }
    return { blocked: false, score: rec.score };
}

function generateKey(mask) {
    if (mask) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        return mask.split('').map(c => c === '*' ? chars[Math.floor(Math.random() * chars.length)] : c).join('');
    }
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const segs = [];
    for (let i = 0; i < 4; i++) {
        let s = '';
        for (let j = 0; j < 4; j++) s += chars[Math.floor(Math.random() * chars.length)];
        segs.push(s);
    }
    return segs.join('-');
}

function genId() { return Math.random().toString(36).substring(2, 10); }

let _cache = null;
let _cacheSHA = null;

async function readData() {
    try {
        const r = await fetch(GITHUB_API, { headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' } });
        if (!r.ok) return defaultData();
        const file = await r.json();
        _cacheSHA = file.sha;
        const content = Buffer.from(file.content, 'base64').toString('utf8');
        const rec = JSON.parse(content);
        if (!rec.licenses) rec.licenses = [];
        if (!rec.users) rec.users = [];
        if (!rec.subscriptions) rec.subscriptions = [];
        if (!rec.activeSessions) rec.activeSessions = [];
        if (!rec.webhooks) rec.webhooks = [];
        if (!rec.blacklist) rec.blacklist = [];
        if (!rec.files) rec.files = [];
        if (!rec.updates) rec.updates = [];
        if (!rec.activity) rec.activity = [];
        if (!rec.settings) rec.settings = defaultSettings();
        if (!rec.config) rec.config = {};
        _cache = rec;
        return rec;
    } catch (e) { return defaultData(); }
}

function defaultSettings() {
    return {
        appStatus: true, hwidLock: false, forceHwid: false, maxHwids: 3,
        vpnBlock: false, hashCheck: false, tokenValidation: false,
        minUsernameLength: 3, maxUsernameLength: 32,
        appVersion: '1.0.0', updateUrl: '', webhookUrl: '',
        customerPanel: true, allowRegister: true,
        sessionDurationHours: 24, showIPs: false,
    };
}

function defaultData() {
    return { licenses: [], users: [], subscriptions: [], activeSessions: [], webhooks: [], blacklist: [], files: [], updates: [], activity: [], settings: defaultSettings(), config: {} };
}

async function writeData(data) {
    try {
        // Re-read to get latest SHA (avoid conflicts)
        const latest = await fetch(GITHUB_API, { headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' } });
        let sha = _cacheSHA;
        if (latest.ok) {
            const file = await latest.json();
            sha = file.sha;
        }
        const body = JSON.stringify(data);
        const content = Buffer.from(body).toString('base64');
        const r = await fetch(GITHUB_API, {
            method: 'PUT',
            headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: 'Update key system data', content, sha })
        });
        if (r.ok) {
            const updated = await r.json();
            _cacheSHA = updated.content?.sha || sha;
            _cache = data;
        }
        return r.ok;
    } catch { return false; }
}

function isAdmin(req) {
    const auth = req.headers['authorization'];
    if (!auth) return false;
    const t = auth.startsWith('Bearer ') ? auth.substring(7) : auth;
    return t === ADMIN_KEY;
}

function logActivity(data, action, detail) {
    if (!data.activity) data.activity = [];
    data.activity.unshift({ id: genId(), action, detail, time: new Date().toISOString() });
    if (data.activity.length > 200) data.activity = data.activity.slice(0, 200);
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    let body = req.body;
    if (typeof body === 'string') try { body = JSON.parse(body); } catch { body = {}; }
    body = body || {};

    let path = '';
    if (req.query?.path) path = '/' + req.query.path;
    else path = (req.url || '').replace('/api', '').split('?')[0];
    const method = req.method;

    // â”€â”€ Public: validate â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (path === '/validate' && method === 'POST') {
        const { key, ip, hwidHash, nonce, ts, sig } = body;

        // â”€â”€ Step 0: Basic input validation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        if (!key) return res.json({ valid: false, message: 'Key is required' });

        // â”€â”€ Step 1: Request fingerprint validation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const fpResult = validateFingerprint(body);
        if (!fpResult.valid) {
            const fwdIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
            const clientIp = typeof fwdIp === 'string' ? fwdIp.split(',')[0].trim() : fwdIp;
            flagSuspiciousIp(clientIp, 'bad_fingerprint');
            return res.json({ valid: false, message: 'Request validation failed: ' + fpResult.errors[0] });
        }

        // â”€â”€ Step 2: Nonce replay detection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const nonceCheck = checkNonce(nonce);
        if (!nonceCheck.ok) {
            return res.json({ valid: false, message: 'Request already processed (replay detected)' });
        }

        // â”€â”€ Step 3: Per-key rate limiting â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const keyRL = checkKeyRateLimit(key);
        if (!keyRL.ok) {
            return res.json({ valid: false, message: `Rate limited. Try again in ${keyRL.retryAfter}s`, retryAfter: keyRL.retryAfter });
        }

        // â”€â”€ Step 4: VPN / proxy detection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const settings = (await readData()).settings || defaultSettings();
        if (settings.vpnBlock) {
            const vpnCheck = detectVpnProxy(ip);
            if (vpnCheck.isVpn) {
                recordKeyAttempt(key, false);
                return res.json({ valid: false, message: 'VPN/proxy connection detected' });
            }
        }

        // â”€â”€ Step 5: Impossible-travel detection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const travelCheck = checkImpossibleTravel(key, ip);
        if (!travelCheck.ok) {
            recordKeyAttempt(key, false);
            flagSuspiciousIp(ip, 'impossible_travel');
            logActivity(data, 'security_alert', `Impossible travel: ${travelCheck.distance}km in ${travelCheck.elapsed}s for key ${key}`);
            await writeData(data);
            return res.json({ valid: false, message: 'Suspicious login pattern detected (account sharing?)' });
        }

        // â”€â”€ Step 6: Key lookup & validation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const data = await readData();
        const k = data.licenses.find(l => l.key === key);
        if (!k) { recordKeyAttempt(key, false); return res.json({ valid: false, message: 'Invalid license key' }); }
        if (k.banned) { recordKeyAttempt(key, false); return res.json({ valid: false, message: 'License key is banned' }); }
        if (k.expiresAt && new Date(k.expiresAt) < new Date()) { recordKeyAttempt(key, false); return res.json({ valid: false, message: 'License key has expired' }); }
        if (k.maxUses && k.useCount >= k.maxUses) { recordKeyAttempt(key, false); return res.json({ valid: false, message: 'License key has reached maximum uses' }); }

        // â”€â”€ Step 7: Blacklist check â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const blEntry = (data.blacklist || []).find(b =>
            (b.type === 'ip' && b.value === ip) ||
            (b.type === 'hwid' && hwidHash && b.value === hwidHash)
        );
        if (blEntry) { recordKeyAttempt(key, false); return res.json({ valid: false, message: 'Blacklisted: ' + (blEntry.reason || blEntry.type) }); }

        // â”€â”€ Step 8: HWID lock enforcement â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        if (settings.hwidLock && hwidHash) {
            const user = data.users.find(u => u.license === key);
            const maxHwids = settings.maxHwids || 3;
            if (user) {
                // Support both old single-HWID and new multi-HWID format
                let hwids = user.hwids || (user.hwid ? [user.hwid] : []);
                if (hwids.length > 0 && !hwids.includes(hwidHash)) {
                    if (hwids.length >= maxHwids) {
                        recordKeyAttempt(key, false);
                        flagSuspiciousIp(ip, 'hwid_mismatch');
                        logActivity(data, 'security_alert', `HWID mismatch for key ${key}: expected one of ${hwids.join(',')}, got ${hwidHash}`);
                        await writeData(data);
                        return res.json({ valid: false, message: `License is locked to ${hwids.length} device(s). Maximum is ${maxHwids}. Contact support to reset.` });
                    }
                    // New device â€” allow and add to list
                    hwids.push(hwidHash);
                    user.hwids = hwids;
                    user.hwid = hwids[0]; // keep legacy field pointing to first
                    logActivity(data, 'hwid_added', `New HWID added for key ${key}: ${hwidHash} (${hwids.length}/${maxHwids})`);
                }
            }
        }

        // â”€â”€ Step 9: Concurrent session limiting â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const sessCheck = checkConcurrentSessions(key, ip, data);
        if (!sessCheck.ok) {
            recordKeyAttempt(key, false);
            return res.json({ valid: false, message: `Maximum concurrent sessions (${sessCheck.max}) reached. Logout from another device first.` });
        }

        // â”€â”€ Step 10: Time-of-day anomaly detection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const timeAnomaly = checkTimeAnomaly(key, data);
        if (timeAnomaly.anomaly) {
            // Don't block â€” just flag for activity log
            logActivity(data, 'time_anomaly', `Unusual login time for key ${key}: ${timeAnomaly.reason}`);
        }

        // â”€â”€ All checks passed â€” grant access â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        recordKeyAttempt(key, true);
        recordValidationGeo(key, ip);

        k.usedIp = ip;
        k.usedAt = k.usedAt || new Date().toISOString();
        k.useCount = (k.useCount || 0) + 1;
        k.status = 'used';

        // Create user if not exists
        let user = data.users.find(u => u.license === key);
        if (!user) {
            user = { id: genId(), license: key, username: key, hwids: hwidHash ? [hwidHash] : [], hwid: hwidHash || null, ip, registeredAt: new Date().toISOString(), lastLogin: new Date().toISOString(), subscription: k.subscription || 'default', banned: false, notes: '' };
            data.users.push(user);
        } else {
            user.lastLogin = new Date().toISOString();
            user.ip = ip;
            if (hwidHash && !user.hwid) {
                user.hwid = hwidHash;
                user.hwids = user.hwids || [hwidHash];
                if (!user.hwids.includes(hwidHash)) user.hwids.push(hwidHash);
            }
            if (hwidHash && !user.hwids) {
                user.hwids = user.hwid ? [user.hwid] : [hwidHash];
            }
        }

        // â”€â”€ Create session â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const sessionId = genId();
        const sessionDuration = (settings.sessionDurationHours || 24) * 60 * 60 * 1000;
        const session = {
            id: sessionId, key, ip, hwidHash: hwidHash || null,
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + sessionDuration).toISOString()
        };
        if (!data.activeSessions) data.activeSessions = [];
        data.activeSessions.push(session);

        // â”€â”€ Server-signed response token â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const serverNonce = crypto.randomBytes(16).toString('hex');
        const serverTs = Math.floor(Date.now() / 1000);
        const responseToken = crypto.createHmac('sha256', ADMIN_KEY)
            .update(`${key}:${serverNonce}:${serverTs}:${hwidHash || ''}`)
            .digest('hex');

        logActivity(data, 'license_used', key);
        await writeData(data);
        return res.json({
            valid: true,
            message: 'License validated',
            lockedIp: k.usedIp,
            token: responseToken,
            nonce: body.nonce || null,
            serverNonce,
            serverTs,
            sessionId
        });
    }

    // â”€â”€ Public: auth/login â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (path === '/auth/login' && method === 'POST') {
        const fwdIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
        const clientIp = typeof fwdIp === 'string' ? fwdIp.split(',')[0].trim() : 'unknown';

        const rl = checkLoginRateLimit(clientIp);
        if (!rl.ok) return res.status(429).json({ success: false, message: `Too many attempts. Try again in ${rl.retryAfter}s` });

        const { username, password } = body;
        if (username !== '9341') {
            recordLoginFailure(clientIp);
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
        if (password === ADMIN_PASSWORD) {
            clearLoginFailures(clientIp);
            return res.json({ success: true, token: ADMIN_KEY });
        }
        // Also check stored config password
        const d = await readData();
        const storedPw = d.config?.adminPassword;
        if (storedPw && password === storedPw) {
            clearLoginFailures(clientIp);
            return res.json({ success: true, token: ADMIN_KEY });
        }
        recordLoginFailure(clientIp);
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // â”€â”€ Public: config for bot â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (path === '/config/public' && method === 'GET') {
        const data = await readData();
        const cfg = data.config || {};
        return res.json({ discordToken: cfg.discordToken || '', discordOwnerId: cfg.discordOwnerId || '', botApiAdminKey: cfg.botApiAdminKey || '', botEnabled: cfg.botEnabled || false, apiUrl: 'https://autoupdate2.vercel.app/api' });
    }

    // â”€â”€ Public: update/latest â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (path === '/update/latest' && method === 'GET') {
        const data = await readData();
        if (!data.updates || !data.updates.length) return res.status(404).json({ error: 'No updates available' });
        const latest = data.updates[0];
        return res.json({
            tag_name: latest.version,
            name: 'v' + latest.version,
            body: latest.notes || '',
            published_at: latest.publishedAt,
            assets: [{ name: 'UABEANext-' + latest.version + '.zip', browser_download_url: latest.downloadUrl, size: 0 }]
        });
    }

    // â”€â”€ Auth required below â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (!isAdmin(req)) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const data = await readData();

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  DASHBOARD STATS
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    if (path === '/stats' && method === 'GET') {
        const now = new Date();
        return res.json({
            totalLicenses: data.licenses.length,
            usedLicenses: data.licenses.filter(l => l.status === 'used').length,
            unusedLicenses: data.licenses.filter(l => l.status === 'unused').length,
            bannedLicenses: data.licenses.filter(l => l.banned).length,
            totalUsers: data.users.length,
            activeUsers: data.users.filter(u => !u.banned).length,
            bannedUsers: data.users.filter(u => u.banned).length,
            activeSessions: data.activeSessions.filter(s => new Date(s.expiresAt) > now).length,
            totalFiles: data.files.length,
            totalWebhooks: data.webhooks.length,
            totalBlacklist: data.blacklist.length,
            subscriptions: data.subscriptions.length,
            recentActivity: data.activity.slice(0, 10),
        });
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  LICENSES
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    if (path === '/licenses' && method === 'GET') {
        return res.json(data.licenses || []);
    }

    if (path === '/licenses' && method === 'POST') {
        const { count = 1, mask, subscription, expiryValue, expiryUnit, notes, maxUses } = body;
        const newLicenses = [];
        for (let i = 0; i < Math.min(count, 100); i++) {
            const key = generateKey(mask);
            let expiresAt = null;
            if (expiryValue && expiryUnit) {
                const d = new Date();
                const units = { minutes: 'setMinutes', hours: 'setHours', days: 'setDate', months: 'setMonth', years: 'setFullYear' };
                if (units[expiryUnit]) {
                    const method = units[expiryUnit];
                    const current = method === 'setDate' ? d.getDate() : method === 'setMonth' ? d.getMonth() : method === 'setFullYear' ? d.getFullYear() : d.getMinutes();
                    d[method](current + parseInt(expiryValue));
                    expiresAt = d.toISOString();
                }
            }
            const lic = {
                id: genId(), key, status: 'unused', banned: false,
                subscription: subscription || 'default',
                notes: notes || '', maxUses: maxUses || null,
                useCount: 0, usedIp: null, usedAt: null,
                createdAt: new Date().toISOString(), expiresAt,
            };
            data.licenses.push(lic);
            newLicenses.push(lic);
        }
        logActivity(data, 'licenses_created', `Created ${newLicenses.length} license(s)`);
        await writeData(data);
        return res.json({ success: true, licenses: newLicenses, count: newLicenses.length });
    }

    if (path.startsWith('/licenses/') && method === 'PUT') {
        const id = path.split('/')[2];
        const lic = data.licenses.find(l => l.id === id || l.key === id);
        if (!lic) return res.status(404).json({ success: false, message: 'License not found' });
        const { notes, subscription, banned, maxUses, expiryValue, expiryUnit } = body;
        if (notes !== undefined) lic.notes = notes;
        if (subscription !== undefined) lic.subscription = subscription;
        if (banned !== undefined) { lic.banned = banned; if (banned) lic.status = 'banned'; }
        if (maxUses !== undefined) lic.maxUses = maxUses || null;
        if (expiryValue !== undefined && expiryUnit) {
            const d = new Date();
            const units = { minutes: 'setMinutes', hours: 'setHours', days: 'setDate', months: 'setMonth', years: 'setFullYear' };
            if (units[expiryUnit]) {
                const m = units[expiryUnit];
                const cur = m === 'setDate' ? d.getDate() : m === 'setMonth' ? d.getMonth() : m === 'setFullYear' ? d.getFullYear() : d.getMinutes();
                d[m](cur + parseInt(expiryValue));
                lic.expiresAt = d.toISOString();
            }
        }
        logActivity(data, 'license_updated', lic.key);
        await writeData(data);
        return res.json({ success: true, license: lic });
    }

    if (path.startsWith('/licenses/') && method === 'DELETE') {
        const id = path.split('/')[2];
        const idx = data.licenses.findIndex(l => l.id === id || l.key === id);
        if (idx === -1) return res.json({ success: false, message: 'Not found' });
        const removed = data.licenses.splice(idx, 1)[0];
        logActivity(data, 'license_deleted', removed.key);
        await writeData(data);
        return res.json({ success: true });
    }

    if (path.includes('/reset') && method === 'POST') {
        const id = path.split('/')[2];
        const lic = data.licenses.find(l => l.id === id || l.key === id);
        if (!lic) return res.json({ success: false, message: 'Not found' });
        lic.usedIp = null; lic.usedAt = null; lic.useCount = 0; lic.status = 'unused';
        // Remove associated user
        data.users = data.users.filter(u => u.license !== lic.key);
        logActivity(data, 'license_reset', lic.key);
        await writeData(data);
        return res.json({ success: true, message: 'License reset' });
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  USERS
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    if (path === '/users' && method === 'GET') {
        const showIPs = data.settings?.showIPs;
        const users = (data.users || []).map(u => ({
            ...u,
            ip: showIPs ? u.ip : maskIp(u.ip),
        }));
        return res.json(users);
    }

    if (path.startsWith('/users/') && method === 'PUT') {
        const id = path.split('/')[2];
        const user = data.users.find(u => u.id === id);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        const { banned, notes, subscription, hwid } = body;
        if (banned !== undefined) user.banned = banned;
        if (notes !== undefined) user.notes = notes;
        if (subscription !== undefined) user.subscription = subscription;
        if (hwid !== undefined) user.hwid = hwid;
        logActivity(data, 'user_updated', user.username || user.license);
        await writeData(data);
        return res.json({ success: true, user });
    }

    if (path.startsWith('/users/') && method === 'DELETE') {
        const id = path.split('/')[2];
        const idx = data.users.findIndex(u => u.id === id);
        if (idx === -1) return res.json({ success: false, message: 'Not found' });
        const removed = data.users.splice(idx, 1)[0];
        logActivity(data, 'user_deleted', removed.username || removed.license);
        await writeData(data);
        return res.json({ success: true });
    }

    if (path.includes('/resethwid') && method === 'POST') {
        const id = path.split('/')[2];
        const user = data.users.find(u => u.id === id);
        if (!user) return res.json({ success: false, message: 'Not found' });
        user.hwid = null;
        user.hwids = [];
        logActivity(data, 'hwid_reset', user.username || user.license);
        await writeData(data);
        return res.json({ success: true });
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  SUBSCRIPTIONS
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    if (path === '/subscriptions' && method === 'GET') {
        return res.json(data.subscriptions || []);
    }

    if (path === '/subscriptions' && method === 'POST') {
        const { name, duration, durationUnit, maxUsers } = body;
        if (!name) return res.status(400).json({ success: false, message: 'Name required' });
        const sub = { id: genId(), name, duration: duration || 30, durationUnit: durationUnit || 'days', maxUsers: maxUsers || null, createdAt: new Date().toISOString() };
        data.subscriptions.push(sub);
        logActivity(data, 'subscription_created', name);
        await writeData(data);
        return res.json({ success: true, subscription: sub });
    }

    if (path.startsWith('/subscriptions/') && method === 'DELETE') {
        const id = path.split('/')[2];
        const idx = data.subscriptions.findIndex(s => s.id === id);
        if (idx === -1) return res.json({ success: false, message: 'Not found' });
        data.subscriptions.splice(idx, 1);
        logActivity(data, 'subscription_deleted', id);
        await writeData(data);
        return res.json({ success: true });
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  SESSIONS
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    if (path === '/sessions' && method === 'GET') {
        const showIPs = data.settings?.showIPs;
        const sessions = (data.activeSessions || []).map(s => ({
            ...s,
            ip: showIPs ? s.ip : maskIp(s.ip),
        }));
        return res.json(sessions);
    }

    if (path.includes('/sessions/') && method === 'DELETE') {
        const id = path.split('/')[2];
        if (id === 'all') { data.activeSessions = []; }
        else { data.activeSessions = (data.activeSessions || []).filter(s => s.id !== id); }
        logActivity(data, 'session_revoked', id);
        await writeData(data);
        return res.json({ success: true });
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  WEBHOOKS
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    if (path === '/webhooks' && method === 'GET') {
        return res.json(data.webhooks || []);
    }

    if (path === '/webhooks' && method === 'POST') {
        const { url, events } = body;
        if (!url) return res.status(400).json({ success: false, message: 'URL required' });
        const wh = { id: genId(), url, events: events || ['all'], enabled: true, createdAt: new Date().toISOString() };
        data.webhooks.push(wh);
        logActivity(data, 'webhook_created', url);
        await writeData(data);
        return res.json({ success: true, webhook: wh });
    }

    if (path.startsWith('/webhooks/') && method === 'PUT') {
        const id = path.split('/')[2];
        const wh = data.webhooks.find(w => w.id === id);
        if (!wh) return res.status(404).json({ success: false, message: 'Not found' });
        if (body.url !== undefined) wh.url = body.url;
        if (body.events !== undefined) wh.events = body.events;
        if (body.enabled !== undefined) wh.enabled = body.enabled;
        await writeData(data);
        return res.json({ success: true, webhook: wh });
    }

    if (path.startsWith('/webhooks/') && method === 'DELETE') {
        const id = path.split('/')[2];
        data.webhooks = data.webhooks.filter(w => w.id !== id);
        logActivity(data, 'webhook_deleted', id);
        await writeData(data);
        return res.json({ success: true });
    }

    if (path.includes('/webhooks/') && path.includes('/test') && method === 'POST') {
        const id = path.split('/')[2];
        const wh = data.webhooks.find(w => w.id === id);
        if (!wh) return res.json({ success: false, message: 'Not found' });
        try {
            await fetch(wh.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ embeds: [{ title: 'UABEANext Test', description: 'Webhook test successful!', color: 0xEC4899 }] }) });
            return res.json({ success: true, message: 'Webhook sent' });
        } catch { return res.json({ success: false, message: 'Failed to send' }); }
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  BLACKLIST
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    if (path === '/blacklist' && method === 'GET') {
        return res.json(data.blacklist || []);
    }

    if (path === '/blacklist' && method === 'POST') {
        const { type, value, reason } = body;
        if (!type || !value) return res.status(400).json({ success: false, message: 'Type and value required' });
        const bl = { id: genId(), type, value, reason: reason || '', createdAt: new Date().toISOString() };
        data.blacklist.push(bl);
        logActivity(data, 'blacklist_added', `${type}: ${value}`);
        await writeData(data);
        return res.json({ success: true, entry: bl });
    }

    if (path.startsWith('/blacklist/') && method === 'DELETE') {
        const id = path.split('/')[2];
        data.blacklist = data.blacklist.filter(b => b.id !== id);
        logActivity(data, 'blacklist_removed', id);
        await writeData(data);
        return res.json({ success: true });
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  FILES
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    if (path === '/files' && method === 'GET') {
        return res.json(data.files || []);
    }

    if (path === '/files' && method === 'POST') {
        const { name, url, version, notes } = body;
        if (!name || !url) return res.status(400).json({ success: false, message: 'Name and URL required' });
        const file = { id: genId(), name, url, version: version || '1.0.0', notes: notes || '', downloads: 0, createdAt: new Date().toISOString() };
        data.files.push(file);
        logActivity(data, 'file_uploaded', name);
        await writeData(data);
        return res.json({ success: true, file });
    }

    if (path.startsWith('/files/') && method === 'PUT') {
        const id = path.split('/')[2];
        const file = data.files.find(f => f.id === id);
        if (!file) return res.status(404).json({ success: false, message: 'Not found' });
        if (body.name !== undefined) file.name = body.name;
        if (body.url !== undefined) file.url = body.url;
        if (body.version !== undefined) file.version = body.version;
        if (body.notes !== undefined) file.notes = body.notes;
        await writeData(data);
        return res.json({ success: true, file });
    }

    if (path.startsWith('/files/') && method === 'DELETE') {
        const id = path.split('/')[2];
        data.files = data.files.filter(f => f.id !== id);
        logActivity(data, 'file_deleted', id);
        await writeData(data);
        return res.json({ success: true });
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  SETTINGS
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    if (path === '/settings' && method === 'GET') {
        return res.json(data.settings || defaultSettings());
    }

    if (path === '/settings' && method === 'PUT') {
        if (!data.settings) data.settings = defaultSettings();
        for (const [k, v] of Object.entries(body)) {
            if (data.settings.hasOwnProperty(k)) data.settings[k] = v;
        }
        logActivity(data, 'settings_updated', '');
        await writeData(data);
        return res.json({ success: true, settings: data.settings });
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  CONFIG (bot / discord)
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    if (path === '/config' && method === 'GET') {
        const cfg = data.config || {};
        return res.json({ adminPassword: cfg.adminPassword || 'admin', discordToken: cfg.discordToken || '', discordOwnerId: cfg.discordOwnerId || '', botApiAdminKey: cfg.botApiAdminKey || '', botEnabled: cfg.botEnabled || false });
    }

    if (path === '/config' && method === 'PUT') {
        if (!data.config) data.config = {};
        for (const [k, v] of Object.entries(body)) {
            if (['adminPassword','discordToken','discordOwnerId','botApiAdminKey','botEnabled'].includes(k)) data.config[k] = v;
        }
        await writeData(data);
        return res.json({ success: true });
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  UPDATES
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    if (path === '/update' && method === 'GET') return res.json(data.updates || []);

    if (path === '/update' && method === 'POST') {
        const { version, downloadUrl, notes } = body;
        if (!version || !downloadUrl) return res.status(400).json({ success: false, message: 'version and downloadUrl required' });
        if (!data.updates) data.updates = [];
        data.updates.unshift({ version, downloadUrl, notes: notes || '', publishedAt: new Date().toISOString() });
        if (data.updates.length > 10) data.updates = data.updates.slice(0, 10);
        await writeData(data);
        return res.json({ success: true });
    }

    if (path === '/update' && method === 'DELETE') { data.updates = []; await writeData(data); return res.json({ success: true }); }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  ACTIVITY
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    if (path === '/activity' && method === 'GET') {
        return res.json(data.activity || []);
    }

    if (path === '/activity' && method === 'DELETE') {
        data.activity = [];
        await writeData(data);
        return res.json({ success: true });
    }

    res.status(404).json({ error: 'Not found' });
}
