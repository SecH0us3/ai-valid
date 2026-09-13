import { describe, it, expect } from 'vitest';
import { scoreAudit, gradeFor, topPriorities, buildPrompt, countSyllables, createLimiter, checkRateLimit, CHECK_CATALOG, getCheckMeta, renderAuditMarkdown } from '../src/index.js';

describe('scoreAudit', () => {
    it('reports a percentage of the weight actually available', () => {
        const score = scoreAudit([
            { name: 'robots.txt', status: 'ok' },        // weight 10
            { name: 'sitemap.xml', status: 'err' }       // weight 10
        ]);
        expect(score.total).toBe(50);
        expect(score.max).toBe(100);
        expect(score.earnedPoints).toBe(10);
        expect(score.possiblePoints).toBe(20);
    });

    it('no longer saturates at 100 for a partially ready site', () => {
        // The old implementation summed ~300 points against a hard cap of 100,
        // so clearing a third of the checks reported a perfect score.
        const checks = Object.keys(CHECK_CATALOG).map((name, i) => ({
            name,
            status: i % 3 === 0 ? 'ok' : 'err'
        }));
        const score = scoreAudit(checks);
        expect(score.total).toBeGreaterThan(0);
        expect(score.total).toBeLessThan(60);
    });

    it('excludes advisory policy checks from the score entirely', () => {
        const withPolicyMissing = scoreAudit([
            { name: 'robots.txt', status: 'ok' },
            { name: 'AI Training Blocked', status: 'warn' },
            { name: 'NoAI Meta Tag', status: 'warn' },
            { name: 'TDM Reservation', status: 'err' }
        ]);
        // Only robots.txt counts, so a site that deliberately welcomes AI
        // training is not penalised for that choice.
        expect(withPolicyMissing.total).toBe(100);
        expect(withPolicyMissing.possiblePoints).toBe(getCheckMeta('robots.txt').weight);
    });

    it('gives partial credit for resources that exist but are gated', () => {
        const gated = scoreAudit([{ name: 'MCP Server', status: 'warn', code: 'Protected' }]);
        const missing = scoreAudit([{ name: 'MCP Server', status: 'err', code: 'Missing' }]);
        expect(gated.total).toBe(50);
        expect(missing.total).toBe(0);
    });

    it('breaks the score down by category', () => {
        const score = scoreAudit([
            { name: 'robots.txt', status: 'ok' },
            { name: 'sitemap.xml', status: 'ok' },
            { name: 'LLMs.txt', status: 'err' }
        ]);
        expect(score.categories.Discoverability.total).toBe(100);
        expect(score.categories['Agent Protocols'].total).toBe(0);
    });

    it('handles an empty check list without dividing by zero', () => {
        expect(scoreAudit([]).total).toBe(0);
    });
});

describe('gradeFor', () => {
    it('maps percentages onto grades', () => {
        expect(gradeFor(100)).toBe('A+');
        expect(gradeFor(90)).toBe('A+');
        expect(gradeFor(85)).toBe('A');
        expect(gradeFor(60)).toBe('C');
        expect(gradeFor(0)).toBe('F');
    });
});

describe('topPriorities', () => {
    it('ranks the heaviest failures first and skips passing checks', () => {
        const priorities = topPriorities([
            { name: 'Clean URLs', status: 'warn', message: 'x' },          // weight 1
            { name: 'LLMs.txt', status: 'err', message: 'y' },             // weight 10
            { name: 'AGENTS.md', status: 'err', message: 'z' },            // weight 6
            { name: 'robots.txt', status: 'ok', message: 'fine' }
        ]);
        expect(priorities.map(p => p.name)).toEqual(['LLMs.txt', 'AGENTS.md', 'Clean URLs']);
        expect(priorities.every(p => p.status !== 'ok')).toBe(true);
    });

    it('leaves advisory policy checks out of the recommendations', () => {
        const priorities = topPriorities([{ name: 'AI Training Blocked', status: 'warn', message: 'x' }]);
        expect(priorities).toEqual([]);
    });

    it('prefers a hard miss over a warning of equal weight', () => {
        const priorities = topPriorities([
            { name: 'Content Freshness', status: 'warn', message: 'a' },
            { name: 'Authorship (E-E-A-T)', status: 'err', message: 'b' }
        ]);
        expect(priorities[0].name).toBe('Authorship (E-E-A-T)');
    });
});

describe('buildPrompt', () => {
    it('carries the audited origin and the actual finding into the prompt', () => {
        const prompt = buildPrompt(
            { name: 'LLMs.txt', status: 'err', message: 'Not found (404)', spec: 'https://llmstxt.org/' },
            'https://acme.test'
        );
        expect(prompt).toContain('https://acme.test');
        expect(prompt).toContain('Not found (404)');
        expect(prompt).toContain('Specification: https://llmstxt.org/');
        expect(prompt).toContain('Done when:');
    });

    it('substitutes the origin into the verification commands', () => {
        const prompt = buildPrompt({ name: 'LLMs.txt', status: 'err', message: 'missing' }, 'https://acme.test');
        expect(prompt).toContain('curl -s https://acme.test/llms.txt');
        expect(prompt).not.toContain('ORIGIN');
    });

    it('asks for a review rather than a rewrite when the check already passes', () => {
        const prompt = buildPrompt({ name: 'LLMs.txt', status: 'ok', message: 'Compliant' }, 'https://acme.test');
        expect(prompt).toContain('already in place');
        expect(prompt).toContain('do not rewrite it wholesale');
    });

    it('tells the assistant to ask for real values instead of inventing them', () => {
        const prompt = buildPrompt({ name: 'security.txt', status: 'err', message: 'missing' }, 'https://acme.test');
        expect(prompt).toContain('ask me for it rather than filling in a placeholder');
    });

    it('falls back to the inline prompt for an unknown check', () => {
        const prompt = buildPrompt({ name: 'Nonexistent Check', status: 'err', prompt: 'fallback text' }, 'https://acme.test');
        expect(prompt).toBe('fallback text');
    });
});

