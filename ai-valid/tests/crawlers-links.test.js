import { describe, it, expect } from 'vitest';
import './helpers/rewriter-mock.js';
import index, {
    classifyMachineLinks,
    evaluateAiCrawlerPolicy,
    parseLinkHeader,
    robotsBlocksBot,
} from '../src/index.js';

const ORIGIN = 'https://example.com';

/** Full audit against a mocked origin; `routes` maps path → () => Response. */
async function audit(routes = {}) {
    const originalFetch = global.fetch;
    global.fetch = async (url, opts) => {
        const u = new URL(url.toString());
        if (u.hostname === 'cloudflare-dns.com') {
            return new Response(JSON.stringify({ Answer: [{ type: 1, data: '93.184.216.34' }] }));
        }
        const route = routes[u.pathname];
        return route ? route(opts) : new Response('Not Found', { status: 404 });
    };
    try {
        const res = await index.fetch(new Request(`https://localhost/api/audit?targetUrl=${encodeURIComponent(ORIGIN)}`), {}, {});
        return await res.json();
    } finally {
        global.fetch = originalFetch;
    }
}
const find = (data, name) => [...data.bots.results, ...data.content.results, ...data.protocols.results].find(c => c.name === name);
const text = (body, type = 'text/plain', headers = {}) => () => new Response(body, { status: 200, headers: { 'Content-Type': type, ...headers } });
const html = (head = '', headers = {}) => text(`<html><head><title>x</title>${head}</head><body><p>hello</p></body></html>`, 'text/html', headers);

const rules = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, { allow: v.allow || [], disallow: v.disallow || [] }]));

describe('AI crawler policy', () => {
    it('falls back to the * group for unnamed bots', () => {
        const r = rules({ '*': { disallow: ['/'] }, 'claude-user': { allow: ['/'] } });
        expect(robotsBlocksBot(r, 'gptbot')).toBe(true);
        expect(robotsBlocksBot(r, 'claude-user')).toBe(false);
    });

    it('is clean for an explicit, differentiated policy', () => {
        const r = rules({
            '*': { allow: ['/'] },
            gptbot: { disallow: ['/'] }, claudebot: { disallow: ['/'] }, 'google-extended': { disallow: ['/'] },
            'applebot-extended': { disallow: ['/'] }, 'meta-externalagent': { disallow: ['/'] }, amazonbot: { disallow: ['/'] },
            ccbot: { disallow: ['/'] }, bytespider: { disallow: ['/'] }, 'cohere-ai': { disallow: ['/'] },
        });
        const p = evaluateAiCrawlerPolicy(r);
        expect(p.issues).toEqual([]);
        expect(p.summary).toBe('search 5/5 allowed, user agents 5/5 allowed, training 0/9 allowed');
    });

    it('flags retired Anthropic tokens', () => {
        const p = evaluateAiCrawlerPolicy(rules({ 'anthropic-ai': { disallow: ['/'] } }));
        expect(p.issues.join('\n')).toMatch(/retired token "anthropic-ai".*ClaudeBot/);
    });

    it('flags an incomplete training opt-out', () => {
        const p = evaluateAiCrawlerPolicy(rules({ gptbot: { disallow: ['/'] } }));
        const msg = p.issues.join('\n');
        expect(msg).toMatch(/training opt-out incomplete/);
        expect(msg).toMatch(/ClaudeBot/);
        expect(msg).not.toMatch(/GPTBot,/);
    });

    it('flags search and user agents caught by a blanket * block', () => {
        const p = evaluateAiCrawlerPolicy(rules({ '*': { disallow: ['/'] } }));
        expect(p.issues.join('\n')).toMatch(/blocked only by the "\*" group.*OAI-SearchBot.*Claude-User/);
    });

    it('flags blocking a vendor user agent while its trainer is allowed', () => {
        const p = evaluateAiCrawlerPolicy(rules({ 'claude-user': { disallow: ['/'] } }));
        expect(p.issues.join('\n')).toMatch(/Anthropic: user-triggered Claude-User blocked while training is allowed/);
    });

    it('reports robots rules for ChatGPT-User / Perplexity-User as ineffective', () => {
        const p = evaluateAiCrawlerPolicy(rules({ 'chatgpt-user': { disallow: ['/'] }, 'perplexity-user': { disallow: ['/'] } }));
        const msg = p.issues.join('\n');
        expect(msg).toMatch(/ChatGPT-User, Perplexity-User generally ignore robots\.txt/);
        expect(msg).not.toMatch(/OpenAI: user-triggered/);
        expect(p.crawlers.find(c => c.name === 'ChatGPT-User').ignoresRobots).toBe(true);
    });

    it('does not count robots-ignoring fetchers as collateral of a * block', () => {
        const p = evaluateAiCrawlerPolicy(rules({ '*': { disallow: ['/'] } }));
        const collateral = p.issues.find(i => i.startsWith('blocked only by'));
        expect(collateral).toMatch(/Claude-User/);
        expect(collateral).not.toMatch(/ChatGPT-User|Perplexity-User/);
    });
});

