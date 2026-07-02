import { describe, it, expect } from 'vitest';
import index from '../src/index.js';

class HTMLRewriterMock {
    constructor() {
        this.selectors = [];
    }
    on(selector, handlers) {
        this.selectors.push({ selector, handlers });
        return this;
    }
    transform(response) {
        return {
            text: async () => {
                const htmlText = await response.text();
                const parser = new DOMParser();
                const doc = parser.parseFromString(htmlText, 'text/html');
                
                const traverse = (node) => {
                    let endTagCallbacks = [];
                    
                    if (node.nodeType === 1) { // Element node
                        for (const { selector, handlers } of this.selectors) {
                            if (selector !== '*' && node.matches(selector)) {
                                if (handlers.element) {
                                    handlers.element({
                                        getAttribute(name) {
                                            return node.getAttribute(name);
                                        },
                                        onEndTag(cb) {
                                            endTagCallbacks.push(cb);
                                        }
                                    });
                                }
                                if (handlers.text) {
                                    handlers.text({
                                        text: node.textContent,
                                        lastInTextNode: true
                                    });
                                }
                            }
                        }
                    }
                    
                    // Visit children
                    for (const child of node.childNodes) {
                        traverse(child);
                    }
                    
                    // Handle * text node
                    if (node.nodeType === 3) { // Text node
                        for (const { selector, handlers } of this.selectors) {
                            if (selector === '*' && handlers.text) {
                                if (node.nodeValue.includes('[split]')) {
                                    const parts = node.nodeValue.split('[split]');
                                    for (let i = 0; i < parts.length; i++) {
                                        handlers.text({
                                            text: parts[i],
                                            lastInTextNode: i === parts.length - 1
                                        });
                                    }
                                } else {
                                    handlers.text({
                                        text: node.nodeValue,
                                        lastInTextNode: true
                                    });
                                }
                            }
                        }
                    }
                    
                    // Trigger end tags
                    if (node.nodeType === 1) {
                        for (const cb of endTagCallbacks) {
                            cb();
                        }
                    }
                };
                
                traverse(doc.body || doc.documentElement);
                return htmlText;
            }
        };
    }
}

