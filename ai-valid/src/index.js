import htmlTemplate from '../public/index.html';
import cssContent from '../public/style.css';
import jsContent from '../public/app.client.js';
import faviconSvg from '../public/favicon.svg';
import ogImage from '../public/og-image.png';
import llmsTxt from '../public/llms.txt';
import llmsFullTxt from '../public/llms-full.txt';
import openApiJson from '../public/openapi.json';
import tdmrepJson from "../public/.well-known/tdmrep.json";
import tdmPolicyJson from "../public/policies/tdm-policy.json";
import apiCatalogTxt from '../public/api-catalog.txt';
import x402Json from "../public/.well-known/x402.json";
import agentsMd from "../public/AGENTS.md";
import agentsJson from "../public/.well-known/agents.json";


const FETCH_TIMEOUT = 5000;

// Maximum number of outbound sub-requests kept in flight at once. Cloudflare
// allows 6 simultaneous connections per Worker invocation; anything above that
// is queued by the runtime anyway, so we queue it ourselves and keep the
// ordering predictable.
const MAX_CONCURRENCY = 6;

// Resolving a hostname through DNS-over-HTTPS costs two sub-requests (A + AAAA).
// A single audit touches ~25 URLs on the same host, so without memoisation the
// SSRF guard alone burns 50 sub-requests and blows the per-invocation limit.
// Positive results are held only briefly: caching "this host is safe" for long
// would widen the DNS-rebinding window the guard exists to close. Negative
// results are safe to hold longer.
const DNS_CACHE_TTL_SAFE = 60 * 1000;
const DNS_CACHE_TTL_UNSAFE = 5 * 60 * 1000;
const DNS_CACHE_MAX = 500;
const dnsSafetyCache = new Map();

function getCachedHostSafety(hostname) {
    const hit = dnsSafetyCache.get(hostname);
    if (!hit) return undefined;
    if (hit.expires < Date.now()) {
        dnsSafetyCache.delete(hostname);
        return undefined;
    }
    return hit.safe;
}

function setCachedHostSafety(hostname, safe) {
    if (dnsSafetyCache.size >= DNS_CACHE_MAX) {
        const oldest = dnsSafetyCache.keys().next().value;
        if (oldest !== undefined) dnsSafetyCache.delete(oldest);
    }
    const ttl = safe ? DNS_CACHE_TTL_SAFE : DNS_CACHE_TTL_UNSAFE;
    dnsSafetyCache.set(hostname, { safe, expires: Date.now() + ttl });
}

/**
 * Runs tasks with a bounded number of them in flight at any one time.
 * Returns a function that queues a task and resolves with its result.
 */
export function createLimiter(limit) {
    let active = 0;
    const queue = [];

    const drain = () => {
        if (active >= limit || queue.length === 0) return;
        const task = queue.shift();
        active++;
        Promise.resolve()
            .then(task.fn)
            .then(task.resolve, task.reject)
            .finally(() => {
                active--;
                drain();
            });
    };

    return (fn) => new Promise((resolve, reject) => {
        queue.push({ fn, resolve, reject });
        drain();
    });
}

/** Thrown when the target origin cannot be reached at all. */
class UnreachableTargetError extends Error {}

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept"
};

const STATIC_ROUTES = {
    "/": (request) => {
        const accept = request.headers.get("Accept") || "";
        if (accept.includes("text/markdown")) {
            const mdContent = `# AI-Valid | AI Readiness Audit\n\nInstant analysis of your site's accessibility for intelligent agents, crawlers, and modern AI protocols.\n\n## API Usage\nSend a GET request to \`/api/audit\` with a \`targetUrl\` query parameter:\n\n\`\`\`bash\ncurl "https://<your-worker-domain>/api/audit?targetUrl=https://example.com"\n\`\`\`\n`;
            return new Response(mdContent, {
                headers: { 
                    "Content-Type": "text/markdown; charset=utf-8",
                    "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
                    "Vary": "Accept",
                    ...corsHeaders
                },
            });
        }
        return new Response(htmlTemplate, {
            headers: { 
                "Content-Type": "text/html; charset=utf-8",
                "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
                "Vary": "Accept",
                ...corsHeaders
            },
        });
    },
    "/style.css": () => new Response(cssContent, {
        headers: { 
            "Content-Type": "text/css; charset=utf-8",
            "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
            ...corsHeaders
        },
    }),
    "/app.client.js": () => new Response(jsContent, {
        headers: { 
            "Content-Type": "application/javascript; charset=utf-8",
            "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
            ...corsHeaders
        },
    }),
    "/favicon.svg": () => new Response(faviconSvg, {
        headers: { 
            "Content-Type": "image/svg+xml",
            "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
            ...corsHeaders
        },
    }),
    "/favicon.ico": () => new Response(faviconSvg, {
        headers: { 
            "Content-Type": "image/svg+xml",
            "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
            ...corsHeaders
        },
    }),
    "/og-image.png": () => new Response(ogImage, {
        headers: { 
            "Content-Type": "image/png",
            "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
            ...corsHeaders
        },
    }),
    "/llms-full.txt": () => new Response(llmsFullTxt, {
        headers: { 
            "Content-Type": "text/markdown; charset=utf-8",
            "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
            ...corsHeaders
        },
    }),
    "/llms.txt": () => new Response(llmsTxt, {
        headers: { 
            "Content-Type": "text/markdown; charset=utf-8",
            "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
            ...corsHeaders
        },
    }),
    "/openapi.json": () => new Response(openApiJson, {
        headers: { 
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
            ...corsHeaders
        },
    }),
    "/.well-known/api-catalog": () => new Response(apiCatalogTxt, {
        headers: { 
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
            ...corsHeaders
        },
    }),
    "/.well-known/tdmrep.json": () => new Response(tdmrepJson, {
        headers: { 
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
            ...corsHeaders
        },
    }),
    "/policies/tdm-policy.json": () => new Response(tdmPolicyJson, {
        headers: { 
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
            ...corsHeaders
        },
    }),
    "/.well-known/agent-skills/index.json": () => {
        const agentSkills = {
            "skills": [
                {
                    "name": "AuditPlatform",
                    "description": "Performs an AI readiness audit on a given URL. Validates protocols like llms.txt, API Catalogs, MCP, and AI bot accessibility.",
                    "endpoint": "/api/audit",
                    "method": "GET"
                }

            ]
        };
        return new Response(JSON.stringify(agentSkills, null, 2), {
            headers: { 
                "Content-Type": "application/json; charset=utf-8",
                "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
                ...corsHeaders
            },
        });
    },
    "/.well-known/x402.json": () => {
        let content = "";
        if (typeof x402Json === 'object' && x402Json !== null) {
            content = JSON.stringify(x402Json, null, 2);
        } else if (typeof x402Json === 'string' && (x402Json.trim().startsWith('{') || x402Json.trim().startsWith('['))) {
            content = x402Json;
        }
        const body = content || JSON.stringify({
            x402Version: 2,
            endpoints: [
                {
                    url: "/api/audit",
                    description: "AI-Readiness Audit Platform API",
                    amount: "0",
                    currency: "USDC",
                    network: "eip155:8453",
                    payTo: "0x0000000000000000000000000000000000000000"
                }
            ]
        }, null, 2);
        return new Response(body, {
            headers: { 
                "Content-Type": "application/json; charset=utf-8",
                "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
                ...corsHeaders
            },
        });
    },
    "/.well-known/security.txt": () => {
        const securityTxt = `Contact: mailto:security@secmy.app\nExpires: 2027-12-31T23:59:59.000Z\nPreferred-Languages: en\nCanonical: https://ai-valid.secmy.app/.well-known/security.txt\nPolicy: https://github.com/SecH0us3/ai-valid/security/policy\n`;
        return new Response(securityTxt, {
            headers: {
                "Content-Type": "text/plain; charset=utf-8",
                "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
                ...corsHeaders
            }
        });
    },
    "/robots.txt": () => {
        const robotsTxt = `User-agent: *\nAllow: /\n\nUser-agent: GPTBot\nDisallow: /\n\nUser-agent: ClaudeBot\nDisallow: /\n\nUser-agent: Google-Extended\nDisallow: /\n\nUser-agent: Amazonbot\nDisallow: /\n\nUser-agent: Applebot-Extended\nDisallow: /\n\nUser-agent: OAI-SearchBot\nAllow: /\n\nUser-agent: ChatGPT-User\nAllow: /\n\nUser-agent: PerplexityBot\nAllow: /\n`;
        return new Response(robotsTxt, {
            headers: {
                "Content-Type": "text/plain; charset=utf-8",
                "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
                ...corsHeaders
            }
        });
    },
    "/.well-known/mcp/server-card.json": (request) => {
        const origin = new URL(request.url).origin;
        // The card is generated from the same tool definitions the live /mcp
        // endpoint serves, so the two cannot describe different servers.
        const serverCard = {
            "serverInfo": {
                "name": "ai-valid",
                "title": "AI-Valid Readiness Auditor",
                "version": "1.0.0"
            },
            "protocolVersion": MCP_PROTOCOL_VERSION,
            "description": "AI-Readiness Audit Platform MCP Server",
            "url": `${origin}/mcp`,
            "endpoints": {
                "http": `${origin}/mcp`
            },
            "capabilities": { "tools": { "listChanged": false } },
            "tools": MCP_TOOLS
        };
        return new Response(JSON.stringify(serverCard, null, 2), {
            headers: {
                "Content-Type": "application/json; charset=utf-8",
                "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
                ...corsHeaders
            }
        });
    },
    "/.well-known/agent-card.json": () => {
        const agentCard = {
            "name": "AI-Valid Auditor",
            "description": "Autonomous AI Readiness and GEO audit agent",
            "version": "1.0.0",
            "url": "https://ai-valid.secmy.app",
            "capabilities": [
                "ai-readiness-audit",
                "geo-analysis",
                "robots-policy-check"
            ],
            "endpoints": [
                {
                    "path": "/api/audit",
                    "method": "GET",
                    "description": "Execute AI readiness audit on target URL"
                }
            ]
        };
        return new Response(JSON.stringify(agentCard, null, 2), {
            headers: {
                "Content-Type": "application/json; charset=utf-8",
                "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
                ...corsHeaders
            }
        });
    },
    "/AGENTS.md": () => {
        const mdText = typeof agentsMd === 'string' && agentsMd.startsWith('#') ? agentsMd : `# AGENTS.md — AI-Valid Agent Guidelines\n\n> Autonomous agent operating manual and integration rules for AI-Valid.\n\n## Overview\nAI-Valid is a web-based AI-Readiness and Generative Engine Optimization (GEO) audit platform. Autonomous AI agents can invoke our public endpoints to inspect websites, validate compliance with emerging machine protocols, and retrieve structured diagnostic reports.\n\n## Core Capabilities\n- **AI Audit**: Analyze websites for robots.txt, llms.txt, MCP server manifests, WebMCP widgets, Schema.org metadata, and RSS feeds.\n- **Protocol Discovery**: Validate A2A, UCP, RFC 9727 API Catalog, RFC 8414 OAuth, and x402 payment configurations.\n\n## API Integration for Agents\n\`\`\`http\nGET /api/audit?targetUrl=https://example.com HTTP/1.1\nHost: ai-valid.secmy.app\nAccept: application/json\n\`\`\`\n\n## Agent Operating Constraints & Guardrails\n- **Rate Limiting**: Honor Retry-After headers and maintain polite request intervals.\n- **Target URL Validation**: Ensure targetUrl parameter contains a valid HTTP or HTTPS scheme.\n`;
        return new Response(mdText, {
            headers: {
                "Content-Type": "text/markdown; charset=utf-8",
                "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
                ...corsHeaders
            }
        });
    },
    "/.well-known/agents.md": () => {
        const mdText = typeof agentsMd === 'string' && agentsMd.startsWith('#') ? agentsMd : `# AGENTS.md — AI-Valid Agent Guidelines\n\n> Autonomous agent operating manual and integration rules for AI-Valid.\n\n## Overview\nAI-Valid is a web-based AI-Readiness and Generative Engine Optimization (GEO) audit platform. Autonomous AI agents can invoke our public endpoints to inspect websites, validate compliance with emerging machine protocols, and retrieve structured diagnostic reports.\n\n## Core Capabilities\n- **AI Audit**: Analyze websites for robots.txt, llms.txt, MCP server manifests, WebMCP widgets, Schema.org metadata, and RSS feeds.\n- **Protocol Discovery**: Validate A2A, UCP, RFC 9727 API Catalog, RFC 8414 OAuth, and x402 payment configurations.\n\n## API Integration for Agents\n\`\`\`http\nGET /api/audit?targetUrl=https://example.com HTTP/1.1\nHost: ai-valid.secmy.app\nAccept: application/json\n\`\`\`\n\n## Agent Operating Constraints & Guardrails\n- **Rate Limiting**: Honor Retry-After headers and maintain polite request intervals.\n- **Target URL Validation**: Ensure targetUrl parameter contains a valid HTTP or HTTPS scheme.\n`;
        return new Response(mdText, {
            headers: {
                "Content-Type": "text/markdown; charset=utf-8",
                "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
                ...corsHeaders
            }
        });
    },
    "/.well-known/agents.json": () => {
        let content = "";
        if (typeof agentsJson === 'object' && agentsJson !== null && agentsJson.name) {
            content = JSON.stringify(agentsJson, null, 2);
        } else if (typeof agentsJson === 'string' && (agentsJson.trim().startsWith('{') || agentsJson.trim().startsWith('['))) {
            try {
                const parsed = JSON.parse(agentsJson);
                if (parsed.name) content = JSON.stringify(parsed, null, 2);
            } catch {}
        }
        if (!content) {
            content = JSON.stringify({
                "name": "ai-valid-agent",
                "version": "1.0.0",
                "description": "AI-Readiness and GEO Audit Agent for modern web platforms",
                "homepage": "https://ai-valid.secmy.app",
                "documentation": "https://ai-valid.secmy.app/AGENTS.md",
                "capabilities": [
                    {
                        "name": "audit_website",
                        "description": "Performs AI readiness analysis for a given URL",
                        "endpoint": "/api/audit",
                        "method": "GET",
                        "parameters": {
                            "targetUrl": {
                                "type": "string",
                                "required": true,
                                "description": "URL to audit"
                            }
                        }
                    }
                ]
            }, null, 2);
        }
        return new Response(content, {
            headers: {
                "Content-Type": "application/json; charset=utf-8",
                "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
                ...corsHeaders
            }
        });
    },
    "/.well-known/oauth-protected-resource/mcp": () => {
        const resourceMeta = {
            "resource": "https://ai-valid.secmy.app/mcp",
            "authorization_servers": [
                "https://ai-valid.secmy.app"
            ],
            "bearer_methods_supported": [
                "header"
            ],
            "scopes_supported": [
                "mcp:read",
                "mcp:write"
            ]
        };
        return new Response(JSON.stringify(resourceMeta, null, 2), {
            headers: {
                "Content-Type": "application/json; charset=utf-8",
                "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
                ...corsHeaders
            }
        });
    },
    "/.well-known/oauth-protected-resource": () => {
        const resourceMeta = {
            "resource": "https://ai-valid.secmy.app",
            "authorization_servers": [
                "https://ai-valid.secmy.app"
            ],
            "bearer_methods_supported": [
                "header"
            ]
        };
        return new Response(JSON.stringify(resourceMeta, null, 2), {
            headers: {
                "Content-Type": "application/json; charset=utf-8",
                "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
                ...corsHeaders
            }
        });
    }
};


/**
 * Single source of truth for how much each check counts and where it belongs.
 *
 * `weight` drives the score, the ordering of the result lists and the
 * "fix this next" ranking in the UI. Before this table those three things
 * lived in four separate hard-coded maps that had already drifted apart.
 *
 * Tiers:
 *   10 - table stakes; a site that misses these is invisible or unreadable to agents
 *    6 - strong signal, applicable to essentially every site
 *    3 - advanced or emerging protocol
 *    1 - niche; only meaningful for a subset of sites, so it barely moves the score
 *
 * `advisory: true` marks a check that reports a *policy choice* rather than a
 * defect. Blocking AI training is a legitimate business decision in either
 * direction, so those checks are reported but left out of the score entirely.
 */
export const CHECK_CATALOG = {
    // --- Discoverability & bot policy ---
    "robots.txt":                  { weight: 10, category: "Discoverability" },
    "sitemap.xml":                 { weight: 10, category: "Discoverability" },
    "AI Search Allowed":           { weight: 10, category: "Discoverability" },
    "AI Agent Allowed":            { weight: 6,  category: "Discoverability" },
    "Sitemap Lastmod":             { weight: 3,  category: "Discoverability" },
    "AI Training Blocked":         { weight: 0,  category: "Policy", advisory: true },
    "Differentiated Policy":       { weight: 0,  category: "Policy", advisory: true },
    "NoAI Meta Tag":               { weight: 0,  category: "Policy", advisory: true },
    "TDM Reservation":             { weight: 0,  category: "Policy", advisory: true },
    "ai.txt":                      { weight: 0,  category: "Policy", advisory: true },
    "Content-Signal":              { weight: 3,  category: "Policy" },
    "Content-Use Parameter":       { weight: 1,  category: "Policy" },

    // --- Content structure & readability ---
    "HTML Title Tag":              { weight: 10, category: "Content" },
    "Meta Description":            { weight: 6,  category: "Content" },
    "HTML Lang Attribute":         { weight: 6,  category: "Content" },
    "Semantic HTML":               { weight: 6,  category: "Content" },
    "Heading Hierarchy":           { weight: 6,  category: "Content" },
    "Canonical URL":               { weight: 6,  category: "Content" },
    "Scannable Formats":           { weight: 3,  category: "Content" },
    "Internal Architecture":       { weight: 3,  category: "Content" },
    "Image Alt Text":              { weight: 3,  category: "Content" },
    "ARIA Accessibility":          { weight: 3,  category: "Content" },
    "Viewport Meta Tag":           { weight: 3,  category: "Content" },
    "Clean URLs":                  { weight: 1,  category: "Content" },
    "Content Depth":               { weight: 6,  category: "Content" },
    "Server-Rendered Content":     { weight: 10, category: "Content" },

    // --- Machine readability & freshness ---
    "Semantic JSON-LD":            { weight: 10, category: "Structured Data" },
    "Organization Schema":         { weight: 3,  category: "Structured Data" },
    "FAQ Schema":                  { weight: 3,  category: "Structured Data" },
    "Breadcrumb Schema":           { weight: 3,  category: "Structured Data" },
    "Site Search Schema":          { weight: 1,  category: "Structured Data" },
    "Authorship (E-E-A-T)":        { weight: 6,  category: "Trust" },
    "Content Freshness":           { weight: 6,  category: "Trust" },
    "External Citations":          { weight: 3,  category: "Trust" },
    "Quotation Addition":          { weight: 1,  category: "Trust" },
    "Statistics Addition":         { weight: 1,  category: "Trust" },
    "Fluency Optimization":        { weight: 3,  category: "Trust" },
    "Authoritative Voice":         { weight: 1,  category: "Trust" },

    // --- Delivery & caching ---
    "Content Neg. (MD)":           { weight: 6,  category: "Delivery" },
    "Freshness Headers":           { weight: 6,  category: "Delivery" },
    "Conditional Requests (304)":  { weight: 3,  category: "Delivery" },
    "X-Robots-Tag Header":         { weight: 3,  category: "Delivery" },
    "HTTPS & HSTS":                { weight: 6,  category: "Delivery" },
    "RSS/Atom Feed":               { weight: 3,  category: "Delivery" },
    "AI Fallback (No-JS)":         { weight: 1,  category: "Delivery" },

    // --- Agent protocols ---
    "LLMs.txt":                    { weight: 10, category: "Agent Protocols" },
    "AGENTS.md":                   { weight: 6,  category: "Agent Protocols" },
    "MCP Server":                  { weight: 6,  category: "Agent Protocols" },
    "LLMs-Full.txt":               { weight: 3,  category: "Agent Protocols" },
    "agents.json":                 { weight: 3,  category: "Agent Protocols" },
    "A2A Agent Card":              { weight: 3,  category: "Agent Protocols" },
    "Agent Skills":                { weight: 3,  category: "Agent Protocols" },
    "API Catalog":                 { weight: 3,  category: "Agent Protocols" },
    "AI Plugin":                   { weight: 1,  category: "Agent Protocols" },
    "WebMCP Integration":          { weight: 1,  category: "Agent Protocols" },
    "OAuth Discovery":             { weight: 1,  category: "Agent Protocols" },
    "OAuth Protected Resource":    { weight: 1,  category: "Agent Protocols" },
    "security.txt":                { weight: 1,  category: "Agent Protocols" },
    "Universal Commerce":          { weight: 1,  category: "Commerce" },
    "x402 Payment Standard":       { weight: 1,  category: "Commerce" }
};

const DEFAULT_CHECK_META = { weight: 3, category: "Other" };

export function getCheckMeta(name) {
    return CHECK_CATALOG[name] || DEFAULT_CHECK_META;
}

// Partial credit: a resource that exists but is gated behind auth, or a manifest
// that is present but incomplete, is worth more than nothing and less than a
// clean pass.
const PARTIAL_CREDIT_CODES = new Set(["Protected", "OAuth Protected", "Partial", "Manifest"]);

function creditFor(check) {
    if (check.status === 'ok') return 1;
    if (check.status === 'warn') return PARTIAL_CREDIT_CODES.has(check.code) ? 0.5 : 0;
    return 0;
}

export function gradeFor(percent) {
    if (percent >= 90) return 'A+';
    if (percent >= 80) return 'A';
    if (percent >= 70) return 'B';
    if (percent >= 60) return 'C';
    if (percent >= 45) return 'D';
    if (percent >= 25) return 'E';
    return 'F';
}

/**
 * Derives the score from the checks themselves rather than from points sprinkled
 * through the audit. Previously the running total could reach ~300 against a
 * hard cap of 100, so any site clearing a third of the checks reported "100%".
 */
export function scoreAudit(checks) {
    const categories = {};
    let earned = 0;
    let possible = 0;

    for (const check of checks) {
        const meta = getCheckMeta(check.name);
        if (meta.advisory || !meta.weight) continue;

        const credit = creditFor(check);
        earned += meta.weight * credit;
        possible += meta.weight;

        const bucket = categories[meta.category] || (categories[meta.category] = { earned: 0, possible: 0, total: 0 });
        bucket.earned += meta.weight * credit;
        bucket.possible += meta.weight;
    }

    for (const bucket of Object.values(categories)) {
        bucket.total = bucket.possible > 0 ? Math.round((bucket.earned / bucket.possible) * 100) : 0;
        bucket.earned = Math.round(bucket.earned * 10) / 10;
    }

    const total = possible > 0 ? Math.round((earned / possible) * 100) : 0;
    return {
        total,
        max: 100,
        grade: gradeFor(total),
        earnedPoints: Math.round(earned * 10) / 10,
        possiblePoints: possible,
        categories
    };
}

/**
 * The highest-weight failures, so the UI (and the API consumer) can lead with
 * the handful of changes that actually move the number.
 */
export function topPriorities(checks, take = 5) {
    return checks
        .filter(c => c.status !== 'ok' && !getCheckMeta(c.name).advisory && getCheckMeta(c.name).weight > 0)
        .sort((a, b) => {
            const byWeight = getCheckMeta(b.name).weight - getCheckMeta(a.name).weight;
            if (byWeight !== 0) return byWeight;
            // A hard miss is more actionable than a warning of the same weight.
            if (a.status !== b.status) return a.status === 'err' ? -1 : 1;
            return a.name.localeCompare(b.name);
        })
        .slice(0, take)
        .map(c => ({
            name: c.name,
            status: c.status,
            weight: getCheckMeta(c.name).weight,
            category: getCheckMeta(c.name).category,
            message: c.message,
            prompt: c.prompt,
            spec: c.spec
        }));
}


/**
 * Rough syllable count for the Flesch reading-ease estimate.
 *
 * The previous implementation matched runs of up to two vowels anywhere in the
 * text, which counts "queue" as two syllables and "ouija" as one, and treats a
 * trailing silent "e" as a syllable of its own. This walks words instead and
 * applies the usual English adjustments; Cyrillic syllables map 1:1 to vowels.
 */
