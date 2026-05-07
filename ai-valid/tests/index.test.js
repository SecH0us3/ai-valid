import { describe, it, expect } from 'vitest';
import index from '../src/index.js';

describe('AI-Valid Worker - handleRequest API URL Validation', () => {

    // helper to create a mocked request
    const createRequest = (body) => {
        return new Request('https://localhost/api/audit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined
        });
    };

    const env = {};
    const ctx = {};

    it('should return 400 if targetUrl is missing', async () => {
        const req = createRequest({});
        const res = await index.fetch(req, env, ctx);

        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toBe('Invalid URL');
    });

    it('should return 400 if targetUrl is empty', async () => {
        const req = createRequest({ targetUrl: '' });
        const res = await index.fetch(req, env, ctx);

        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toBe('Invalid URL');
    });

    it('should return 400 if targetUrl does not start with http', async () => {
        const req = createRequest({ targetUrl: 'ftp://example.com' });
        const res = await index.fetch(req, env, ctx);

        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toBe('Invalid URL');
    });

    it('should return 400 if targetUrl is just a string without http', async () => {
        const req = createRequest({ targetUrl: 'example.com' });
        const res = await index.fetch(req, env, ctx);

        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toBe('Invalid URL');
    });

    it('should catch JSON parsing errors and return 500', async () => {
        const req = new Request('https://localhost/api/audit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: 'invalid json {'
        });
        const res = await index.fetch(req, env, ctx);

        expect(res.status).toBe(500);
        const data = await res.json();
        expect(data.error).toBeDefined(); // should be an error message like "Unexpected token"
    });
});

describe('AI-Valid Worker - 404 Not Found', () => {
    const env = {};
    const ctx = {};

    it('should return 404 for unknown GET path', async () => {
        const req = new Request('https://localhost/non-existent-path', {
            method: 'GET'
        });
        const res = await index.fetch(req, env, ctx);

        expect(res.status).toBe(404);
        const text = await res.text();
        expect(text).toBe('Not Found');
    });

    it('should return 404 for POST request to root', async () => {
        const req = new Request('https://localhost/', {
            method: 'POST'
        });
        const res = await index.fetch(req, env, ctx);

        expect(res.status).toBe(404);
        const text = await res.text();
        expect(text).toBe('Not Found');
    });

    it('should return 404 for GET request to /api/audit', async () => {
        const req = new Request('https://localhost/api/audit', {
            method: 'GET'
        });
        const res = await index.fetch(req, env, ctx);

        expect(res.status).toBe(404);
        const text = await res.text();
        expect(text).toBe('Not Found');
    });
});