describe('Link header parsing', () => {
    it('parses multiple links with quoted params and commas', () => {
        const links = parseLinkHeader('</index.md>; rel="alternate"; type="text/markdown", </llms.txt>; rel=describedby, <https://x.test/a,b>; rel="api-catalog service-desc"; title="a, b"');
        expect(links).toEqual([
            { href: '/index.md', rel: ['alternate'], type: 'text/markdown' },
            { href: '/llms.txt', rel: ['describedby'], type: '' },
            { href: 'https://x.test/a,b', rel: ['api-catalog', 'service-desc'], type: '' },
        ]);
    });

    it('classifies relations and ignores unrelated ones', () => {
        const c = classifyMachineLinks([
            ...parseLinkHeader('</index.md>; rel="alternate"; type="text/markdown; charset=utf-8", </style.css>; rel=preload'),
            { href: '/feed.xml', rel: ['alternate'], type: 'application/rss+xml' },
            { href: '/llms.txt', rel: ['describedby'], type: '' },
            { href: '/.well-known/api-catalog', rel: ['api-catalog'], type: '' },
            { href: '/index.md', rel: ['alternate'], type: 'text/markdown' },
        ]);
        expect(c).toEqual({ markdown: ['/index.md'], llms: ['/llms.txt'], api: ['/.well-known/api-catalog'] });
    });
});

describe('Machine-Readable Links check', () => {
    it('passes when the HTML advertises a working Markdown alternate', async () => {
        const data = await audit({
            '/': html('<link rel="alternate" type="text/markdown" href="/index.md"><link rel="describedby" href="/llms.txt">'),
            '/index.md': text('# Home', 'text/markdown'),
        });
        const c = find(data, 'Machine-Readable Links');
        expect(c.status).toBe('ok');
        expect(c.message).toMatch(/Markdown alternate, llms\.txt/);
    });

    it('reads relations from the HTTP Link header', async () => {
        const data = await audit({
            '/': html('', { Link: '</page.md>; rel="alternate"; type="text/markdown"' }),
            '/page.md': text('# Home', 'text/markdown'),
        });
        const c = find(data, 'Machine-Readable Links');
        expect(c.status).toBe('ok');
        expect(c.message).toMatch(/Link header/);
    });

    it('warns when the Markdown alternate is broken', async () => {
        const data = await audit({ '/': html('<link rel="alternate" type="text/markdown" href="/missing.md">') });
        const c = find(data, 'Machine-Readable Links');
        expect(c.status).toBe('warn');
        expect(c.message).toMatch(/returned 404/);
    });

    it('warns when only llms.txt is linked', async () => {
        const data = await audit({ '/': html('<link rel="describedby" href="/llms.txt">') });
        expect(find(data, 'Machine-Readable Links').code).toBe('Partial');
    });

    it('fails when nothing is advertised', async () => {
        const data = await audit({ '/': html() });
        expect(find(data, 'Machine-Readable Links').status).toBe('err');
    });
});

