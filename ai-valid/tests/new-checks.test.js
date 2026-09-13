import { describe, it, expect } from 'vitest';
import './helpers/rewriter-mock.js';
import index from '../src/index.js';

/** Runs a full audit against a mocked origin serving the given homepage. */
async function audit(html, { homeHeaders = { 'Content-Type': 'text/html' }, origin = 'https://example.com' } = {}) {
    const originalFetch = global.fetch;
    global.fetch = async (url) => {
        const u = url.toString();
        if (u.includes('cloudflare-dns.com')) {
            return new Response(JSON.stringify({ Answer: [{ type: 1, data: '93.184.216.34' }] }));
        }
        if (u === origin || u === `${origin}/`) {
            return new Response(html, { status: 200, headers: homeHeaders });
        }
        return new Response('Not Found', { status: 404 });
    };
    try {
        const res = await index.fetch(
            new Request(`https://localhost/api/audit?targetUrl=${encodeURIComponent(origin)}`),
            {}, {}
        );
        return await res.json();
    } finally {
        global.fetch = originalFetch;
    }
}

const find = (data, name) => [...data.bots.results, ...data.content.results, ...data.protocols.results]
    .find(c => c.name === name);

const prose = 'This is a simple sentence about the product. '.repeat(40);

describe('Server-Rendered Content', () => {
    it('passes a page whose text is in the HTML response', async () => {
        const data = await audit(`<html><body><main><p>${prose}</p></main></body></html>`);
        expect(data.content.hasServerRenderedContent).toBe(true);
        expect(find(data, 'Server-Rendered Content').status).toBe('ok');
    });

    it('flags a client-rendered shell that ships script but no text', async () => {
        const data = await audit(
            `<html><body><div id="root"></div><script>${'const x = 1;'.repeat(800)}</script></body></html>`
        );
        expect(data.content.hasServerRenderedContent).toBe(false);
        const check = find(data, 'Server-Rendered Content');
        expect(check.status).toBe('err');
        expect(check.code).toBe('Client-Rendered');
    });

    it('does not flag a small page that simply has little script', async () => {
        const data = await audit('<html><body><p>A short but genuine page carrying about thirty words of real content on it, which is enough for a reader to follow and for an indexer to work with.</p></body></html>');
        expect(data.content.hasServerRenderedContent).toBe(true);
    });
});

describe('Content Depth', () => {
    it('warns on a thin page and reports the word count', async () => {
        const data = await audit('<html><body><p>Too short.</p></body></html>');
        const check = find(data, 'Content Depth');
        expect(check.status).toBe('warn');
        expect(check.message).toMatch(/\d+ words/);
    });

    it('passes a page with substantive content', async () => {
        const data = await audit(`<html><body><p>${prose}</p></body></html>`);
        expect(data.content.wordCount).toBeGreaterThanOrEqual(300);
        expect(find(data, 'Content Depth').status).toBe('ok');
    });
});

describe('Canonical URL', () => {
    it('detects rel=canonical', async () => {
        const data = await audit('<html><head><link rel="canonical" href="https://example.com/"></head><body>x</body></html>');
        expect(data.content.hasCanonical).toBe(true);
        expect(find(data, 'Canonical URL').status).toBe('ok');
    });

    it('ignores a canonical link with an empty href', async () => {
        const data = await audit('<html><head><link rel="canonical" href="  "></head><body>x</body></html>');
        expect(data.content.hasCanonical).toBe(false);
    });

    it('warns when no canonical is declared', async () => {
        const data = await audit('<html><head></head><body>x</body></html>');
        expect(find(data, 'Canonical URL').status).toBe('warn');
    });
});

describe('HTTPS & HSTS', () => {
    it('passes when HTTPS is paired with an HSTS header', async () => {
        const data = await audit('<html><body>x</body></html>', {
            homeHeaders: { 'Content-Type': 'text/html', 'Strict-Transport-Security': 'max-age=31536000' }
        });
        expect(data.content.hasHsts).toBe(true);
        expect(find(data, 'HTTPS & HSTS').status).toBe('ok');
    });

    it('warns on HTTPS without HSTS', async () => {
        const data = await audit('<html><body>x</body></html>');
        const check = find(data, 'HTTPS & HSTS');
        expect(check.status).toBe('warn');
        expect(check.code).toBe('No HSTS');
    });
});

