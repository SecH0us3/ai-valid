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
            'http://169.254.169.254/latest/meta-data/', // AWS IMDS
            'http://192.168.1.1',
            'http://10.0.0.5',
            'http://localtest.me', // Domain resolving to 127.0.0.1
        ];

        for (const url of testCases) {
            const req = createRequest(url);
            const res = await index.fetch(req, env, ctx);
            expect(res.status, `Expected 403 for ${url}`).toBe(403);
            const data = await res.json();
            expect(data.error).toContain('Access to internal or restricted network resources is not allowed');
        }
    });
});
