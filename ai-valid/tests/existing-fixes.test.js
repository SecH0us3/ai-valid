import { describe, it, expect } from 'vitest';
import './helpers/rewriter-mock.js';
import index, { lintAgentsJson, probeMcpEndpoint } from '../src/index.js';

const ORIGIN = 'https://example.com';

async function audit(handler) {
    const originalFetch = global.fetch;
    global.fetch = async (url, opts = {}) => {
        const u = new URL(url.toString());
        if (u.hostname === 'cloudflare-dns.com') {
            return new Response(JSON.stringify({ Answer: [{ type: 1, data: '93.184.216.34' }] }));
        }
        return (await handler(u, opts)) || new Response('Not Found', { status: 404 });
    };
    try {
        const res = await index.fetch(new Request(`https://localhost/api/audit?targetUrl=${encodeURIComponent(ORIGIN)}`), {}, {});
        return await res.json();
    } finally {
        global.fetch = originalFetch;
    }
}
const find = (data, name) => data.protocols.results.find(c => c.name === name);
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

describe('MCP Server: no false positives from auth walls', () => {
    it('does not treat a WAF 403 on /mcp as a live server', async () => {
        const data = await audit((u) => u.pathname.startsWith('/mcp')
            ? new Response('<html>Access denied</html>', { status: 403, headers: { 'Content-Type': 'text/html' } })
            : null);
        const c = find(data, 'MCP Server');
        expect(c.status).toBe('err');
        expect(c.code).toBe('Missing');
    });

    it('warns, not passes, on a 401 without a Bearer challenge', async () => {
        const data = await audit((u) => u.pathname === '/mcp'
            ? new Response('{"error":"unauthorized token"}', { status: 401, headers: { 'Content-Type': 'application/json' } })
            : null);
        const c = find(data, 'MCP Server');
        expect(c.status).toBe('warn');
        expect(c.code).toBe('Protected');
        expect(c.message).toMatch(/without an OAuth Bearer challenge/);
    });

    it('accepts a JSON-RPC error as proof of a live server', async () => {
        const data = await audit((u, opts) => u.pathname === '/mcp' && opts.method === 'POST'
            ? json({ jsonrpc: '2.0', id: 1, error: { code: -32002, message: 'Server not initialized' } }, 400)
            : null);
        const c = find(data, 'MCP Server');
        expect(c.status).toBe('ok');
        expect(c.code).toBe('Live & Operational');
    });

    it('does not treat arbitrary JSON as MCP', async () => {
        const res = await probeMcpEndpoint('https://example.com/mcp', async () => json({ ok: true }));
        expect(res).toBeNull();
    });

    it('flags RFC 9728 resource metadata in the Bearer challenge', async () => {
        const res = await probeMcpEndpoint('https://example.com/mcp', async () =>
            new Response(null, { status: 401, headers: { 'WWW-Authenticate': 'Bearer realm="mcp", resource_metadata="https://example.com/.well-known/oauth-protected-resource"' } }));
        expect(res).toEqual({ kind: 'oauth', resourceMetadata: true });
    });
});

describe('AI Plugin is legacy and unscored', () => {
    it('passes when absent and carries no weight', async () => {
        const data = await audit(() => null);
        const c = find(data, 'AI Plugin');
        expect(c.status).toBe('ok');
        expect(c.code).toBe('Not Needed');
    });

    it('reports a present manifest as legacy', async () => {
        const data = await audit((u) => u.pathname === '/.well-known/ai-plugin.json'
            ? json({ schema_version: 'v1', name_for_model: 'x', api: { type: 'openapi', url: '/openapi.yaml' } })
            : null);
        const c = find(data, 'AI Plugin');
        expect(c.status).toBe('warn');
        expect(c.code).toBe('Legacy');
    });
});