describe('X-Robots-Tag Header', () => {
    it('flags a stray noindex left on a public page', async () => {
        const data = await audit('<html><body>x</body></html>', {
            homeHeaders: { 'Content-Type': 'text/html', 'X-Robots-Tag': 'noindex, nofollow' }
        });
        expect(data.content.hasBlockingXRobots).toBe(true);
        const check = find(data, 'X-Robots-Tag Header');
        expect(check.status).toBe('warn');
        expect(check.message).toContain('noindex');
    });

    it('treats the absence of the header as healthy', async () => {
        const data = await audit('<html><body>x</body></html>');
        expect(find(data, 'X-Robots-Tag Header').status).toBe('ok');
    });

    it('accepts a permissive X-Robots-Tag', async () => {
        const data = await audit('<html><body>x</body></html>', {
            homeHeaders: { 'Content-Type': 'text/html', 'X-Robots-Tag': 'all' }
        });
        expect(find(data, 'X-Robots-Tag Header').status).toBe('ok');
    });
});

describe('Breadcrumb and Site Search schema', () => {
    it('detects BreadcrumbList markup', async () => {
        const data = await audit(`<html><head><script type="application/ld+json">
            {"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[]}
        </script></head><body>x</body></html>`);
        expect(data.content.hasBreadcrumbSchema).toBe(true);
        expect(find(data, 'Breadcrumb Schema').status).toBe('ok');
    });

    it('detects a WebSite SearchAction', async () => {
        const data = await audit(`<html><head><script type="application/ld+json">
            {"@context":"https://schema.org","@type":"WebSite","potentialAction":{"@type":"SearchAction","target":"https://example.com/s?q={search_term_string}"}}
        </script></head><body>x</body></html>`);
        expect(data.content.hasSiteSearchSchema).toBe(true);
    });

    it('does not treat a bare WebSite node as a SearchAction', async () => {
        const data = await audit(`<html><head><script type="application/ld+json">
            {"@context":"https://schema.org","@type":"WebSite","name":"Acme"}
        </script></head><body>x</body></html>`);
        expect(data.content.hasSiteSearchSchema).toBe(false);
        expect(find(data, 'Site Search Schema').status).toBe('warn');
    });
});

describe('Image Alt Text coverage', () => {
    it('no longer passes when one image out of many is described', async () => {
        const imgs = '<img src="a.png">'.repeat(9) + '<img src="b.png" alt="described">';
        const data = await audit(`<html><body>${imgs}</body></html>`);
        expect(data.content.imagesTotal).toBe(10);
        expect(data.content.imagesWithAlt).toBe(1);
        expect(data.content.hasImageAlt).toBe(false);
    });

    it('passes when at least 80% of images carry an alt attribute', async () => {
        const imgs = '<img src="a.png" alt="a">'.repeat(8) + '<img src="b.png">'.repeat(2);
        const data = await audit(`<html><body>${imgs}</body></html>`);
        expect(data.content.hasImageAlt).toBe(true);
    });

    it('counts an explicitly empty alt as a decorative image, not a missing one', async () => {
        const data = await audit('<html><body><img src="spacer.gif" alt=""></body></html>');
        expect(data.content.imagesWithAlt).toBe(1);
        expect(data.content.hasImageAlt).toBe(true);
    });

    it('passes a page with no images at all', async () => {
        const data = await audit('<html><body><p>No images here.</p></body></html>');
        expect(data.content.imagesTotal).toBe(0);
        expect(data.content.hasImageAlt).toBe(true);
    });
});

