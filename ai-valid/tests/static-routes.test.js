import { describe, it, expect } from 'vitest';
import index from '../src/index.js';

describe('AI-Valid Worker - Static GET Routes', () => {
    const env = {};
    const ctx = {};

    const testRoute = async (path, expectedContentType, acceptHeader = '') => {
        const headers = {};
        if (acceptHeader) {
            headers['Accept'] = acceptHeader;
        }
        const req = new Request(`https://localhost${path}`, {
            method: 'GET',
            headers: headers
        });
        const res = await index.fetch(req, env, ctx);

        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toBe(expectedContentType);
        expect(res.headers.get('Cache-Control')).toBe('public, max-age=86400, stale-while-revalidate=604800');
        if (path === '/') {
            expect(res.headers.get('Vary')).toBe('Accept');
        }
    };

    it('should serve HTML for / by default', async () => {
        await testRoute('/', 'text/html; charset=utf-8');
    });

    it('should serve Markdown for / when Accept header is text/markdown', async () => {
        await testRoute('/', 'text/markdown; charset=utf-8', 'text/markdown');
    });

    it('should serve CSS for /style.css', async () => {
        await testRoute('/style.css', 'text/css; charset=utf-8');
    });

    it('should serve JavaScript for /app.client.js', async () => {
        await testRoute('/app.client.js', 'application/javascript; charset=utf-8');
    });

    it('should serve SVG for /favicon.svg', async () => {
        await testRoute('/favicon.svg', 'image/svg+xml');
    });

    it('should serve SVG for /favicon.ico', async () => {
        await testRoute('/favicon.ico', 'image/svg+xml');
    });

    it('should serve PNG for /og-image.png', async () => {
        await testRoute('/og-image.png', 'image/png');
    });

    it('should serve Markdown for /llms-full.txt', async () => {
        await testRoute('/llms-full.txt', 'text/markdown; charset=utf-8');
    });

    it('should serve Markdown for /llms.txt', async () => {
        await testRoute('/llms.txt', 'text/markdown; charset=utf-8');
    });

    it('should serve JSON for /openapi.json', async () => {
        await testRoute('/openapi.json', 'application/json; charset=utf-8');
    });

    it('should serve Text for /.well-known/api-catalog', async () => {
        await testRoute('/.well-known/api-catalog', 'text/plain; charset=utf-8');
    });

    it('should serve JSON for /.well-known/tdmrep.json', async () => {
        await testRoute('/.well-known/tdmrep.json', 'application/json; charset=utf-8');
    });

    it('should serve JSON for /policies/tdm-policy.json', async () => {
        await testRoute('/policies/tdm-policy.json', 'application/json; charset=utf-8');
    });

    it('should serve JSON for /.well-known/agent-skills/index.json', async () => {
        const req = new Request('https://localhost/.well-known/agent-skills/index.json', { method: 'GET' });
        const res = await index.fetch(req, env, ctx);
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
        expect(res.headers.get('Cache-Control')).toBe('public, max-age=86400, stale-while-revalidate=604800');
        const body = await res.json();
        expect(body.skills[0].method).toBe('GET');
    });

    it('should serve JSON for /.well-known/x402.json', async () => {
        const req = new Request('https://localhost/.well-known/x402.json', { method: 'GET' });
        const res = await index.fetch(req, env, ctx);
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
        expect(res.headers.get('Cache-Control')).toBe('public, max-age=86400, stale-while-revalidate=604800');
        const body = await res.json();
        expect(body.x402Version).toBe(2);
    });

    it('should serve Text for /.well-known/security.txt', async () => {
        const req = new Request('https://localhost/.well-known/security.txt', { method: 'GET' });
        const res = await index.fetch(req, env, ctx);
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
        expect(res.headers.get('Cache-Control')).toBe('public, max-age=86400, stale-while-revalidate=604800');
        const text = await res.text();
        expect(text).toContain('Contact:');
    });

    it('should serve Text for /robots.txt', async () => {
        const req = new Request('https://localhost/robots.txt', { method: 'GET' });
        const res = await index.fetch(req, env, ctx);
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
        expect(res.headers.get('Cache-Control')).toBe('public, max-age=86400, stale-while-revalidate=604800');
        const text = await res.text();
        expect(text).toContain('User-agent:');
    });

    it('should serve JSON for /.well-known/mcp/server-card.json', async () => {
        const req = new Request('https://localhost/.well-known/mcp/server-card.json', { method: 'GET' });
        const res = await index.fetch(req, env, ctx);
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
        const body = await res.json();
        expect(body.serverInfo.name).toBe('ai-valid-mcp');
    });

    it('should serve JSON for /.well-known/agent-card.json', async () => {
        const req = new Request('https://localhost/.well-known/agent-card.json', { method: 'GET' });
        const res = await index.fetch(req, env, ctx);
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
        const body = await res.json();
        expect(body.name).toBe('AI-Valid Auditor');
    });

    it('should serve Markdown for /AGENTS.md and /.well-known/agents.md', async () => {
        const req1 = new Request('https://localhost/AGENTS.md', { method: 'GET' });
        const res1 = await index.fetch(req1, env, ctx);
        expect(res1.status).toBe(200);
        expect(res1.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
        const text1 = await res1.text();
        expect(text1).toContain('# AGENTS.md');

        const req2 = new Request('https://localhost/.well-known/agents.md', { method: 'GET' });
        const res2 = await index.fetch(req2, env, ctx);
        expect(res2.status).toBe(200);
        expect(res2.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
        const text2 = await res2.text();
        expect(text2).toContain('# AGENTS.md');
    });

    it('should serve JSON for /.well-known/agents.json', async () => {
        const req = new Request('https://localhost/.well-known/agents.json', { method: 'GET' });
        const res = await index.fetch(req, env, ctx);
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
        const body = await res.json();
        expect(body.name).toBe('ai-valid-agent');
        expect(Array.isArray(body.capabilities)).toBe(true);
    });

    it('should respond to OPTIONS request with CORS headers', async () => {
        const req = new Request('https://localhost/api/audit', { method: 'OPTIONS' });
        const res = await index.fetch(req, env, ctx);
        expect(res.status).toBe(200);
        expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
        expect(res.headers.get('Access-Control-Allow-Methods')).toBe('GET, HEAD, POST, OPTIONS');
        expect(res.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type, Accept');
    });

    it('should include CORS headers on static files and API responses', async () => {
        const req = new Request('https://localhost/style.css', { method: 'GET' });
        const res = await index.fetch(req, env, ctx);
        expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    describe("Share routes", () => {
        it("should serve HTML for /share", async () => {
            const req = new Request("https://localhost/share?domain=example.com&passed=10&warn=5&fail=2", { method: 'GET' });
            const res = await index.fetch(req, env, ctx);
            expect(res.status).toBe(200);
            expect(res.headers.get('Content-Type')).toContain('text/html');
            const html = await res.text();
            expect(html).toContain('og:image');
            expect(html).toContain('/api/og-image');
        });

        it("should serve SVG for /api/og-image", async () => {
            const req = new Request("https://localhost/api/og-image?domain=example.com&passed=10&warn=5&fail=2", { method: 'GET' });
            const res = await index.fetch(req, env, ctx);
            expect(res.status).toBe(200);
            expect(res.headers.get("Content-Type")).toBe("image/svg+xml");
            const svg = await res.text();
            expect(svg).toContain('<svg');
            expect(svg).toContain('example.com');
        });
    });
});
