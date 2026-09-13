import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import './helpers/rewriter-mock.js';
import index from '../src/index.js';

const rpc = (body, method = 'POST') => new Request('https://ai-valid.test/mcp', {
    method,
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
    body: method === 'POST' ? JSON.stringify(body) : undefined
});

const call = async (body, method) => index.fetch(rpc(body, method), {}, {});

describe('MCP endpoint', () => {
    let originalFetch;

    beforeEach(() => {
        originalFetch = global.fetch;
        global.fetch = async (url) => {
            const u = url.toString();
            if (u.includes('cloudflare-dns.com')) {
                return new Response(JSON.stringify({ Answer: [{ type: 1, data: '93.184.216.34' }] }));
            }
            if (u === 'https://example.com' || u === 'https://example.com/') {
                return new Response('<html lang="en"><head><title>Example</title></head><body><main><p>Some content here.</p></main></body></html>',
                    { status: 200, headers: { 'Content-Type': 'text/html' } });
            }
            return new Response('Not Found', { status: 404 });
        };
    });

    afterEach(() => { global.fetch = originalFetch; });

    it('completes the initialize handshake', async () => {
        const res = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.jsonrpc).toBe('2.0');
        expect(body.id).toBe(1);
        expect(body.result.protocolVersion).toBeTruthy();
        expect(body.result.serverInfo.name).toBe('ai-valid');
        expect(body.result.capabilities.tools).toBeDefined();
    });

    it('lists the audit tool with a usable input schema', async () => {
        const body = await (await call({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json();
        const tool = body.result.tools.find(t => t.name === 'audit_website');
        expect(tool).toBeDefined();
        expect(tool.inputSchema.required).toContain('targetUrl');
        expect(tool.inputSchema.properties.targetUrl.type).toBe('string');
        // The description has to say when to reach for the tool, not just what it is.
        expect(tool.description).toMatch(/Use it when/);
    });

    it('runs an audit through tools/call and returns structured content', async () => {
        const body = await (await call({
            jsonrpc: '2.0', id: 3, method: 'tools/call',
            params: { name: 'audit_website', arguments: { targetUrl: 'https://example.com' } }
        })).json();

        expect(body.result.isError).toBe(false);
        expect(body.result.content[0].text).toContain('AI readiness for https://example.com');
        expect(body.result.content[0].text).toContain('By category:');
        expect(body.result.structuredContent.score.max).toBe(100);
        expect(Array.isArray(body.result.structuredContent.priorities)).toBe(true);
    });

    it('includes every check when format is full', async () => {
        const summary = await (await call({
            jsonrpc: '2.0', id: 4, method: 'tools/call',
            params: { name: 'audit_website', arguments: { targetUrl: 'https://example.com' } }
        })).json();
        const full = await (await call({
            jsonrpc: '2.0', id: 5, method: 'tools/call',
            params: { name: 'audit_website', arguments: { targetUrl: 'https://example.com', format: 'full' } }
        })).json();

        expect(full.result.content[0].text).toContain('All checks:');
        expect(full.result.content[0].text.length).toBeGreaterThan(summary.result.content[0].text.length);
    });

    it('reports a bad target as a tool error the model can correct', async () => {
        const body = await (await call({
            jsonrpc: '2.0', id: 6, method: 'tools/call',
            params: { name: 'audit_website', arguments: { targetUrl: 'not-a-url' } }
        })).json();
        expect(body.result.isError).toBe(true);
        expect(body.result.content[0].text).toContain('Invalid URL');
        expect(body.error).toBeUndefined();
    });

    it('applies the SSRF guard to the MCP entry point as well', async () => {
        const body = await (await call({
            jsonrpc: '2.0', id: 7, method: 'tools/call',
            params: { name: 'audit_website', arguments: { targetUrl: 'http://127.0.0.1/' } }
        })).json();
        expect(body.result.isError).toBe(true);
        expect(body.result.content[0].text).toContain('internal or restricted');
    });

    it('rejects a missing targetUrl as an invalid-params protocol error', async () => {
        const body = await (await call({
            jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'audit_website', arguments: {} }
        })).json();
        expect(body.error.code).toBe(-32602);
    });

    it('rejects an unknown tool', async () => {
        const body = await (await call({
            jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'delete_everything', arguments: {} }
        })).json();
        expect(body.error.code).toBe(-32602);
    });

    it('returns method-not-found for an unknown method', async () => {
        const body = await (await call({ jsonrpc: '2.0', id: 10, method: 'resources/list' })).json();
        expect(body.error.code).toBe(-32601);
    });

    it('answers ping', async () => {
        const body = await (await call({ jsonrpc: '2.0', id: 11, method: 'ping' })).json();
        expect(body.result).toEqual({});
    });

    it('accepts a notification without replying', async () => {
        const res = await call({ jsonrpc: '2.0', method: 'notifications/initialized' });
        expect(res.status).toBe(202);
        expect(await res.text()).toBe('');
    });

    it('handles a batch, dropping notifications from the reply', async () => {
        const res = await call([
            { jsonrpc: '2.0', id: 'a', method: 'ping' },
            { jsonrpc: '2.0', method: 'notifications/initialized' },
            { jsonrpc: '2.0', id: 'b', method: 'tools/list' }
        ]);
        const body = await res.json();
        expect(Array.isArray(body)).toBe(true);
        expect(body.map(m => m.id)).toEqual(['a', 'b']);
    });

    it('rejects a malformed body with a parse error', async () => {
        const res = await index.fetch(new Request('https://ai-valid.test/mcp', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{not json'
        }), {}, {});
        expect(res.status).toBe(400);
        expect((await res.json()).error.code).toBe(-32700);
    });

    it('rejects a message that is not JSON-RPC 2.0', async () => {
        const body = await (await call({ id: 1, method: 'ping' })).json();
        expect(body.error.code).toBe(-32600);
    });

    it('answers GET with 405 and an Allow header, as the transport expects', async () => {
        const res = await call(undefined, 'GET');
        expect(res.status).toBe(405);
        expect(res.headers.get('Allow')).toContain('POST');
    });

    it('matches the tool advertised in its own server card', async () => {
        const card = await (await index.fetch(
            new Request('https://ai-valid.test/.well-known/mcp/server-card.json'), {}, {}
        )).json();
        const listed = await (await call({ jsonrpc: '2.0', id: 12, method: 'tools/list' })).json();

        // The card promised a tool that had no endpoint behind it before.
        expect(card.tools.map(t => t.name)).toEqual(listed.result.tools.map(t => t.name));
    });
});

