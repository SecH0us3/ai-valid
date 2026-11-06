import { describe, it, expect } from 'vitest';
import './helpers/rewriter-mock.js';
import index, {
    AGENT_SKILLS_SCHEMA_V020,
    evaluateAgentSkillsIndex,
    isValidAgentSkillName,
    lintAgentSkillsIndex,
    parseSkillFrontmatter,
    sha256Hex,
} from '../src/index.js';

const INDEX_URL = 'https://example.com/.well-known/agent-skills/index.json';
const SKILL_MD = '---\nname: search-docs\ndescription: Search the product documentation.\n---\n\n# Search docs\n\nUse the search API.\n';
const digestOf = async (text) => `sha256:${await sha256Hex(new TextEncoder().encode(text))}`;

const json = (body, headers = { 'Content-Type': 'application/json' }) =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200, headers });

/** Builds a fetch stub that serves the given path → Response factories. */
const origin = (routes) => async (url) => {
    const path = new URL(url).pathname;
    return routes[path] ? routes[path]() : new Response('Not Found', { status: 404 });
};

async function evaluate(indexBody, routes = {}, { cType = 'application/json' } = {}) {
    return evaluateAgentSkillsIndex(json(indexBody), 200, cType, INDEX_URL, origin(routes));
}

async function goodIndex(overrides = {}) {
    return {
        $schema: AGENT_SKILLS_SCHEMA_V020,
        skills: [{
            name: 'search-docs',
            type: 'skill-md',
            description: 'Search the product documentation.',
            url: '/.well-known/agent-skills/search-docs/SKILL.md',
            digest: await digestOf(SKILL_MD),
            ...overrides,
        }],
    };
}

const mdRoute = (text = SKILL_MD, type = 'text/markdown') => ({
    '/.well-known/agent-skills/search-docs/SKILL.md': () => new Response(text, { status: 200, headers: { 'Content-Type': type } }),
});

describe('Agent Skills name rules', () => {
    it('accepts lowercase hyphenated names up to 64 chars', () => {
        expect(isValidAgentSkillName('pdf-processing')).toBe(true);
        expect(isValidAgentSkillName('a'.repeat(64))).toBe(true);
    });
    it('rejects uppercase, edge/double hyphens, empty and overlong names', () => {
        for (const bad of ['PDF', '-pdf', 'pdf-', 'pdf--x', '', 'a'.repeat(65), 'pdf_x']) {
            expect(isValidAgentSkillName(bad)).toBe(false);
        }
    });
});

describe('lintAgentSkillsIndex', () => {
    it('detects schema versions', () => {
        expect(lintAgentSkillsIndex({ $schema: AGENT_SKILLS_SCHEMA_V020, skills: [] }).version).toBe('0.2.0');
        expect(lintAgentSkillsIndex({ skills: [] }).version).toBe('0.1.0');
        expect(lintAgentSkillsIndex({ $schema: 'https://x/9.json', skills: [] }).version).toBe('unknown');
    });
    it('is fatal without a skills array', () => {
        expect(lintAgentSkillsIndex({ $schema: AGENT_SKILLS_SCHEMA_V020 }).fatal).toMatch(/skills/);
        expect(lintAgentSkillsIndex([]).fatal).toBeTruthy();
    });
    it('reports field problems per entry and keeps valid ones', async () => {
        const idx = await goodIndex();
        idx.skills.push({ name: 'Bad Name', type: 'skill-md', description: 'x', url: '/x', digest: 'md5:abc' });
        idx.skills.push({ ...idx.skills[0] }); // duplicate
        idx.skills.push({ ...idx.skills[0], name: 'other', type: 'zip-bundle' });
        const lint = lintAgentSkillsIndex(idx);
        expect(lint.entries.map(e => e.name)).toEqual(['search-docs']);
        expect(lint.issues.join('\n')).toMatch(/invalid name/);
        expect(lint.issues.join('\n')).toMatch(/digest must be/);
        expect(lint.issues.join('\n')).toMatch(/duplicate name/);
        expect(lint.issues.join('\n')).toMatch(/unknown type "zip-bundle"/);
    });
    it('rejects descriptions over 1024 characters', async () => {
        const lint = lintAgentSkillsIndex(await goodIndex({ description: 'x'.repeat(1025) }));
        expect(lint.issues[0]).toMatch(/1024/);
    });
});

