import { test, mock } from 'node:test';
import assert from 'node:assert';
import { handleRequest } from './index.js';

test('/api/audit returns 400 for missing targetUrl', async () => {
  const request = new Request('http://localhost/api/audit', {
    method: 'POST',
    body: JSON.stringify({}),
    headers: { 'Content-Type': 'application/json' }
  });

  const response = await handleRequest(request, {}, {});
  assert.strictEqual(response.status, 400);
  const body = await response.json();
  assert.strictEqual(body.error, 'Invalid URL');
});

test('/api/audit returns 400 for targetUrl not starting with http', async () => {
  const request = new Request('http://localhost/api/audit', {
    method: 'POST',
    body: JSON.stringify({ targetUrl: 'ftp://example.com' }),
    headers: { 'Content-Type': 'application/json' }
  });

  const response = await handleRequest(request, {}, {});
  assert.strictEqual(response.status, 400);
  const body = await response.json();
  assert.strictEqual(body.error, 'Invalid URL');
});

test('/api/audit returns 400 for unreachable domain', async (t) => {
  // Mock global fetch
  const originalFetch = global.fetch;
  global.fetch = mock.fn(() => Promise.reject(new Error('Network error')));

  try {
    const request = new Request('http://localhost/api/audit', {
      method: 'POST',
      body: JSON.stringify({ targetUrl: 'http://nonexistent-domain.com' }),
      headers: { 'Content-Type': 'application/json' }
    });

    const response = await handleRequest(request, {}, {});
    assert.strictEqual(response.status, 400);
    const body = await response.json();
    assert.strictEqual(body.error, 'Domain does not exist or is unreachable');
  } finally {
    global.fetch = originalFetch;
  }
});