globalThis.HTMLRewriter = HTMLRewriterMock;


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

    it('should return 200 for a valid targetUrl', async () => {
        // Mock DoH response
        const originalFetch = global.fetch;
        global.fetch = async (url, options) => {
            const urlStr = url.toString();
            if (urlStr.includes('cloudflare-dns.com')) {
                return new Response(JSON.stringify({
                    Answer: [{ type: 1, data: '93.184.216.34' }]
                }), { status: 200, headers: { 'Content-Type': 'application/dns-json' } });
            }
            // For example.com we might get requests for robots.txt, sitemap.xml, etc.
            if (urlStr.includes('example.com') || urlStr.includes('93.184.216.34')) {
                return new Response('OK', { status: 200, headers: { 'Content-Type': 'text/html' } });
            }
            return originalFetch(url, options);
        };

        try {
            const req = createRequest({ targetUrl: 'https://example.com' });
            const res = await index.fetch(req, env, ctx);

            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.score).toBeDefined();
        } finally {
            global.fetch = originalFetch;
        }
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

describe('AI-Valid Worker - Content GEO Audits', () => {
    const env = {};
    const ctx = {};

    const runAuditTest = async (htmlContent) => {
        const originalFetch = global.fetch;
        global.fetch = async (url) => {
            const urlStr = url.toString();
            if (urlStr.includes('cloudflare-dns.com')) {
                return new Response(JSON.stringify({ Answer: [{ type: 1, data: '93.184.216.34' }] }));
            }
            if (urlStr.includes('example.com') || urlStr.includes('93.184.216.34')) {
                return new Response(htmlContent, {
                    status: 200,
                    headers: { 'Content-Type': 'text/html' }
                });
            }
            return new Response('Not Found', { status: 404 });
        };

        try {
            const req = new Request('https://localhost/api/audit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetUrl: 'https://example.com' })
            });
            const res = await index.fetch(req, env, ctx);
            expect(res.status).toBe(200);
            return await res.json();
        } finally {
            global.fetch = originalFetch;
        }
    };

    it('should detect Quotation Addition (blockquote and q tags)', async () => {
        const html = `
            <html>
                <body>
                    <blockquote>This is a blockquote quotation.</blockquote>
                    <p>Some text with a <q>short quote</q> here.</p>
                </body>
            </html>
        `;
        const data = await runAuditTest(html);
        const quotationResult = data.content.results.find(r => r.name === 'Quotation Addition');
        expect(quotationResult).toBeDefined();
        expect(quotationResult.status).toBe('ok');
        expect(quotationResult.code).toBe('Found');
    });

    it('should detect Statistics Addition (percentages and currency values)', async () => {
        const html = `
            <html>
                <body>
                    <p>Our revenue grew by 25% this quarter.</p>
                    <p>The product costs $1,500.50.</p>
                    <p>Total amount is GBP 400.</p>
                </body>
            </html>
        `;
        const data = await runAuditTest(html);
        const statisticsResult = data.content.results.find(r => r.name === 'Statistics Addition');
        expect(statisticsResult).toBeDefined();
        expect(statisticsResult.status).toBe('ok');
        expect(statisticsResult.code).toBe('Found');
    });

    it('should flag missing Quotation and Statistics when they are not present', async () => {
        const html = `
            <html>
                <body>
                    <p>This page has generic text with no quotes and no stats.</p>
                </body>
            </html>
        `;
        const data = await runAuditTest(html);
        const quotationResult = data.content.results.find(r => r.name === 'Quotation Addition');
        const statisticsResult = data.content.results.find(r => r.name === 'Statistics Addition');
        expect(quotationResult.status).toBe('warn');
        expect(quotationResult.code).toBe('Missing');
        expect(statisticsResult.status).toBe('warn');
        expect(statisticsResult.code).toBe('Missing');
    });

    it('should ignore statistics inside script, style, and noscript tags to avoid false positives', async () => {
        const html = `
            <html>
                <head>
                    <style>
                        body { width: 100%; height: 80%; }
                    </style>
                    <script>
                        const data = { price: "$500", count: 12 };
                    </script>
                </head>
                <body>
                    <noscript>
                        We have 99% uptime when Javascript is enabled!
                    </noscript>
                    <p>This page has no visible statistics.</p>
                </body>
            </html>
        `;
        const data = await runAuditTest(html);
        const statisticsResult = data.content.results.find(r => r.name === 'Statistics Addition');
        expect(statisticsResult.status).toBe('warn');
        expect(statisticsResult.code).toBe('Missing');
    });

    it('should successfully match statistics split across text chunks (chunking test)', async () => {
        // The [split] marker is handled by HTMLRewriterMock to trigger multiple text chunks
        const html = `
            <html>
                <body>
                    <p>Statistics addition of 50[split]% of respondents.</p>
                </body>
            </html>
        `;
        const data = await runAuditTest(html);
        const statisticsResult = data.content.results.find(r => r.name === 'Statistics Addition');
        expect(statisticsResult.status).toBe('ok');
        expect(statisticsResult.code).toBe('Found');
    });

    it('should detect x402 Payment Standard configuration', async () => {
        const originalFetch = global.fetch;
        global.fetch = async (url) => {
            const urlStr = url.toString();
            if (urlStr.includes('cloudflare-dns.com')) {
                return new Response(JSON.stringify({ Answer: [{ type: 1, data: '93.184.216.34' }] }));
            }
            if (urlStr.includes('.well-known/x402.json')) {
                return new Response(JSON.stringify({
                    x402Version: 2,
                    endpoints: []
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
            if (urlStr.includes('example.com') || urlStr.includes('93.184.216.34')) {
                return new Response('<html></html>', {
                    status: 200,
                    headers: { 'Content-Type': 'text/html' }
                });
            }
            return new Response('Not Found', { status: 404 });
        };

        try {
            const req = new Request('https://localhost/api/audit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetUrl: 'https://example.com' })
            });
            const res = await index.fetch(req, env, ctx);
            expect(res.status).toBe(200);
            const data = await res.json();
            const x402Result = data.protocols.results.find(r => r.name === 'x402 Payment Standard');
            expect(x402Result).toBeDefined();
            expect(x402Result.status).toBe('ok');
            expect(x402Result.message).toBe('Valid JSON found');
            expect(x402Result.code).toBe(200);
        } finally {
            global.fetch = originalFetch;
        }
    });
});

