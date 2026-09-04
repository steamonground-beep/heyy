const { test } = require('node:test');
const assert = require('node:assert/strict');

const { sign, verify } = require('../web/lib/session');
const { constantTimeEqual } = require('../shared/auth');

process.env.SESSION_SECRET = 'test-secret';

test('sign + verify roundtrip', () => {
  const token = sign({ userId: 'abc', tier: 'free' });
  const payload = verify(token);
  assert.equal(payload.userId, 'abc');
  assert.equal(payload.tier, 'free');
});

test('tampered token fails verification', () => {
  const token = sign({ userId: 'abc' });
  const [data, sig] = token.split('.');
  const tampered = Buffer.from(JSON.stringify({ userId: 'evil' })).toString('base64url');
  assert.equal(verify(`${tampered}.${sig}`), null);
});

test('garbage token returns null', () => {
  assert.equal(verify(''), null);
  assert.equal(verify('abc'), null);
  assert.equal(verify('a.b.c'), null);
});

test('constantTimeEqual matches and rejects', () => {
  assert.equal(constantTimeEqual('same', 'same'), true);
  assert.equal(constantTimeEqual('same', 'diff'), false);
  assert.equal(constantTimeEqual('a', 'bbbbbbbbbb'), false);
});