describe('parseSkillFrontmatter', () => {
    it('reads plain, quoted and folded values', () => {
        expect(parseSkillFrontmatter(SKILL_MD)).toMatchObject({ name: 'search-docs', description: 'Search the product documentation.' });
        expect(parseSkillFrontmatter('---\nname: "a-b"\ndescription: >\n  line one\n  line two\n---\nbody').description).toBe('line one line two');
        expect(parseSkillFrontmatter('﻿---\r\nname: a\r\ndescription: d\r\n---\r\n')).toMatchObject({ name: 'a', description: 'd' });
    });
    it('returns null without frontmatter', () => {
        expect(parseSkillFrontmatter('# Just markdown')).toBeNull();
    });
});

describe('evaluateAgentSkillsIndex', () => {
    it('passes a compliant v0.2.0 index whose digests verify', async () => {
        const r = await evaluate(await goodIndex(), mdRoute());
        expect(r.status).toBe('ok');
        expect(r.code).toBe('Compliant');
        expect(r.message).toMatch(/1 skill, digests verified/);
    });

    it('resolves relative urls against the index url', async () => {
        const r = await evaluate(await goodIndex({ url: 'search-docs/SKILL.md' }), mdRoute());
        expect(r.status).toBe('ok');
    });

    it('fails when the only artifact does not match its digest', async () => {
        const r = await evaluate(await goodIndex(), mdRoute(SKILL_MD + 'tampered'));
        expect(r.status).toBe('err');
        expect(r.message).toMatch(/digest mismatch/);
    });

    it('fails when the artifact is missing', async () => {
        const r = await evaluate(await goodIndex(), {});
        expect(r.status).toBe('err');
        expect(r.message).toMatch(/artifact returned 404/);
    });

    it('rejects a skill whose SKILL.md name disagrees with the index', async () => {
        const md = SKILL_MD.replace('name: search-docs', 'name: docs-search');
        const r = await evaluate(await goodIndex({ digest: await digestOf(md) }), mdRoute(md));
        expect(r.status).toBe('err');
        expect(r.message).toMatch(/frontmatter name "docs-search" differs/);
    });

    it('compares descriptions after YAML unquoting and whitespace folding', async () => {
        const md = "---\nname: search-docs\ndescription: 'It''s a  search skill.'\n---\nbody\n";
        const r = await evaluate(await goodIndex({ description: "It's a search skill.", digest: await digestOf(md) }), mdRoute(md));
        expect(r.status).toBe('ok');
    });

    it('reports only checked skills in the partial ratio', async () => {
        const idx = await goodIndex();
        const base = idx.skills[0];
        idx.skills = Array.from({ length: 7 }, (_, i) => ({ ...base, name: `s${i}`, url: `/s${i}.md`, digest: undefined }));
        const routes = {};
        for (let i = 0; i < 7; i++) {
            const md = `---\nname: s${i}\ndescription: ${base.description}\n---\n`;
            idx.skills[i].digest = await digestOf(md);
            routes[`/s${i}.md`] = () => new Response(md, { headers: { 'Content-Type': i === 0 ? 'application/octet-stream' : 'text/markdown' } });
        }
        const r = await evaluate(idx, routes);
        expect(r.status).toBe('warn');
        expect(r.message).toMatch(/^5\/5 checked skills usable \(first 5 of 7 checked\)/);
    });

    it('flags SKILL.md served with the wrong media type', async () => {
        const r = await evaluate(await goodIndex(), mdRoute(SKILL_MD, 'application/octet-stream'));
        expect(r.status).toBe('warn');
        expect(r.message).toMatch(/expected text\/markdown/);
    });

    it('flags an index not served as application/json', async () => {
        const r = await evaluate(await goodIndex(), mdRoute(), { cType: 'text/plain' });
        expect(r.status).toBe('warn');
        expect(r.message).toMatch(/must be application\/json/);
    });

    it('verifies archive digests and magic bytes', async () => {
        const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
        const idx = await goodIndex({ type: 'archive', url: '/skills/search-docs.zip', digest: `sha256:${await sha256Hex(zip)}` });
        const ok = await evaluate(idx, { '/skills/search-docs.zip': () => new Response(zip, { headers: { 'Content-Type': 'application/zip' } }) });
        expect(ok.status).toBe('ok');

        const notArchive = new TextEncoder().encode('hello');
        const idx2 = await goodIndex({ type: 'archive', url: '/skills/search-docs.zip', digest: `sha256:${await sha256Hex(notArchive)}` });
        const bad = await evaluate(idx2, { '/skills/search-docs.zip': () => new Response(notArchive) });
        expect(bad.status).toBe('err');
        expect(bad.message).toMatch(/neither \.tar\.gz nor \.zip/);
    });

    it('warns on a legacy index without $schema', async () => {
        const r = await evaluate({ skills: [{ name: 'x', description: 'y', files: ['SKILL.md'] }] });
        expect(r.status).toBe('warn');
        expect(r.message).toMatch(/legacy v0\.1\.0/);
    });

    it('warns and does not process an unknown $schema', async () => {
        const r = await evaluate({ $schema: 'https://example.com/other.json', skills: [] });
        expect(r.status).toBe('warn');
        expect(r.code).toBe('Unknown Schema');
    });

    it('rejects the old ad-hoc endpoint/method format', async () => {
        const r = await evaluate({ $schema: AGENT_SKILLS_SCHEMA_V020, skills: [{ name: 'AuditPlatform', description: 'x', endpoint: '/api/audit', method: 'GET' }] });
        expect(r.status).toBe('err');
        expect(r.code).toBe('Non-compliant');
    });

    it('handles invalid JSON, soft 404 and auth', async () => {
        expect((await evaluateAgentSkillsIndex(json('{nope'), 200, 'application/json', INDEX_URL, origin({}))).code).toBe('Invalid JSON');
        expect((await evaluateAgentSkillsIndex(json('<html>'), 200, 'text/html', INDEX_URL, origin({}))).code).toBe('Soft 404');
        expect((await evaluateAgentSkillsIndex(json(''), 401, '', INDEX_URL, origin({}))).status).toBe('warn');
        expect((await evaluateAgentSkillsIndex(json(''), 404, '', INDEX_URL, origin({}))).code).toBe('Missing');
    });
});

