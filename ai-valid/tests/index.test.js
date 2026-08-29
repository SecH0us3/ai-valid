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
        const execute = async () => {
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
            
            traverse(doc.documentElement);
            return htmlText;
        };

        return {
            text: execute,
            arrayBuffer: async () => {
                const text = await execute();
                return new TextEncoder().encode(text).buffer;
            },
            body: {
                getReader() {
                    let done = false;
                    return {
                        read: async () => {
                            if (done) {
                                return { done: true, value: undefined };
                            }
                            done = true;
                            const text = await execute();
                            return {
                                done: false,
                                value: new TextEncoder().encode(text)
                            };
                        },
                        releaseLock() {},
                        cancel: async () => {}
                    };
                }
            }
        };
    }
}

globalThis.HTMLRewriter = HTMLRewriterMock;


describe('AI-Valid Worker - handleRequest API URL Validation', () => {

    it('HTMLRewriterMock should support arrayBuffer method', async () => {
        const mock = new HTMLRewriterMock();
        const response = new Response("<html>hello</html>");
        const transformResult = mock.transform(response);
        expect(typeof transformResult.arrayBuffer).toBe('function');
        const buffer = await transformResult.arrayBuffer();
        expect(buffer.byteLength).toBe(18);
    });

    it('HTMLRewriterMock should support body stream reading', async () => {
        const mock = new HTMLRewriterMock();
        const response = new Response("<html>hello</html>");
        const transformResult = mock.transform(response);
        expect(transformResult.body).toBeDefined();
        expect(typeof transformResult.body.getReader).toBe('function');
        const reader = transformResult.body.getReader();
        const { done, value } = await reader.read();
        expect(done).toBe(false);
        expect(new TextDecoder().decode(value)).toBe("<html>hello</html>");
        const next = await reader.read();
        expect(next.done).toBe(true);
    });

    // helper to create a mocked request
    const createRequest = (params) => {
        const query = params && params.targetUrl !== undefined ? `?targetUrl=${encodeURIComponent(params.targetUrl)}` : '';
        return new Request(`https://localhost/api/audit${query}`, {
            method: 'GET'
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
            expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600, stale-while-revalidate=86400');
            const data = await res.json();
            expect(data.score.total).toBeDefined();
            expect(data.score.max).toBe(100);
        } finally {
            global.fetch = originalFetch;
        }
    });

    it('should return no-store for bypassCache=true query parameter', async () => {
        const originalFetch = global.fetch;
        global.fetch = async (url, options) => {
            const urlStr = url.toString();
            if (urlStr.includes('cloudflare-dns.com')) {
                return new Response(JSON.stringify({
                    Answer: [{ type: 1, data: '93.184.216.34' }]
                }), { status: 200, headers: { 'Content-Type': 'application/dns-json' } });
            }
            if (urlStr.includes('example.com') || urlStr.includes('93.184.216.34')) {
                return new Response('OK', { status: 200, headers: { 'Content-Type': 'text/html' } });
            }
            return originalFetch(url, options);
        };

        try {
            const req = new Request('https://localhost/api/audit?targetUrl=https%3A%2F%2Fexample.com&bypassCache=true', {
                method: 'GET'
            });
            const res = await index.fetch(req, env, ctx);

            expect(res.status).toBe(200);
            expect(res.headers.get('Cache-Control')).toBe('no-store, no-cache, must-revalidate');
        } finally {
            global.fetch = originalFetch;
        }
    });

    it('should return no-store for Cache-Control: no-cache request header', async () => {
        const originalFetch = global.fetch;
        global.fetch = async (url, options) => {
            const urlStr = url.toString();
            if (urlStr.includes('cloudflare-dns.com')) {
                return new Response(JSON.stringify({
                    Answer: [{ type: 1, data: '93.184.216.34' }]
                }), { status: 200, headers: { 'Content-Type': 'application/dns-json' } });
            }
            if (urlStr.includes('example.com') || urlStr.includes('93.184.216.34')) {
                return new Response('OK', { status: 200, headers: { 'Content-Type': 'text/html' } });
            }
            return originalFetch(url, options);
        };

        try {
            const req = new Request('https://localhost/api/audit?targetUrl=https%3A%2F%2Fexample.com', {
                method: 'GET',
                headers: { 'Cache-Control': 'no-cache' }
            });
            const res = await index.fetch(req, env, ctx);

            expect(res.status).toBe(200);
            expect(res.headers.get('Cache-Control')).toBe('no-store, no-cache, must-revalidate');
        } finally {
            global.fetch = originalFetch;
        }
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

    it('should return 404 for POST request to /api/audit', async () => {
        const req = new Request('https://localhost/api/audit', {
            method: 'POST'
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
            const req = new Request('https://localhost/api/audit?targetUrl=' + encodeURIComponent('https://example.com'), {
                method: 'GET'
            });
            const res = await index.fetch(req, env, ctx);
            expect(res.status).toBe(200);
            expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600, stale-while-revalidate=86400');
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

    it('should correctly detect statistics when separated by inline HTML tags', async () => {
        const originalFetch = global.fetch;
        global.fetch = async (url) => {
            const urlStr = url.toString();
            if (urlStr.includes('cloudflare-dns.com')) {
                return new Response(JSON.stringify({ Answer: [{ type: 1, data: '93.184.216.34' }] }));
            }
            if (urlStr.includes('robots.txt') || urlStr.includes('sitemap.xml')) {
                return new Response('Not Found', { status: 404 });
            }
            if (urlStr.includes('example.com') || urlStr.includes('93.184.216.34')) {
                return new Response('<html><body>Only <span>99</span>% of users succeeded!</body></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
            }
            return new Response('Not Found', { status: 404 });
        };
        try {
            const req = new Request('https://localhost/api/audit?targetUrl=' + encodeURIComponent('https://example.com'), {
                method: 'GET'
            });
            const res = await index.fetch(req, {}, {});
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.content.hasStatistics).toBe(true);
        } finally {
            global.fetch = originalFetch;
        }
    });

    it('should detect ARIA Accessibility attributes', async () => {
        const html = `
            <html>
                <body>
                    <div aria-label="Menu" role="navigation"></div>
                    <button aria-labelledby="button-label"></button>
                </body>
            </html>
        `;
        const data = await runAuditTest(html);
        const ariaResult = data.content.results.find(r => r.name === 'ARIA Accessibility');
        expect(ariaResult).toBeDefined();
        expect(ariaResult.status).toBe('ok');
        expect(ariaResult.code).toBe('Found');
    });

    it('should detect Meta Description and Open Graph descriptions', async () => {
        const htmlDesc = `<html><head><meta name="description" content="A valid description"></head><body></body></html>`;
        const htmlOgDesc = `<html><head><meta property="og:description" content="A valid og description"></head><body></body></html>`;
        const htmlOgImageOnly = `<html><head><meta property="og:image" content="image.png"></head><body></body></html>`;
        
        let data = await runAuditTest(htmlDesc);
        let metaResult = data.content.results.find(r => r.name === 'Meta Description');
        expect(metaResult.status).toBe('ok');
        expect(metaResult.code).toBe('Found');

        data = await runAuditTest(htmlOgDesc);
        metaResult = data.content.results.find(r => r.name === 'Meta Description');
        expect(metaResult.status).toBe('ok');
        expect(metaResult.code).toBe('Found');

        // Should ignore og:image
        data = await runAuditTest(htmlOgImageOnly);
        metaResult = data.content.results.find(r => r.name === 'Meta Description');
        expect(metaResult.status).toBe('warn');
        expect(metaResult.code).toBe('Missing');
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
            const req = new Request('https://localhost/api/audit?targetUrl=' + encodeURIComponent('https://example.com'), {
                method: 'GET'
            });
            const res = await index.fetch(req, env, ctx);
            expect(res.status).toBe(200);
            expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600, stale-while-revalidate=86400');
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

    describe('AI-Valid Worker - Cloudflare Smart Search & Bot Policies', () => {
        const env = {};
        const ctx = {};

        it('should evaluate robots.txt and sitemap correctly (differentiated policy & sitemap lastmod)', async () => {
            const originalFetch = global.fetch;
            global.fetch = async (url, options) => {
                const urlStr = url.toString();
                if (urlStr.includes('cloudflare-dns.com')) {
                    return new Response(JSON.stringify({ Answer: [{ type: 1, data: '93.184.216.34' }] }));
                }
                if (urlStr.includes('/robots.txt')) {
                    return new Response(
                        `User-agent: OAI-SearchBot\nAllow: /\n` +
                        `User-agent: ChatGPT-User\nAllow: /\n` +
                        `User-agent: GPTBot\nDisallow: /\n` +
                        `User-agent: ClaudeBot\nDisallow: /\n` +
                        `User-agent: Google-Extended\nDisallow: /\n` +
                        `User-agent: Amazonbot\nDisallow: /\n` +
                        `User-agent: cohere-ai\nDisallow: /\n` +
                        `User-agent: applebot-extended\nDisallow: /\n` +
                        `Content-Signal: search=yes, ai-train=no, use=reference\n` +
                        `Sitemap: https://example.com/sitemap.xml`,
                        { status: 200 }
                    );
                }
                if (urlStr.includes('/sitemap.xml')) {
                    return new Response(
                        `<urlset><url><loc>https://example.com/</loc><lastmod>2026-07-02</lastmod></url></urlset>`,
                        { status: 200 }
                    );
                }
                if (urlStr.includes('example.com') || urlStr.includes('93.184.216.34')) {
                    return new Response('<html></html>', {
                        status: 200,
                        headers: { 
                            'Content-Type': 'text/html',
                            'ETag': '"abc12345"',
                            'Last-Modified': 'Wed, 01 Jul 2026 12:00:00 GMT'
                        }
                    });
                }
                return new Response('Not Found', { status: 404 });
            };

            try {
                const req = new Request('https://localhost/api/audit?targetUrl=' + encodeURIComponent('https://example.com'), {
                    method: 'GET'
                });
                const res = await index.fetch(req, env, ctx);
                expect(res.status).toBe(200);
                expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600, stale-while-revalidate=86400');
                const data = await res.json();
                
                // Check bots
                expect(data.bots.robotsFound).toBe(true);
                expect(data.bots.hasAISearch).toBe(true);
                expect(data.bots.hasAIAgent).toBe(true);
                expect(data.bots.hasAITrainingBlocked).toBe(true);
                expect(data.bots.hasDifferentiatedPolicy).toBe(true);
                expect(data.bots.sitemapFound).toBe(true);
                expect(data.bots.hasSitemapLastmod).toBe(true);

                // Check Content-Signal and freshness
                expect(data.content.hasContentSignal).toBe(true);
                expect(data.content.hasContentUse).toBe(true);
                expect(data.content.hasFreshnessHeaders).toBe(true);
            } finally {
                global.fetch = originalFetch;
            }
        });

        it('should support Conditional GET resulting in 304 Not Modified', async () => {
            const originalFetch = global.fetch;
            global.fetch = async (url, options) => {
                const urlStr = url.toString();
                if (urlStr.includes('cloudflare-dns.com')) {
                    return new Response(JSON.stringify({ Answer: [{ type: 1, data: '93.184.216.34' }] }));
                }
                if (urlStr.includes('robots.txt') || urlStr.includes('sitemap.xml')) {
                    return new Response('Not Found', { status: 404 });
                }
                if (urlStr.includes('example.com') || urlStr.includes('93.184.216.34')) {
                    const reqHeaders = new Headers(options?.headers);
                    if (reqHeaders.get('if-none-match') === '"abc12345"') {
                        return new Response(null, { status: 304 });
                    }
                    return new Response('<html></html>', {
                        status: 200,
                        headers: { 
                            'Content-Type': 'text/html',
                            'ETag': '"abc12345"'
                        }
                    });
                }
                return new Response('Not Found', { status: 404 });
            };

            try {
                const req = new Request('https://localhost/api/audit?targetUrl=' + encodeURIComponent('https://example.com'), {
                    method: 'GET'
                });
                const res = await index.fetch(req, env, ctx);
                expect(res.status).toBe(200);
                expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600, stale-while-revalidate=86400');
                const data = await res.json();
                
                expect(data.content.hasFreshnessHeaders).toBe(true);
                expect(data.content.hasConditionalGET).toBe(true);
            } finally {
                global.fetch = originalFetch;
            }
        });

        it('should handle missing sitemap lastmod or invalid lastmod dates', async () => {
            const originalFetch = global.fetch;
            global.fetch = async (url) => {
                const urlStr = url.toString();
                if (urlStr.includes('cloudflare-dns.com')) {
                    return new Response(JSON.stringify({ Answer: [{ type: 1, data: '93.184.216.34' }] }));
                }
                if (urlStr.includes('robots.txt')) {
                    return new Response('User-agent: *\nDisallow:', { status: 200 });
                }
                if (urlStr.includes('sitemap.xml')) {
                    return new Response('<urlset><url><loc>https://example.com/</loc><lastmod>invalid-date</lastmod></url></urlset>', { status: 200 });
                }
                if (urlStr.includes('example.com') || urlStr.includes('93.184.216.34')) {
                    return new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
                }
                return new Response('Not Found', { status: 404 });
            };

            try {
                const req = new Request('https://localhost/api/audit?targetUrl=' + encodeURIComponent('https://example.com'), {
                    method: 'GET'
                });
                const res = await index.fetch(req, env, ctx);
                expect(res.status).toBe(200);
                expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600, stale-while-revalidate=86400');
                const data = await res.json();
                
                expect(data.bots.sitemapFound).toBe(true);
                expect(data.bots.hasSitemapLastmod).toBe(false);
            } finally {
                global.fetch = originalFetch;
            }
        });

        it('should handle robots.txt with consecutive user agent blocks correctly', async () => {
            const originalFetch = global.fetch;
            global.fetch = async (url) => {
                const urlStr = url.toString();
                if (urlStr.includes('cloudflare-dns.com')) {
                    return new Response(JSON.stringify({ Answer: [{ type: 1, data: '93.184.216.34' }] }));
                }
                if (urlStr.includes('robots.txt')) {
                    return new Response('User-agent: GPTBot\nUser-agent: ClaudeBot\nUser-agent: Google-Extended\nUser-agent: Amazonbot\nUser-agent: cohere-ai\nUser-agent: applebot-extended\nDisallow: /\nUser-agent: PerplexityBot\nAllow: /', { status: 200 });
                }
                if (urlStr.includes('sitemap.xml')) {
                    return new Response('Not Found', { status: 404 });
                }
                if (urlStr.includes('example.com') || urlStr.includes('93.184.216.34')) {
                    return new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
                }
                return new Response('Not Found', { status: 404 });
            };

            try {
                const req = new Request('https://localhost/api/audit?targetUrl=' + encodeURIComponent('https://example.com'), {
                    method: 'GET'
                });
                const res = await index.fetch(req, env, ctx);
                expect(res.status).toBe(200);
                expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600, stale-while-revalidate=86400');
                const data = await res.json();
                
                expect(data.bots.hasAISearch).toBe(true);
                expect(data.bots.hasAITrainingBlocked).toBe(true);
                expect(data.bots.hasDifferentiatedPolicy).toBe(true);
            } finally {
                global.fetch = originalFetch;
            }
        });

        it('should handle site refusing conditional GET (returning 200 instead of 304)', async () => {
            const originalFetch = global.fetch;
            global.fetch = async (url, options) => {
                const urlStr = url.toString();
                if (urlStr.includes('cloudflare-dns.com')) {
                    return new Response(JSON.stringify({ Answer: [{ type: 1, data: '93.184.216.34' }] }));
                }
                if (urlStr.includes('robots.txt') || urlStr.includes('sitemap.xml')) {
                    return new Response('Not Found', { status: 404 });
                }
                if (urlStr.includes('example.com') || urlStr.includes('93.184.216.34')) {
                    return new Response('<html></html>', {
                        status: 200,
                        headers: { 
                            'Content-Type': 'text/html',
                            'ETag': '"abc12345"'
                        }
                    });
                }
                return new Response('Not Found', { status: 404 });
            };

            try {
                const req = new Request('https://localhost/api/audit?targetUrl=' + encodeURIComponent('https://example.com'), {
                    method: 'GET'
                });
                const res = await index.fetch(req, env, ctx);
                expect(res.status).toBe(200);
                expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600, stale-while-revalidate=86400');
                const data = await res.json();
                
                expect(data.content.hasFreshnessHeaders).toBe(true);
                expect(data.content.hasConditionalGET).toBe(false);
            } finally {
                global.fetch = originalFetch;
            }
        });
    });
});

describe('safeReadText helper', () => {
    it('safeReadText should limit reading to maxBytes', async () => {
        const stream = new ReadableStream({
            start(controller) {
                const chunk = new TextEncoder().encode("a".repeat(1024 * 1024)); // 1MB chunk
                controller.enqueue(chunk);
                controller.enqueue(chunk); // 2MB total
                controller.enqueue(chunk); // 3MB total
                controller.close();
            }
        });
        const response = new Response(stream);
        const { safeReadText } = await import('../src/index.js');
        expect(safeReadText).toBeDefined();
        const text = await safeReadText(response, 2 * 1024 * 1024);
        expect(text.length).toBeLessThanOrEqual(2 * 1024 * 1024 + 1024 * 1024);
    });

    it('should limit robots.txt reading to 2MB', async () => {
        const originalFetch = global.fetch;
        global.fetch = async (url) => {
            const urlStr = url.toString();
            if (urlStr.includes('cloudflare-dns.com')) {
                return new Response(JSON.stringify({ Answer: [{ type: 1, data: '93.184.216.34' }] }));
            }
            if (urlStr.includes('robots.txt')) {
                const stream = new ReadableStream({
                    start(controller) {
                        const line = "User-agent: *\nDisallow: /private\n";
                        const repeated = line.repeat(1000); // ~30KB
                        const chunk = new TextEncoder().encode(repeated);
                        for (let i = 0; i < 100; i++) { // 100 chunks * 30KB = ~3MB
                            controller.enqueue(chunk);
                        }
                        controller.close();
                    }
                });
                return new Response(stream, { status: 200 });
            }
            return new Response('Not Found', { status: 404 });
        };
        try {
            const req = new Request('https://localhost/api/audit?targetUrl=' + encodeURIComponent('https://example.com'), {
                method: 'GET'
            });
            const res = await index.fetch(req, {}, {});
            expect(res.status).toBe(200);
        } finally {
            global.fetch = originalFetch;
        }
    });

    it('should resolve relative sitemap URLs correctly', async () => {
        const originalFetch = global.fetch;
        let sitemapFetchedUrl = null;
        global.fetch = async (url) => {
            const urlStr = url.toString();
            if (urlStr.includes('cloudflare-dns.com')) {
                return new Response(JSON.stringify({ Answer: [{ type: 1, data: '93.184.216.34' }] }));
            }
            if (urlStr.includes('robots.txt')) {
                return new Response('User-agent: *\nSitemap: /custom-relative-sitemap.xml', { status: 200 });
            }
            if (urlStr.includes('custom-relative-sitemap.xml')) {
                sitemapFetchedUrl = urlStr;
                return new Response('<urlset><url><loc>https://example.com/</loc><lastmod>2026-07-02</lastmod></url></urlset>', { status: 200 });
            }
            if (urlStr.includes('example.com') || urlStr.includes('93.184.216.34')) {
                return new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
            }
            return new Response('Not Found', { status: 404 });
        };
        try {
            const req = new Request('https://localhost/api/audit?targetUrl=' + encodeURIComponent('https://example.com/deep/path'), {
                method: 'GET'
            });
            const res = await index.fetch(req, {}, {});
            expect(res.status).toBe(200);
            expect(sitemapFetchedUrl).toBe('https://example.com/custom-relative-sitemap.xml');
            const data = await res.json();
            expect(data.bots.sitemapFound).toBe(true);
            expect(data.bots.hasSitemapLastmod).toBe(true);
        } finally {
            global.fetch = originalFetch;
        }
    });

    it('should parse sitemap XML correctly when sitemap is larger than 100k chars by slicing it', async () => {
        const originalFetch = global.fetch;
        global.fetch = async (url) => {
            const urlStr = url.toString();
            if (urlStr.includes('cloudflare-dns.com')) {
                return new Response(JSON.stringify({ Answer: [{ type: 1, data: '93.184.216.34' }] }));
            }
            if (urlStr.includes('robots.txt')) {
                return new Response('User-agent: *\nSitemap: https://example.com/huge-sitemap.xml', { status: 200 });
            }
            if (urlStr.includes('huge-sitemap.xml')) {
                // Generate a sitemap XML that is longer than 100k characters.
                // If it is sliced to 100k:
                // Case 1: lastmod tag is at the beginning (should match)
                // Case 2: lastmod tag is at the end (should not match because it's past 100k limit)
                const prefix = '<urlset><url><loc>https://example.com/</loc><lastmod>2026-07-02</lastmod></url>';
                const middle = 'a'.repeat(120000);
                const suffix = '</urlset>';
                return new Response(prefix + middle + suffix, { status: 200 });
            }
            if (urlStr.includes('example.com') || urlStr.includes('93.184.216.34')) {
                return new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
            }
            return new Response('Not Found', { status: 404 });
        };
        try {
            const req = new Request('https://localhost/api/audit?targetUrl=' + encodeURIComponent('https://example.com'), {
                method: 'GET'
            });
            const res = await index.fetch(req, {}, {});
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.bots.sitemapFound).toBe(true);
            expect(data.bots.hasSitemapLastmod).toBe(true);
        } finally {
            global.fetch = originalFetch;
        }
    });

    it('should NOT match lastmod if it is past the 100k characters limit in sitemap XML', async () => {
        const originalFetch = global.fetch;
        global.fetch = async (url) => {
            const urlStr = url.toString();
            if (urlStr.includes('cloudflare-dns.com')) {
                return new Response(JSON.stringify({ Answer: [{ type: 1, data: '93.184.216.34' }] }));
            }
            if (urlStr.includes('robots.txt')) {
                return new Response('User-agent: *\nSitemap: https://example.com/huge-sitemap-late.xml', { status: 200 });
            }
            if (urlStr.includes('huge-sitemap-late.xml')) {
                const prefix = '<urlset><url><loc>https://example.com/</loc>';
                const middle = 'a'.repeat(120000);
                const suffix = '<lastmod>2026-07-02</lastmod></url></urlset>';
                return new Response(prefix + middle + suffix, { status: 200 });
            }
            if (urlStr.includes('example.com') || urlStr.includes('93.184.216.34')) {
                return new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
            }
            return new Response('Not Found', { status: 404 });
        };
        try {
            const req = new Request('https://localhost/api/audit?targetUrl=' + encodeURIComponent('https://example.com'), {
                method: 'GET'
            });
            const res = await index.fetch(req, {}, {});
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.bots.sitemapFound).toBe(true);
            expect(data.bots.hasSitemapLastmod).toBe(false); // Should be false because it was sliced to 100k
        } finally {
            global.fetch = originalFetch;
        }
    });

    it('should cap JSON-LD chunks to 50', async () => {
        const originalFetch = global.fetch;
        
        // Scenario A: 49 invalid + 1 valid JSON-LD = 50 total (within limit). Valid one should be parsed.
        global.fetch = async (url) => {
            const urlStr = url.toString();
            if (urlStr.includes('cloudflare-dns.com')) {
                return new Response(JSON.stringify({ Answer: [{ type: 1, data: '93.184.216.34' }] }));
            }
            if (urlStr.includes('example.com') || urlStr.includes('93.184.216.34')) {
                let html = '<html><body>';
                for (let i = 0; i < 49; i++) {
                    html += '<script type="application/ld+json">invalid-json</script>';
                }
                html += '<script type="application/ld+json">{"@context": "https://schema.org", "@type": "Organization", "name": "Test"}</script>';
                html += '</body></html>';
                return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } });
            }
            return new Response('Not Found', { status: 404 });
        };
        try {
            const req = new Request('https://localhost/api/audit?targetUrl=' + encodeURIComponent('https://example.com'), {
                method: 'GET'
            });
            const res = await index.fetch(req, {}, {});
            expect(res.status).toBe(200);
            const data = await res.json();
            const jsonLdResult = data.content.results.find(r => r.name === 'Semantic JSON-LD');
            expect(jsonLdResult.status).toBe('ok');
        } finally {
            global.fetch = originalFetch;
        }

        // Scenario B: 50 invalid + 1 valid JSON-LD = 51 total (exceeds limit). Valid one should be ignored.
        global.fetch = async (url) => {
            const urlStr = url.toString();
            if (urlStr.includes('cloudflare-dns.com')) {
                return new Response(JSON.stringify({ Answer: [{ type: 1, data: '93.184.216.34' }] }));
            }
            if (urlStr.includes('example.com') || urlStr.includes('93.184.216.34')) {
                let html = '<html><body>';
                for (let i = 0; i < 50; i++) {
                    html += '<script type="application/ld+json">invalid-json</script>';
                }
                html += '<script type="application/ld+json">{"@context": "https://schema.org", "@type": "Organization", "name": "Test"}</script>';
                html += '</body></html>';
                return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } });
            }
            return new Response('Not Found', { status: 404 });
        };
        try {
            const req = new Request('https://localhost/api/audit?targetUrl=' + encodeURIComponent('https://example.com'), {
                method: 'GET'
            });
            const res = await index.fetch(req, {}, {});
            expect(res.status).toBe(200);
            const data = await res.json();
            const jsonLdResult = data.content.results.find(r => r.name === 'Semantic JSON-LD');
            expect(jsonLdResult.status).toBe('err');
        } finally {
            global.fetch = originalFetch;
        }
    });

    it('should block sitemap fetching if sitemapUrl points to a private/restricted resource', async () => {
        const originalFetch = global.fetch;
        let fetchedPrivateSitemap = false;
        
        global.fetch = async (url) => {
            const urlStr = url.toString();
            if (urlStr.includes('cloudflare-dns.com')) {
                return new Response(JSON.stringify({ Answer: [{ type: 1, data: '93.184.216.34' }] }));
            }
            if (urlStr.includes('example.com') || urlStr.includes('93.184.216.34')) {
                if (urlStr.endsWith('/robots.txt')) {
                    return new Response('Sitemap: http://localhost/sitemap-private.xml\n', { status: 200 });
                }
                return new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
            }
            if (urlStr.includes('localhost') || urlStr.includes('127.0.0.1')) {
                fetchedPrivateSitemap = true;
                return new Response('<urlset></urlset>', { status: 200 });
            }
            return new Response('Not Found', { status: 404 });
        };
        
        try {
            const req = new Request('https://localhost/api/audit?targetUrl=' + encodeURIComponent('https://example.com'), {
                method: 'GET'
            });
            const res = await index.fetch(req, {}, {});
            expect(res.status).toBe(200);
            expect(fetchedPrivateSitemap).toBe(false);
        } finally {
            global.fetch = originalFetch;
        }
    });

    it('should detect HTML Title, Lang, Image Alt, RSS/Atom, and Organization Schema', async () => {
        const originalFetch = global.fetch;
        global.fetch = async (url) => {
            const urlStr = url.toString();
            if (urlStr.includes('cloudflare-dns.com')) {
                return new Response(JSON.stringify({ Answer: [{ type: 1, data: '93.184.216.34' }] }));
            }
            if (urlStr.includes('/.well-known/security.txt')) {
                return new Response('Contact: mailto:security@example.com\nExpires: 2027-12-31\n', {
                    status: 200,
                    headers: { 'Content-Type': 'text/plain' }
                });
            }
            if (urlStr.includes('example.com') || urlStr.includes('93.184.216.34')) {
                const html = `<!DOCTYPE html>
                <html lang="en">
                <head>
                    <title>Example Domain</title>
                    <link rel="alternate" type="application/rss+xml" href="/feed.xml">
                    <script type="application/ld+json">
                    {
                        "@context": "https://schema.org",
                        "@type": "Organization",
                        "name": "Example Inc."
                    }
                    </script>
                </head>
                <body>
                    <img src="/logo.png" alt="Example Logo">
                </body>
                </html>`;
                return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } });
            }
            return new Response('Not Found', { status: 404 });
        };

        try {
            const req = new Request('https://localhost/api/audit?targetUrl=' + encodeURIComponent('https://example.com'), {
                method: 'GET'
            });
            const res = await index.fetch(req, {}, {});
            expect(res.status).toBe(200);
            const data = await res.json();

            // Check content booleans
            expect(data.content.hasTitle).toBe(true);
            expect(data.content.hasLang).toBe(true);
            expect(data.content.hasImageAlt).toBe(true);
            expect(data.content.hasRss).toBe(true);
            expect(data.content.hasOrgSchema).toBe(true);

            // Check result entries
            const titleRes = data.content.results.find(r => r.name === 'HTML Title Tag');
            expect(titleRes?.status).toBe('ok');

            const langRes = data.content.results.find(r => r.name === 'HTML Lang Attribute');
            expect(langRes?.status).toBe('ok');

            const altRes = data.content.results.find(r => r.name === 'Image Alt Text');
            expect(altRes?.status).toBe('ok');

            const rssRes = data.content.results.find(r => r.name === 'RSS/Atom Feed');
            expect(rssRes?.status).toBe('ok');

            const orgRes = data.content.results.find(r => r.name === 'Organization Schema');
            expect(orgRes?.status).toBe('ok');

            // Check protocol security.txt
            const secRes = data.protocols.results.find(r => r.name === 'security.txt');
            expect(secRes?.status).toBe('ok');
        } finally {
            global.fetch = originalFetch;
        }
    });

    it('should report warnings when Title, Lang, Image Alt, RSS, and Organization Schema are missing', async () => {
        const originalFetch = global.fetch;
        global.fetch = async (url) => {
            const urlStr = url.toString();
            if (urlStr.includes('cloudflare-dns.com')) {
                return new Response(JSON.stringify({ Answer: [{ type: 1, data: '93.184.216.34' }] }));
            }
            if (urlStr.includes('example.com') || urlStr.includes('93.184.216.34')) {
                // HTML without lang, title, alt text, or RSS feeds
                const html = `<html>
                <body>
                    <img src="/blank.png">
                </body>
                </html>`;
                return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } });
            }
            return new Response('Not Found', { status: 404 });
        };

        try {
            const req = new Request('https://localhost/api/audit?targetUrl=' + encodeURIComponent('https://example.com'), {
                method: 'GET'
            });
            const res = await index.fetch(req, {}, {});
            expect(res.status).toBe(200);
            const data = await res.json();

            expect(data.content.hasTitle).toBe(false);
            expect(data.content.hasLang).toBe(false);
            expect(data.content.hasImageAlt).toBe(false);
            expect(data.content.hasRss).toBe(false);
            expect(data.content.hasOrgSchema).toBe(false);

            const titleRes = data.content.results.find(r => r.name === 'HTML Title Tag');
            expect(titleRes?.status).toBe('warn');

            const langRes = data.content.results.find(r => r.name === 'HTML Lang Attribute');
            expect(langRes?.status).toBe('warn');

            const altRes = data.content.results.find(r => r.name === 'Image Alt Text');
            expect(altRes?.status).toBe('warn');

            const rssRes = data.content.results.find(r => r.name === 'RSS/Atom Feed');
            expect(rssRes?.status).toBe('warn');

            const orgRes = data.content.results.find(r => r.name === 'Organization Schema');
            expect(orgRes?.status).toBe('warn');
        } finally {
            global.fetch = originalFetch;
        }
    });

    it('should validate AGENTS.md, agents.json, deep llms.txt linting, OpenAPI tool readiness, and Live MCP probe', async () => {
        const originalFetch = global.fetch;
        global.fetch = async (url, opts) => {
            const urlStr = url.toString();
            if (urlStr.includes('cloudflare-dns.com')) {
                return new Response(JSON.stringify({ Answer: [{ type: 1, data: '93.184.216.34' }] }));
            }
            if (urlStr.endsWith('/AGENTS.md')) {
                return new Response('# AGENTS.md\n\n> Autonomous agent manual\n\n## Capabilities\n- Audit', {
                    status: 200,
                    headers: { 'Content-Type': 'text/markdown' }
                });
            }
            if (urlStr.endsWith('/.well-known/agents.json')) {
                return new Response(JSON.stringify({
                    name: 'test-agent',
                    version: '1.0.0',
                    capabilities: [{ name: 'audit' }]
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
            if (urlStr.endsWith('/llms.txt')) {
                return new Response('# Test App\n\n> Summary description\n\n- [Docs](https://example.com/docs): Full technical documentation', {
                    status: 200,
                    headers: { 'Content-Type': 'text/plain' }
                });
            }
            if (urlStr.endsWith('/llms-full.txt')) {
                return new Response('# Test App Full\n\n## Overview\nComplete manual', {
                    status: 200,
                    headers: { 'Content-Type': 'text/plain' }
                });
            }
            if (urlStr.endsWith('/.well-known/api-catalog')) {
                return new Response('https://example.com/openapi.json', {
                    status: 200,
                    headers: { 'Content-Type': 'text/plain' }
                });
            }
            if (urlStr.endsWith('/openapi.json')) {
                return new Response(JSON.stringify({
                    openapi: '3.0.0',
                    paths: {
                        '/api/audit': {
                            get: {
                                operationId: 'performAudit',
                                summary: 'Perform website audit',
                                description: 'Analyzes target site for AI readiness'
                            }
                        }
                    }
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
            if (urlStr.endsWith('/.well-known/mcp/server-card.json')) {
                return new Response(JSON.stringify({
                    serverInfo: { name: 'test-mcp' },
                    endpoints: { sse: '/mcp/sse' },
                    tools: [{ name: 'audit_website' }]
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
            if (urlStr.endsWith('/mcp/sse')) {
                return new Response(JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    result: { tools: [{ name: 'audit_website' }] }
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
            return new Response('Not Found', { status: 404 });
        };

        try {
            const req = new Request('https://localhost/api/audit?targetUrl=' + encodeURIComponent('https://example.com'), {
                method: 'GET'
            });
            const res = await index.fetch(req, {}, {});
            expect(res.status).toBe(200);
            const data = await res.json();

            const agentsMd = data.protocols.results.find(r => r.name === 'AGENTS.md');
            expect(agentsMd?.status).toBe('ok');
            expect(agentsMd?.message).toContain('Valid AGENTS.md instructions');

            const agentsJson = data.protocols.results.find(r => r.name === 'agents.json');
            expect(agentsJson?.status).toBe('ok');
            expect(agentsJson?.message).toContain('1 capabilities declared');

            const llmsTxt = data.protocols.results.find(r => r.name === 'LLMs.txt');
            expect(llmsTxt?.status).toBe('ok');
            expect(llmsTxt?.code).toBe('Compliant');

            const llmsFullTxt = data.protocols.results.find(r => r.name === 'LLMs-Full.txt');
            expect(llmsFullTxt?.status).toBe('ok');
            expect(llmsFullTxt?.code).toBe('Compliant');

            const apiCat = data.protocols.results.find(r => r.name === 'API Catalog');
            expect(apiCat?.status).toBe('ok');
            expect(apiCat?.code).toBe('100% Ready');

            const mcp = data.protocols.results.find(r => r.name === 'MCP Server');
            expect(mcp?.status).toBe('ok');
            expect(mcp?.code).toBe('Live & Operational');
        } finally {
            global.fetch = originalFetch;
        }
    });

    it('should correctly handle partial llms.txt and manifest-only MCP server', async () => {
        const originalFetch = global.fetch;
        global.fetch = async (url) => {
            const urlStr = url.toString();
            if (urlStr.includes('cloudflare-dns.com')) {
                return new Response(JSON.stringify({ Answer: [{ type: 1, data: '93.184.216.34' }] }));
            }
            if (urlStr.endsWith('/llms.txt')) {
                // llms.txt with H1 and links but missing blockquote summary
                return new Response('# Test App\n- [Link](https://example.com)', {
                    status: 200,
                    headers: { 'Content-Type': 'text/plain' }
                });
            }
            if (urlStr.endsWith('/.well-known/mcp/server-card.json')) {
                // MCP server card with tools declared in manifest, but no live endpoint
                return new Response(JSON.stringify({
                    serverInfo: { name: 'manifest-only-mcp' },
                    tools: [{ name: 'tool_a' }, { name: 'tool_b' }]
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
            if (urlStr.endsWith('/.well-known/api-catalog')) {
                return new Response('/openapi.json', { status: 200, headers: { 'Content-Type': 'text/plain' } });
            }
            if (urlStr.endsWith('/openapi.json')) {
                // 1 ready operation out of 2 (50% ready)
                return new Response(JSON.stringify({
                    openapi: '3.0.0',
                    paths: {
                        '/api/users': {
                            get: {
                                operationId: 'getUsers',
                                summary: 'List users'
                            },
                            post: {
                                // missing operationId and summary
                            }
                        }
                    }
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
            return new Response('Not Found', { status: 404 });
        };

        try {
            const req = new Request('https://localhost/api/audit?targetUrl=' + encodeURIComponent('https://example.com'), {
                method: 'GET'
            });
            const res = await index.fetch(req, {}, {});
            expect(res.status).toBe(200);
            const data = await res.json();

            const llmsTxt = data.protocols.results.find(r => r.name === 'LLMs.txt');
            expect(llmsTxt?.status).toBe('ok');
            expect(llmsTxt?.code).toBe('Partial');

            const mcp = data.protocols.results.find(r => r.name === 'MCP Server');
            expect(mcp?.status).toBe('ok');
            expect(mcp?.code).toBe('Active');
            expect(mcp?.message).toContain('2 defined tools');

            const apiCat = data.protocols.results.find(r => r.name === 'API Catalog');
            expect(apiCat?.status).toBe('ok');
            expect(apiCat?.code).toBe('50% Ready');
        } finally {
            global.fetch = originalFetch;
        }
    });
});