export function countSyllables(text, isCyrillic = false) {
    if (isCyrillic) {
        return (text.match(/[аеёиоуыэюя]/gi) || []).length || 1;
    }
    let total = 0;
    const words = text.match(/[a-zàáâãäåèéêëìíîïòóôõöùúûüýÿ']+/gi) || [];
    for (const word of words) {
        const groups = word.match(/[aeiouyàáâãäåèéêëìíîïòóôõöùúûüýÿ]+/gi) || [];
        let count = groups.length;
        // Silent terminal "e" ("make", "one"), but never reduce below one.
        if (count > 1 && /e$/i.test(word) && !/[aeiouy]e$/i.test(word)) count--;
        total += Math.max(1, count);
    }
    return total || 1;
}

/**
 * Remediation prompts.
 *
 * The original prompts were single sentences ("Create an llms.txt file...").
 * Pasted into an assistant they produced generic, placeholder-filled output
 * that the user then had to rewrite, because they carried none of what the
 * audit already knew: which site was scanned, what specifically failed, what
 * the file has to contain to pass, and how to check the result.
 *
 * Each entry supplies the parts; buildPrompt assembles them with the audited
 * origin and the actual finding, so the same check produces a different, more
 * specific prompt for "missing" than for "present but malformed".
 */
const PROMPT_LIBRARY = {
    "robots.txt": {
        goal: "Publish a robots.txt that states an explicit, deliberate policy for AI crawlers.",
        requirements: [
            "Keep the existing rules for conventional search crawlers intact — do not tighten them as a side effect.",
            "Add a separate group for each AI user-agent you want to address rather than relying on the `*` group; several AI crawlers ignore `*` when a named group exists.",
            "Decide the three cases independently: AI search citation (OAI-SearchBot, PerplexityBot, YouBot), live agent fetching on a user's behalf (ChatGPT-User, Perplexity-User), and model training (GPTBot, ClaudeBot, Google-Extended, Amazonbot, Applebot-Extended, CCBot, meta-externalagent).",
            "Add a `Sitemap:` line with the absolute URL of the sitemap."
        ],
        deliverable: "The complete robots.txt content, to be served at /robots.txt as text/plain.",
        acceptance: [
            "`curl -s ORIGIN/robots.txt` returns text/plain, not an HTML page.",
            "Every group has at least one Allow or Disallow line.",
            "Tell me which of the three policy decisions above each group implements, so I can confirm the result matches my intent."
        ]
    },
    "sitemap.xml": {
        goal: "Publish a valid XML sitemap and point robots.txt at it.",
        requirements: [
            "List canonical URLs only — no redirects, no parameterised duplicates, no noindex pages.",
            "Give every <url> a <lastmod> with a real modification date in W3C datetime format.",
            "Split into a sitemap index if there are more than 50,000 URLs or the file exceeds 50MB uncompressed.",
            "Reference it from robots.txt with an absolute `Sitemap:` URL."
        ],
        deliverable: "The sitemap XML (or the generator code that produces it) plus the robots.txt line referencing it.",
        acceptance: [
            "The document validates against the sitemaps.org 0.9 schema.",
            "`curl -s ORIGIN/sitemap.xml | head` returns XML with an application/xml content type."
        ]
    },
    "Sitemap Lastmod": {
        goal: "Populate <lastmod> in the sitemap with real modification dates.",
        requirements: [
            "Derive each date from the content's actual last edit, not from the build or deploy time — a sitemap where every date changes on every deploy is treated as noise and ignored.",
            "Use W3C datetime format (YYYY-MM-DD or a full ISO 8601 timestamp).",
            "Omit <lastmod> entirely for pages whose modification date you cannot determine, rather than emitting a placeholder."
        ],
        deliverable: "The change to the sitemap generation so <lastmod> reflects content modification time.",
        acceptance: ["Two consecutive deploys with no content change produce identical <lastmod> values."]
    },
    "AI Search Allowed": {
        goal: "Allow the AI search crawlers that can cite this site in generated answers.",
        requirements: [
            "Add explicit `Allow: /` groups for OAI-SearchBot, PerplexityBot and YouBot.",
            "These are retrieval crawlers for citation, distinct from the training crawlers — allowing them does not permit model training.",
            "Do not add these to a shared `*` group; name each agent in its own group."
        ],
        deliverable: "The robots.txt groups to add, and where they go relative to the existing rules.",
        acceptance: ["Each of the three agents has a group whose rules permit the paths you want cited."]
    },
    "AI Agent Allowed": {
        goal: "Allow user-directed agent fetches, which are requests a person actually asked for.",
        requirements: [
            "Add an `Allow: /` group for ChatGPT-User (and Perplexity-User if you also want Perplexity's on-demand fetches).",
            "These agents fetch a page because a user asked about it in a conversation; blocking them blocks your own visitors' agents, not a scraper.",
            "Keep any training-crawler policy unchanged — this decision is independent of it."
        ],
        deliverable: "The robots.txt groups to add.",
        acceptance: ["A request with the ChatGPT-User user-agent is permitted by the resulting rules."]
    },
    "AI Training Blocked": {
        goal: "Make the model-training policy explicit, in whichever direction you intend.",
        requirements: [
            "Decide first whether you want your content used for model training. Both answers are legitimate; this check reports the choice, it does not score it.",
            "To opt out: add `Disallow: /` groups for GPTBot, ClaudeBot, Google-Extended, Amazonbot, Applebot-Extended, CCBot and meta-externalagent, and consider a TDM reservation at /.well-known/tdmrep.json for EU CDSM Article 4 coverage.",
            "To opt in: leave those agents permitted and say so explicitly with `Allow: /` groups rather than relying on silence.",
            "Either way, keep the AI search and user-agent groups separate so opting out of training does not also remove you from AI search results."
        ],
        deliverable: "The robots.txt groups implementing the decision, and a one-line note of which direction was chosen.",
        acceptance: ["No training-crawler policy is left implicit; every named agent has an explicit rule."]
    },
    "Differentiated Policy": {
        goal: "State separate policies for AI search, user-directed agents and model training.",
        requirements: [
            "Treat the three as three decisions, not one. The common intent — be citable in AI search, serve users' agents, decline training — requires all three groups to differ.",
            "Group 1 (cite me): OAI-SearchBot, PerplexityBot, YouBot.",
            "Group 2 (serve my users' agents): ChatGPT-User, Perplexity-User.",
            "Group 3 (training): GPTBot, ClaudeBot, Google-Extended, Amazonbot, Applebot-Extended, CCBot."
        ],
        deliverable: "The full robots.txt with the three groups distinguished.",
        acceptance: ["The three groups do not all carry identical rules."]
    },
    "Content-Signal": {
        goal: "Declare machine-readable usage terms with a Content-Signal directive.",
        requirements: [
            "Emit either a `Content-Signal:` line in robots.txt or a `Content-Signal:` HTTP response header.",
            "Use the defined keys — `search`, `ai-input`, `ai-train` — each set to `yes` or `no`.",
            "Keep it consistent with the robots.txt rules; a Content-Signal that contradicts the crawler groups is worse than none."
        ],
        deliverable: "The exact Content-Signal line or header value, plus where to configure it.",
        acceptance: ["`curl -sI ORIGIN` or ORIGIN/robots.txt shows the directive, and its values match the robots.txt groups."]
    },
    "Content-Use Parameter": {
        goal: "Add a `use=` parameter to the Content-Signal directive.",
        requirements: [
            "Append `use=` with one of `reference`, `immediate` or `full` to the existing Content-Signal value.",
            "`reference` permits citation with attribution; `immediate` permits use in a live answer; `full` permits unrestricted use. Pick the one that matches your licensing terms."
        ],
        deliverable: "The updated Content-Signal value.",
        acceptance: ["The directive parses as comma-separated key=value pairs and includes a valid `use` key."]
    },
    "HTML Title Tag": {
        goal: "Give every page a unique, descriptive <title>.",
        requirements: [
            "One <title> per page, in the <head>, 50-60 characters.",
            "Lead with what the page is about, not with the site name.",
            "No two pages share a title; templated titles must interpolate the page's own subject."
        ],
        deliverable: "The title tag (or the template change that generates it).",
        acceptance: ["Every page returns a distinct title, and it is present in the raw HTML before JavaScript runs."]
    },
    "Meta Description": {
        goal: "Add a meta description summarising each page.",
        requirements: [
            "A <meta name=\"description\"> of 140-160 characters describing what the page actually contains.",
            "Write it as a standalone sentence a model could quote, not as a keyword list.",
            "Add a matching og:description so social and agent previews agree."
        ],
        deliverable: "The meta tags (or the template change that generates them).",
        acceptance: ["The description is unique per page and present in the server-returned HTML."]
    },
    "HTML Lang Attribute": {
        goal: "Declare the document language on the <html> element.",
        requirements: [
            "Add a `lang` attribute with a BCP 47 tag (`en`, `en-GB`, `ru`) to <html>.",
            "Mark any passage in a different language with its own `lang` attribute on the containing element.",
            "If the site is multilingual, add `hreflang` alternates linking the language variants to each other."
        ],
        deliverable: "The html tag change, plus any hreflang link tags.",
        acceptance: ["The attribute is a valid BCP 47 tag and matches the language the page is actually written in."]
    },
    "Semantic HTML": {
        goal: "Wrap the primary content in semantic landmark elements.",
        requirements: [
            "Put the page's main content inside <main>, and each self-contained piece inside <article>.",
            "Use <nav>, <header>, <footer> and <aside> for the surrounding chrome so extractors can tell content from navigation.",
            "Replace generic <div> wrappers that exist only for layout where a landmark element would carry meaning."
        ],
        deliverable: "The markup changes to the page template.",
        acceptance: ["The page has exactly one <main>, and the article text sits inside it rather than beside it."]
    },
    "Heading Hierarchy": {
        goal: "Give the page a correct heading outline.",
        requirements: [
            "Exactly one <h1>, stating the page's subject.",
            "<h2> for each major section, <h3> for subsections; never skip a level to get a particular font size.",
            "Headings must describe the section that follows — retrieval systems chunk on heading boundaries, so a vague heading produces a vague chunk."
        ],
        deliverable: "The corrected heading structure.",
        acceptance: ["The outline reads as a coherent table of contents when the headings are extracted in order."]
    },
    "Canonical URL": {
        goal: "Declare a canonical URL for every page.",
        requirements: [
            "Add <link rel=\"canonical\"> to the <head> with the absolute, preferred URL.",
            "Make it self-referential on the canonical page itself, and point variants (tracking parameters, trailing-slash forms, alternate hosts) at it.",
            "The canonical URL must return 200 — never point at a redirect or a 404."
        ],
        deliverable: "The canonical link tag, or the template logic that generates it.",
        acceptance: ["Fetching the canonical URL returns 200 and its own canonical points at itself."]
    },
    "Server-Rendered Content": {
        goal: "Serve the page's text in the initial HTML response, without requiring JavaScript.",
        requirements: [
            "Identify which content currently only appears after client-side hydration.",
            "Move it into the server response via server-side rendering, static generation or prerendering — whichever fits the existing framework; say which one you are using and why.",
            "Keep interactive behaviour client-side; only the readable content needs to be in the initial payload.",
            "Do not add a separate prerendered copy served only to bots — that is cloaking, and it breaks when the two copies drift."
        ],
        deliverable: "The rendering change, described concretely against this project's framework.",
        acceptance: [
            "`curl -s ORIGIN | wc -w` returns a word count close to what a browser displays.",
            "Disabling JavaScript in a browser still shows the page's main content."
        ]
    },
    "Content Depth": {
        goal: "Give the page enough substantive text to be retrievable.",
        requirements: [
            "Aim for 300+ words of real content — prose that answers the questions a reader arrives with.",
            "Do not pad with boilerplate, keyword repetition or duplicated navigation; that lowers retrieval quality rather than raising it.",
            "If the substance genuinely lives in a video, PDF or diagram, add a text transcript or summary alongside it."
        ],
        deliverable: "A concrete outline of what content to add to this specific page, and why each part earns its place.",
        acceptance: ["The added text answers a question a user could plausibly ask a model about this page."]
    },
    "Scannable Formats": {
        goal: "Structure the content into lists and tables where the material is naturally enumerable.",
        requirements: [
            "Convert enumerations buried in prose into <ul>/<ol>, and comparisons into <table> with real <th> headers.",
            "Use <dl> for term/definition pairs.",
            "Do not convert flowing argument into bullets — only material that is genuinely a list."
        ],
        deliverable: "The markup changes.",
        acceptance: ["Tables have header cells and a <caption>; lists use list markup rather than styled <div>s."]
    },
    "Internal Architecture": {
        goal: "Link related pages together with descriptive anchor text.",
        requirements: [
            "Add contextual links from this page to the related pages on the site.",
            "Write anchor text that describes the destination — never \"click here\" or a bare URL.",
            "Make sure every page is reachable from the homepage in three clicks or fewer."
        ],
        deliverable: "The specific links to add and the anchor text for each.",
        acceptance: ["No orphan pages remain in the sitemap, and no anchor text is generic."]
    },
    "Clean URLs": {
        goal: "Use semantic URL paths instead of query-string parameters for content.",
        requirements: [
            "Move content identity into the path (/guides/ai-readiness), keeping query strings for filtering and pagination only.",
            "Preserve the existing URLs with 301 redirects — do not break inbound links or existing citations.",
            "Update the sitemap and internal links to the new form."
        ],
        deliverable: "The routing change plus the redirect map from old URLs to new.",
        acceptance: ["Every old URL 301s to exactly one new URL, with no redirect chains."]
    },
    "Image Alt Text": {
        goal: "Describe every meaningful image with alt text.",
        requirements: [
            "Give each informative image an `alt` that conveys what it shows, not what it is named.",
            "Give purely decorative images `alt=\"\"` so they are explicitly skipped rather than silently missing.",
            "For charts and diagrams, put the actual finding in the alt text or in an adjacent caption.",
            "Do not prefix with \"image of\" — that is already implied by the element."
        ],
        deliverable: "The alt attributes, written per image.",
        acceptance: ["Every <img> has an alt attribute; the non-empty ones read as useful sentences out of context."]
    },
    "ARIA Accessibility": {
        goal: "Label the interactive and landmark regions of the page.",
        requirements: [
            "Prefer native semantic elements; add ARIA only where no native element carries the meaning.",
            "Give icon-only controls an `aria-label`, and each landmark region an accessible name where several of the same type exist.",
            "Never put a `role` on an element that already implies it (`<nav role=\"navigation\">` is redundant)."
        ],
        deliverable: "The attribute changes.",
        acceptance: ["Every interactive control has an accessible name, and no ARIA role contradicts its element."]
    },
    "Viewport Meta Tag": {
        goal: "Declare a responsive viewport.",
        requirements: [
            "Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"> to the <head>.",
            "Do not set `user-scalable=no` or a `maximum-scale` below 5 — both break zoom for users who need it."
        ],
        deliverable: "The meta tag.",
        acceptance: ["The tag is present and permits zooming."]
    },
    "Semantic JSON-LD": {
        goal: "Add schema.org structured data in JSON-LD.",
        requirements: [
            "Choose the type that actually matches the page — Article, Product, FAQPage, HowTo, Event, Organization — rather than defaulting to WebPage.",
            "Populate every property the type marks as required, and only properties that are true of this page.",
            "Embed it as <script type=\"application/ld+json\"> in the server-rendered HTML, not injected by client-side JavaScript.",
            "Use a single @graph if the page needs several linked entities."
        ],
        deliverable: "The complete JSON-LD block for this page.",
        acceptance: [
            "The JSON parses, and every value in it is factually true of the page — structured data that overstates the page is treated as spam.",
            "It validates at https://validator.schema.org/."
        ]
    },
    "Organization Schema": {
        goal: "Publish Organization structured data identifying who runs the site.",
        requirements: [
            "Include `name`, `url`, `logo`, and `sameAs` links to the organisation's authoritative profiles.",
            "Add `contactPoint` if there is a public support or press contact.",
            "Place it on the homepage (or in a site-wide @graph) rather than repeating a full copy on every page."
        ],
        deliverable: "The Organization JSON-LD block.",
        acceptance: ["The sameAs URLs all resolve and genuinely belong to the organisation."]
    },
    "FAQ Schema": {
        goal: "Mark up genuine question-and-answer content as FAQPage.",
        requirements: [
            "Only mark up Q&A that is actually visible on the page — hidden or invented FAQ markup is a spam signal.",
            "Each `Question` needs a `name` and an `acceptedAnswer` whose `text` answers it completely enough to stand alone.",
            "Write answers as self-contained paragraphs; they may be quoted without the surrounding page."
        ],
        deliverable: "The FAQPage JSON-LD block.",
        acceptance: ["Every question and answer in the markup appears verbatim in the page's visible text."]
    },
    "Breadcrumb Schema": {
        goal: "Publish BreadcrumbList structured data for the page's position in the hierarchy.",
        requirements: [
            "Emit an ordered `itemListElement` array of `ListItem` entries, each with `position`, `name` and `item`.",
            "Start at the site root and end at the current page.",
            "Mirror the breadcrumb trail the page actually displays."
        ],
        deliverable: "The BreadcrumbList JSON-LD block.",
        acceptance: ["Positions are sequential from 1, and every `item` URL resolves."]
    },
    "Site Search Schema": {
        goal: "Publish a WebSite SearchAction so agents can query the site directly.",
        requirements: [
            "Add a `WebSite` node with `potentialAction` of type `SearchAction`.",
            "Set `target` to a URL template containing `{search_term_string}`, and `query-input` to `required name=search_term_string`.",
            "The template must point at a working search endpoint that returns results server-rendered."
        ],
        deliverable: "The WebSite/SearchAction JSON-LD block.",
        acceptance: ["Substituting a real term into the template returns a results page with content in the HTML."]
    },
    "Authorship (E-E-A-T)": {
        goal: "Attribute content to an identifiable author.",
        requirements: [
            "Add an `author` property to the page's JSON-LD, as a `Person` or `Organization` with a `name` and a `url` to a real profile or author page.",
            "Add a visible byline in the markup as well — structured data alone with no visible attribution reads as manufactured.",
            "For a Person, link `sameAs` to profiles that establish the relevant expertise."
        ],
        deliverable: "The author markup, structured and visible.",
        acceptance: ["The author URL resolves to a page about that author, and the byline is visible to a reader."]
    },
    "Content Freshness": {
        goal: "Publish explicit publication and modification dates.",
        requirements: [
            "Add `datePublished` and `dateModified` to the page's JSON-LD in ISO 8601 form.",
            "Show a visible date in the markup using <time datetime=\"...\">.",
            "Only update `dateModified` when the content substantively changes — bumping it on every deploy destroys the signal's value."
        ],
        deliverable: "The date markup, structured and visible.",
        acceptance: ["The structured dates match the visible ones, and dateModified is not newer than the last real edit."]
    },
    "External Citations": {
        goal: "Cite the external sources the content relies on.",
        requirements: [
            "Link to the primary source for each factual claim, statistic or quotation — the original study or dataset, not an article about it.",
            "Use descriptive anchor text naming the source.",
            "Do not add links that the content does not actually draw on."
        ],
        deliverable: "The citations to add, mapped to the claims they support.",
        acceptance: ["Every statistic and quotation on the page has a resolvable source link."]
    },
    "Quotation Addition": {
        goal: "Mark quoted material as quotations.",
        requirements: [
            "Wrap block quotations in <blockquote> and inline ones in <q>.",
            "Add a `cite` attribute with the source URL, and attribute the speaker in visible text.",
            "Only mark up material that is genuinely quoted from elsewhere."
        ],
        deliverable: "The quotation markup.",
        acceptance: ["Each blockquote has an attributed source."]
    },
    "Statistics Addition": {
        goal: "Support the page's claims with concrete figures.",
        requirements: [
            "Replace vague quantifiers (\"many\", \"significantly\") with actual numbers where you have them.",
            "Give every figure a unit, a time period and a source.",
            "Do not invent figures — if a number is not available, say so rather than estimating."
        ],
        deliverable: "The specific figures to add and where each comes from.",
        acceptance: ["Every number on the page is traceable to a cited source."]
    },
    "Fluency Optimization": {
        goal: "Bring the prose into a readable band without flattening it.",
        requirements: [
            "Target a Flesch Reading Ease of 45-95 for English (30-90 for Russian, whose scale runs lower).",
            "Shorten sentences that carry more than one idea; prefer the active voice.",
            "Expand jargon on first use rather than deleting it — precision matters more than the score.",
            "Do not chase the metric by chopping every sentence to five words; that reads worse and retrieves no better."
        ],
        deliverable: "The rewritten passages, with the reasoning for each substantive change.",
        acceptance: ["The meaning is unchanged and no technical term has been lost."]
    },
    "Authoritative Voice": {
        goal: "Make the page's authority verifiable rather than asserted.",
        requirements: [
            "This is not about inserting words like \"research shows\" — such phrasing without backing is exactly what the check is designed to reject.",
            "Name the author and link to their credentials.",
            "Cite primary sources for the claims, and quote them where the exact wording matters.",
            "Give concrete figures with their provenance."
        ],
        deliverable: "The specific attributions, citations and figures to add to this page.",
        acceptance: ["A skeptical reader could check every substantive claim on the page by following a link."]
    },
    "Content Neg. (MD)": {
        goal: "Serve a Markdown representation of pages to clients that ask for it.",
        requirements: [
            "When a request carries `Accept: text/markdown`, return the page's content as Markdown with `Content-Type: text/markdown; charset=utf-8`.",
            "Send `Vary: Accept` on every response so caches do not mix the two representations.",
            "The Markdown must carry the same content as the HTML — same headings, same body, same links — not a summary.",
            "Optionally also expose the Markdown at a stable `.md` URL for clients that do not negotiate."
        ],
        deliverable: "The server or middleware change implementing the negotiation.",
        acceptance: [
            "`curl -H 'Accept: text/markdown' ORIGIN` returns Markdown, and a plain `curl ORIGIN` still returns HTML.",
            "Both responses carry `Vary: Accept`."
        ]
    },
    "Freshness Headers": {
        goal: "Send validators so clients can revalidate cheaply.",
        requirements: [
            "Send `ETag` and/or `Last-Modified` on content responses.",
            "The ETag must change when and only when the content changes.",
            "Pair them with a `Cache-Control` policy that permits revalidation."
        ],
        deliverable: "The header configuration.",
        acceptance: ["`curl -sI ORIGIN` shows ETag or Last-Modified, and the value is stable across identical content."]
    },
    "Conditional Requests (304)": {
        goal: "Answer conditional requests with 304 Not Modified.",
        requirements: [
            "Handle `If-None-Match` against your ETag and `If-Modified-Since` against Last-Modified.",
            "Return 304 with no body when the content is unchanged.",
            "Make sure the CDN or reverse proxy in front of the app forwards the conditional headers rather than stripping them."
        ],
        deliverable: "The server-side handling, and any proxy configuration needed.",
        acceptance: ["`curl -sI -H 'If-None-Match: \"<etag>\"' ORIGIN` returns 304 with an empty body."]
    },
    "X-Robots-Tag Header": {
        goal: "Remove restrictive X-Robots-Tag directives from production responses.",
        requirements: [
            "Find where the header is set — application, framework, CDN or reverse proxy — and identify why.",
            "Remove `noindex`, `nosnippet` or `noai` from responses that should be publicly indexable.",
            "Keep restrictions only on paths that genuinely should not be indexed, and verify staging configuration is not leaking into production."
        ],
        deliverable: "The configuration change and the layer it belongs to.",
        acceptance: ["`curl -sI ORIGIN | grep -i x-robots-tag` returns nothing restrictive for public pages."]
    },
    "HTTPS & HSTS": {
        goal: "Serve the site over HTTPS and enforce it with HSTS.",
        requirements: [
            "Redirect all HTTP traffic to HTTPS with a 301.",
            "Send `Strict-Transport-Security: max-age=31536000; includeSubDomains`.",
            "Confirm every subdomain has a valid certificate before adding `includeSubDomains` — it will break any that does not.",
            "Only consider `preload` once the policy has run without problems for some time; preload removal is slow."
        ],
        deliverable: "The redirect and header configuration.",
        acceptance: ["`curl -sI ORIGIN` shows the HSTS header, and an http:// request 301s to https://."]
    },
    "RSS/Atom Feed": {
        goal: "Publish a feed and advertise it from the HTML.",
        requirements: [
            "Publish an RSS 2.0 or Atom feed of the site's updating content.",
            "Include full content in the feed rather than a truncated teaser.",
            "Link it from the <head>: <link rel=\"alternate\" type=\"application/rss+xml\" href=\"...\">."
        ],
        deliverable: "The feed and the link tag.",
        acceptance: ["The feed validates, and the alternate link is present in the server-rendered HTML."]
    },
    "AI Fallback (No-JS)": {
        goal: "Give non-JavaScript clients a usable path to the content.",
        requirements: [
            "Provide a <noscript> block pointing at the machine-readable entry points (llms.txt, the sitemap, a Markdown or API representation).",
            "This is a fallback, not a substitute for server-rendering the main content."
        ],
        deliverable: "The noscript block.",
        acceptance: ["With JavaScript disabled, the page offers a working route to the content."]
    },
    "NoAI Meta Tag": {
        goal: "Decide whether to declare a NoAI preference, and state it explicitly either way.",
        requirements: [
            "This is a policy choice, not a defect — the audit reports it without scoring it.",
            "To opt out: add <meta name=\"robots\" content=\"noai, noimageai\"> and keep it consistent with robots.txt and any TDM reservation.",
            "To opt in: leave it absent deliberately, and make sure nothing else on the site contradicts that."
        ],
        deliverable: "The meta tag if opting out, or a note confirming the deliberate absence.",
        acceptance: ["The NoAI stance, robots.txt and any TDM declaration all say the same thing."]
    },
    "WebMCP Integration": {
        goal: "Expose in-page tools to agents via WebMCP.",
        requirements: [
            "Register the page's real capabilities as tools — search, filter, add-to-cart — not a demonstration tool.",
            "Give each tool a description precise enough that a model can tell when it applies, and a typed input schema.",
            "Keep every tool idempotent and side-effect-free unless the user has explicitly confirmed the action."
        ],
        deliverable: "The WebMCP registration code and the tool definitions.",
        acceptance: ["Each tool's description names its preconditions, and destructive actions require confirmation."]
    },
    "LLMs.txt": {
        goal: "Publish an llms.txt navigation manifest at the site root.",
        requirements: [
            "Follow the llmstxt.org structure exactly: an H1 with the project name, a blockquote summarising it in one or two sentences, then H2 sections containing Markdown link lists.",
            "Each link needs a short description after a colon explaining what the reader will find there.",
            "Link to raw Markdown or plain-text documentation where it exists, not to JavaScript-heavy pages.",
            "Put genuinely optional material under an `## Optional` section so agents with a limited budget can skip it."
        ],
        deliverable: "The complete llms.txt content, served at /llms.txt as text/plain or text/markdown.",
        acceptance: [
            "`curl -s ORIGIN/llms.txt` returns Markdown, not HTML — a soft 404 that returns the site's HTML shell is the most common failure here.",
            "The file has exactly one H1, a blockquote, and at least one Markdown link list.",
            "Every linked URL resolves."
        ]
    },
    "LLMs-Full.txt": {
        goal: "Publish the full documentation as a single Markdown file.",
        requirements: [
            "Concatenate the primary documentation in a sensible reading order under H2 section headings.",
            "Include the actual content — API references, guides, code samples — not a table of contents.",
            "Generate it from the same source as the human documentation so the two cannot drift.",
            "Keep it as plain Markdown with no site chrome."
        ],
        deliverable: "The generated /llms-full.txt, plus the build step that keeps it current.",
        acceptance: ["The file starts with an H1, contains H2 sections, and is regenerated by the docs build."]
    },
    "AGENTS.md": {
        goal: "Publish an AGENTS.md operating manual for autonomous agents.",
        requirements: [
            "Start with an H1 and a blockquote summarising what this site or project is.",
            "Cover: what the project does, how to run and test it, the conventions an agent must follow, and what it must not do.",
            "Be specific — exact commands, exact paths. Generic advice is worse than nothing because it displaces the model's own reasonable defaults.",
            "Serve it at /AGENTS.md (and optionally /.well-known/agents.md) as text/markdown."
        ],
        deliverable: "The complete AGENTS.md content.",
        acceptance: [
            "`curl -s ORIGIN/AGENTS.md` returns Markdown with the correct content type, not the site's HTML shell.",
            "Every command in it runs successfully as written."
        ]
    },
    "agents.json": {
        goal: "Publish an agents.json capability manifest.",
        requirements: [
            "Include `name`, `version`, `description`, and a `capabilities` array.",
            "Describe each capability with its endpoint, HTTP method and parameter schema.",
            "Only declare capabilities that actually exist and work.",
            "Serve it at /.well-known/agents.json as application/json."
        ],
        deliverable: "The complete agents.json.",
        acceptance: ["The file is valid JSON, and every declared endpoint responds as described."]
    },
    "MCP Server": {
        goal: "Expose the site's capabilities through a Model Context Protocol server.",
        requirements: [
            "Implement an MCP endpoint speaking JSON-RPC 2.0 over streamable HTTP at /mcp, handling `initialize`, `tools/list` and `tools/call`.",
            "Expose tools that map to real operations, each with a JSON Schema for its input and a description precise enough for a model to choose it correctly.",
            "Validate and authorise every call server-side — a tool definition is not an access control.",
            "Optionally publish a discovery manifest at /.well-known/mcp/server-card.json, and RFC 9728 metadata at /.well-known/oauth-protected-resource/mcp if the endpoint requires auth."
        ],
        deliverable: "The MCP server implementation and its tool definitions.",
        acceptance: [
            "A `tools/list` JSON-RPC POST to /mcp returns the tool array.",
            "Each tool's inputSchema validates the arguments its handler actually requires."
        ]
    },
    "A2A Agent Card": {
        goal: "Publish an A2A agent card so other agents can negotiate with this one.",
        requirements: [
            "Follow the A2A specification's card schema: identity, capabilities/skills, endpoint URLs and authentication requirements.",
            "Declare the authentication scheme accurately, including the OAuth endpoints if applicable.",
            "Serve it at /.well-known/agent-card.json as application/json."
        ],
        deliverable: "The complete agent-card.json.",
        acceptance: ["The card validates against the A2A schema and every declared endpoint resolves."]
    },
    "Agent Skills": {
        goal: "Publish an Agent Skills index mapping endpoints to task-level skills.",
        requirements: [
            "Describe each skill by the task it accomplishes, not by the REST route it wraps.",
            "Give each skill a name, a description, its endpoint and its method.",
            "Serve the index at /.well-known/agent-skills/index.json."
        ],
        deliverable: "The complete skills index JSON.",
        acceptance: ["Each skill description would let a model decide, unaided, whether the skill applies to a given request."]
    },
    "API Catalog": {
        goal: "Publish an RFC 9727 API catalog pointing at the OpenAPI description.",
        requirements: [
            "Serve a linkset at /.well-known/api-catalog per RFC 9727, with `service-desc` links to the OpenAPI documents.",
            "Give every OpenAPI operation an `operationId` and a `description` — that is what makes the API usable as a set of tools.",
            "Describe every parameter and document the response schemas.",
            "Serve it as application/linkset+json."
        ],
        deliverable: "The api-catalog linkset plus the OpenAPI annotations it points to.",
        acceptance: ["Every operation in the referenced OpenAPI document has both an operationId and a description."]
    },
    "AI Plugin": {
        goal: "Publish an ai-plugin.json manifest.",
        requirements: [
            "Include `name_for_human`, `name_for_model`, `description_for_human`, `description_for_model`, the auth configuration and a link to the OpenAPI spec.",
            "Write `description_for_model` as an instruction telling the model when to use the API and when not to — this is the field that determines whether it gets called correctly.",
            "Serve it at /.well-known/ai-plugin.json as application/json."
        ],
        deliverable: "The complete ai-plugin.json.",
        acceptance: ["`description_for_model` states the API's preconditions and limits, not just its features."]
    },
    "OAuth Discovery": {
        goal: "Publish RFC 8414 OAuth 2.0 authorization server metadata.",
        requirements: [
            "Serve the metadata document at /.well-known/oauth-authorization-server.",
            "Include `issuer`, `authorization_endpoint`, `token_endpoint`, `scopes_supported`, `response_types_supported` and `code_challenge_methods_supported`.",
            "Support PKCE and list `S256` — agent clients are public clients and cannot hold a secret.",
            "The `issuer` value must exactly match the URL the document is served from."
        ],
        deliverable: "The metadata document and any server configuration it requires.",
        acceptance: ["Every declared endpoint resolves and the issuer matches the document's own origin."]
    },
    "OAuth Protected Resource": {
        goal: "Publish RFC 9728 protected resource metadata.",
        requirements: [
            "Serve the metadata at /.well-known/oauth-protected-resource (and /.well-known/oauth-protected-resource/mcp for an MCP endpoint).",
            "Include `resource`, `authorization_servers`, `bearer_methods_supported` and `scopes_supported`.",
            "Have the protected endpoint answer unauthenticated requests with 401 and a `WWW-Authenticate` header naming the resource_metadata URL."
        ],
        deliverable: "The metadata document plus the WWW-Authenticate response.",
        acceptance: ["An unauthenticated request returns 401 with a WWW-Authenticate header pointing at the metadata."]
    },
    "Universal Commerce": {
        goal: "Publish a UCP configuration for agent-driven commerce.",
        requirements: [
            "Only add this if the site actually sells something — it is scored as niche precisely because it does not apply to most sites.",
            "Point /.well-known/ucp at the product catalogue, pricing and checkout endpoints.",
            "Keep prices and availability live; a stale catalogue is worse than none because agents will act on it."
        ],
        deliverable: "The UCP configuration.",
        acceptance: ["The declared endpoints return current pricing and stock."]
    },
    "x402 Payment Standard": {
        goal: "Publish x402 payment discovery metadata.",
        requirements: [
            "Only add this if you intend to accept programmatic payments.",
            "Declare the priced endpoints, the amount, the asset, the network as a CAIP-2 identifier, and the receiving address.",
            "Ask me for the receiving wallet address rather than inserting a placeholder — a zero address here means real payments are lost.",
            "Have the priced endpoints return HTTP 402 with the payment requirements when payment is absent."
        ],
        deliverable: "The x402.json plus the 402 response handling.",
        acceptance: ["The payTo address is one I confirmed, and an unpaid request to a priced endpoint returns 402."]
    },
    "security.txt": {
        goal: "Publish an RFC 9116 security.txt.",
        requirements: [
            "Include `Contact` (a monitored address or reporting form) and `Expires` (an ISO 8601 timestamp less than a year out).",
            "Optionally add `Policy`, `Preferred-Languages` and `Encryption`.",
            "Ask me for the contact address instead of inventing one — an unmonitored address here means vulnerability reports go nowhere.",
            "Serve it at /.well-known/security.txt as text/plain, and set a reminder to refresh `Expires` before it lapses."
        ],
        deliverable: "The security.txt content.",
        acceptance: ["The Contact value is an address I confirmed is monitored, and Expires is in the future."]
    },
    "TDM Reservation": {
        goal: "Declare a TDM reservation if you intend to reserve text-and-data-mining rights.",
        requirements: [
            "This is a policy choice; the audit reports it without scoring it.",
            "To reserve rights: publish /.well-known/tdmrep.json with `tdm-reservation: 1` and a `tdm-policy` URL, and publish the policy document at that URL.",
            "Keep it consistent with robots.txt — a TDM reservation alongside an open GPTBot rule sends two contradictory signals.",
            "This addresses EU CDSM Directive Article 4; it is not a substitute for legal advice."
        ],
        deliverable: "The tdmrep.json and the policy document it references.",
        acceptance: ["The tdm-policy URL resolves, and the declaration agrees with robots.txt."]
    },
    "ai.txt": {
        goal: "Publish an ai.txt declaring data-mining permissions, if that matches your policy.",
        requirements: [
            "This is a policy choice; the audit reports it without scoring it.",
            "Follow the Spawning ai.txt format, with explicit User-Agent and Disallow/Allow directives.",
            "Keep it consistent with robots.txt and any TDM reservation."
        ],
        deliverable: "The ai.txt content, served at /ai.txt as text/plain.",
        acceptance: ["The directives agree with robots.txt rather than contradicting it."]
    }
};

const PROMPT_TAIL = "Follow the linked specification exactly; do not invent fields it does not define. " +
    "If any required value depends on my setup — a contact address, a wallet, an endpoint, a real date — " +
    "ask me for it rather than filling in a placeholder. " +
    "Show me the complete file or code change, tell me the exact path it belongs at, " +
    "and list anything you were unsure about.";

/**
 * Assembles a remediation prompt for one check, carrying the audited origin and
 * the specific finding so the assistant is not left to guess either.
 */
export function buildPrompt(check, origin) {
    const entry = PROMPT_LIBRARY[check.name];
    if (!entry) return check.prompt;

    const subst = (text) => String(text).replace(/ORIGIN/g, origin);
    const parts = [];

    parts.push(`Goal: ${subst(entry.goal)}`);
    parts.push('');
    parts.push(check.status === 'ok'
        ? `Context: I run ${origin}. An AI-readiness audit reports this as already in place ("${check.message}"). Review what is there against the requirements below and tell me what, if anything, would improve it — do not rewrite it wholesale if it is already correct.`
        : `Context: I run ${origin}. An AI-readiness audit flagged this: "${check.message}".`);
    parts.push('');
    parts.push('Requirements:');
    for (const req of entry.requirements) parts.push(`- ${subst(req)}`);

    if (entry.deliverable) {
        parts.push('');
        parts.push(`Deliverable: ${subst(entry.deliverable)}`);
    }
    if (entry.acceptance?.length) {
        parts.push('');
        parts.push('Done when:');
        for (const item of entry.acceptance) parts.push(`- ${subst(item)}`);
    }
    if (check.spec) {
        parts.push('');
        parts.push(`Specification: ${check.spec}`);
    }
    parts.push('');
    parts.push(PROMPT_TAIL);

    return parts.join('\n');
}


export async function safeReadText(response, maxBytes = 2 * 1024 * 1024) {
    if (!response.body || typeof response.body.getReader !== 'function') {
        return await response.text();
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let result = '';
    let bytesRead = 0;
    try {
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (value) {
                    bytesRead += value.byteLength || value.length || 0;
                    if (typeof value === 'string') {
                        result += value;
                    } else {
                        result += decoder.decode(value, { stream: true });
                    }
                    if (bytesRead > maxBytes) {
                        await reader.cancel();
                        break;
                    }
                }
            }
            result += decoder.decode();
        } finally {
            reader.releaseLock();
        }
    } catch {
        // Fallback
    }
    return result;
}


export default {
    async fetch(request, env, ctx) {
        return await handleRequest(request, env, ctx);
    }
};

async function internalFetch(url, options = {}, base, requestOrigin, env, ctx) {
    if (base === requestOrigin) {
        const req = new Request(url, options);
        return await handleRequest(req, env, ctx);
    }
    let currentUrl = url;
    if (!await isSafeUrl(currentUrl)) {
        throw new Error("SSRF attempt blocked");
    }
    let redirectCount = 0;
    const maxRedirects = 5;
    let res = await fetch(currentUrl, { redirect: "manual", ...options, signal: AbortSignal.timeout(FETCH_TIMEOUT) });
    while (res.status >= 300 && res.status < 400 && res.headers.has("location") && redirectCount < maxRedirects) {
        const locationUrl = new URL(res.headers.get("location"), currentUrl);
        if (locationUrl.protocol !== "http:" && locationUrl.protocol !== "https:") {
            throw new Error("Invalid redirect protocol");
        }
        currentUrl = locationUrl.href;
        if (!await isSafeUrl(currentUrl)) {
            throw new Error("SSRF attempt via redirect");
        }
        res = await fetch(currentUrl, { ...options, redirect: "manual", signal: AbortSignal.timeout(FETCH_TIMEOUT) });
        redirectCount++;
    }
    return res;
}


function isPrivateIP(ip) {
    if (!ip) return false;
    try {
        const urlHost = ip.includes(':') && !ip.startsWith('[') ? `[${ip}]` : ip;
        ip = new URL('http://' + urlHost).hostname.replace(/^\[/, '').replace(/\]$/, '');
    } catch {
        // Fallback to original
    }
    ip = ip.replace(/^\[/, '').replace(/\]$/, '');
    const ipv4Patterns = [
        /^127\./, /^10\./, /^172\.(1[6-9]|2[0-9]|3[0-1])\./, /^192\.168\./,
        /^169\.254\./, /^0\./, /^22[4-9]\./, /^23[0-9]\./, /^24[0-9]\./, /^25[0-5]\./,
        /^100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\./
    ];
    for (const pattern of ipv4Patterns) {
        if (pattern.test(ip)) return true;
    }
    if (ip.includes(':')) {
        ip = ip.split('%')[0];
        if (ip === '::1' || ip === '::' || ip === '::0') return true;
        let fullIp = ip;
        if (fullIp.includes('::')) {
            const parts = fullIp.split('::');
            const leftCount = parts[0] ? parts[0].split(':').length : 0;
            const rightCount = parts[1] ? parts[1].split(':').length : 0;
            const missing = 8 - (leftCount + rightCount);
            const zeroes = new Array(missing).fill('0000').join(':');
            fullIp = `${parts[0] ? parts[0] + ':' : ''}${zeroes}${parts[1] ? ':' + parts[1] : ''}`;
        }
        fullIp = fullIp.split(':').map(segment => segment.padStart(4, '0').toLowerCase()).join(':');

        // 0000:0000:0000:0000:0000:ffff:7f00:0001
        if (fullIp.startsWith('fc') || fullIp.startsWith('fd') ||
            fullIp.startsWith('fe8') || fullIp.startsWith('fe9') || fullIp.startsWith('fea') || fullIp.startsWith('feb') ||
            fullIp.startsWith('ff')) {
            return true;
        }

        if (fullIp.startsWith('0000:0000:0000:0000:0000:ffff:') || fullIp.startsWith('0000:0000:0000:0000:0000:0000:')) {
            const hex = fullIp.substring(30).replace(/:/g, '');
            const ipv4 = [
                parseInt(hex.substring(0, 2), 16),
                parseInt(hex.substring(2, 4), 16),
                parseInt(hex.substring(4, 6), 16),
                parseInt(hex.substring(6, 8), 16)
            ].join('.');
            for (const pattern of ipv4Patterns) {
                if (pattern.test(ipv4)) return true;
            }
        }
    }
    return false;
}

async function isSafeUrl(targetUrl) {
    try {
        const parsedUrl = new URL(targetUrl);
        const hostname = parsedUrl.hostname;

        if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
            return false;
        }

        if (isPrivateIP(hostname)) {
            return false;
        }

        // Only do DNS resolution for non-IP hostnames
        if (!/^[0-9\.]+$/.test(hostname) && !hostname.includes(':')) {
            // An audit hits the same host ~25 times; resolve it once per isolate.
            const cached = getCachedHostSafety(hostname);
            if (cached !== undefined) return cached;

            // Use Cloudflare DoH to resolve the IP to prevent DNS rebinding or resolving to internal IPs
            const resolveDns = async (type) => {
                try {
                    const dohUrl = `https://cloudflare-dns.com/dns-query?name=${hostname}&type=${type}`;
                    const res = await fetch(dohUrl, { headers: { 'accept': 'application/dns-json' } });
                    if (!res.ok) {
                        return false;
                    }
                    const data = await res.json();
                    if (data && data.Answer) {
                        for (const record of data.Answer) {
                            if (record.type === 1 || record.type === 28) { // A or AAAA
                                if (isPrivateIP(record.data)) {
                                    return false;
                                }
                            }
                        }
                    }
                    return true;
                } catch {
                    return false;
                }
            };

            const [aSafe, aaaaSafe] = await Promise.all([resolveDns('A'), resolveDns('AAAA')]);
            const safe = aSafe && aaaaSafe;
            setCachedHostSafety(hostname, safe);
            return safe;
        }
        return true;
    } catch {
        return false;
    }
}