describe('rate limiting on the public API', () => {
    let originalFetch;

    beforeEach(() => {
        originalFetch = global.fetch;
        global.fetch = async (url) => {
            const u = url.toString();
            if (u.includes('cloudflare-dns.com')) {
                return new Response(JSON.stringify({ Answer: [{ type: 1, data: '93.184.216.34' }] }));
            }
            if (u.startsWith('https://rl-example.com')) {
                return new Response('<html><body>x</body></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
            }
            return new Response('Not Found', { status: 404 });
        };
    });

    afterEach(() => { global.fetch = originalFetch; });

    const auditAs = (ip) => index.fetch(new Request(
        'https://ai-valid.test/api/audit?bypassCache=true&targetUrl=' + encodeURIComponent('https://rl-example.com'),
        { headers: { 'CF-Connecting-IP': ip } }
    ), {}, {});

    it('returns 429 with Retry-After once a caller exceeds the window', async () => {
        const ip = '203.0.113.10';
        let last;
        for (let i = 0; i < 21; i++) last = await auditAs(ip);

        expect(last.status).toBe(429);
        expect(Number(last.headers.get('Retry-After'))).toBeGreaterThan(0);
        expect(last.headers.get('RateLimit-Remaining')).toBe('0');
        expect((await last.json()).error).toContain('Rate limit');
    });

    it('does not penalise a different caller', async () => {
        const ip = '203.0.113.11';
        for (let i = 0; i < 21; i++) await auditAs(ip);
        expect((await auditAs(ip)).status).toBe(429);

        const other = await auditAs('203.0.113.12');
        expect(other.status).toBe(200);
    });
});
