import { describe, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(here, '../public/index.html'), 'utf8');
const clientSource = readFileSync(resolve(here, '../public/app.client.js'), 'utf8');

/** A minimal audit payload in the shape the worker now returns. */
function auditPayload(overrides = {}) {
    return {
        target: 'https://acme.test',
        score: {
            total: 62,
            max: 100,
            grade: 'C',
            categories: {
                Discoverability: { total: 100, earned: 39, possible: 39 },
                'Agent Protocols': { total: 0, earned: 0, possible: 42 },
                Content: { total: 80, earned: 40, possible: 50 }
            }
        },
        priorities: [
            { name: 'LLMs.txt', status: 'err', weight: 10, category: 'Agent Protocols', message: 'Not found (404)' },
            { name: 'AGENTS.md', status: 'err', weight: 6, category: 'Agent Protocols', message: 'Not found (404)' }
        ],
        bots: { results: [{ name: 'robots.txt', status: 'ok', code: 'Found', message: 'Found manifest file', weight: 10, category: 'Discoverability' }] },
        content: { results: [{ name: 'AI Training Blocked', status: 'warn', code: 'Missing', message: 'Training not blocked', weight: 0, category: 'Policy', advisory: true }] },
        protocols: { results: [{ name: 'LLMs.txt', status: 'err', code: 'Missing', message: 'Not found (404)', weight: 10, category: 'Agent Protocols', tooltip: '<strong>What</strong>', prompt: 'Goal: ...', spec: 'https://llmstxt.org/' }] },
        ...overrides
    };
}

/**
 * Loads the real index.html into its own window and runs the real client
 * against a stubbed API. A fresh window per test matters: the script registers
 * a DOMContentLoaded listener and closes over the elements it finds, so reusing
 * one document leaves earlier listeners rendering into detached nodes.
 */
function mountApp(apiResponse) {
    // runScripts: 'outside-only' gives the window its own eval, so the client
    // binds to this document rather than to the test environment's global one.
    const dom = new JSDOM(html, {
        url: 'https://ai-valid.test/',
        runScripts: 'outside-only',
        pretendToBeVisual: true
    });
    const { window } = dom;

    window.fetch = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => apiResponse
    }));
    // Advance the clock a full animation duration per frame so the count-up
    // finishes in two frames. A constant timestamp would recurse forever,
    // because the animation only stops once elapsed time reaches its duration.
    let frameClock = 0;
    window.requestAnimationFrame = (cb) => { frameClock += 1000; cb(frameClock); return 0; };

    window.eval(clientSource);
    window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
    return window;
}

async function renderDashboard(payload = auditPayload()) {
    const window = mountApp(payload);
    const { document } = window;
    document.getElementById('url-input').value = 'acme.test';
    document.getElementById('audit-form').dispatchEvent(new window.Event('submit', { cancelable: true }));

    await vi.waitFor(() => {
        if (document.getElementById('results-dashboard').classList.contains('hidden')) {
            throw new Error('dashboard still hidden');
        }
    });
    return document;
}

describe('dashboard rendering', () => {
    it('shows the overall score and grade the API reported', async () => {
        const document = await renderDashboard();
        expect(document.getElementById('score-value').textContent).toBe('62');
        expect(document.getElementById('score-grade').textContent).toBe('GRADE C');
    });

    it('draws the gauge arc in proportion to the score', async () => {
        const document = await renderDashboard();
        const fill = document.getElementById('gauge-fill');
        const circumference = 2 * Math.PI * 52;
        const expected = circumference * (1 - 62 / 100);
        expect(parseFloat(fill.style.strokeDashoffset)).toBeCloseTo(expected, 1);
        expect(fill.classList.contains('grade-mid')).toBe(true);
    });

    it('lists categories weakest first so the gap is obvious', async () => {
        const document = await renderDashboard();
        const names = [...document.querySelectorAll('#category-bars .category-name')].map(n => n.textContent);
        expect(names).toEqual(['Agent Protocols', 'Content', 'Discoverability']);
    });

    it('renders the priority shortlist with its point values', async () => {
        const document = await renderDashboard();
        const panel = document.getElementById('priorities-panel');
        expect(panel.hidden).toBe(false);
        const items = [...document.querySelectorAll('#priorities-list .priority-item')];
        expect(items).toHaveLength(2);
        expect(items[0].querySelector('.priority-name').textContent).toBe('LLMs.txt');
        expect(items[0].querySelector('.priority-weight').textContent).toBe('+10 pts');
    });

    it('hides the priority panel when nothing is outstanding', async () => {
        const document = await renderDashboard(auditPayload({ priorities: [] }));
        expect(document.getElementById('priorities-panel').hidden).toBe(true);
    });

    it('labels each check with the weight the API sent', async () => {
        const document = await renderDashboard();
        const badges = [...document.querySelectorAll('.proto-weight')].map(b => b.textContent);
        expect(badges).toContain('10pt');
    });

    it('marks advisory policy checks as advisory rather than as points', async () => {
        const document = await renderDashboard();
        const badges = [...document.querySelectorAll('.proto-weight')].map(b => b.textContent);
        expect(badges).toContain('advisory');
    });

    it('sorts checks by weight, heaviest first', async () => {
        const payload = auditPayload({
            bots: { results: [
                { name: 'Light', status: 'err', code: 'Missing', message: 'm', weight: 1, category: 'Content' },
                { name: 'Heavy', status: 'err', code: 'Missing', message: 'm', weight: 10, category: 'Content' }
            ] },
            content: { results: [] },
            protocols: { results: [] }
        });
        const document = await renderDashboard(payload);
        const names = [...document.querySelectorAll('#failed-grid .proto-name')].map(n => n.textContent.trim());
        expect(names[0]).toContain('Heavy');
    });

    it('renders each check card with its status and message', async () => {
        const document = await renderDashboard();
        const passedCards = document.querySelectorAll('#passed-grid .protocol-card');
        expect(passedCards).toHaveLength(1);
        expect(passedCards[0].querySelector('.proto-msg').textContent).toBe('Found manifest file');
        expect(document.getElementById('summary-passed').textContent).toBe('1');
    });

    it('surfaces a scan error instead of an empty dashboard', async () => {
        const window = mountApp({ error: 'Domain does not exist or is unreachable' });
        const { document } = window;
        document.getElementById('url-input').value = 'nope.test';
        document.getElementById('audit-form').dispatchEvent(new window.Event('submit', { cancelable: true }));

        const errorEl = document.getElementById('error-message');
        await vi.waitFor(() => {
            if (errorEl.classList.contains('hidden')) throw new Error('error not shown');
        });
        expect(errorEl.textContent).toContain('unreachable');
        expect(document.getElementById('results-dashboard').classList.contains('hidden')).toBe(true);
    });
});