describe('agents.json follows the Wildcard spec', () => {
    const valid = {
        agentsJson: '0.1.0',
        info: { title: 'T', version: '1', description: 'd' },
        sources: [{ id: 'api', path: 'https://x/openapi.json' }],
        flows: [{ id: 'f', actions: [{ id: 'a', sourceId: 'api', operationId: 'op' }] }],
    };

    it('accepts a complete document', () => {
        expect(lintAgentsJson(valid)).toMatchObject({ status: 'ok', code: 'Compliant' });
    });

    it('flags the old ad-hoc capabilities format as non-standard', () => {
        expect(lintAgentsJson({ name: 'x', version: '1', capabilities: [] })).toMatchObject({ status: 'warn', code: 'Non-standard' });
    });

    it('reports missing pieces', () => {
        const r = lintAgentsJson({ ...valid, sources: [{ id: 'api' }], flows: [] });
        expect(r.status).toBe('warn');
        expect(r.message).toMatch(/every source needs id and path/);
        expect(r.message).toMatch(/no "flows"/);
    });

    it('our own agents.json is compliant', async () => {
        const res = await index.fetch(new Request('https://localhost/.well-known/agents.json'), {}, {});
        expect(lintAgentsJson(await res.json()).status).toBe('ok');
    });
});

describe('review regressions (round 2)', () => {
    it('counts a truncated, oversized tools/list reply as live', async () => {
        const tools = Array.from({ length: 3000 }, (_, i) => ({ name: `tool_${i}`, description: 'x'.repeat(80), inputSchema: { type: 'object' } }));
        const big = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools } });
        expect(big.length).toBeGreaterThan(256 * 1024);
        const res = await probeMcpEndpoint('https://example.com/mcp', async (_u, opts) => opts.method === 'POST'
            ? new Response(big, { headers: { 'Content-Type': 'application/json' } })
            : new Response(null, { status: 405 }));
        expect(res.kind).toBe('live');
        expect(res.tools).toBeGreaterThan(0);
    });

    it('ignores "Bearer" inside a quoted realm', async () => {
        const res = await probeMcpEndpoint('https://example.com/mcp', async () =>
            new Response(null, { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="Login, Bearer tokens not accepted"' } }));
        expect(res).toEqual({ kind: 'auth' });
    });

    it('accepts a second challenge that is Bearer', async () => {
        const res = await probeMcpEndpoint('https://example.com/mcp', async () =>
            new Response(null, { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="x", Bearer resource_metadata="https://e/x"' } }));
        expect(res.kind).toBe('oauth');
    });

    it('recognises a JSON-RPC error on a 404 (missing session)', async () => {
        const res = await probeMcpEndpoint('https://example.com/mcp', async (_u, opts) => opts.method === 'POST'
            ? json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Session not found' } }, 404)
            : new Response(null, { status: 405 }));
        expect(res.kind).toBe('live');
    });

    it('resolves relative card endpoints against the card URL', async () => {
        const seen = [];
        const data = await audit((u, opts) => {
            seen.push(u.pathname);
            if (u.pathname === '/.well-known/mcp/server-card.json') {
                const r = json({ serverInfo: { name: 'x' }, endpoints: { http: 'rpc' } });
                Object.defineProperty(r, 'url', { value: u.href });
                return r;
            }
            if (u.pathname === '/.well-known/mcp/rpc' && opts.method === 'POST') return json({ jsonrpc: '2.0', id: 1, result: { tools: [] } });
            return null;
        });
        expect(seen).toContain('/.well-known/mcp/rpc');
        expect(find(data, 'MCP Server').code).toBe('Live & Operational');
    });

    it('treats a catch-all 200 at ai-plugin.json as no manifest', async () => {
        const data = await audit((u) => u.pathname === '/.well-known/ai-plugin.json' ? json({ error: 'not found' }) : null);
        const c = find(data, 'AI Plugin');
        expect(c).toMatchObject({ status: 'ok', code: 'Not Needed', legacy: true });
        expect(c.advisory).toBeUndefined();
    });

    it('rejects agents.json actions without operationId or with unknown sources', () => {
        const base = { agentsJson: '0.1.0', info: { title: 'T', version: '1', description: 'd' }, sources: [{ id: 'api', path: '/o.json' }] };
        expect(lintAgentsJson({ ...base, flows: [{ id: 'f', actions: [{}] }] }).message).toMatch(/sourceId and operationId/);
        expect(lintAgentsJson({ ...base, flows: [{ id: 'f', actions: [{ sourceId: 'nope', operationId: 'x' }] }] }).message).toMatch(/undeclared sources: nope/);
    });

    it('serves agents.json pointing at the current origin', async () => {
        const res = await index.fetch(new Request('https://preview.example.dev/.well-known/agents.json'), {}, {});
        expect((await res.json()).sources[0].path).toBe('https://preview.example.dev/openapi.json');
    });
});