describe('robots.txt AI crawler checks in a full audit', () => {
    it('names the blocked search and user bots', async () => {
        const data = await audit({
            '/': html(),
            '/robots.txt': text('User-agent: Claude-SearchBot\nDisallow: /\n\nUser-agent: Claude-User\nDisallow: /\n\nUser-agent: Perplexity-User\nDisallow: /\n'),
        });
        expect(find(data, 'AI Search Allowed').message).toBe('AI Search bots blocked: Claude-SearchBot');
        expect(find(data, 'AI Agent Allowed').message).toBe('User-triggered AI agents blocked: Claude-User');
        expect(find(data, 'AI Crawler Directives').message).toMatch(/Perplexity-User generally ignore robots\.txt/);
        expect(data.bots.aiCrawlers.find(b => b.name === 'Claude-SearchBot')).toMatchObject({ role: 'search', named: true, allowed: false });
    });

    it('reports AI Crawler Directives issues for a retired token', async () => {
        const data = await audit({
            '/': html(),
            '/robots.txt': text('User-agent: anthropic-ai\nDisallow: /\n\nUser-agent: *\nAllow: /\n'),
        });
        const c = find(data, 'AI Crawler Directives');
        expect(c.status).toBe('warn');
        expect(c.code).toBe('Partial');
        expect(c.message).toMatch(/retired token "anthropic-ai"/);
    });

    it('passes AI Crawler Directives for a permissive robots.txt', async () => {
        const data = await audit({ '/': html(), '/robots.txt': text('User-agent: *\nAllow: /\n') });
        const c = find(data, 'AI Crawler Directives');
        expect(c.status).toBe('ok');
        expect(c.message).toMatch(/search 5\/5 allowed/);
    });

    it('fails AI Crawler Directives without robots.txt', async () => {
        const data = await audit({ '/': html() });
        expect(find(data, 'AI Crawler Directives').code).toBe('Missing');
    });
});

describe('AI-Valid homepage advertises its machine-readable forms', () => {
    it('sends a Link header and serves /index.md', async () => {
        const res = await index.fetch(new Request('https://localhost/'), {}, {});
        const c = classifyMachineLinks(parseLinkHeader(res.headers.get('link')));
        expect(c.markdown).toEqual(['/index.md']);
        expect(c.llms).toEqual(['/llms.txt']);
        expect(c.api).toContain('/.well-known/api-catalog');
        const md = await index.fetch(new Request('https://localhost/index.md'), {}, {});
        expect(md.headers.get('content-type')).toMatch(/text\/markdown/);
    });
});

describe('review regressions', () => {
    it('AI-Valid robots.txt passes its own AI Crawler Directives check', async () => {
        const robots = await (await index.fetch(new Request('https://localhost/robots.txt'), {}, {})).text();
        const data = await audit({ '/': html(), '/robots.txt': text(robots) });
        expect(find(data, 'AI Crawler Directives').status).toBe('ok');
        expect(find(data, 'AI Search Allowed').status).toBe('ok');
        expect(find(data, 'AI Agent Allowed').status).toBe('ok');
        expect(find(data, 'AI Training Blocked').status).toBe('ok');
    });

    it('resolves a relative Markdown alternate against the redirected homepage URL', async () => {
        const originalFetch = global.fetch;
        global.fetch = async (url) => {
            const u = new URL(url.toString());
            if (u.hostname === 'cloudflare-dns.com') return new Response(JSON.stringify({ Answer: [{ type: 1, data: '93.184.216.34' }] }));
            if (u.pathname === '/') return new Response(null, { status: 301, headers: { Location: '/en/' } });
            if (u.pathname === '/en/') {
                const r = new Response('<html><head><title>x</title><link rel="alternate" type="text/markdown" href="index.md"></head><body>hi</body></html>', { headers: { 'Content-Type': 'text/html' } });
                Object.defineProperty(r, 'url', { value: u.href });
                return r;
            }
            if (u.pathname === '/en/index.md') return new Response('# Hi', { headers: { 'Content-Type': 'text/markdown' } });
            return new Response('Not Found', { status: 404 });
        };
        try {
            const res = await index.fetch(new Request(`https://localhost/api/audit?targetUrl=${encodeURIComponent(ORIGIN)}`), {}, {});
            const data = await res.json();
            expect(find(data, 'Machine-Readable Links').status).toBe('ok');
        } finally {
            global.fetch = originalFetch;
        }
    });
});