describe('countSyllables', () => {
    it('does not count a silent terminal e as its own syllable', () => {
        expect(countSyllables('make')).toBe(1);
        expect(countSyllables('one')).toBe(1);
    });

    it('treats a vowel run as a single syllable', () => {
        expect(countSyllables('queue')).toBe(1);
    });

    it('counts multi-syllable words', () => {
        expect(countSyllables('readability')).toBe(5);
    });

    it('never returns zero, so the reading-ease divisor stays safe', () => {
        expect(countSyllables('')).toBe(1);
        expect(countSyllables('xyz')).toBe(1);
    });

    it('counts Cyrillic syllables by vowel', () => {
        expect(countSyllables('привет', true)).toBe(2);
    });
});

describe('createLimiter', () => {
    it('never runs more than the limit concurrently', async () => {
        const limit = createLimiter(2);
        let active = 0;
        let peak = 0;
        const task = () => limit(async () => {
            active++;
            peak = Math.max(peak, active);
            await new Promise(r => setTimeout(r, 5));
            active--;
        });
        await Promise.all(Array.from({ length: 10 }, task));
        expect(peak).toBeLessThanOrEqual(2);
    });

    it('frees its slot when a task rejects', async () => {
        const limit = createLimiter(1);
        await expect(limit(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
        await expect(limit(async () => 'ok')).resolves.toBe('ok');
    });

    it('returns each task its own result', async () => {
        const limit = createLimiter(3);
        const results = await Promise.all([1, 2, 3, 4].map(n => limit(async () => n * 2)));
        expect(results).toEqual([2, 4, 6, 8]);
    });
});

describe('renderAuditMarkdown', () => {
    const result = {
        target: 'https://acme.test',
        generatedAt: '2026-01-01T00:00:00.000Z',
        score: { total: 60, max: 100, grade: 'C', categories: { Content: { total: 80 } } },
        priorities: [{ name: 'LLMs.txt', status: 'err', weight: 10, category: 'Agent Protocols', message: 'Not found', prompt: 'do it', spec: 'https://llmstxt.org/' }],
        bots: { results: [{ name: 'robots.txt', status: 'ok', code: 'Found', message: 'Found manifest file' }] },
        content: { results: [] },
        protocols: { results: [] }
    };

    it('renders a readable report with the score and priorities', () => {
        const md = renderAuditMarkdown(result);
        expect(md).toContain('# AI Readiness Audit — https://acme.test');
        expect(md).toContain('**60/100** (grade C)');
        expect(md).toContain('## Fix these first');
        expect(md).toContain('| robots.txt | ✅ Found | Found manifest file |');
    });

    it('escapes pipes so a message cannot break the table', () => {
        const md = renderAuditMarkdown({
            ...result,
            bots: { results: [{ name: 'robots.txt', status: 'ok', code: 'Found', message: 'a | b' }] }
        });
        expect(md).toContain('a \\| b');
    });
});

describe('checkRateLimit', () => {
    it('allows a burst up to the limit, then refuses', () => {
        const key = 'client-a';
        const now = 1_000_000;
        for (let i = 0; i < 20; i++) {
            expect(checkRateLimit(key, now).allowed).toBe(true);
        }
        const blocked = checkRateLimit(key, now);
        expect(blocked.allowed).toBe(false);
        expect(blocked.retryAfter).toBeGreaterThan(0);
    });

    it('counts each client separately', () => {
        const now = 2_000_000;
        for (let i = 0; i < 20; i++) checkRateLimit('client-b', now);
        expect(checkRateLimit('client-b', now).allowed).toBe(false);
        expect(checkRateLimit('client-c', now).allowed).toBe(true);
    });

    it('reopens the bucket once the window has passed', () => {
        const key = 'client-d';
        const now = 3_000_000;
        for (let i = 0; i < 20; i++) checkRateLimit(key, now);
        expect(checkRateLimit(key, now).allowed).toBe(false);
        expect(checkRateLimit(key, now + 60_001).allowed).toBe(true);
    });

    it('does not throttle requests with no identifiable client', () => {
        for (let i = 0; i < 50; i++) {
            expect(checkRateLimit(null, 4_000_000).allowed).toBe(true);
        }
    });

    it('reports the remaining allowance', () => {
        expect(checkRateLimit('client-e', 5_000_000).remaining).toBe(19);
        expect(checkRateLimit('client-e', 5_000_000).remaining).toBe(18);
    });
});