describe('AI-Valid own Agent Skills index', () => {
    const selfFetch = (url, opts = {}) => index.fetch(new Request(url, opts), {}, {});

    it('passes its own check', async () => {
        const url = 'https://localhost/.well-known/agent-skills/index.json';
        const res = await selfFetch(url);
        const r = await evaluateAgentSkillsIndex(res, res.status, res.headers.get('content-type').toLowerCase(), url, selfFetch);
        expect(r).toMatchObject({ status: 'ok', code: 'Compliant' });
    });

    it('answers HEAD without a body', async () => {
        const res = await selfFetch('https://localhost/.well-known/agent-skills/ai-readiness-audit/SKILL.md', { method: 'HEAD' });
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toMatch(/text\/markdown/);
        expect(await res.text()).toBe('');
    });
});

describe('Agent Skills check in a full audit', () => {
    it('reports a compliant index as Compliant', async () => {
        const idx = await goodIndex();
        const originalFetch = global.fetch;
        global.fetch = async (url) => {
            const u = url.toString();
            if (u.includes('cloudflare-dns.com')) {
                return new Response(JSON.stringify({ Answer: [{ type: 1, data: '93.184.216.34' }] }));
            }
            if (u === INDEX_URL) return json(idx);
            if (u === 'https://example.com/.well-known/agent-skills/search-docs/SKILL.md') {
                return new Response(SKILL_MD, { headers: { 'Content-Type': 'text/markdown' } });
            }
            return new Response('Not Found', { status: 404 });
        };
        try {
            const res = await index.fetch(new Request(`https://localhost/api/audit?targetUrl=${encodeURIComponent('https://example.com')}`), {}, {});
            const data = await res.json();
            const check = data.protocols.results.find(c => c.name === 'Agent Skills');
            expect(check.status).toBe('ok');
            expect(check.code).toBe('Compliant');
        } finally {
            global.fetch = originalFetch;
        }
    });
});