// --- Abuse control -----------------------------------------------------------
//
// One /api/audit call fans out to ~25 outbound requests against a caller-chosen
// origin, with no cost to the caller. Unthrottled, that is a usable traffic
// amplifier pointed at third parties.
//
// This is an in-isolate bucket, so it is per-edge-location rather than global —
// a determined caller spread across colos gets a higher effective ceiling. It is
// a floor, not a guarantee; a global limit needs the Workers rate-limiting
// binding or a Durable Object. The limit is set well above what a person
// clicking "Run scan" will ever reach.
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_MAX_CLIENTS = 10000;
const rateLimitBuckets = new Map();

export function checkRateLimit(clientKey, now = Date.now()) {
    if (!clientKey) return { allowed: true, remaining: RATE_LIMIT_MAX, retryAfter: 0 };

    const bucket = rateLimitBuckets.get(clientKey);
    if (!bucket || bucket.resetAt <= now) {
        if (rateLimitBuckets.size >= RATE_LIMIT_MAX_CLIENTS) {
            // Drop whatever expired; failing that, drop the oldest entry so the
            // map cannot grow without bound under a spray of unique clients.
            for (const [key, value] of rateLimitBuckets) {
                if (value.resetAt <= now) rateLimitBuckets.delete(key);
            }
            if (rateLimitBuckets.size >= RATE_LIMIT_MAX_CLIENTS) {
                const oldest = rateLimitBuckets.keys().next().value;
                if (oldest !== undefined) rateLimitBuckets.delete(oldest);
            }
        }
        rateLimitBuckets.set(clientKey, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
        return { allowed: true, remaining: RATE_LIMIT_MAX - 1, retryAfter: 0 };
    }

    if (bucket.count >= RATE_LIMIT_MAX) {
        return { allowed: false, remaining: 0, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
    }

    bucket.count++;
    return { allowed: true, remaining: RATE_LIMIT_MAX - bucket.count, retryAfter: 0 };
}

function clientKeyFor(request) {
    return request.headers.get("CF-Connecting-IP") ||
           request.headers.get("X-Forwarded-For")?.split(",")[0].trim() ||
           null;
}

// --- Model Context Protocol endpoint -----------------------------------------
//
// The site publishes an MCP server card at /.well-known/mcp/server-card.json and
// RFC 9728 metadata pointing at /mcp, but /mcp itself did not exist: an agent
// following the card got a 404, and the tool failed its own MCP check.
//
// This is the streamable-HTTP transport: JSON-RPC 2.0 over POST.

const MCP_PROTOCOL_VERSION = "2025-06-18";

const MCP_TOOLS = [
    {
        name: "audit_website",
        title: "Audit a website's AI readiness",
        description: "Runs a full AI-readiness and Generative Engine Optimization audit against a public website. " +
            "Checks crawler policy, content structure, structured data, delivery headers and agent protocols " +
            "(llms.txt, AGENTS.md, MCP, A2A, API catalogs), and returns a weighted score with per-category " +
            "breakdown and a ranked list of the highest-impact fixes. " +
            "Use it when asked whether a site is ready for AI agents, why a site is not cited by AI search, " +
            "or what to change to improve it. Only works against publicly reachable http(s) origins.",
        inputSchema: {
            type: "object",
            properties: {
                targetUrl: {
                    type: "string",
                    description: "Absolute http(s) URL of the site to audit, e.g. https://example.com. Only the origin is used."
                },
                format: {
                    type: "string",
                    enum: ["summary", "full"],
                    description: "'summary' (default) returns the score, categories and top fixes. 'full' returns every check."
                }
            },
            required: ["targetUrl"],
            additionalProperties: false
        }
    }
];

function jsonRpcResponse(id, result) {
    return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(id, code, message, data) {
    const error = { code, message };
    if (data !== undefined) error.data = data;
    return { jsonrpc: "2.0", id: id ?? null, error };
}

const MCP_HEADERS = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    ...corsHeaders
};

/**
 * Renders an audit as the text an agent actually wants back: the score, the
 * weak categories, and what to do about them — not 60 raw check objects.
 */
function summariseAuditForAgent(result, full) {
    const lines = [];
    lines.push(`AI readiness for ${result.target}: ${result.score.total}/100 (grade ${result.score.grade}).`);
    lines.push('');
    lines.push('By category:');
    for (const [name, bucket] of Object.entries(result.score.categories).sort((a, b) => a[1].total - b[1].total)) {
        lines.push(`  ${name}: ${bucket.total}%`);
    }
    if (result.priorities.length) {
        lines.push('');
        lines.push('Highest-impact fixes:');
        for (const item of result.priorities) {
            lines.push(`  [+${item.weight}] ${item.name} — ${item.message}`);
        }
    }
    if (full) {
        lines.push('');
        lines.push('All checks:');
        const groups = [['Discoverability & bots', result.bots.results], ['Content', result.content.results], ['Protocols', result.protocols.results]];
        for (const [title, checks] of groups) {
            lines.push(`  ${title}:`);
            for (const check of checks) {
                const mark = check.status === 'ok' ? 'PASS' : (check.status === 'warn' ? 'WARN' : 'FAIL');
                lines.push(`    ${mark} ${check.name} — ${check.message}`);
            }
        }
    }
    return lines.join('\n');
}

async function handleMcpRequest(request, url, env, ctx) {
    // The streamable-HTTP transport uses POST. A GET would open a server-sent
    // event stream, which this server has no need for.
    if (request.method !== "POST") {
        return new Response(JSON.stringify(jsonRpcError(null, -32600, "This MCP endpoint accepts POST with a JSON-RPC 2.0 body")), {
            status: 405,
            headers: { ...MCP_HEADERS, "Allow": "POST, OPTIONS" }
        });
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return new Response(JSON.stringify(jsonRpcError(null, -32700, "Parse error")), { status: 400, headers: MCP_HEADERS });
    }

    // Batches are legal JSON-RPC; handle each message and drop the notifications.
    const messages = Array.isArray(body) ? body : [body];
    const responses = [];
    const clientKey = clientKeyFor(request);
    for (const message of messages) {
        // Only tools/call does real work; the rate check is taken per call so a
        // batch cannot slip several audits through on one allowance.
        const rateAllowed = message?.method !== 'tools/call' || checkRateLimit(clientKey).allowed;
        const reply = await handleMcpMessage(message, url, env, ctx, rateAllowed);
        if (reply) responses.push(reply);
    }

    // A payload of nothing but notifications gets 202 with no body.
    if (responses.length === 0) {
        return new Response(null, { status: 202, headers: corsHeaders });
    }

    const payload = Array.isArray(body) ? responses : responses[0];
    return new Response(JSON.stringify(payload), { status: 200, headers: MCP_HEADERS });
}

async function handleMcpMessage(message, url, env, ctx, rateAllowed = true) {
    if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
        return jsonRpcError(message?.id, -32600, "Invalid Request");
    }

    // A message with no id is a notification: acknowledge by staying silent.
    const isNotification = message.id === undefined || message.id === null;
    const id = message.id;

    switch (message.method) {
        case "initialize":
            return isNotification ? null : jsonRpcResponse(id, {
                protocolVersion: MCP_PROTOCOL_VERSION,
                capabilities: { tools: { listChanged: false } },
                serverInfo: { name: "ai-valid", title: "AI-Valid Readiness Auditor", version: "1.0.0" },
                instructions: "Call audit_website with the origin of a public website to get its AI-readiness score and the ranked fixes that would improve it."
            });

        case "ping":
            return isNotification ? null : jsonRpcResponse(id, {});

        case "tools/list":
            return isNotification ? null : jsonRpcResponse(id, { tools: MCP_TOOLS });

        case "tools/call": {
            if (isNotification) return null;
            const params = message.params || {};
            if (params.name !== "audit_website") {
                return jsonRpcError(id, -32602, `Unknown tool: ${params.name}`);
            }
            const args = params.arguments || {};
            const targetUrl = args.targetUrl;
            if (typeof targetUrl !== "string" || !targetUrl.trim()) {
                return jsonRpcError(id, -32602, "targetUrl is required and must be a string");
            }

            if (!rateAllowed) {
                return jsonRpcResponse(id, {
                    content: [{ type: "text", text: "Rate limit exceeded. Please retry shortly." }],
                    isError: true
                });
            }

            const outcome = await runAuditForTarget(targetUrl, url.origin, env, ctx);
            if (!outcome.ok) {
                // A target the caller got wrong is a tool error, not a protocol
                // error: the model should see it and can correct the argument.
                return jsonRpcResponse(id, {
                    content: [{ type: "text", text: `Audit failed: ${outcome.error}` }],
                    isError: true
                });
            }

            return jsonRpcResponse(id, {
                content: [{ type: "text", text: summariseAuditForAgent(outcome.result, args.format === "full") }],
                structuredContent: {
                    target: outcome.result.target,
                    score: outcome.result.score,
                    priorities: outcome.result.priorities
                },
                isError: false
            });
        }

        default:
            return isNotification ? null : jsonRpcError(id, -32601, `Method not found: ${message.method}`);
    }
}

/**
 * Validates a target and runs the audit. Shared by the HTTP API and the MCP
 * tool so the SSRF guard cannot be bypassed through either entry point.
 */
async function runAuditForTarget(targetUrl, requestOrigin, env, ctx) {
    let parsed;
    try {
        parsed = new URL(targetUrl);
    } catch {
        return { ok: false, status: 400, error: "Invalid URL" };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return { ok: false, status: 400, error: "Invalid URL" };
    }
    if (!await isSafeUrl(targetUrl)) {
        return { ok: false, status: 403, error: "Access to internal or restricted network resources is not allowed" };
    }
    try {
        return { ok: true, result: await performAudit(targetUrl, requestOrigin, env, ctx) };
    } catch (e) {
        if (e instanceof UnreachableTargetError) {
            return { ok: false, status: 400, error: "Domain does not exist or is unreachable" };
        }
        throw e;
    }
}


export async function handleRequest(request, env, ctx) {
        if (request.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders });
        }

        const url = new URL(request.url);
        
        // --- Static File Routing ---
        if (request.method === "GET" && STATIC_ROUTES[url.pathname]) {
            return STATIC_ROUTES[url.pathname](request);
        }

        // --- API Route ---
        if (request.method === "GET" && url.pathname === "/api/audit") {
            try {
                let targetUrl = url.searchParams.get("targetUrl");
                
                if (!targetUrl || !targetUrl.startsWith('http')) {
                    return new Response(JSON.stringify({ error: "Invalid URL" }), { 
                        status: 400,
                        headers: { "Content-Type": "application/json", ...corsHeaders }
                    });
                }

                const rate = checkRateLimit(clientKeyFor(request));
                if (!rate.allowed) {
                    return new Response(JSON.stringify({ error: "Rate limit exceeded. Please retry shortly." }), {
                        status: 429,
                        headers: {
                            "Content-Type": "application/json",
                            "Retry-After": String(rate.retryAfter),
                            "RateLimit-Limit": String(RATE_LIMIT_MAX),
                            "RateLimit-Remaining": "0",
                            ...corsHeaders
                        }
                    });
                }

                const bypassCache = url.searchParams.get("bypassCache") === "true" || 
                                     request.headers.get("Cache-Control")?.includes("no-cache") ||
                                     request.headers.get("Pragma")?.includes("no-cache");

                const wantsMarkdown = (request.headers.get("Accept") || "").includes("text/markdown") ||
                                      url.searchParams.get("format") === "md";

                // A full audit is ~25 outbound requests. Serving a repeat scan of the
                // same origin from the edge cache turns a multi-second scan into a
                // single round trip.
                const cacheKey = new Request(`${url.origin}/api/audit?targetUrl=${encodeURIComponent(new URL(targetUrl).origin)}&format=${wantsMarkdown ? 'md' : 'json'}`, { method: 'GET' });
                const edgeCache = typeof caches !== 'undefined' && caches.default ? caches.default : null;

                if (edgeCache && !bypassCache) {
                    try {
                        const cached = await edgeCache.match(cacheKey);
                        if (cached) {
                            const hit = new Response(cached.body, cached);
                            hit.headers.set("X-Audit-Cache", "HIT");
                            return hit;
                        }
                    } catch { /* cache unavailable, fall through to a live audit */ }
                }

                // Shared with the MCP tool, so the SSRF guard and the
                // reachability handling cannot diverge between the two entry points.
                const outcome = await runAuditForTarget(targetUrl, url.origin, env, ctx);
                if (!outcome.ok) {
                    return new Response(JSON.stringify({ error: outcome.error }), {
                        status: outcome.status,
                        headers: { "Content-Type": "application/json", ...corsHeaders }
                    });
                }
                const result = outcome.result;

                const body = wantsMarkdown ? renderAuditMarkdown(result) : JSON.stringify(result);
                const response = new Response(body, {
                    headers: { 
                        "Content-Type": wantsMarkdown ? "text/markdown; charset=utf-8" : "application/json",
                        "Cache-Control": bypassCache 
                            ? "no-store, no-cache, must-revalidate" 
                            : "public, max-age=3600, stale-while-revalidate=86400",
                        "Vary": "Accept",
                        "X-Audit-Cache": "MISS",
                        ...corsHeaders
                    }
                });

                if (edgeCache && !bypassCache) {
                    const storable = response.clone();
                    if (ctx && typeof ctx.waitUntil === 'function') {
                        ctx.waitUntil(edgeCache.put(cacheKey, storable).catch(() => {}));
                    }
                }

                return response;

            } catch(e) {
                console.error('Audit API Error:', e);
                return new Response(JSON.stringify({ error: "Internal Server Error" }), {
                    status: 500,
                    headers: { "Content-Type": "application/json", ...corsHeaders }
                });
            }
        }

        // --- Share & OG Image Routes ---
        if (request.method === "GET" && url.pathname === "/share") {
            const rawDomain = url.searchParams.get("domain") || "unknown";
            const domain = /^[a-zA-Z0-9.-]+(?::\d+)?$/.test(rawDomain) ? rawDomain : "unknown";
            const passed = Math.max(0, parseInt(url.searchParams.get("passed") || "0", 10) || 0);
            const warn = Math.max(0, parseInt(url.searchParams.get("warn") || "0", 10) || 0);
            const fail = Math.max(0, parseInt(url.searchParams.get("fail") || "0", 10) || 0);
            // Prefer the weighted score the audit actually reported. The old
            // passed/(passed+warn+fail) fallback is a different number, so a
            // shared card could disagree with the dashboard it came from.
            const score = readScoreParam(url, passed, warn, fail);

            const shareImageUrl = `${url.origin}/api/og-image?domain=${encodeURIComponent(domain)}&passed=${passed}&warn=${warn}&fail=${fail}&score=${score}`;
            
            const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>AI Readiness Audit for ${domain}</title>
    <meta property="og:title" content="AI Readiness Audit: ${domain} is ${score}% AI-ready">
    <meta property="og:description" content="Passed: ${passed} | Warnings: ${warn} | Not found: ${fail}. Check your site's AI accessibility.">
    <meta property="og:image" content="${url.origin}/og-image.png">
    <meta property="og:image:type" content="image/png">
    <meta property="og:image" content="${shareImageUrl}">
    <meta property="og:image:type" content="image/svg+xml">
    <meta property="og:image:alt" content="AI readiness scorecard for ${domain}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="AI Readiness Audit: ${domain} is ${score}% AI-ready">
    <meta name="twitter:description" content="Passed: ${passed} | Warnings: ${warn} | Not found: ${fail}.">
    <meta name="twitter:image" content="${url.origin}/og-image.png">
    <script>window.location.href = "/#" + encodeURIComponent("${domain}");</script>
</head>
<body>Redirecting...</body>
</html>`;
            return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", ...corsHeaders } });
        }

        if (request.method === "GET" && url.pathname === "/api/og-image") {
            const rawDomain = url.searchParams.get("domain") || "unknown";
            const domain = /^[a-zA-Z0-9.-]+(?::\d+)?$/.test(rawDomain) ? rawDomain : "unknown";
            const passed = Math.max(0, parseInt(url.searchParams.get("passed") || "0", 10) || 0);
            const warn = Math.max(0, parseInt(url.searchParams.get("warn") || "0", 10) || 0);
            const fail = Math.max(0, parseInt(url.searchParams.get("fail") || "0", 10) || 0);
            const score = readScoreParam(url, passed, warn, fail);

            const svg = generateOgImageSvg(domain, passed, warn, fail, score);
            return new Response(svg, {
                headers: {
                    "Content-Type": "image/svg+xml",
                    "Cache-Control": "public, max-age=86400",
                    ...corsHeaders
                }
            });
        }

        if (url.pathname === "/mcp") {
            return await handleMcpRequest(request, url, env, ctx);
        }

        return new Response("Not Found", { status: 404, headers: corsHeaders });
}

async function performAudit(baseUrl, requestOrigin, env, ctx) {
    const headersStandard = { 'User-Agent': 'Mozilla/5.0 (compatible; AI-Valid/1.0)' };
    // Two different questions need two different Accept headers.
    //
    // Asking for `text/markdown` and then parsing the reply as HTML punished
    // every site that implements the content negotiation this tool recommends:
    // a correct server returns Markdown, and the structural checks — title,
    // lang, headings, JSON-LD, alt text — then all reported "missing". The
    // markdown probe is now its own request, and the structural analysis runs
    // against the HTML representation.
    const headersAgent = { 'User-Agent': 'OAI-SearchBot', 'Accept': 'text/markdown' };
    const headersHtml = { 'User-Agent': 'OAI-SearchBot', 'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8' };
    
    // Ensure baseUrl doesn't end with slash securely
    const base = new URL(baseUrl).origin;

    // Every outbound request goes through the same bounded queue so that the
    // three audit phases can be kicked off together without opening more
    // connections than the runtime will actually service in parallel.
    const limit = createLimiter(MAX_CONCURRENCY);
    const iFetch = async (url, options = {}) => await limit(() => internalFetch(url, options, base, requestOrigin, env, ctx));

    const timings = { startedAt: Date.now() };

    // 1. Discoverability & Bots
    let robotsFound = false;
    let hasAISearch = false;
    let hasAIAgent = false;
    let hasAITrainingBlocked = false;
    let hasDifferentiatedPolicy = false;
    let sitemapFound = false;
    let hasSitemapLastmod = false;
    let robotsText = "";
    let robotsContentSignal = "";

    // --- Phase 1: robots.txt (and, once parsed, the sitemap it points at) ---
    const robotsPhase = (async () => {
    try {
        const r_robots = await iFetch(`${base}/robots.txt`, { headers: headersStandard, cf: { cacheEverything: false } });
        if (r_robots.status === 200) {
            robotsFound = true;
            robotsText = await safeReadText(r_robots);
            
            const rules = {};
            const lines = robotsText.split('\n');
            let currentAgents = [];
            let inAgentBlock = false;
            for (const line of lines) {
                const cleanLine = line.trim();
                if (!cleanLine || cleanLine.startsWith('#')) continue;
                
                // Extract Content-Signal if declared in robots.txt
                const matchCS = cleanLine.match(/^content-signal:\s*(.*)$/i);
                if (matchCS) {
                    robotsContentSignal = matchCS[1].trim();
                    continue;
                }

                const matchUA = cleanLine.match(/^user-agent:\s*(.*)$/i);
                if (matchUA) {
                    const agent = matchUA[1].trim().toLowerCase();
                    if (!inAgentBlock) {
                        currentAgents = [];
                        inAgentBlock = true;
                    }
                    currentAgents.push(agent);
                    if (!rules[agent]) {
                        rules[agent] = { allow: [], disallow: [] };
                    }
                    continue;
                }
                const matchAllow = cleanLine.match(/^allow:\s*(.*)$/i);
                if (matchAllow && currentAgents.length > 0) {
                    inAgentBlock = false;
                    const path = matchAllow[1].trim();
                    currentAgents.forEach(agent => rules[agent].allow.push(path));
                    continue;
                }
                const matchDisallow = cleanLine.match(/^disallow:\s*(.*)$/i);
                if (matchDisallow && currentAgents.length > 0) {
                    inAgentBlock = false;
                    const path = matchDisallow[1].trim();
                    currentAgents.forEach(agent => rules[agent].disallow.push(path));
                    continue;
                }
            }

            const isBotBlocked = (bot) => {
                const agentRules = rules[bot] || rules['*'];
                if (agentRules) {
                    const hasDisallowAll = agentRules.disallow.some(p => p === '/' || p === '/*');
                    const hasAllowAll = agentRules.allow.some(p => p === '/' || p === '/*');
                    return hasDisallowAll && !hasAllowAll;
                }
                return false;
            };

            const isBotAllowed = (bot) => !isBotBlocked(bot);

            hasAISearch = isBotAllowed('oai-searchbot') && isBotAllowed('perplexitybot') && isBotAllowed('youbot');
            hasAIAgent = isBotAllowed('chatgpt-user');
            hasAITrainingBlocked = isBotBlocked('gptbot') && isBotBlocked('claudebot') && isBotBlocked('google-extended') && isBotBlocked('amazonbot') && isBotBlocked('cohere-ai') && isBotBlocked('applebot-extended');
            hasDifferentiatedPolicy = hasAISearch && hasAIAgent && hasAITrainingBlocked;

        }
    } catch { /* silent fail */ }
    })();

    const sitemapPhase = robotsPhase.then(async () => {
    try {
        let sitemapUrl = `${base}/sitemap.xml`;
        if (robotsText) {
            const sitemapMatch = robotsText.match(/^Sitemap:\s*(.*)$/im);
            if (sitemapMatch && sitemapMatch[1]) {
                sitemapUrl = sitemapMatch[1].trim();
                try {
                    sitemapUrl = new URL(sitemapUrl, base).href;
                } catch {
                    // Fallback
                }
            }
        }

        if (await isSafeUrl(sitemapUrl)) {
            const r_sitemap = await iFetch(sitemapUrl, { headers: headersStandard, cf: { cacheEverything: false } });
            if (r_sitemap.status === 200) {
                sitemapFound = true;
                
                const sitemapText = await safeReadText(r_sitemap);
                const lastmodMatch = sitemapText.substring(0, 100000).match(/<lastmod>\s*([^\s<]+)\s*<\/lastmod>/i);
                if (lastmodMatch) {
                    const dateStr = lastmodMatch[1];
                    if (!isNaN(Date.parse(dateStr))) {
                        hasSitemapLastmod = true;
                    }
                }
            }
        }
    } catch { /* silent fail for sitemap */ }
    });

    // 2. Content Accessibility
    let supportsMarkdown = false;
    let hasContentSignal = false;
    let hasContentUse = false;
    let hasVaryAccept = false;
    let hasFreshnessHeaders = false;
    let hasConditionalGET = false;
    let hasSchema = false;
    let schemaType = "";
    let hasAgentFallback = false;
    let hasNoAI = false;
    let hasViewport = false;
    let hasSemanticTags = false;
    let hasH1 = false;
    let hasH2 = false;
    let hasLists = false;
    let hasInternalLinks = false;
    let hasDirtyUrls = false;
    let hasCleanUrls = false;
    let hasFluency = false;
    let hasAuthoritativeVoice = false;
    let hasFaqSchema = false;
    let hasAuthorship = false;
    let hasFreshness = false;
    let hasCitations = false;
    let hasQuotations = false;
    let hasStatistics = false;
    let hasWebMCP = false;
    let hasARIA = false;
    let hasMetaDesc = false;
    let hasTitle = false;
    let hasLang = false;
    let hasImageAlt = false;
    let hasRss = false;
    let hasOrgSchema = false;
    let fleschScore = null;
    let hasBreadcrumbSchema = false;
    let hasSiteSearchSchema = false;
    let hasCanonical = false;
    let hasHsts = false;
    let isHttps = false;
    let xRobotsTag = '';
    let hasBlockingXRobots = false;
    let imagesTotal = 0;
    let imagesWithAlt = 0;
    let wordCount = 0;
    let scriptBytes = 0;
    let hasServerRenderedContent = false;
    let currentScriptText = '';

    // --- Phase 2a: does the origin serve Markdown to an agent that asks? ---
    // Its own request, so the structural analysis below can ask for HTML.
    const markdownPhase = (async () => {
        try {
            const r_md = await iFetch(base, { headers: headersAgent, cf: { cacheEverything: false } });
            const mdType = (r_md.headers.get('content-type') || '').toLowerCase();
            if (r_md.status === 200 && (mdType.includes('text/markdown') || mdType.includes('text/x-markdown'))) {
                supportsMarkdown = true;
                // The point of negotiation is that both representations stay
                // cacheable; without Vary a shared cache will serve one to the
                // audience for the other.
                hasVaryAccept = (r_md.headers.get('vary') || '').toLowerCase().includes('accept');
            }
            if (r_md.body && typeof r_md.body.cancel === 'function') {
                await r_md.body.cancel();
            }
        } catch { /* the HTML fetch decides reachability, not this probe */ }
    })();

    // --- Phase 2: the homepage itself (headers + streamed HTML analysis) ---
    const contentPhase = (async () => {
    let r_home;
    try {
        r_home = await iFetch(base, { headers: headersHtml, cf: { cacheEverything: false } });
    } catch {
        // The origin answered nothing at all: there is no audit to report.
        throw new UnreachableTargetError(base);
    }
    try {
        timings.homeRespondedAt = Date.now();

        // Transport-level signals available straight from the response headers.
        isHttps = new URL(base).protocol === 'https:';
        hasHsts = !!r_home.headers.get('strict-transport-security');
        xRobotsTag = (r_home.headers.get('x-robots-tag') || '').toLowerCase();
        hasBlockingXRobots = /\b(noindex|nosnippet|noai|noimageai)\b/.test(xRobotsTag);

        const cType = (r_home.headers.get('content-type') || '').toLowerCase();
        // A server that hands Markdown to everyone regardless of Accept still
        // negotiates correctly as far as an agent is concerned.
        if (cType.includes('text/markdown')) {
            supportsMarkdown = true;
        }

        // Only the robots.txt fallback below needs the robots parse; the two
        // fetches themselves already ran concurrently.
        await robotsPhase;

        let contentSignalValue = '';
        if (r_home.headers.has('content-signal')) {
            contentSignalValue = r_home.headers.get('content-signal');
        } else if (robotsContentSignal) {
            contentSignalValue = robotsContentSignal;
        }

        if (contentSignalValue) {
            hasContentSignal = true;

            const params = {};
            contentSignalValue.split(',').forEach(part => {
                const [k, v] = part.split('=').map(s => s.trim().toLowerCase());
                if (k) params[k] = v || '';
            });

            if (params['use'] && ['reference', 'immediate', 'full'].includes(params['use'])) {
                hasContentUse = true;
            }
        }

        const etag = r_home.headers.get('etag');
        const lastModified = r_home.headers.get('last-modified');
        if (etag || lastModified) {
            hasFreshnessHeaders = true;

            try {
                const condHeaders = { ...headersHtml };
                if (etag) condHeaders['If-None-Match'] = etag;
                if (lastModified) condHeaders['If-Modified-Since'] = lastModified;

                const r_cond = await iFetch(base, { headers: condHeaders, cf: { cacheEverything: false } });
                if (r_cond.status === 304) {
                    hasConditionalGET = true;
                }
            } catch { /* silent fail */ }
        }




        // Parse HTML structure using Cloudflare's native HTMLRewriter (streaming, ReDoS-safe)
        const jsonLdChunks = [];
        let currentJsonLd = '';
        let ignoredTagDepth = 0;
        let lowerHtmlText = '';

        const transformed = new HTMLRewriter()
            .on('html', {
                element(el) {
                    const lang = el.getAttribute('lang');
                    if (lang && lang.trim()) {
                        hasLang = true;
                    }
                }
            })
            .on('title', {
                element() { hasTitle = true; }
            })
            .on('img', {
                element(el) {
                    imagesTotal++;
                    const alt = el.getAttribute('alt');
                    // A decorative image legitimately carries alt="", so an
                    // explicitly empty alt counts as described, not missing.
                    if (alt !== null) imagesWithAlt++;
                }
            })
            .on('link[rel~="canonical"]', {
                element(el) {
                    const href = (el.getAttribute('href') || '').trim();
                    if (href) hasCanonical = true;
                }
            })
            .on('link[rel="alternate"]', {
                element(el) {
                    const type = (el.getAttribute('type') || '').toLowerCase();
                    if (type === 'application/rss+xml' || type === 'application/atom+xml') {
                        hasRss = true;
                    }
                }
            })
            .on('meta', {
                element(el) {
                    const name = (el.getAttribute('name') || '').toLowerCase();
                    const property = (el.getAttribute('property') || '').toLowerCase();
                    const content = (el.getAttribute('content') || '').toLowerCase();
                    // NoAI / NoImageAI meta tag detection
                    if (name === 'robots' && /\b(noai|noimageai)\b/.test(content)) {
                        hasNoAI = true;
                    }
                    // Viewport meta tag detection
                    if (name === 'viewport') {
                        hasViewport = true;
                    }
                    if (name === 'author' && content.trim()) {
                        hasAuthorship = true;
                    }
                    if (property === 'article:published_time' && content.trim()) {
                        hasFreshness = true;
                    }
                    // Meta Description and Open Graph detection
                    if ((name === 'description' || property === 'og:description') && content.trim()) {
                        hasMetaDesc = true;
                    }
                }
            })
            .on('time', {
                element() { hasFreshness = true; }
            })
            .on('main, article', {
                element() { hasSemanticTags = true; }
            })
            .on('h1', {
                element() { hasH1 = true; }
            })
            .on('h2', {
                element() { hasH2 = true; }
            })
            .on('ul, ol, table', {
                element() { hasLists = true; }
            })
            .on('blockquote, q', {
                element() { hasQuotations = true; }
            })
            .on('*[aria-label], *[aria-labelledby], *[role]', {
                element() { hasARIA = true; }
            })
            .on('script, style, noscript', {
                element(el) {
                    ignoredTagDepth++;
                    el.onEndTag(() => {
                        ignoredTagDepth--;
                    });
                }
            })
            .on('body', {
                text(chunk) {
                    if (ignoredTagDepth === 0 && lowerHtmlText.length < 500000) {
                        lowerHtmlText += chunk.text.toLowerCase();
                        if (lowerHtmlText.length > 500000) {
                            lowerHtmlText = lowerHtmlText.substring(0, 500000);
                        }
                    }
                }
            })
            .on('a', {
                element(el) {
                    const href = el.getAttribute('href');
                    if (href) {
                        try {
                            const resolvedUrl = new URL(href, base);
                            const baseHostname = new URL(base).hostname;
                            if (resolvedUrl.hostname === baseHostname) {
                                hasInternalLinks = true;
                                if (resolvedUrl.search && resolvedUrl.search.length > 1) {
                                    hasDirtyUrls = true;
                                }
                            } else if (resolvedUrl.protocol.startsWith('http')) {
                                hasCitations = true;
                            }
                        } catch {
                            // Ignore invalid URLs or unsupported protocols
                        }
                    }
                }
            })
            .on('noscript', {
                text(chunk) {
                    const t = chunk.text.toLowerCase();
                    if (t.includes('llms.txt') || t.includes('ai agent')) {
                        hasAgentFallback = true;
                    }
                }
            })
            .on('script', {
                element(el) {
                    const src = (el.getAttribute('src') || '').toLowerCase();
                    if (src.includes('webmcp.js') || src.includes('webmcp@latest') || src.includes('@jason.today/webmcp')) {
                        hasWebMCP = true;
                    }
                },
                text(chunk) {
                    scriptBytes += chunk.text.length;
                    if (hasWebMCP) return;
                    if (currentScriptText.length < 500000) {
                        currentScriptText += chunk.text;
                        if (currentScriptText.length > 500000) {
                            currentScriptText = currentScriptText.substring(0, 500000);
                        }
                    }
                    if (chunk.lastInTextNode) {
                        if (currentScriptText.includes('new WebMCP')) {
                            hasWebMCP = true;
                        }
                        currentScriptText = '';
                    }
                }
            })
            .on('script[type="application/ld+json"]', {
                text(chunk) {
                    if (currentJsonLd.length < 500000) {
                        currentJsonLd += chunk.text;
                        if (currentJsonLd.length > 500000) {
                            currentJsonLd = currentJsonLd.substring(0, 500000);
                        }
                    }
                    if (chunk.lastInTextNode) {
                        if (jsonLdChunks.length < 50) { jsonLdChunks.push(currentJsonLd); }
                        currentJsonLd = '';
                    }
                }
            })
            .transform(r_home);

        if (transformed.body) {
            let bytesRead = 0;
            const maxBytes = 2 * 1024 * 1024;
            const reader = transformed.body.getReader();
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    if (value) {
                        bytesRead += value.byteLength || value.length || 0;
                        if (bytesRead > maxBytes) {
                            await reader.cancel();
                            break;
                        }
                    }
                }
            } finally {
                reader.releaseLock();
            }
        }

        // Evaluate new metrics
        hasCleanUrls = hasInternalLinks && !hasDirtyUrls;

        // An <img> without an alt attribute is invisible to an agent. One
        // described image out of two hundred used to be enough to pass.
        hasImageAlt = imagesTotal === 0 || (imagesWithAlt / imagesTotal) >= 0.8;

        const sentences = lowerHtmlText.split(/[.!?]+(?=\s+|$)/).filter(s => s.trim().length > 0).length || 1;
        const words = lowerHtmlText.split(/\s+/).filter(w => w.length > 0).length || 1;
        wordCount = lowerHtmlText.trim() ? words : 0;
        const isCyrillic = /[а-яё]/i.test(lowerHtmlText);

        // A page that ships a large script bundle but almost no text is a
        // client-rendered shell: crawlers that do not execute JavaScript see an
        // empty document, which is the single most expensive AI-readiness bug.
        hasServerRenderedContent = wordCount >= 100 || (wordCount >= 25 && scriptBytes < 5000);

        if (words > 50) {
            const asl = words / sentences;
            const asw = countSyllables(lowerHtmlText, isCyrillic) / words;
            const flesch = isCyrillic
                ? 206.835 - 1.3 * asl - 60.1 * asw
                : 206.835 - 1.015 * asl - 84.6 * asw;
            fleschScore = Math.round(flesch);
            // The bands differ by language on purpose. The Russian (Oborneva)
            // coefficients weigh syllables far more heavily than the English
            // ones, so the same prose scores ~15 points lower in Cyrillic; a
            // single threshold across both would quietly fail readable Russian.
            // The old 30-100 window passed essentially any prose in either.
            hasFluency = isCyrillic
                ? (flesch >= 30 && flesch <= 90)
                : (flesch >= 45 && flesch <= 95);
        }


        // Also check the raw text for JS-based agent fallback (covers non-noscript patterns)
        if (!hasAgentFallback && lowerHtmlText.includes('javascript') && (lowerHtmlText.includes('llms.txt') || lowerHtmlText.includes('ai agent'))) {
            hasAgentFallback = true;
        }

        if (!hasStatistics) {
            const statsRegex = /(?:\$|\b(?:USD|EUR|GBP)\s?)\d+(?:,\d{3})*(?:\.\d+)?|\b\d+(?:,\d{3})*(?:\.\d+)?\s*%/i;
            if (statsRegex.test(lowerHtmlText)) {
                hasStatistics = true;
            }
        }
        // Process JSON-LD blocks extracted by HTMLRewriter
        for (const block of jsonLdChunks) {
            try {
                const json = JSON.parse(block);
                const checkSchema = (obj) => {
                    if (!obj || typeof obj !== 'object') return;
                    if (obj['@type']) {
                        hasSchema = true;
                        const typeList = Array.isArray(obj['@type']) ? obj['@type'] : [obj['@type']];
                        if (!schemaType) schemaType = typeList[0];

                        if (typeList.includes('FAQPage') || typeList.includes('Question')) {
                            hasFaqSchema = true;
                        }
                        if (typeList.includes('Organization')) {
                            hasOrgSchema = true;
                        }
                        if (typeList.includes('BreadcrumbList')) {
                            hasBreadcrumbSchema = true;
                        }
                        if (typeList.includes('WebSite') && obj['potentialAction']) {
                            const actions = Array.isArray(obj['potentialAction']) ? obj['potentialAction'] : [obj['potentialAction']];
                            if (actions.some(a => a && /SearchAction/.test(String(a['@type'] || '')))) {
                                hasSiteSearchSchema = true;
                            }
                        }
                    }
                    if (obj['author']) {
                        hasAuthorship = true;
                    }
                    if (obj['datePublished'] || obj['dateModified']) {
                        hasFreshness = true;
                    }
                };
                
                if (Array.isArray(json)) {
                    json.forEach(checkSchema);
                } else if (json['@graph'] && Array.isArray(json['@graph'])) {
                    json['@graph'].forEach(checkSchema);
                } else {
                    checkSchema(json);
                }
            } catch { /* ignore parse error */ }
        }

        // Depends on authorship from JSON-LD and on the statistics scan above,
        // so it has to be decided once both are final.
        hasAuthoritativeVoice = (hasAuthorship && (hasCitations || hasStatistics)) ||
                                (hasCitations && hasQuotations && hasStatistics);
        

    } catch { /* silent fail */ }
    })();

    // --- Phase 3: protocol / manifest discovery ---
    const wellKnownFiles = [
        {
            name: 'A2A Agent Card', prompt: `Write a JSON file named agent-card.json that follows the A2A protocol specification. It should list my application's capabilities, endpoints, and OAuth 2.0 authorization rules. Please provide the file content and tell me to place it in /.well-known/agent-card.json.`, path: '/.well-known/agent-card.json', spec: 'https://a2a-protocol.org/latest/specification/', isJson: true, points: 5,
            tooltip: `<strong>What it is:</strong> Expected at <code>/.well-known/agent-card.json</code>, this is the standard Agent-to-Agent (A2A) protocol entry point.<br/><br/><strong>Why it's critical:</strong> It details exactly what your application is capable of doing from a machine's perspective, listing supported actions and state schemas.<br/><br/><strong>Impact of missing it:</strong> Other autonomous agents cannot dynamically negotiate data exchanges with your platform, isolating you from the agentic economy. You lose machine-to-machine traffic.<br/><br/><strong>Implementation Example:</strong> Publish a JSON file containing your agent's name, capabilities (Skills), endpoints, and OAuth 2.0 authorization rules.`
        },
        {
            name: 'AGENTS.md', prompt: `Create an AGENTS.md file at the root of my project defining operational guidelines, tool constraints, and workflow instructions for autonomous AI agents.`, path: '/AGENTS.md', spec: 'https://agents.md/', isJson: false, points: 5,
            tooltip: `<strong>What it is:</strong> A dedicated Markdown manifest at <code>/AGENTS.md</code> or <code>/.well-known/agents.md</code> that provides operational guidelines, tool constraints, and instructions specifically for autonomous AI agents.<br/><br/><strong>Why it's critical:</strong> Gives agents explicit operating context, helping them navigate your codebase and APIs safely without hallucinating workflows.<br/><br/><strong>Impact of missing it:</strong> Agents execute blindly based on generic model priors, increasing the risk of unexpected behaviors or failed task executions.<br/><br/><strong>Implementation Example:</strong> Create <code>/AGENTS.md</code> with an H1 title, summary blockquote, and sections for Core Capabilities, Guardrails, and API Integration.`,
            validate: async (req, statusCode, cType, base) => {
                if (statusCode === 404) {
                    try {
                        const fallbackReq = await iFetch(`${base}/.well-known/agents.md`, { headers: headersStandard, cf: { cacheEverything: false } });
                        if (fallbackReq.status === 200) {
                            req = fallbackReq;
                            statusCode = 200;
                            cType = (fallbackReq.headers.get('content-type') || '').toLowerCase();
                        }
                    } catch {}
                }
                let isSoft404 = statusCode === 200 && cType.includes('text/html');
                if (statusCode === 200 && !isSoft404) {
                    const text = await safeReadText(req, 256 * 1024);
                    const hasH1 = /^#\s+.+/m.test(text);
                    const hasInstructions = /agent|guideline|instruction|capabilit|overview|rule|task|endpoint|api/i.test(text);
                    if (hasH1 && hasInstructions) {
                        return { status: 'ok', message: 'Valid AGENTS.md instructions found', code: 'Found' };
                    }
                    return { status: 'ok', message: 'AGENTS.md document found', code: 'Found' };
                }
                if (isSoft404) return { status: 'err', message: 'Soft 404 (Placeholder page)', code: 'Soft 404' };
                if ([401, 403].includes(statusCode)) return { status: 'warn', message: 'Authorization required', code: 'Protected' };
                return { status: 'err', message: `Not found (${statusCode})`, code: 'Missing' };
            }
        },
        {
            name: 'agents.json', prompt: `Create an agents.json manifest at /.well-known/agents.json declaring my AI agent's name, version, and callable capabilities.`, path: '/.well-known/agents.json', spec: 'https://agents.md/', isJson: true, points: 5,
            tooltip: `<strong>What it is:</strong> Machine-readable agent configuration manifest at <code>/.well-known/agents.json</code>.<br/><br/><strong>Why it's critical:</strong> Provides structured metadata (name, version, endpoints, capabilities) for automated agent discovery registers and multi-agent systems.<br/><br/><strong>Impact of missing it:</strong> Autonomous agent discovery platforms cannot programmatically ingest your agent's capabilities.<br/><br/><strong>Implementation Example:</strong> Publish a JSON file containing <code>name</code>, <code>version</code>, and <code>capabilities</code> list at <code>/.well-known/agents.json</code>.`,
            validate: async (req, statusCode, cType) => {
                let isSoft404 = statusCode === 200 && cType.includes('text/html');
                if (statusCode === 200 && !isSoft404) {
                    try {
                        const json = await req.json();
                        if (json && typeof json === 'object') {
                            const capCount = Array.isArray(json.capabilities) ? json.capabilities.length : (Array.isArray(json.tools) ? json.tools.length : 0);
                            const detail = capCount > 0 ? `${capCount} capabilities declared` : 'Config found';
                            return { status: 'ok', message: `Valid agents.json manifest (${detail})`, code: 'Found' };
                        }
                    } catch {}
                    return { status: 'err', message: 'Invalid JSON content in agents.json', code: 'Invalid JSON' };
                }
                if (isSoft404) return { status: 'err', message: 'Soft 404 (Placeholder page)', code: 'Soft 404' };
                if ([401, 403].includes(statusCode)) return { status: 'warn', message: 'Authorization required', code: 'Protected' };
                return { status: 'err', message: `Not found (${statusCode})`, code: 'Missing' };
            }
        },
        {
            name: 'API Catalog', prompt: `Create an RFC 9727 HTTP API Catalog file at /.well-known/api-catalog that points to my OpenAPI/Swagger documentation, and ensure endpoints have operationIds and schema descriptions for LLM tool calling.`, path: '/.well-known/api-catalog', spec: 'https://www.rfc-editor.org/rfc/rfc9727.txt', isJson: false, points: 5,
            tooltip: `<strong>What it is:</strong> RFC 9727 HTTP API Catalog.<br/><br/><strong>Why it's critical:</strong> It standardizes where autonomous systems can find machine-readable descriptions (like OpenAPI/Swagger) of your APIs.<br/><br/><strong>Impact of missing it:</strong> LLMs won't be able to map out your API endpoints natively. If an agent wants to extract specific business data or trigger an action, it will fail to 'understand' how to structure the HTTP requests, reducing integrations to zero.<br/><br/><strong>Implementation Example:</strong> Create a <code>/.well-known/api-catalog</code> that points to your public <code>openapi.json</code> or Swagger documentation so models instantly learn your exact HTTP request structures.`,
            validate: async (req, statusCode, cType, base) => {
                let isSoft404 = statusCode === 200 && cType.includes('text/html');
                if (statusCode === 200 && !isSoft404) {
                    let openapiUrl = `${base}/openapi.json`;
                    try {
                        const text = await safeReadText(req, 64 * 1024);
                        const match = text.match(/https?:\/\/[^\s"',;<>()]+|\/[a-zA-Z0-9_\-\.\/]+\.json/i);
                        if (match) {
                            openapiUrl = match[0].startsWith('http') ? match[0] : `${base}${match[0]}`;
                        }
                    } catch {}

                    try {
                        const openapiReq = await iFetch(openapiUrl, { headers: headersStandard, cf: { cacheEverything: false } });
                        if (openapiReq.status === 200) {
                            const spec = await openapiReq.json();
                            if (spec && typeof spec.paths === 'object') {
                                let totalOps = 0;
                                let readyOps = 0;
                                for (const p of Object.keys(spec.paths)) {
                                    const pathItem = spec.paths[p];
                                    if (pathItem && typeof pathItem === 'object') {
                                        ['get', 'post', 'put', 'delete', 'patch', 'options', 'head'].forEach(m => {
                                            const op = pathItem[m];
                                            if (op && typeof op === 'object') {
                                                totalOps++;
                                                const hasOpId = Boolean(op.operationId && String(op.operationId).trim());
                                                const hasDesc = Boolean((op.description || op.summary) && String(op.description || op.summary).trim());
                                                if (hasOpId && hasDesc) {
                                                    readyOps++;
                                                }
                                            }
                                        });
                                    }
                                }
                                if (totalOps > 0) {
                                    const pct = Math.round((readyOps / totalOps) * 100);
                                    return { status: 'ok', message: `RFC 9727 API Catalog (Tool-Ready: ${readyOps}/${totalOps} operations, ${pct}%)`, code: `${pct}% Ready` };
                                }
                            }
                        }
                    } catch {}
                    return { status: 'ok', message: 'Valid API Catalog found', code: 'Found' };
                }
                if (isSoft404) return { status: 'err', message: 'Soft 404 (Placeholder page)', code: 'Soft 404' };
                if ([401, 403].includes(statusCode)) return { status: 'warn', message: 'Authorization required', code: 'Protected' };
                return { status: 'err', message: `Not found (${statusCode})`, code: 'Missing' };
            }
        },
        {
            name: 'Agent Skills', prompt: `Create an Agent Skills index file at /.well-known/agent-skills/index.json that maps my complex REST endpoints into actionable skills for an AI agent.`, path: '/.well-known/agent-skills/index.json', spec: 'https://agentskills.io/home', isJson: true, points: 5,
            tooltip: `<strong>What it is:</strong> A specialized index documenting actionable machine-skills (e.g. "BuyItem", "SearchDocs").<br/><br/><strong>Why it's critical:</strong> It abstracts complex APIs into simple semantic 'skills' that an LLM brain can invoke.<br/><br/><strong>Impact of missing it:</strong> AI Assistants (like custom GPTs) will not be able to execute any high-level workflows on your platform, severely reducing the business automation capabilities for end-users.<br/><br/><strong>Implementation Example:</strong> Map complex REST endpoints into clean, actionable concepts like <code>FindFlight</code> or <code>CancelOrder</code> under <code>/.well-known/agent-skills/index.json</code>.`
        },
        {
            name: 'MCP Server', prompt: `Create a Model Context Protocol (MCP) server manifest at /.well-known/mcp/server-card.json or deploy a live MCP endpoint at /mcp exposing your tools via SSE or Stream.`, path: '/.well-known/mcp/server-card.json', spec: 'https://modelcontextprotocol.io/', isJson: true, points: 5,
            tooltip: `<strong>What it is:</strong> Model Context Protocol (MCP) server integration.<br/><br/><strong>Why it's critical:</strong> It allows AI ecosystems (Claude Desktop, Cursor, intelligent agents) to securely connect to your platform, stream resources, and execute callable tools.<br/><br/><strong>Impact of missing it:</strong> Agents will not be able to interact with your business logic dynamically.<br/><br/><strong>Implementation Example:</strong> Deploy an MCP endpoint at <code>/mcp</code> or <code>/mcp/sse</code>, or publish a discovery manifest at <code>/.well-known/mcp/server-card.json</code>.`,
            validate: async (req, statusCode, cType, base) => {
                let isSoft404 = statusCode === 200 && cType.includes('text/html');
                
                // 1. Check server-card.json if valid
                if (statusCode === 200 && !isSoft404) {
                    try {
                        const jsonBody = await req.json();
                        let liveTarget = jsonBody.endpoints?.sse || jsonBody.endpoints?.http || jsonBody.url || '/mcp';
                        let liveProbeOk = false;
                        let isOAuthProtected = false;
                        let toolCount = Array.isArray(jsonBody.tools) ? jsonBody.tools.length : 0;

                        if (liveTarget) {
                            try {
                                const targetUrl = liveTarget.startsWith('http') ? liveTarget : `${base}${liveTarget.startsWith('/') ? '' : '/'}${liveTarget}`;
                                const probeReq = await iFetch(targetUrl, {
                                    method: 'POST',
                                    headers: { ...headersStandard, 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
                                    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
                                    cf: { cacheEverything: false }
                                });
                                if (probeReq.status === 200 || probeReq.status === 204) {
                                    liveProbeOk = true;
                                    try {
                                        const resJson = await probeReq.json();
                                        if (resJson?.result?.tools?.length) {
                                            toolCount = resJson.result.tools.length;
                                        }
                                    } catch {}
                                } else if ([401, 403].includes(probeReq.status)) {
                                    const authHeader = (probeReq.headers.get('www-authenticate') || '').toLowerCase();
                                    isOAuthProtected = authHeader.includes('bearer') || authHeader.includes('resource_metadata') || authHeader.includes('oauth');
                                    if (!isOAuthProtected) {
                                        try {
                                            const probeBody = await probeReq.text();
                                            if (probeBody.includes('token') || probeBody.includes('unauthorized') || probeBody.includes('auth')) {
                                                isOAuthProtected = true;
                                            }
                                        } catch {}
                                    }
                                }
                            } catch {}
                        }

                        if (liveProbeOk) {
                            return { status: 'ok', message: `Live MCP Server operational (${toolCount > 0 ? `${toolCount} tools active` : 'endpoint responding'})`, code: 'Live & Operational' };
                        }
                        if (isOAuthProtected) {
                            return { status: 'ok', message: 'Live MCP server active (OAuth 2.0 protected)', code: 'OAuth Protected' };
                        }
                        if (toolCount > 0) {
                            return { status: 'ok', message: `MCP manifest found with ${toolCount} defined tools`, code: 'Active' };
                        }
                        return { status: 'ok', message: 'Valid MCP server card manifest found', code: 'Manifest' };
                    } catch {}
                }

                // 2. Direct probe of /mcp and /mcp/sse endpoints
                const candidatePaths = ['/mcp', '/mcp/sse'];
                for (const candPath of candidatePaths) {
                    try {
                        const mcpUrl = `${base}${candPath}`;
                        const mcpGetReq = await iFetch(mcpUrl, {
                            headers: { ...headersStandard, 'Accept': 'application/json, text/event-stream, */*' },
                            cf: { cacheEverything: false }
                        });
                        const getStatus = mcpGetReq.status;
                        const getCType = (mcpGetReq.headers.get('content-type') || '').toLowerCase();
                        const getAuth = (mcpGetReq.headers.get('www-authenticate') || '').toLowerCase();
                        const isGetSoft404 = getStatus === 200 && getCType.includes('text/html');

                        if (getStatus === 200 && !isGetSoft404) {
                            if (getCType.includes('text/event-stream')) {
                                return { status: 'ok', message: `Live MCP SSE endpoint active at ${candPath}`, code: 'Live & Operational' };
                            }
                            try {
                                const jsonRes = await mcpGetReq.json();
                                const toolCount = Array.isArray(jsonRes?.tools) ? jsonRes.tools.length : 0;
                                const isMcpJson = jsonRes && (jsonRes.jsonrpc === '2.0' || Array.isArray(jsonRes.tools) || jsonRes.capabilities || jsonRes.serverInfo);
                                if (isMcpJson) {
                                    return { status: 'ok', message: `Live MCP endpoint active at ${candPath} (${toolCount > 0 ? `${toolCount} tools` : 'JSON response'})`, code: 'Live & Operational' };
                                }
                            } catch {}
                        }

                        if ([401, 403].includes(getStatus)) {
                            let isOAuth = getAuth.includes('bearer') || getAuth.includes('resource_metadata') || getAuth.includes('oauth');
                            let bodySnippet = '';
                            try {
                                bodySnippet = await safeReadText(mcpGetReq, 4 * 1024);
                                if (bodySnippet.includes('token') || bodySnippet.includes('unauthorized') || bodySnippet.includes('error')) {
                                    isOAuth = true;
                                }
                            } catch {}

                            if (isOAuth) {
                                return { status: 'ok', message: `Live MCP server active at ${candPath} (OAuth 2.0 protected)`, code: 'OAuth Protected' };
                            }
                            return { status: 'ok', message: `Live MCP endpoint active at ${candPath} (Protected)`, code: 'Protected' };
                        }

                        if (getStatus === 405) {
                            const mcpPostReq = await iFetch(mcpUrl, {
                                method: 'POST',
                                headers: { ...headersStandard, 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
                                body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
                                cf: { cacheEverything: false }
                            });
                            const postStatus = mcpPostReq.status;
                            const postAuth = (mcpPostReq.headers.get('www-authenticate') || '').toLowerCase();

                            if (postStatus === 200 || postStatus === 204) {
                                return { status: 'ok', message: `Live MCP endpoint active at ${candPath}`, code: 'Live & Operational' };
                            }
                            if ([401, 403].includes(postStatus)) {
                                const isOAuth = postAuth.includes('bearer') || postAuth.includes('resource_metadata') || postAuth.includes('oauth');
                                return { status: 'ok', message: `Live MCP server active at ${candPath} (${isOAuth ? 'OAuth 2.0 protected' : 'Protected'})`, code: isOAuth ? 'OAuth Protected' : 'Protected' };
                            }
                        }
                    } catch {}
                }

                if (isSoft404) return { status: 'err', message: 'Soft 404 (Placeholder page)', code: 'Soft 404' };
                if ([401, 403].includes(statusCode)) return { status: 'warn', message: 'Authorization required', code: 'Protected' };
                return { status: 'err', message: `Not found (${statusCode})`, code: 'Missing' };
            }
        },
        {
            name: 'OAuth Discovery', prompt: `Create an OAuth 2.0 discovery metadata file at /.well-known/oauth-authorization-server following RFC 8414.`, path: '/.well-known/oauth-authorization-server', spec: 'https://www.rfc-editor.org/rfc/rfc8414.txt', isJson: true, points: 5,
            tooltip: `<strong>What it is:</strong> RFC 8414 standard for OAuth 2.0 discovery.<br/><br/><strong>Why it's critical:</strong> Allows agents to understand exactly how to authenticate, which scopes are available, and where token endpoints live.<br/><br/><strong>Impact of missing it:</strong> Agents will be completely blocked out of secure/private areas of your platform. They cannot dynamically request user consent to perform actions on their behalf.<br/><br/><strong>Implementation Example:</strong> Serve metadata at <code>/.well-known/oauth-authorization-server</code> highlighting your issuer URI and token endpoints so LLM apps can securely acquire human user consent.`
        },
        {
            name: 'OAuth Protected Resource',
            prompt: `Create an RFC 9728 OAuth 2.0 Protected Resource Metadata file at /.well-known/oauth-protected-resource/mcp (or /.well-known/oauth-protected-resource) linking my MCP server to its authorization server.
Example:
\`\`\`json
{
  "resource": "https://ai-valid.secmy.app/mcp",
  "authorization_servers": ["https://ai-valid.secmy.app"],
  "bearer_methods_supported": ["header"],
  "scopes_supported": ["mcp:read", "mcp:write"]
}
\`\`\``,
            path: '/.well-known/oauth-protected-resource/mcp',
            spec: 'https://www.rfc-editor.org/rfc/rfc9728.txt',
            isJson: true,
            points: 5,
            tooltip: `<strong>What it is:</strong> RFC 9728 OAuth 2.0 Protected Resource Metadata (expected at <code>/.well-known/oauth-protected-resource/mcp</code> or <code>/.well-known/oauth-protected-resource</code>).<br/><br/><strong>Why it's critical:</strong> Used natively by Claude Code, OpenAI Assistants, and AI agents to automatically discover OAuth 2.0 authorization servers when connecting to protected Remote MCP endpoints.<br/><br/><strong>Impact of missing it:</strong> AI clients cannot automatically initiate browser-based OAuth consent flow when attempting to connect to protected MCP server tools.<br/><br/><strong>Implementation Example:</strong> Publish a JSON metadata file at <code>/.well-known/oauth-protected-resource/mcp</code> declaring your <code>resource</code> URL and <code>authorization_servers</code>.`,
            validate: async (req, statusCode, cType, base) => {
                if ([404, 405, 501].includes(statusCode)) {
                    try {
                        const fallbackReq = await iFetch(`${base}/.well-known/oauth-protected-resource`, { headers: headersStandard, cf: { cacheEverything: false } });
                        if (fallbackReq.status === 200) {
                            req = fallbackReq;
                            statusCode = 200;
                            cType = (fallbackReq.headers.get('content-type') || '').toLowerCase();
                        }
                    } catch {}
                }
                let isSoft404 = statusCode === 200 && cType.includes('text/html');
                if (statusCode === 200 && !isSoft404) {
                    try {
                        const json = await req.json();
                        if (json && typeof json === 'object') {
                            const authServers = Array.isArray(json.authorization_servers) ? json.authorization_servers.length : 0;
                            return {
                                status: 'ok',
                                message: `RFC 9728 Protected Resource metadata verified (${authServers > 0 ? `${authServers} auth server(s)` : 'valid config'})`,
                                code: 'Found',
                                addScore: 5
                            };
                        }
                    } catch {}
                    return { status: 'err', message: 'Invalid JSON in oauth-protected-resource metadata', code: 'Invalid JSON' };
                }
                if (isSoft404) return { status: 'err', message: 'Soft 404 (Placeholder page)', code: 'Soft 404' };
                if ([401, 403].includes(statusCode)) return { status: 'warn', message: 'Authorization required', code: 'Protected' };
                return { status: 'err', message: `Not found (${statusCode})`, code: 'Missing' };
            }
        },
        {
            name: 'AI Plugin', prompt: `Create an AI Plugin manifest at /.well-known/ai-plugin.json with a description_for_model and a link to my OpenAPI schema.`, path: '/.well-known/ai-plugin.json', spec: 'https://projects.laion.ai/Open-Assistant/docs/plugins/details', isJson: true, points: 5,
            tooltip: `<strong>What it is:</strong> Originally introduced by OpenAI, this is the standard manifesto that turns your website's REST API into an AI "Plugin" or "Action" for consumer LLM chats.<br/><br/><strong>Why it's critical:</strong> When users chat with ChatGPT or Copilot, the AI needs to know exactly what your API does to decide when to call it. This file provides the "natural language" metadata and authentication rules connecting the LLM to your OpenAPI schema.<br/><br/><strong>Impact of missing it:</strong> You cannot create Custom GPTs or Copilot extensions that natively interact with your platform. The AI will not know how to discover your API endpoints.<br/><br/><strong>Implementation Example:</strong> Host a file at <code>/.well-known/ai-plugin.json</code>. Inside, provide a <code>name_for_human</code>, a highly detailed <code>description_for_model</code> (telling the AI explicitly when and how to use it), and a link to your <code>openapi.yaml</code> spec.`
        },
        {
            name: 'Universal Commerce', prompt: `Create a Universal Commerce Protocol (UCP) configuration at /.well-known/ucp pointing to my headless commerce endpoints.`, path: '/.well-known/ucp', spec: 'http://ucp.dev/', isJson: true, points: 5,
            tooltip: `<strong>What it is:</strong> Protocol specifically designed for agent-based e-commerce operations.<br/><br/><strong>Why it's critical:</strong> It formats product data, checkout flows, and inventory constraints transparently for AI shopping agents.<br/><br/><strong>Impact of missing it:</strong> If your site sells goods or services, AI purchasing agents will not be able to seamlessly 'click' through your funnel or verify prices, losing you fully automated AI-driven revenue.<br/><br/><strong>Implementation Example:</strong> Place a configuration at <code>/.well-known/ucp</code> pointing agents to your headless commerce endpoints, allowing autonomous bots to load shopping carts.`
        },
        {
            name: 'LLMs.txt', prompt: `Create an llms.txt file for my root directory containing an H1 title, a summary quote box, and a Markdown list of links to my technical documentation.`, path: '/llms.txt', spec: 'https://llmstxt.org/', isJson: false, points: 5,
            tooltip: `<strong>What it is:</strong> A navigation manifesto designed specifically for Large Language Models.<br/><br/><strong>Why it's critical:</strong> It provides a clean, markdown-based table of contents of your documentation, sidestepping heavy UI routing.<br/><br/><strong>Impact of missing it:</strong> Models trying to understand your platform's documentation will hallucinate or get stuck traversing endless JS-heavy web pages. Giving them an explicit map drastically improves AI response accuracy regarding your product.<br/><br/><strong>Implementation Example:</strong> Add <code>/llms.txt</code> to your root. Formatting: an H1 Title, a summary quote box, and a clean Markdown list of links pointing to raw <code>.md</code> technical docs.`,
            validate: async (req, statusCode, cType) => {
                let isSoft404 = statusCode === 200 && cType.includes('text/html');
                if (statusCode === 200 && !isSoft404) {
                    const text = await safeReadText(req, 256 * 1024);
                    const hasH1 = /^#\s+.+/m.test(text);
                    const hasBlockquote = /^>\s+.+/m.test(text);
                    const hasLinkList = /^-\s+\[.+\]\(.+\)/m.test(text);

                    if (hasH1 && hasBlockquote && hasLinkList) {
                        return { status: 'ok', message: 'Full llmstxt.org spec compliant (H1, Summary, Links)', code: 'Compliant' };
                    } else if (hasH1 || hasLinkList) {
                        return { status: 'ok', message: 'Valid llms.txt found (partial structure: missing summary blockquote or link list)', code: 'Partial' };
                    }
                    return { status: 'ok', message: 'Readable llms.txt found', code: 'Found' };
                }
                if (isSoft404) return { status: 'err', message: 'Soft 404 (Placeholder page)', code: 'Soft 404' };
                if ([401, 403].includes(statusCode)) return { status: 'warn', message: 'Authorization required', code: 'Protected' };
                return { status: 'err', message: `Not found (${statusCode})`, code: 'Missing' };
            }
        },
        {
            name: "LLMs-Full.txt",
            prompt: `Please check if \`/llms-full.txt\` exists in my project root. If it exists, update it; otherwise, create it. It should provide a comprehensive, concatenated Markdown version of all my primary technical documentation.`,
            path: '/llms-full.txt', spec: 'https://llmstxt.org/', isJson: false, points: 5,
            tooltip: `<strong>What it is:</strong> A complete, machine-readable export of your entire documentation in structured Markdown format.<br/><br/><strong>Why it's critical:</strong> It provides LLMs and agents with all context in a single file, eliminating the need for multiple API calls or web scraping.<br/><br/><strong>Impact of missing it:</strong> AI systems might miss critical details if they only read summaries or have to navigate multiple links, increasing the chance of hallucinations and degraded agentic capabilities.<br/><br/><strong>Implementation Example:</strong> Add <code>/llms-full.txt</code> to your root. Include all relevant documentation content (e.g., tutorials, API references, code samples) concatenated in clear, structured Markdown.`,
            validate: async (req, statusCode, cType) => {
                let isSoft404 = statusCode === 200 && cType.includes('text/html');
                if (statusCode === 200 && !isSoft404) {
                    const text = await safeReadText(req, 500 * 1024);
                    const hasH1 = /^#\s+.+/m.test(text);
                    const hasSections = /^##\s+.+/m.test(text);
                    if (hasH1 && hasSections) {
                        return { status: 'ok', message: 'Structured full markdown documentation found', code: 'Compliant' };
                    }
                    return { status: 'ok', message: 'Full documentation text found', code: 'Found' };
                }
                if (isSoft404) return { status: 'err', message: 'Soft 404 (Placeholder page)', code: 'Soft 404' };
                if ([401, 403].includes(statusCode)) return { status: 'warn', message: 'Authorization required', code: 'Protected' };
                return { status: 'err', message: `Not found (${statusCode})`, code: 'Missing' };
            }
        },
        {
            name: "TDM Reservation",
            prompt: `Please check if \`/.well-known/tdmrep.json\` exists. If it exists, update it; otherwise, create it. It should implement the TDM Reservation Protocol to express my Text and Data Mining (TDM) rights for AI scraping and training. You must also create the \`/policies/tdm-policy.json\` file referenced in the \`tdm-policy\` field if it does not already exist.`,
            path: '/.well-known/tdmrep.json', spec: 'https://www.w3.org/community/reports/tdmrep/CG-FINAL-tdmrep-20240510/', isJson: true, points: 5,
            tooltip: `<strong>What it is:</strong> The W3C Text and Data Mining (TDM) Reservation Protocol.<br/><br/><strong>Why it's critical:</strong> It provides a machine-readable way to formally opt-out of or set policies for AI model training and automated scraping, which is critical for compliance with the EU CDSM Directive Article 4.<br/><br/><strong>Impact of missing it:</strong> AI crawlers and scrapers may assume they have the right to scrape your data for model training purposes. You lack a standardized mechanism to declare your copyright reservation.<br/><br/><strong>Implementation Example:</strong> Host a JSON file at <code>/.well-known/tdmrep.json</code> with a <code>tdm-reservation</code> flag and an optional link to your licensing policy.`
        },
        {
            name: "ai.txt",
            prompt: `Please check if \`/ai.txt\` exists. If it exists, update it; otherwise, create it. It should define permissions for AI data mining and scraping, following the Spawning.ai format.`,
            path: '/ai.txt', spec: 'https://site.spawning.ai/spawning-ai-txt', isJson: false, points: 5,
            tooltip: `<strong>What it is:</strong> A plain text file declaring your website's policies for AI system interaction, such as permissions for AI data mining and model training, following the Spawning format.<br/><br/><strong>Why it's critical:</strong> It adheres to the EU's Digital Single Market TDM Article 4 exception by providing a machine-readable opt-out targeted at commercial AI model training.<br/><br/><strong>Impact of missing it:</strong> AI crawlers and data scrapers may assume they have full permission to scrape and use your content for commercial AI model training.<br/><br/><strong>Implementation Example:</strong> Host a file at <code>/ai.txt</code> with explicit bot directives: <br><code>User-Agent: GPTBot<br>Disallow: /</code>`
        },
        {
            name: "x402 Payment Standard",
            prompt: `Please check if \`/.well-known/x402.json\` exists. If it exists, update it; otherwise, create it. It should define my API pricing and payment parameters (assets, network CAIP-2, wallet address) following the x402 open payment standard.`,
            path: '/.well-known/x402.json',
            spec: 'https://www.x402.org/',
            isJson: true,
            points: 5,
            tooltip: `<strong>What it is:</strong> Expected at <code>/.well-known/x402.json</code>, this is the standard discovery metadata file for the HTTP 402-native open payments protocol.<br/><br/><strong>Why it's critical:</strong> It publishes machine-readable details about pricing, accepted assets (like USDC), payment networks (via CAIP-2 identifiers), and target wallet addresses so AI agents can pay programmatically.<br/><br/><strong>Impact of missing it:</strong> AI agents cannot discover your payment configuration. They will not be able to automatically authorize and execute micro-payments to purchase access to your APIs or protected data.<br/><br/><strong>Implementation Example:</strong> Publish a JSON configuration at <code>/.well-known/x402.json</code> specifying your pricing terms, network CAIP-2 identifiers (e.g., eip155:8453 for Base), and target wallet addresses.`
        },
        {
            name: "security.txt",
            prompt: `Please check if \`/.well-known/security.txt\` exists. If it exists, update it; otherwise, create it following RFC 9116. It should include Contact, Expires, and Preferred-Languages fields to help AI security scanners report vulnerabilities.`,
            path: '/.well-known/security.txt',
            spec: 'https://securitytxt.org/',
            isJson: false,
            points: 5,
            tooltip: `<strong>What it is:</strong> A standard plaintext file at <code>/.well-known/security.txt</code> defining security reporting policies.<br/><br/><strong>Why it's critical:</strong> Autonomous AI agents that discover security misconfigurations or vulnerabilities need a standardized way to report them to your team safely and legally.<br/><br/><strong>Impact of missing it:</strong> Security-focused agents will not know who to contact, leaving potential vulnerabilities unaddressed.<br/><br/><strong>Implementation Example:</strong> Publish a file at <code>/.well-known/security.txt</code> with <code>Contact: mailto:security@example.com</code> and an <code>Expires</code> date.`
        }
    ];

    // All manifest probes are queued at once; the shared limiter caps how many
    // are actually in flight. Fixed-size batches used to stall every probe in a
    // batch behind that batch's slowest host.
    const protoResults = [];
    const protoPhase = (async () => {
        const settled = await Promise.all(wellKnownFiles.map(async (data) => {
            const url = `${base}${data.path}`;
            let status = 'err';
            let message = '';
            let code = null;
            try {
                const req = await iFetch(url, { headers: headersStandard, cf: { cacheEverything: false } });
                code = req.status;
                let cType = (req.headers.get('content-type') || '').toLowerCase();

                if (typeof data.validate === 'function') {
                    const customResult = await data.validate(req, code, cType, base);
                    status = customResult.status || status;
                    message = customResult.message || message;
                    code = customResult.code || (status === 'ok' ? 'Found' : 'Missing');
                } else {
                    let isSoft404 = code === 200 && cType.includes('text/html');

                    if (code === 200 && !isSoft404) {
                        if (data.isJson) {
                            try {
                                const jsonBody = await req.json();
                                status = 'ok';
                                message = 'Valid JSON found';
                            } catch (err) {
                                message = 'Invalid JSON content';
                            }
                        } else {
                            if (!cType.includes('text/html')) {
                                status = 'ok';
                                message = 'Readable format found';
                            } else {
                                message = 'Received HTML (Soft 404)';
                            }
                        }
                    } else if (isSoft404) {
                        message = 'Soft 404 (Placeholder page)';
                    } else if ([401, 403].includes(code)) {
                        status = 'warn';
                        message = 'Authorization required';
                    } else {
                        message = `Not found (${code})`;
                    }
                }
            } catch (e) {
                message = 'Network error';
            }

            return { name: data.name, path: data.path, spec: data.spec, tooltip: data.tooltip, prompt: data.prompt, status, message, code };
        }));
        protoResults.push(...settled);
    })();

    // Surface an unreachable origin as such; everything else degrades silently
    // into a "not found" result for the individual check.
    await Promise.all([contentPhase, markdownPhase, sitemapPhase, protoPhase]);
    timings.durationMs = Date.now() - timings.startedAt;

    const auditResult = {
        target: base,
        generatedAt: new Date().toISOString(),
        durationMs: timings.durationMs,
        bots: {
            robotsFound,
            hasAISearch,
            hasAIAgent,
            hasAITrainingBlocked,
            hasDifferentiatedPolicy,
            sitemapFound,
            hasSitemapLastmod,
            results: [
                {
                    name: "robots.txt",
                    prompt: `Create or update my robots.txt file to explicitly allow OAI-SearchBot and other relevant AI bots while setting standard rules for web crawlers.`,
                    status: robotsFound ? 'ok' : 'err',
                    message: robotsFound ? "Found manifest file" : "Not Found manifest file",
                    spec: "https://developers.google.com/search/docs/crawling-indexing/robots/intro",
                    tooltip: `<strong>What it is:</strong> Standard web crawler directives located at <code>/robots.txt</code>.<br/><br/><strong>Why it's critical:</strong> It is the first place legacy and modern bots look for permissions on what content they are allowed to index or scrape.<br/><br/><strong>Impact of missing it:</strong> AI bots may either scrape data you wish to keep private (training models on your intellectual property), or they might adopt a strict default and completely ignore your site in AI search results (like Perplexity or SearchGPT).<br/><br/><strong>Implementation Example:</strong> Add explicit bot designations in your <code>robots.txt</code>, such as: <br><code>User-agent: OAI-SearchBot<br>Allow: /</code>`,
                    code: robotsFound ? 'Found' : 'Missing'
                },
                {
                    name: "AI Search Allowed",
                    prompt: `Update my robots.txt to explicitly allow AI search agents like OAI-SearchBot, PerplexityBot, and YouBot.`,
                    status: hasAISearch ? 'ok' : 'warn',
                    message: hasAISearch ? "AI Search bots allowed" : "AI Search bots disallowed or missing",
                    spec: "https://developers.google.com/search/docs/crawling-indexing/robots/intro",
                    tooltip: `<strong>What it is:</strong> Allowing search engines and AI engines that provide source citations (like OAI-SearchBot, PerplexityBot, YouBot).<br/><br/><strong>Why it's critical:</strong> It ensures that your website is discoverable by modern AI-based answers and engines that link back to your content.<br/><br/><strong>Impact of missing it:</strong> If blocked, you lose traffic from major AI engines.<br/><br/><strong>Implementation Example:</strong> <code>User-agent: OAI-SearchBot<br>Allow: /</code>`,
                    code: hasAISearch ? 'Allowed' : 'Disallowed'
                },
                {
                    name: "AI Agent Allowed",
                    prompt: `Update my robots.txt to explicitly allow user-directed AI agents like ChatGPT-User.`,
                    status: hasAIAgent ? 'ok' : 'warn',
                    message: hasAIAgent ? "AI Agent bots allowed" : "AI Agent bots disallowed or missing",
                    spec: "https://platform.openai.com/docs/bots",
                    tooltip: `<strong>What it is:</strong> Allowing user-initiated autonomous actions (like ChatGPT-User) to fetch your content dynamically on the user's behalf.<br/><br/><strong>Why it's critical:</strong> Allows users to run real-time tasks on your page via AI tools.<br/><br/><strong>Impact of missing it:</strong> Users cannot interact with your site natively through conversational assistant tools.<br/><br/><strong>Implementation Example:</strong> <code>User-agent: ChatGPT-User<br>Allow: /</code>`,
                    code: hasAIAgent ? 'Allowed' : 'Disallowed'
                },
                {
                    name: "AI Training Blocked",
                    prompt: `Update my robots.txt to disallow AI training and model scraping bots such as GPTBot, ClaudeBot, Google-Extended, Amazonbot, and Applebot-Extended.`,
                    status: hasAITrainingBlocked ? 'ok' : 'warn',
                    message: hasAITrainingBlocked ? "AI Training bots blocked" : "AI Training bots allowed or missing disallow directives",
                    spec: "https://platform.openai.com/docs/bots",
                    tooltip: `<strong>What it is:</strong> Disallowing crawlers that scrape content to train foundation models without direct referral value (GPTBot, ClaudeBot, Google-Extended, Amazonbot, cohere-ai, applebot-extended).<br/><br/><strong>Why it's critical:</strong> Protects your intellectual property from being digested without economic attribution.<br/><br/><strong>Impact of missing it:</strong> Your site is ingested into models that compete with your business directly.<br/><br/><strong>Implementation Example:</strong> <code>User-agent: GPTBot<br>Disallow: /</code>`,
                    code: hasAITrainingBlocked ? 'Blocked' : 'Allowed'
                },
                {
                    name: "Differentiated Policy",
                    prompt: `Configure a balanced AI crawler policy that allows AI Search and Agents but blocks model training.`,
                    status: hasDifferentiatedPolicy ? 'ok' : 'warn',
                    message: hasDifferentiatedPolicy ? "Differentiated policy implemented" : "Lacks recommended balanced crawler configuration",
                    spec: "https://blog.cloudflare.com/content-independence-day-ai-options/",
                    tooltip: `<strong>What it is:</strong> The recommended model where citation engines (Search) and user assistants (Agent) are allowed, but bulk model trainers (Training) are blocked.<br/><br/><strong>Why it's critical:</strong> Avoids the "binary choice" of blocking everything or allowing everything.<br/><br/><strong>Impact of missing it:</strong> You either block AI entirely or allow model training without control.<br/><br/><strong>Implementation Example:</strong> Block GPTBot/ClaudeBot, but allow OAI-SearchBot and ChatGPT-User.`,
                    code: hasDifferentiatedPolicy ? 'Implemented' : 'Not Implemented'
                },
                {
                    name: "sitemap.xml",
                    prompt: `Please generate a \`sitemap.xml\` for my project if it doesn't exist, and ensure my \`/robots.txt\` includes a \`Sitemap: <url>\` directive pointing to it. The sitemap should follow standard XML schema and list all important public pages.`,
                    status: sitemapFound ? 'ok' : 'err',
                    message: sitemapFound ? "Sitemap found" : "No Sitemap found",
                    spec: "https://www.sitemaps.org/protocol.html",
                    tooltip: `<strong>What it is:</strong> An XML file that lists URLs for a site along with additional metadata about each URL.<br/><br/><strong>Why it's critical:</strong> It allows AI search bots (like SearchGPT and Perplexity) and traditional search engines to discover your content efficiently without having to guess paths or follow every link blindly.<br/><br/><strong>Impact of missing it:</strong> AI crawlers might miss critical new or updated content on your platform, significantly reducing your visibility in AI-generated answers and search results.<br/><br/><strong>Implementation Example:</strong> Host a <code>/sitemap.xml</code> and add <code>Sitemap: https://yourdomain.com/sitemap.xml</code> to your <code>robots.txt</code>.`,
                    code: sitemapFound ? 'Found' : 'Missing'
                },
                {
                    name: "Sitemap Lastmod",
                    prompt: `Update my sitemap generator to include the <lastmod> tag with the last modification date for each URL in my sitemap.xml.`,
                    status: hasSitemapLastmod ? 'ok' : 'warn',
                    message: hasSitemapLastmod ? "Sitemap utilizes <lastmod> directives" : "Sitemap URLs missing <lastmod> date attributes",
                    spec: "https://www.sitemaps.org/protocol.html",
                    tooltip: `<strong>What it is:</strong> The <code>&lt;lastmod&gt;</code> property inside the sitemap XML.<br/><br/><strong>Why it's critical:</strong> Provides crawler hints to AI search engines about when content was updated, avoiding redundant crawling.<br/><br/><strong>Impact of missing it:</strong> Bots will repeatedly fetch unchanged pages or miss newly updated pages due to lack of signals.<br/><br/><strong>Implementation Example:</strong> <code>&lt;url&gt;&lt;loc&gt;...&lt;/loc&gt;&lt;lastmod&gt;2026-07-02&lt;/lastmod&gt;&lt;/url&gt;</code>`,
                    code: hasSitemapLastmod ? 'Found' : 'Missing'
                }
            ].sort(byImportance)
        },
        content: {
            supportsMarkdown,
            hasVaryAccept,
            hasContentSignal,
            hasContentUse,
            hasFreshnessHeaders,
            hasConditionalGET,
            hasWebMCP,
            hasStatistics,
            hasTitle,
            hasLang,
            hasImageAlt,
            hasRss,
            hasOrgSchema,
            hasARIA,
            hasMetaDesc,
            hasSemanticTags,
            hasH1,
            hasH2,
            hasLists,
            hasInternalLinks,
            hasCitations,
            hasQuotations,
            hasAuthorship,
            hasFreshness,
            hasFaqSchema,
            hasSchema,
            schemaType,
            hasNoAI,
            hasViewport,
            hasAgentFallback,
            hasFluency,
            hasAuthoritativeVoice,
            hasCleanUrls,
            hasCanonical,
            hasBreadcrumbSchema,
            hasSiteSearchSchema,
            hasServerRenderedContent,
            hasHsts,
            isHttps,
            xRobotsTag,
            hasBlockingXRobots,
            wordCount,
            fleschScore,
            imagesTotal,
            imagesWithAlt,
            results: [
                {
                    name: "Content Neg. (MD)",
                    prompt: `Implement content negotiation in my server so that when a client sends an 'Accept: text/markdown' header, it returns the page content in clean Markdown instead of HTML.`,
                    status: supportsMarkdown ? 'ok' : 'err',
                    message: supportsMarkdown
                        ? (hasVaryAccept
                            ? "Server provides markdown, with Vary: Accept"
                            : "Server provides markdown, but the response is missing Vary: Accept — a shared cache may serve it to browsers")
                        : "No markdown provided on-the-fly",
                    spec: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Content_negotiation",
                    tooltip: `<strong>What it is:</strong> Dynamic content routing. When a bot sends <code>Accept: text/markdown</code>, the server returns clean Markdown instead of full HTML.<br/><br/><strong>Why it's critical:</strong> LLMs process text tokens. Forcing an LLM to read a complex HTML DOM drastically inflates the 'noise', eating up prompt context limits and increasing latency.<br/><br/><strong>Impact of missing it:</strong> Data extraction becomes fragile. Your website remains a 'human-first' application that breaks agent logic when CSS classes and div nested structures get in the way of semantic information.<br/><br/><strong>Implementation Example:</strong> Utilize Cloudflare Workers, Nginx proxies, or Next.js middleware to sniff for <code>Accept: text/markdown</code> in the request header and return parsed Markdown text instantly without any styling wraps.`,
                    code: supportsMarkdown ? (hasVaryAccept ? 'Supported' : 'No Vary') : 'Failed'
                },
                {
                    name: "Content-Signal",
                    prompt: `Add a 'Content-Signal' HTTP response header to my server responses (e.g., Content-Signal: ai-train=no, search=yes) to explicitly declare usage policies for AI scraping and training.`,
                    status: hasContentSignal ? 'ok' : 'warn',
                    message: hasContentSignal ? "Usage policies header found" : "Missing usage policies header",
                    spec: "https://contentsignals.org/",
                    tooltip: `<strong>What it is:</strong> An explicit HTTP Header signaling legal and policy usage metadata for machine consumers.<br/><br/><strong>Why it's critical:</strong> It informs scraping bots at the network level whether your content is free for LLM training, requires attribution, or is completely restricted copyright.<br/><br/><strong>Impact of missing it:</strong> Machine agents assume 'fair game' for all scraped data. Without signal compliance, you have no technical ground to prevent proprietary data from becoming automated training fodder.<br/><br/><strong>Implementation Example:</strong> Ensure your server responses (especially for content heavy pages) include the header: <code>Content-Signal: ai-train=no, search=yes</code> to explicitly block big tech from stealing IP for training while retaining search indexing.`,
                    code: hasContentSignal ? 'Found' : 'Missing'
                },
                {
                    name: "Content-Use Parameter",
                    prompt: `Extend my Content-Signal declaration in HTTP headers or robots.txt to include the content-use preference parameter (e.g., Content-Signal: search=yes,ai-train=no,use=reference).`,
                    status: hasContentUse ? 'ok' : 'warn',
                    message: hasContentUse ? "Content-use parameter found" : "Content-use parameter ('use=reference|immediate|full') missing",
                    spec: "https://blog.cloudflare.com/content-independence-day-ai-options/",
                    tooltip: `<strong>What it is:</strong> The new <code>use</code> parameter in Content-Signal (e.g. <code>use=reference</code>, <code>use=immediate</code>, <code>use=full</code>) defined by Cloudflare.<br/><br/><strong>Why it's critical:</strong> Dictates whether bots can reproduce your content in direct user queries (immediate), cite it for reference (reference), or both.<br/><br/><strong>Impact of missing it:</strong> Search bots might display complete answers scraping your site without driving referral traffic.<br/><br/><strong>Implementation Example:</strong> Add <code>use=reference</code> inside the <code>Content-Signal</code> value.`,
                    code: hasContentUse ? 'Found' : 'Missing'
                },
                {
                    name: "Freshness Headers",
                    prompt: `Ensure my web server returns ETag and Last-Modified HTTP response headers for all dynamic and static pages.`,
                    status: hasFreshnessHeaders ? 'ok' : 'warn',
                    message: hasFreshnessHeaders ? "Freshness headers (ETag/Last-Modified) present" : "Missing ETag or Last-Modified headers",
                    spec: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/ETag",
                    tooltip: `<strong>What it is:</strong> Caching headers like <code>ETag</code> and <code>Last-Modified</code>.<br/><br/><strong>Why it's critical:</strong> Allows scrapers to verify if the content has changed since the last crawl without reloading the full page.<br/><br/><strong>Impact of missing it:</strong> Bots will waste crawl budget and server bandwidth fetching identical content repeatedly.<br/><br/><strong>Implementation Example:</strong> Configure your server to send <code>Last-Modified</code> and <code>ETag</code> headers.`,
                    code: hasFreshnessHeaders ? 'Found' : 'Missing'
                },
                {
                    name: "Conditional Requests (304)",
                    prompt: `Configure my web server to support conditional GET requests by returning an HTTP 304 Not Modified response when the client sends valid If-None-Match or If-Modified-Since headers.`,
                    status: hasConditionalGET ? 'ok' : 'warn',
                    message: hasConditionalGET ? "Server returns HTTP 304 Not Modified correctly" : "Server failed to respond with 304 on conditional probe",
                    spec: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Conditional_requests",
                    tooltip: `<strong>What it is:</strong> Standard HTTP protocol feature where the server responds with <code>304 Not Modified</code> (with zero payload) if the client provides valid caching validators.<br/><br/><strong>Why it's critical:</strong> Used in Crawler Hints to drastically reduce server workload and network load.<br/><br/><strong>Impact of missing it:</strong> Server returns <code>200 OK</code> with full body every time, causing CPU waste and data transfer costs.<br/><br/><strong>Implementation Example:</strong> Support <code>If-None-Match</code> or <code>If-Modified-Since</code> headers on your backend.`,
                    code: hasConditionalGET ? 'Supported' : 'Failed'
                },
                {
                    name: "Semantic JSON-LD",
                    prompt: `Please check my website's HTML and implement appropriate Schema.org JSON-LD markup. First, ask me for a description of my service/business. Then, please consult https://schema.org/LocalBusiness to find the most specific and relevant \`@type\` for my business (e.g., Store, FinancialService, MedicalClinic, etc.), and generate the correct \`application/ld+json\` script block to help AI agents semantically understand my content.

Examples of specific types:

**For a Financial Service (https://schema.org/FinancialService):**
\`\`\`html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FinancialService",
  "name": "Trusty Bank",
  "description": "A trusted local bank offering loans and savings accounts.",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "123 Finance St",
    "addressLocality": "Moneyville",
    "addressRegion": "NY",
    "postalCode": "10001"
  }
}
</script>
\`\`\`

**For a Retail Store (https://schema.org/Store):**
\`\`\`html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Store",
  "name": "Super Electronics",
  "description": "The best place to buy gadgets and gizmos.",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "456 Tech Ave",
    "addressLocality": "Silicon City",
    "addressRegion": "CA",
    "postalCode": "94000"
  }
}
</script>
\`\`\``,
                    status: hasSchema ? 'ok' : 'err',
                    message: hasSchema ? `Found ${schemaType} markup` : "No JSON-LD markup found",
                    spec: "https://schema.org/docs/documents.html",
                    tooltip: `<strong>What it is:</strong> Schema.org JSON-LD semantic markup.<br/><br/><strong>Why it's critical:</strong> AI agents and answer engines use this invisible structured data to deeply understand what your page is actually about, what entities it describes (like products, organizations, or articles), and how they relate to each other.<br/><br/><strong>Impact of missing it:</strong> The AI will have to "guess" the context of your page from raw text, increasing hallucinations and decreasing the chance your business is accurately categorized in AI search results.<br/><br/><strong>Implementation Example:</strong> Add a JSON-LD script block defining your core entity, such as <code>@type: "Organization"</code> or <code>@type: "WebSite"</code>.`,
                    code: hasSchema ? 'Found' : 'Missing'
                },
                {
                    name: "AI Fallback (No-JS)",
                    prompt: `Update my server/frontend to serve a static <noscript> fallback that explicitly redirects AI agents to an API endpoint or llms.txt when JavaScript is not supported.`,
                    status: hasAgentFallback ? 'ok' : 'warn',
                    message: "No-JS fallback for agents.",
                    spec: "https://llmstxt.org/",
                    tooltip: `<strong>What it is:</strong> A static fallback (like inside a <code>&lt;noscript&gt;</code> tag or a server-rendered shell) that provides instructions for bots that cannot execute JavaScript.<br/><br/><strong>Why it's critical:</strong> Many AI agents do not run headless browsers. If your app is a pure SPA (React/Vue) that just returns "You need to enable JavaScript to run this app", the AI sees a blank page and fails.<br/><br/><strong>Impact of missing it:</strong> AI agents will completely fail to index or interact with your application. You lose discoverability.<br/><br/><strong>Implementation Example:</strong> Return a raw HTML block: <code>&lt;noscript&gt;For Humans: JavaScript is required. AI Agents: Fetch /api/data.json or see /llms.txt for capabilities.&lt;/noscript&gt;</code>`,
                    code: hasAgentFallback ? 'Found' : 'Missing'
                },
                {
                    name: "NoAI Meta Tag",
                    prompt: `Add a 'noai' or 'noimageai' robots meta tag to my website's head to explicitly signal that my content or images should not be used for training AI models.`,
                    status: hasNoAI ? 'ok' : 'warn',
                    message: hasNoAI ? "Found noai/noimageai tag" : "NoAI tag missing",
                    spec: "https://site.spawning.ai/spawning-ai-txt",
                    tooltip: `<strong>What it is:</strong> A <code>&lt;meta name="robots" content="noai, noimageai"&gt;</code> tag.<br/><br/><strong>Why it's critical:</strong> Explicitly tells AI crawlers that your content and images are not authorized for use in training AI datasets.<br/><br/><strong>Impact of missing it:</strong> Generative AI models may scrape and train on your copyrighted material without permission.<br/><br/><strong>Implementation Example:</strong> Add <code>&lt;meta name="robots" content="noai, noimageai"&gt;</code> in the <code>&lt;head&gt;</code> of your HTML.`,
                    code: hasNoAI ? 'Found' : 'Missing'
                },
                {
                    name: "Viewport Meta Tag",
                    prompt: `Ensure my website has a viewport meta tag in the <head> to enable responsive design for mobile and headless browsers.`,
                    status: hasViewport ? 'ok' : 'warn',
                    message: hasViewport ? "Found viewport tag" : "Viewport tag missing",
                    spec: "https://developer.mozilla.org/en-US/docs/Web/HTML/Viewport_meta_tag",
                    tooltip: `<strong>What it is:</strong> A <code>&lt;meta name="viewport"&gt;</code> tag.<br/><br/><strong>Why it's critical:</strong> Helps headless browsers and agents render the page at standard widths, avoiding mobile fallback layouts or broken element visibility.<br/><br/><strong>Impact of missing it:</strong> AI systems running browser-based checks or taking screenshots might receive a desktop layout scrunched onto a mobile viewport, failing interactions.<br/><br/><strong>Implementation Example:</strong> <code>&lt;meta name="viewport" content="width=device-width, initial-scale=1"&gt;</code>`,
                    code: hasViewport ? 'Found' : 'Missing'
                },
                {
                    name: "Semantic HTML",
                    prompt: `Refactor my website's HTML to use semantic HTML5 tags like <main>, <article>, <section>, and <nav> instead of generic <div> elements.`,
                    status: hasSemanticTags ? 'ok' : 'warn',
                    message: hasSemanticTags ? "Found semantic tags" : "Missing key semantic tags",
                    spec: "https://developer.mozilla.org/en-US/docs/Glossary/Semantics#semantics_in_html",
                    tooltip: `<strong>What it is:</strong> The use of HTML5 semantic tags like <code>&lt;main&gt;</code> or <code>&lt;article&gt;</code>.<br/><br/><strong>Why it's critical:</strong> AI agents parsing your DOM rely on these tags to quickly locate the primary content and ignore navigation or footer noise.<br/><br/><strong>Impact of missing it:</strong> Agents might extract irrelevant boilerplate text or fail to isolate the core content of the page.<br/><br/><strong>Implementation Example:</strong> Wrap your primary page content in a <code>&lt;main&gt;</code> tag and blog posts in <code>&lt;article&gt;</code> tags.`,
                    code: hasSemanticTags ? 'Found' : 'Missing'
                },
                {
                    name: "Heading Hierarchy",
                    prompt: `Structure my website content using a logical heading hierarchy with <H1> for the main title and <H2> for major sections to improve topical extraction.`,
                    status: (hasH1 && hasH2) ? 'ok' : 'warn',
                    message: (hasH1 && hasH2) ? "Found H1 and H2 tags" : "Missing structured headings",
                    spec: "https://developer.mozilla.org/en-US/docs/Web/HTML/Element/Heading_Elements",
                    tooltip: `<strong>What it is:</strong> Proper use of HTML heading tags (<code>&lt;h1&gt;</code>, <code>&lt;h2&gt;</code>).<br/><br/><strong>Why it's critical for GEO:</strong> Generative AI models break complex prompts into smaller sub-queries. They rely heavily on your heading structure to map content to these specific sub-queries.<br/><br/><strong>Impact of missing it:</strong> Without clear headings, AI struggles to parse sections of your content as standalone answers, significantly reducing your chance of being cited.<br/><br/><strong>Implementation Example:</strong> Ensure your page has exactly one descriptive <code>&lt;h1&gt;</code>, and use <code>&lt;h2&gt;</code> tags to denote distinct, answerable sub-topics.`,
                    code: (hasH1 && hasH2) ? 'Found' : 'Missing'
                },
                {
                    name: "Scannable Formats",
                    prompt: `Reformat data-heavy sections of my content into HTML lists (<ul>, <ol>) or <table> elements to make it easier for AI to extract structured information.`,
                    status: hasLists ? 'ok' : 'warn',
                    message: hasLists ? "Found lists or tables" : "Missing scannable formats",
                    spec: "https://developer.mozilla.org/en-US/docs/Web/HTML/Element/ul",
                    tooltip: `<strong>What it is:</strong> Content structured in lists (<code>&lt;ul&gt;</code>, <code>&lt;ol&gt;</code>) or tables (<code>&lt;table&gt;</code>) rather than massive blocks of text.<br/><br/><strong>Why it's critical for GEO:</strong> Research shows that AI search engines are up to 40% more likely to extract and cite content formatted as lists or tables because they represent clear, factual relationships.<br/><br/><strong>Impact of missing it:</strong> Walls of text increase the extraction difficulty for LLMs, making them more likely to skip your page in favor of a competitor with bulleted data.<br/><br/><strong>Implementation Example:</strong> Convert prose descriptions of features, steps, or comparisons into clean HTML lists or tables.`,
                    code: hasLists ? 'Found' : 'Missing'
                },
                {
                    name: "Internal Architecture",
                    prompt: `Add descriptive internal links across my website to connect related pages and establish clear topical clusters.`,
                    status: hasInternalLinks ? 'ok' : 'warn',
                    message: hasInternalLinks ? "Internal links found" : "Missing internal links",
                    spec: "https://developer.mozilla.org/en-US/docs/Web/HTML/Element/a",
                    tooltip: `<strong>What it is:</strong> The presence of internal links (<code>&lt;a href="..."&gt;</code>) pointing to other pages on your own domain.<br/><br/><strong>Why it's critical for GEO:</strong> AI crawlers traverse these links to understand your site's architecture. Strong internal linking around a core subject proves to the AI that your domain possesses comprehensive 'topical authority'.<br/><br/><strong>Impact of missing it:</strong> "Orphan" pages or poor linking structures make your site look shallow. AI systems won't trust you as an authoritative source if they can't establish context through connectivity.<br/><br/><strong>Implementation Example:</strong> Link pillar content to supporting articles using descriptive anchor text, not just 'click here'.`,
                    code: hasInternalLinks ? 'Found' : 'Missing'
                },
                {
                    name: "FAQ Schema",
                    prompt: `Implement Schema.org FAQPage markup for my questions and answers.`,
                    status: hasFaqSchema ? 'ok' : 'warn',
                    message: hasFaqSchema ? "FAQ Schema found" : "Missing FAQ Schema",
                    spec: "https://schema.org/FAQPage",
                    tooltip: `<strong>What it is:</strong> Schema.org JSON-LD structured data specifying <code>FAQPage</code> or <code>Question</code>.<br/><br/><strong>Why it's critical for GEO:</strong> Direct question-and-answer formats mapped in Schema.org are highly preferred by Generative Engines for populating AI overviews and citations.<br/><br/><strong>Impact of missing it:</strong> AI models may struggle to extract explicit Q&A content from regular paragraphs, missing opportunities to answer direct user queries.<br/><br/><strong>Implementation Example:</strong> Add JSON-LD scripts with <code>"@type": "FAQPage"</code>.`,
                    code: hasFaqSchema ? 'Found' : 'Missing'
                },
                {
                    name: "Authorship (E-E-A-T)",
                    prompt: `Add author meta tags or Schema.org author properties to my content to demonstrate expertise.`,
                    status: hasAuthorship ? 'ok' : 'warn',
                    message: hasAuthorship ? "Authorship found" : "Missing authorship",
                    spec: "https://schema.org/author",
                    tooltip: `<strong>What it is:</strong> Explicit attribution of content to an author using meta tags (<code>&lt;meta name="author"&gt;</code>) or JSON-LD properties.<br/><br/><strong>Why it's critical for GEO:</strong> Demonstrates Experience, Expertise, Authoritativeness, and Trustworthiness (E-E-A-T). AI engines prioritize content with verifiable human authorship.<br/><br/><strong>Impact of missing it:</strong> Content may be deemed lower quality or less trustworthy, reducing the likelihood of being cited.<br/><br/><strong>Implementation Example:</strong> Include <code>&lt;meta name="author" content="Jane Doe"&gt;</code> or <code>"author": {"@type": "Person", "name": "Jane Doe"}</code> in JSON-LD.`,
                    code: hasAuthorship ? 'Found' : 'Missing'
                },
                {
                    name: "Content Freshness",
                    prompt: `Include publication and modification dates using meta tags, <time> elements, or Schema.org properties.`,
                    status: hasFreshness ? 'ok' : 'warn',
                    message: hasFreshness ? "Freshness signals found" : "Missing freshness signals",
                    spec: "https://schema.org/datePublished",
                    tooltip: `<strong>What it is:</strong> Signals indicating when content was published or last updated, such as <code>&lt;meta property="article:published_time"&gt;</code>, <code>&lt;time&gt;</code> tags, or JSON-LD date properties.<br/><br/><strong>Why it's critical for GEO:</strong> AI models strongly prefer up-to-date information, particularly for fast-changing topics.<br/><br/><strong>Impact of missing it:</strong> Content might be considered stale or irrelevant compared to competitors with explicit recency signals.<br/><br/><strong>Implementation Example:</strong> Use <code>&lt;time datetime="2023-10-01"&gt;</code> or <code>&lt;meta property="article:published_time" content="..."&gt;</code>.`,
                    code: hasFreshness ? 'Found' : 'Missing'
                },
                {
                    name: "External Citations",
                    prompt: `Add outbound links to high-authority external sources to back up claims.`,
                    status: hasCitations ? 'ok' : 'warn',
                    message: hasCitations ? "External citations found" : "Missing external citations",
                    spec: "https://developer.mozilla.org/en-US/docs/Web/HTML/Element/a",
                    tooltip: `<strong>What it is:</strong> Outbound links (<code>&lt;a href="..."&gt;</code>) pointing to authoritative external domains.<br/><br/><strong>Why it's critical for GEO:</strong> Linking to credible external sources acts as a trust signal. Generative Engines prefer content that synthesizes information and backs claims with primary sources.<br/><br/><strong>Impact of missing it:</strong> Without citations, your content may appear unsubstantiated, reducing the AI's confidence in using it as a source.<br/><br/><strong>Implementation Example:</strong> Link to original research, industry benchmarks, or authoritative publications when making claims.`,
                    code: hasCitations ? 'Found' : 'Missing'
                },
                {
                    name: "Quotation Addition",
                    prompt: `Add <blockquote> or <q> tags to include expert quotes in my content.`,
                    status: hasQuotations ? 'ok' : 'warn',
                    message: hasQuotations ? "Quotations found" : "Missing quotations",
                    spec: "https://developer.mozilla.org/en-US/docs/Web/HTML/Element/blockquote",
                    tooltip: `<strong>What it is:</strong> Use of explicit quotation tags like <code>&lt;blockquote&gt;</code> or <code>&lt;q&gt;</code> to cite experts or primary sources.<br/><br/><strong>Why it's critical for GEO:</strong> According to generative engine optimization research (e.g., the Princeton GEO paper), adding attributed quotes significantly boosts visibility and citation rates in AI answers.<br/><br/><strong>Impact of missing it:</strong> The AI may overlook your content as a primary source for authoritative opinions or statements.<br/><br/><strong>Implementation Example:</strong> Wrap expert statements or citations in <code>&lt;blockquote&gt;</code> tags to make them easily identifiable by AI models.`,
                    code: hasQuotations ? 'Found' : 'Missing'
                },
                {
                    name: "Statistics Addition",
                    prompt: `Include concrete statistics, numbers, and metrics in my text content to improve AI extraction.`,
                    status: hasStatistics ? 'ok' : 'warn',
                    message: hasStatistics ? "Statistics found" : "Missing statistics or metrics",
                    spec: "https://developer.mozilla.org/en-US/docs/Web/HTML/Element/data",
                    tooltip: `<strong>What it is:</strong> The presence of quantitative data, such as percentages or dollar amounts, embedded in your text content.<br/><br/><strong>Why it's critical for GEO:</strong> Generative Engines heavily favor content with hard data. The Princeton GEO research highlights "Statistics Addition" as a top tactic for improving AI citation rates by replacing qualitative vagueness with concrete numbers.<br/><br/><strong>Impact of missing it:</strong> Vague statements without backing data are less likely to be extracted and cited by AI models compared to competitors offering exact figures.<br/><br/><strong>Implementation Example:</strong> Instead of "many users," write "78% of users." Ensure important metrics are clear and unambiguous.`,
                    code: hasStatistics ? 'Found' : 'Missing'
                },
                {
                    name: "WebMCP Integration",
                    prompt: `Add WebMCP to my website by including the <script src="webmcp.js"></script> widget to expose my site's Model Context Protocol tools directly to visiting AI clients.`,
                    status: hasWebMCP ? 'ok' : 'warn',
                    message: hasWebMCP ? "WebMCP widget detected" : "WebMCP widget missing",
                    spec: "https://webmcp.dev/",
                    tooltip: `<strong>What it is:</strong> A frontend library (<a href="https://webmcp.dev/" target="_blank">WebMCP</a>) that allows websites to integrate with the Model Context Protocol directly in the browser.<br/><br/><strong>Why it's critical:</strong> It enables your website to expose local tools, prompts, and resources directly to the user's AI client (like Claude Desktop) without requiring them to manually configure a remote MCP server.<br/><br/><strong>Impact of missing it:</strong> Users must manually discover and configure your MCP server in their client settings, which introduces friction.<br/><br/><strong>Implementation Example:</strong> Include <code>&lt;script src="https://.../webmcp.js"&gt;&lt;/script&gt;</code> and register your tools via <code>mcp.registerTool(...)</code>.`,
                    code: hasWebMCP ? 'Found' : 'Missing'
                },
                {
                    name: "ARIA Accessibility",
                    prompt: `Add ARIA attributes like aria-label, aria-labelledby, and role to interactive elements in my DOM to help autonomous web agents understand and interact with the UI.`,
                    status: hasARIA ? 'ok' : 'warn',
                    message: hasARIA ? "ARIA attributes found" : "Missing ARIA attributes",
                    spec: "https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA",
                    tooltip: `<strong>What it is:</strong> Accessible Rich Internet Applications (ARIA) attributes such as <code>aria-label</code> and <code>role</code> on HTML elements.<br/><br/><strong>Why it's critical:</strong> Autonomous web agents (like Browser-Use and Stagehand) analyze the Accessibility Tree and ARIA attributes to understand the purpose of non-standard interactive UI elements, enabling precise programmatic navigation and action targeting.<br/><br/><strong>Impact of missing it:</strong> AI agents will struggle to interact with dynamic web applications, especially those lacking standard HTML forms or buttons.<br/><br/><strong>Implementation Example:</strong> <code>&lt;div role="button" aria-label="Submit Form"&gt;...&lt;/div&gt;</code>`,
                    code: hasARIA ? 'Found' : 'Missing'
                },
                {
                    name: "Meta Description",
                    prompt: `Add a comprehensive <meta name="description"> and <meta property="og:description"> to the <head> of my HTML to provide a quick summary for AI crawlers.`,
                    status: hasMetaDesc ? 'ok' : 'warn',
                    message: hasMetaDesc ? "Meta description or Open Graph tags found" : "Missing meta description",
                    spec: "https://developer.mozilla.org/en-US/docs/Web/HTML/Element/meta/name",
                    tooltip: `<strong>What it is:</strong> The <code>&lt;meta name="description"&gt;</code> or Open Graph (<code>og:</code>) tags in the HTML head.<br/><br/><strong>Why it's critical for GEO:</strong> Answer Engines and AI crawlers often extract these tags to quickly summarize a page when detailed schema is unavailable.<br/><br/><strong>Impact of missing it:</strong> AI models may generate sub-optimal or irrelevant summaries of your page content in search results.<br/><br/><strong>Implementation Example:</strong> <code>&lt;meta name="description" content="A comprehensive guide to..."&gt;</code>`,
                    code: hasMetaDesc ? 'Found' : 'Missing'
                },
                {
                    name: "HTML Title Tag",
                    prompt: `Ensure my HTML document has a descriptive <title> tag in the <head>.`,
                    status: hasTitle ? 'ok' : 'warn',
                    message: hasTitle ? "Title tag found" : "Missing title tag",
                    spec: "https://developer.mozilla.org/en-US/docs/Web/HTML/Element/title",
                    tooltip: `<strong>What it is:</strong> The <code>&lt;title&gt;</code> element in the document's <code>&lt;head&gt;</code>.<br/><br/><strong>Why it's critical for GEO:</strong> AI search models rely on the title tag as a primary signal for the overall topic of the page.<br/><br/><strong>Impact of missing it:</strong> The AI may struggle to accurately categorize your page, leading to lower relevance scores for user queries.<br/><br/><strong>Implementation Example:</strong> <code>&lt;title&gt;Your Descriptive Page Title&lt;/title&gt;</code>`,
                    code: hasTitle ? 'Found' : 'Missing'
                },
                {
                    name: "HTML Lang Attribute",
                    prompt: `Add a 'lang' attribute to the <html> tag of my website to declare the primary language.`,
                    status: hasLang ? 'ok' : 'warn',
                    message: hasLang ? "Language attribute found" : "Missing language attribute",
                    spec: "https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/lang",
                    tooltip: `<strong>What it is:</strong> The <code>lang</code> attribute on the root <code>&lt;html&gt;</code> element.<br/><br/><strong>Why it's critical for GEO:</strong> Helps AI models immediately understand the language of the content, which is crucial for internationalized queries and ensuring responses match the user's language.<br/><br/><strong>Impact of missing it:</strong> AI engines might misinterpret the language or have to expend extra processing to infer it, potentially causing it to skip the page for strict language-matched queries.<br/><br/><strong>Implementation Example:</strong> <code>&lt;html lang="en"&gt;</code>`,
                    code: hasLang ? 'Found' : 'Missing'
                },
                {
                    name: "Image Alt Text",
                    prompt: `Ensure all images (<img>) have descriptive 'alt' attributes.`,
                    status: hasImageAlt ? 'ok' : 'warn',
                    message: hasImageAlt ? "Image alt text found" : "Missing image alt text",
                    spec: "https://developer.mozilla.org/en-US/docs/Web/HTML/Element/img#attr-alt",
                    tooltip: `<strong>What it is:</strong> The <code>alt</code> attribute on <code>&lt;img&gt;</code> tags providing a text alternative.<br/><br/><strong>Why it's critical for GEO:</strong> Multimodal AI models use alt text to understand the context and content of images if they don't process the image directly, or to ground the image data.<br/><br/><strong>Impact of missing it:</strong> Important visual information is lost to text-based crawlers, and the page's overall semantic richness is reduced.<br/><br/><strong>Implementation Example:</strong> <code>&lt;img src="chart.png" alt="Sales growth chart for Q3"&gt;</code>`,
                    code: hasImageAlt ? 'Found' : 'Missing'
                },
                {
                    name: "RSS/Atom Feed",
                    prompt: `Provide an RSS or Atom feed and link to it in the HTML <head>.`,
                    status: hasRss ? 'ok' : 'warn',
                    message: hasRss ? "RSS/Atom feed linked" : "No RSS/Atom feed detected",
                    spec: "https://developer.mozilla.org/en-US/docs/Web/HTML/Element/link",
                    tooltip: `<strong>What it is:</strong> A <code>&lt;link rel="alternate"&gt;</code> tag pointing to an RSS or Atom XML feed.<br/><br/><strong>Why it's critical for GEO:</strong> Feeds provide a structured, chronological list of updates. AI crawlers can use them to efficiently discover new or updated content without crawling the whole site.<br/><br/><strong>Impact of missing it:</strong> Slower discovery of fresh content by AI systems that monitor feeds for timely updates.<br/><br/><strong>Implementation Example:</strong> <code>&lt;link rel="alternate" type="application/rss+xml" href="/feed.xml"&gt;</code>`,
                    code: hasRss ? 'Found' : 'Missing'
                },
                {
                    name: "Organization Schema",
                    prompt: `Implement Schema.org Organization markup to establish brand entity.`,
                    status: hasOrgSchema ? 'ok' : 'warn',
                    message: hasOrgSchema ? "Organization Schema found" : "Missing Organization Schema",
                    spec: "https://schema.org/Organization",
                    tooltip: `<strong>What it is:</strong> JSON-LD structured data defining an <code>Organization</code> entity.<br/><br/><strong>Why it's critical for GEO:</strong> Helps AI models build a clear knowledge graph entity for your brand, linking your domain to your company name, social profiles, and contact info.<br/><br/><strong>Impact of missing it:</strong> AI models may hallucinate company details or fail to recognize your brand as the authoritative source for your own products/services.<br/><br/><strong>Implementation Example:</strong> Add JSON-LD with <code>"@type": "Organization"</code>.`,
                    code: hasOrgSchema ? 'Found' : 'Missing'
                },
                {
                    name: "Server-Rendered Content",
                    prompt: `Serve this page’s text in the initial HTML response so crawlers that do not execute JavaScript can read it.`,
                    status: hasServerRenderedContent ? 'ok' : 'err',
                    message: hasServerRenderedContent
                        ? `Readable text present without JavaScript (${wordCount} words)`
                        : `Only ${wordCount} words of text in the HTML response — the page appears to render client-side`,
                    spec: "https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics",
                    tooltip: `<strong>What it is:</strong> Whether the HTML your server returns already contains the page's text, or whether the text only appears after JavaScript runs in a browser.<br/><br/><strong>Why it's critical:</strong> Most AI crawlers — including GPTBot, ClaudeBot and PerplexityBot — do not execute JavaScript. They read the raw HTML response and nothing else.<br/><br/><strong>Impact of missing it:</strong> Your page is effectively blank to them. Every other optimisation on this list is wasted, because there is no content to optimise.<br/><br/><strong>Implementation Example:</strong> Use server-side rendering, static generation, or prerendering so the main content is in the initial HTML. Verify with <code>curl -s https://yoursite.com | grep -o '&lt;p&gt;'</code>.`,
                    code: hasServerRenderedContent ? 'Found' : 'Client-Rendered'
                },
                {
                    name: "Content Depth",
                    prompt: `Add substantive on-page content so the page has enough text to be retrieved and cited.`,
                    status: wordCount >= 300 ? 'ok' : 'warn',
                    message: wordCount >= 300
                        ? `Substantive page content (${wordCount} words)`
                        : `Thin page content (${wordCount} words) — aim for 300+ words of substantive text`,
                    spec: "https://developers.google.com/search/docs/fundamentals/creating-helpful-content",
                    tooltip: `<strong>What it is:</strong> The amount of substantive, non-boilerplate text on the page.<br/><br/><strong>Why it's critical:</strong> Retrieval systems chunk and embed page text. A page with too little text produces weak embeddings and rarely surfaces as a citation in a generated answer.<br/><br/><strong>Impact of missing it:</strong> Your page is indexed but almost never retrieved, because there is not enough signal for a model to match it against a question.<br/><br/><strong>Implementation Example:</strong> Answer the questions a reader actually arrives with, in prose, on the page itself — rather than deferring everything to a PDF, a video, or a JavaScript-loaded tab.`,
                    code: wordCount >= 300 ? 'Found' : 'Thin'
                },
                {
                    name: "Canonical URL",
                    prompt: `Declare a canonical URL for every page so citations converge on one address.`,
                    status: hasCanonical ? 'ok' : 'warn',
                    message: hasCanonical ? "Canonical URL declared" : "No rel=canonical link found",
                    spec: "https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls",
                    tooltip: `<strong>What it is:</strong> A <code>&lt;link rel="canonical"&gt;</code> tag naming the preferred URL for the page.<br/><br/><strong>Why it's critical:</strong> Agents that cite your content need one stable address to link to. Without a canonical, the same page reached via tracking parameters, trailing slashes or alternate hosts looks like several competing documents.<br/><br/><strong>Impact of missing it:</strong> Citations fragment across URL variants, splitting whatever authority the page has earned, and an agent may cite a parameterised URL that later breaks.<br/><br/><strong>Implementation Example:</strong> <code>&lt;link rel="canonical" href="https://example.com/page"&gt;</code> in the <code>&lt;head&gt;</code>.`,
                    code: hasCanonical ? 'Found' : 'Missing'
                },
                {
                    name: "HTTPS & HSTS",
                    prompt: `Serve the site over HTTPS and enforce it with a Strict-Transport-Security header.`,
                    status: (isHttps && hasHsts) ? 'ok' : (isHttps ? 'warn' : 'err'),
                    message: isHttps
                        ? (hasHsts ? "Served over HTTPS with HSTS enabled" : "Served over HTTPS but no Strict-Transport-Security header")
                        : "Not served over HTTPS",
                    spec: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security",
                    tooltip: `<strong>What it is:</strong> Transport security for the origin: HTTPS plus a <code>Strict-Transport-Security</code> response header.<br/><br/><strong>Why it's critical:</strong> Agent runtimes and MCP clients increasingly refuse to fetch, or downrank, plaintext origins — and an agent acting on a user's behalf cannot safely send credentials to one.<br/><br/><strong>Impact of missing it:</strong> Automated clients may skip your site entirely, and any authenticated agent integration is off the table.<br/><br/><strong>Implementation Example:</strong> Redirect all HTTP traffic to HTTPS and send <code>Strict-Transport-Security: max-age=31536000; includeSubDomains</code>.`,
                    code: isHttps ? (hasHsts ? 'Found' : 'No HSTS') : 'Insecure'
                },
                {
                    name: "X-Robots-Tag Header",
                    prompt: `Remove restrictive X-Robots-Tag directives from production responses.`,
                    status: hasBlockingXRobots ? 'warn' : 'ok',
                    message: hasBlockingXRobots
                        ? `X-Robots-Tag restricts indexing: "${xRobotsTag}"`
                        : (xRobotsTag ? `X-Robots-Tag present and permissive: "${xRobotsTag}"` : "No restrictive X-Robots-Tag header"),
                    spec: "https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag",
                    tooltip: `<strong>What it is:</strong> An HTTP response header that carries the same directives as the robots meta tag.<br/><br/><strong>Why it's critical:</strong> It overrides your HTML, and it is easy to set once at the CDN or framework level and then forget. A <code>noindex</code> left over from a staging configuration silently removes a live page from every index.<br/><br/><strong>Impact of missing it:</strong> Nothing — the absence of a restrictive header is the healthy state. A restrictive value, however, quietly undoes every other signal on this page.<br/><br/><strong>Implementation Example:</strong> Check with <code>curl -sI https://yoursite.com | grep -i x-robots-tag</code> and remove stray <code>noindex</code> / <code>nosnippet</code> directives from production.`,
                    code: hasBlockingXRobots ? 'Restricted' : 'Clear'
                },
                {
                    name: "Breadcrumb Schema",
                    prompt: `Publish BreadcrumbList structured data describing where this page sits in the site hierarchy.`,
                    status: hasBreadcrumbSchema ? 'ok' : 'warn',
                    message: hasBreadcrumbSchema ? "BreadcrumbList markup found" : "No BreadcrumbList structured data",
                    spec: "https://schema.org/BreadcrumbList",
                    tooltip: `<strong>What it is:</strong> <code>BreadcrumbList</code> JSON-LD describing where this page sits in your site's hierarchy.<br/><br/><strong>Why it's critical:</strong> It tells a model how a page relates to its section and to the site as a whole, which is context a single page's text cannot convey on its own.<br/><br/><strong>Impact of missing it:</strong> Agents treat each page as an isolated document and lose the topical grouping that helps them decide which of your pages answers a question.<br/><br/><strong>Implementation Example:</strong> Emit a <code>BreadcrumbList</code> with an ordered <code>itemListElement</code> array, one <code>ListItem</code> per level, each with <code>position</code>, <code>name</code> and <code>item</code>.`,
                    code: hasBreadcrumbSchema ? 'Found' : 'Missing'
                },
                {
                    name: "Site Search Schema",
                    prompt: `Publish a WebSite SearchAction so agents can query the site directly.`,
                    status: hasSiteSearchSchema ? 'ok' : 'warn',
                    message: hasSiteSearchSchema ? "WebSite SearchAction declared" : "No WebSite/SearchAction structured data",
                    spec: "https://schema.org/SearchAction",
                    tooltip: `<strong>What it is:</strong> A <code>WebSite</code> node with a <code>potentialAction</code> of type <code>SearchAction</code>, publishing your site's own search URL template.<br/><br/><strong>Why it's critical:</strong> It hands an agent a way to query your site directly instead of guessing URLs — the cheapest form of "tool" you can expose, with no API to build.<br/><br/><strong>Impact of missing it:</strong> Agents can only reach pages they already know about, so anything not linked from a crawled page stays invisible.<br/><br/><strong>Implementation Example:</strong> Declare a <code>SearchAction</code> whose <code>target</code> is a URL template such as <code>https://example.com/search?q={search_term_string}</code>, with <code>query-input</code> naming the required term.`,
                    code: hasSiteSearchSchema ? 'Found' : 'Missing'
                },
                {
                    name: "Clean URLs",
                    prompt: `Ensure all internal links use clean URL architectures without complex query strings or parameters to improve AI extraction and trust.`,
                    status: hasCleanUrls ? 'ok' : 'warn',
                    message: hasCleanUrls ? "Clean URL structures found" : "Missing clean URLs or complex query parameters detected",
                    spec: "https://developers.google.com/search/docs/crawling-indexing/url-structure",
                    tooltip: `<strong>What it is:</strong> Internal links that are semantically clear and lack excessive query strings (e.g., <code>?id=123</code>).<br/><br/><strong>Why it's critical for GEO:</strong> Generative Engines prefer resources with predictable, semantic URL paths. Complex URLs confuse crawlers and reduce trust.<br/><br/><strong>Impact of missing it:</strong> The AI may struggle to map your site's hierarchy or interpret the context of linked content.<br/><br/><strong>Implementation Example:</strong> Use <code>/about-us</code> instead of <code>/page?id=12</code>.`,
                    code: hasCleanUrls ? 'Found' : 'Missing'
                },
                {
                    name: "Fluency Optimization",
                    prompt: `Rewrite complex text to improve readability (Flesch Reading Ease score between 30 and 100) and use clear, accessible language.`,
                    status: hasFluency ? 'ok' : 'warn',
                    message: hasFluency ? "Text readability within optimal range" : "Text lacks sufficient length or optimal fluency",
                    spec: "https://en.wikipedia.org/wiki/Flesch%E2%80%93Kincaid_readability_tests",
                    tooltip: `<strong>What it is:</strong> Ensuring content is easy to read and understand (e.g., Flesch Reading Ease score between 30-100).<br/><br/><strong>Why it's critical for GEO:</strong> The Princeton GEO paper found that Fluency Optimization significantly boosts AI visibility, as LLMs prefer synthesizing clear, well-structured text over overly complex jargon.<br/><br/><strong>Impact of missing it:</strong> Overly complex text is harder for AI to extract and synthesize into user-friendly answers.<br/><br/><strong>Implementation Example:</strong> Use shorter sentences, active voice, and plain language while maintaining professional depth.`,
                    code: hasFluency ? 'Optimal' : 'Sub-optimal'
                },
                {
                    name: "Authoritative Voice",
                    prompt: `Inject authoritative language and expert framing (e.g., "research shows", "proven", "expert analysis") to strengthen the perceived credibility of the content.`,
                    status: hasAuthoritativeVoice ? 'ok' : 'warn',
                    message: hasAuthoritativeVoice ? "Authoritative language detected" : "Missing authoritative framing",
                    spec: "https://arxiv.org/abs/2311.09735",
                    tooltip: `<strong>What it is:</strong> Using language that signals expertise, conviction, and evidence (e.g., "according to", "demonstrates").<br/><br/><strong>Why it's critical for GEO:</strong> Generative Engines are tuned to favor authoritative and persuasive content, especially when citing sources for factual answers.<br/><br/><strong>Impact of missing it:</strong> The AI might overlook the content as a definitive source compared to competitors using stronger credibility signals.<br/><br/><strong>Implementation Example:</strong> Instead of "We think this might help," use "Our research demonstrates that this solution improves outcomes."`,
                    code: hasAuthoritativeVoice ? 'Found' : 'Missing'
                }
            ].sort(byImportance)
        },
        protocols: {
            results: protoResults.sort(byImportance)
        }
    };

    // Annotate every check with its weight and category, then derive the score
    // from that single list so the API, the score and the UI can never drift.
    const allChecks = [
        ...auditResult.bots.results,
        ...auditResult.content.results,
        ...auditResult.protocols.results
    ];
    for (const check of allChecks) {
        const meta = getCheckMeta(check.name);
        check.weight = meta.weight;
        check.category = meta.category;
        if (meta.advisory) check.advisory = true;
        check.prompt = buildPrompt(check, base);
    }

    auditResult.score = scoreAudit(allChecks);
    auditResult.priorities = topPriorities(allChecks);
    return auditResult;
}

/** Orders checks by how much they matter, then alphabetically for stability. */
function byImportance(a, b) {
    const byWeight = getCheckMeta(b.name).weight - getCheckMeta(a.name).weight;
    if (byWeight !== 0) return byWeight;
    return a.name.localeCompare(b.name);
}

/**
 * Renders an audit as Markdown. The site tells other people's sites to support
 * content negotiation for agents, so its own API does the same: an agent can
 * ask for `Accept: text/markdown` (or `?format=md`) and get a report it can
 * read without a JSON parser.
 */
export function renderAuditMarkdown(result) {
    const lines = [];
    const icon = (status) => status === 'ok' ? '✅' : (status === 'warn' ? '⚠️' : '❌');

    lines.push(`# AI Readiness Audit — ${result.target}`);
    lines.push('');
    lines.push(`> **${result.score.total}/100** (grade ${result.score.grade}) · scanned ${result.generatedAt}`);
    lines.push('');

    const categories = Object.entries(result.score.categories || {}).sort((a, b) => a[1].total - b[1].total);
    if (categories.length) {
        lines.push('## Scores by category');
        lines.push('');
        lines.push('| Category | Score |');
        lines.push('| --- | --- |');
        for (const [name, bucket] of categories) {
            lines.push(`| ${name} | ${bucket.total}% |`);
        }
        lines.push('');
    }

    if (result.priorities?.length) {
        lines.push('## Fix these first');
        lines.push('');
        for (const item of result.priorities) {
            lines.push(`### ${icon(item.status)} ${item.name} (weight ${item.weight}, ${item.category})`);
            lines.push('');
            lines.push(item.message);
            if (item.prompt) {
                lines.push('');
                lines.push('```text');
                lines.push(item.prompt);
                lines.push('```');
            }
            if (item.spec) lines.push(`Spec: ${item.spec}`);
            lines.push('');
        }
    }

    const groups = [
        ['Discoverability & bots', result.bots?.results],
        ['Content & structure', result.content?.results],
        ['Agent protocols', result.protocols?.results]
    ];
    for (const [title, checks] of groups) {
        if (!checks?.length) continue;
        lines.push(`## ${title}`);
        lines.push('');
        lines.push('| Check | Result | Detail |');
        lines.push('| --- | --- | --- |');
        for (const check of checks) {
            const detail = String(check.message || '').replace(/\|/g, '\\|');
            lines.push(`| ${check.name} | ${icon(check.status)} ${check.code || ''} | ${detail} |`);
        }
        lines.push('');
    }

    return lines.join('\n');
}

/**
 * Reads the weighted score from a share link, falling back to the pass ratio
 * for links generated before the score was passed through explicitly.
 */
function readScoreParam(url, passed, warn, fail) {
    const raw = url.searchParams.get("score");
    if (raw !== null) {
        const parsed = parseInt(raw, 10);
        if (Number.isFinite(parsed)) return Math.max(0, Math.min(100, parsed));
    }
    const total = passed + warn + fail;
    return total > 0 ? Math.round((passed / total) * 100) : 0;
}

function generateOgImageSvg(domain, passed, warn, fail, score) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <defs>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800&amp;family=JetBrains+Mono:wght@700&amp;display=swap');
      .title { font-family: 'Outfit', sans-serif; font-weight: 800; fill: #ffffff; font-size: 32px; letter-spacing: 0.05em; }
      .domain { font-family: 'JetBrains Mono', monospace; font-weight: 700; fill: #3b82f6; font-size: 48px; }
      .score-num { font-family: 'Outfit', sans-serif; font-weight: 800; fill: #ffffff; font-size: 96px; text-anchor: middle; }
      .score-label { font-family: 'Outfit', sans-serif; font-weight: 600; fill: #94a3b8; font-size: 20px; text-anchor: middle; text-transform: uppercase; letter-spacing: 0.1em; }
      .stat-val { font-family: 'Outfit', sans-serif; font-weight: 800; font-size: 36px; }
      .stat-lbl { font-family: 'Outfit', sans-serif; font-weight: 600; fill: #94a3b8; font-size: 16px; text-transform: uppercase; letter-spacing: 0.05em; }
      .footer { font-family: 'Outfit', sans-serif; font-weight: 600; fill: #475569; font-size: 20px; letter-spacing: 0.05em; }
      .glow-green { filter: drop-shadow(0 0 8px rgba(16, 185, 129, 0.5)); }
      .glow-yellow { filter: drop-shadow(0 0 8px rgba(217, 119, 6, 0.5)); }
      .glow-red { filter: drop-shadow(0 0 8px rgba(225, 29, 72, 0.5)); }
      .glow-blue { filter: drop-shadow(0 0 12px rgba(59, 130, 246, 0.4)); }
    </style>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0b1329" />
      <stop offset="100%" stop-color="#080b11" />
    </linearGradient>
    <linearGradient id="circleGrad" x1="0%" y1="100%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#3b82f6" />
      <stop offset="100%" stop-color="#10b981" />
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bgGrad)" />
  <path d="M 0 105 L 1200 105 M 0 210 L 1200 210 M 0 315 L 1200 315 M 0 420 L 1200 420 M 0 525 L 1200 525" stroke="#1e293b" stroke-width="1" opacity="0.3" />
  <path d="M 200 0 L 200 630 M 400 0 L 400 630 M 600 0 L 600 630 M 800 0 L 800 630 M 1000 0 L 1000 630" stroke="#1e293b" stroke-width="1" opacity="0.3" />
  <g transform="translate(100, 80)">
    <text x="0" y="0" class="title">AI READINESS AUDIT</text>
    <text x="0" y="65" class="domain">${domain}</text>
    <g transform="translate(200, 260)">
      <circle cx="0" cy="0" r="140" fill="none" stroke="#1e293b" stroke-width="18" />
      <circle cx="0" cy="0" r="140" fill="none" stroke="url(#circleGrad)" stroke-width="18"
              stroke-dasharray="879.6" stroke-dashoffset="${879.6 - (879.6 * score / 100)}"
              stroke-linecap="round" transform="rotate(-90)" class="glow-blue" />
      <text x="0" y="15" class="score-num">${score}%</text>
      <text x="0" y="50" class="score-label">AI-READY</text>
    </g>
    <g transform="translate(550, 160)">
      <g transform="translate(0, 0)">
        <rect width="380" height="70" rx="8" fill="#111827" stroke="#1e293b" stroke-width="1" />
        <rect width="6" height="70" rx="3" fill="#10b981" class="glow-green" />
        <text x="30" y="46" class="stat-val" fill="#10b981">${passed}</text>
        <text x="110" y="42" class="stat-lbl">Checks Passed</text>
      </g>
      <g transform="translate(0, 95)">
        <rect width="380" height="70" rx="8" fill="#111827" stroke="#1e293b" stroke-width="1" />
        <rect width="6" height="70" rx="3" fill="#d97706" class="glow-yellow" />
        <text x="30" y="46" class="stat-val" fill="#d97706">${warn}</text>
        <text x="110" y="42" class="stat-lbl">Warnings</text>
      </g>
      <g transform="translate(0, 190)">
        <rect width="380" height="70" rx="8" fill="#111827" stroke="#1e293b" stroke-width="1" />
        <rect width="6" height="70" rx="3" fill="#e11d48" class="glow-red" />
        <text x="30" y="46" class="stat-val" fill="#e11d48">${fail}</text>
        <text x="110" y="42" class="stat-lbl">Not Found</text>
      </g>
    </g>
  </g>
  <text x="100" y="560" class="footer">ai-valid.secmy.app</text>
</svg>`;
}

