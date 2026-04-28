import { test } from 'node:test';
import assert from 'node:assert';
import { performAudit } from './audit.js';

test('performAudit handles robots.txt fetch error gracefully', async (t) => {
    // Mock global fetch
    const originalFetch = global.fetch;
    global.fetch = async (url) => {
        if (url.endsWith('/robots.txt')) {
            throw new Error('Network error');
        }
        return {
            status: 404,
            headers: new Map(),
            text: async () => ''
        };
    };

    // Mock Response and Request if they don't exist in the environment
    if (typeof global.Response === 'undefined') {
        global.Response = class {
            constructor(body, init) {
                this.body = body;
                this.status = init?.status || 200;
                this.headers = new Map(Object.entries(init?.headers || {}));
            }
            async json() { return JSON.parse(this.body); }
            async text() { return this.body; }
        };
    }
    if (typeof global.Request === 'undefined') {
        global.Request = class {
            constructor(url, init) {
                this.url = url;
                this.method = init?.method || 'GET';
                this.headers = new Map(Object.entries(init?.headers || {}));
            }
        };
    }

    const mockHandleRequest = async () => {
        return {
            status: 404,
            headers: new Map(),
            text: async () => ''
        };
    };

    try {
        const result = await performAudit('https://example.com', 'https://auditor.com', {}, {}, mockHandleRequest);

        assert.strictEqual(result.bots.robotsFound, false, 'robotsFound should be false on fetch error');
        assert.strictEqual(result.bots.hasAI, false, 'hasAI should be false on fetch error');

        const robotsResult = result.bots.results.find(r => r.name === 'robots.txt');
        assert.strictEqual(robotsResult.status, 'err', 'robots.txt status should be err');

        const aiDirectivesResult = result.bots.results.find(r => r.name === 'AI Directives');
        assert.strictEqual(aiDirectivesResult.status, 'warn', 'AI Directives status should be warn');

    } finally {
        global.fetch = originalFetch;
    }
});
