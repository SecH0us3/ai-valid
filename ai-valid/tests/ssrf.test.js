import { describe, it, expect } from 'vitest';
import index from '../src/index.js';

describe('AI-Valid Worker - SSRF Protection', () => {

    const createRequest = (targetUrl) => {
        return new Request('https://localhost/api/audit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetUrl })
        });
    };

    const env = {};
    const ctx = {};

    it('should block localhost and internal IPs', async () => {
        const testCases = [
            'http://127.0.0.1',
            'http://localhost',
            'http://test.localhost',
            'http://[::1]',
            'http://[0000:0000:0000:0000:0000:0000:0000:0001]',
            'http://[fd00::1]',
            'http://[fe80::1]',
            'http://[ff02::1]',
            'http://169.254.169.254/latest/meta-data/', // AWS IMDS
            'http://192.168.1.1',
            'http://10.0.0.5',
            'http://localtest.me', // Domain resolving to 127.0.0.1
            'http://0177.0.0.1', // Octal
            'http://0x7f000001', // Hex
            'http://2130706433',  // Decimal
        ];

        for (const url of testCases) {
            const req = createRequest(url);
            const res = await index.fetch(req, env, ctx);
            expect(res.status, `Expected 403 for ${url}`).toBe(403);
            const data = await res.json();
            expect(data.error).toContain('Access to internal or restricted network resources is not allowed');
        }
    });

    it('should block SSRF via redirects', async () => {
        // Mock fetch to simulate a redirect to a private IP
        const originalFetch = global.fetch;
        global.fetch = async (url, options) => {
            const urlStr = url.toString();
            if (urlStr.includes('evil.com')) {
                return new Response(null, {
                    status: 302,
                    headers: { 'Location': 'http://localhost' }
                });
            }
            if (urlStr.includes('cloudflare-dns.com')) {
                return new Response(JSON.stringify({
                    Answer: [{ type: 1, data: '1.1.1.1' }]
                }), { status: 200, headers: { 'Content-Type': 'application/dns-json' } });
            }
            return originalFetch(url, options);
        };

        try {
            const req = createRequest('http://evil.com');
            const res = await index.fetch(req, env, ctx);

            // Domain existence check will try to HEAD http://evil.com
            // internalFetch will see the 302 to localhost, throw,
            // and /api/audit catch block will return 400.
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error).toBe('Domain does not exist or is unreachable');
        } finally {
            global.fetch = originalFetch;
        }
    });
});