describe('audit envelope', () => {
    it('reports a score, a grade, categories and priorities', async () => {
        const data = await audit(`<html><body><p>${prose}</p></body></html>`);
        expect(data.score.max).toBe(100);
        expect(data.score.total).toBeGreaterThanOrEqual(0);
        expect(data.score.total).toBeLessThanOrEqual(100);
        expect(data.score.grade).toBeTruthy();
        expect(Object.keys(data.score.categories).length).toBeGreaterThan(1);
        expect(Array.isArray(data.priorities)).toBe(true);
        expect(data.target).toBe('https://example.com');
    });

    it('annotates every check with a weight and a category', async () => {
        const data = await audit('<html><body>x</body></html>');
        const all = [...data.bots.results, ...data.content.results, ...data.protocols.results];
        expect(all.length).toBeGreaterThan(30);
        for (const check of all) {
            expect(typeof check.weight).toBe('number');
            expect(typeof check.category).toBe('string');
            expect(check.category).not.toBe('Other');
        }
    });

    it('serves a markdown report when the client asks for one', async () => {
        const originalFetch = global.fetch;
        global.fetch = async (url) => {
            const u = url.toString();
            if (u.includes('cloudflare-dns.com')) return new Response(JSON.stringify({ Answer: [{ type: 1, data: '93.184.216.34' }] }));
            if (u === 'https://example.com' || u === 'https://example.com/') return new Response('<html><body>x</body></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
            return new Response('Not Found', { status: 404 });
        };
        try {
            const res = await index.fetch(
                new Request('https://localhost/api/audit?format=md&targetUrl=' + encodeURIComponent('https://example.com')),
                {}, {}
            );
            expect(res.headers.get('Content-Type')).toContain('text/markdown');
            expect(res.headers.get('Vary')).toBe('Accept');
            const body = await res.text();
            expect(body).toContain('# AI Readiness Audit');
            expect(body).toContain('| Check | Result | Detail |');
        } finally {
            global.fetch = originalFetch;
        }
    });
});

describe('content negotiation', () => {
    /** A server that does exactly what the tool recommends: Markdown to agents, HTML to browsers. */
    function negotiatingOrigin({ vary = true } = {}) {
        return async (url, options = {}) => {
            const u = url.toString();
            if (u.includes('cloudflare-dns.com')) {
                return new Response(JSON.stringify({ Answer: [{ type: 1, data: '93.184.216.34' }] }));
            }
            if (u === 'https://example.com' || u === 'https://example.com/') {
                const accept = (options.headers && (options.headers.Accept || options.headers.accept)) || '';
                if (accept.includes('text/markdown')) {
                    const headers = { 'Content-Type': 'text/markdown; charset=utf-8' };
                    if (vary) headers.Vary = 'Accept';
                    return new Response('# Acme\n\nA markdown rendering of the page.\n', { status: 200, headers });
                }
                return new Response(
                    `<html lang="en"><head><title>Acme</title>
                     <meta name="description" content="Acme does things well and clearly.">
                     <link rel="canonical" href="https://example.com/">
                     <script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Acme"}</script>
                     </head><body><main><h1>Acme</h1><h2>What we do</h2>
                     <p>${'This is a simple sentence about the product. '.repeat(40)}</p>
                     </main></body></html>`,
                    { status: 200, headers: { 'Content-Type': 'text/html', 'Vary': 'Accept' } }
                );
            }
            return new Response('Not Found', { status: 404 });
        };
    }

    async function auditNegotiating(opts) {
        const originalFetch = global.fetch;
        global.fetch = negotiatingOrigin(opts);
        try {
            const res = await index.fetch(
                new Request('https://localhost/api/audit?targetUrl=' + encodeURIComponent('https://example.com')),
                {}, {}
            );
            return await res.json();
        } finally {
            global.fetch = originalFetch;
        }
    }

    it('credits a site that serves Markdown to agents', async () => {
        const data = await auditNegotiating();
        expect(data.content.supportsMarkdown).toBe(true);
        expect(find(data, 'Content Neg. (MD)').status).toBe('ok');
    });

    it('still reads the HTML structure of a site that serves Markdown to agents', async () => {
        // The audit used to request Markdown and then parse the reply as HTML,
        // so a correctly negotiating server failed every structural check.
        const data = await auditNegotiating();
        expect(data.content.hasTitle).toBe(true);
        expect(data.content.hasLang).toBe(true);
        expect(data.content.hasMetaDesc).toBe(true);
        expect(data.content.hasCanonical).toBe(true);
        expect(data.content.hasSchema).toBe(true);
        expect(data.content.hasOrgSchema).toBe(true);
        expect(data.content.hasSemanticTags).toBe(true);
        expect(data.content.hasH1 && data.content.hasH2).toBe(true);
        expect(data.content.hasServerRenderedContent).toBe(true);
    });

    it('notes a Markdown response that is missing Vary: Accept', async () => {
        const data = await auditNegotiating({ vary: false });
        expect(data.content.supportsMarkdown).toBe(true);
        expect(data.content.hasVaryAccept).toBe(false);
        const check = find(data, 'Content Neg. (MD)');
        expect(check.status).toBe('ok');
        expect(check.code).toBe('No Vary');
        expect(check.message).toContain('Vary: Accept');
    });

    it('confirms Vary: Accept when the server sends it', async () => {
        const data = await auditNegotiating({ vary: true });
        expect(data.content.hasVaryAccept).toBe(true);
        expect(find(data, 'Content Neg. (MD)').code).toBe('Supported');
    });
});
