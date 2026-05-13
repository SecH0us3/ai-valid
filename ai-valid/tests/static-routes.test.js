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
        await testRoute('/.well-known/agent-skills/index.json', 'application/json; charset=utf-8');
    });
});
