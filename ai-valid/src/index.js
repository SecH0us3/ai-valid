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

const FETCH_TIMEOUT = 5000;
const STATIC_ROUTES = {
    "/": (request) => {
        const accept = request.headers.get("Accept") || "";
        if (accept.includes("text/markdown")) {
            const mdContent = `# AI-Valid | AI Readiness Audit\n\nInstant analysis of your site's accessibility for intelligent agents, crawlers, and modern AI protocols.\n\n## API Usage\nSend a POST request to \`/api/audit\` with a JSON payload:\n\n\`\`\`bash\ncurl -X POST https://<your-worker-domain>/api/audit \\\n  -H "Content-Type: application/json" \\\n  -d '{"targetUrl":"https://example.com"}'\n\`\`\`\n`;
            return new Response(mdContent, {
                headers: { "Content-Type": "text/markdown; charset=utf-8" },
            });
        }
        return new Response(htmlTemplate, {
            headers: { "Content-Type": "text/html; charset=utf-8" },
        });
    },
    "/style.css": () => new Response(cssContent, {
        headers: { "Content-Type": "text/css; charset=utf-8" },
    }),
    "/app.client.js": () => new Response(jsContent, {
        headers: { "Content-Type": "application/javascript; charset=utf-8" },
    }),
    "/favicon.svg": () => new Response(faviconSvg, {
        headers: { "Content-Type": "image/svg+xml" },
    }),
    "/favicon.ico": () => new Response(faviconSvg, {
        headers: { "Content-Type": "image/svg+xml" },
    }),
    "/og-image.png": () => new Response(ogImage, {
        headers: { "Content-Type": "image/png" },
    }),
    "/llms-full.txt": () => new Response(llmsFullTxt, {
        headers: { "Content-Type": "text/markdown; charset=utf-8" },
    }),
    "/llms.txt": () => new Response(llmsTxt, {
        headers: { "Content-Type": "text/markdown; charset=utf-8" },
    }),
    "/openapi.json": () => new Response(openApiJson, {
        headers: { "Content-Type": "application/json; charset=utf-8" },
    }),
    "/.well-known/api-catalog": () => new Response(apiCatalogTxt, {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
    }),
    "/.well-known/tdmrep.json": () => new Response(tdmrepJson, {
        headers: { "Content-Type": "application/json; charset=utf-8" },
    }),
    "/policies/tdm-policy.json": () => new Response(tdmPolicyJson, {
        headers: { "Content-Type": "application/json; charset=utf-8" },
    }),
    "/.well-known/agent-skills/index.json": () => {
        const agentSkills = {
            "skills": [
                {
                    "name": "AuditPlatform",
                    "description": "Performs an AI readiness audit on a given URL. Validates protocols like llms.txt, API Catalogs, MCP, and AI bot accessibility.",
                    "endpoint": "/api/audit",
                    "method": "POST"
                }
            ]
        };
        return new Response(JSON.stringify(agentSkills, null, 2), {
            headers: { "Content-Type": "application/json; charset=utf-8" },
        });
    }
};

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
    return await fetch(url, { ...options, signal: AbortSignal.timeout(FETCH_TIMEOUT) });
}


function isPrivateIP(ip) {
    if (!ip) return false;
    ip = ip.replace(/^\[/, '').replace(/\]$/, '');
    const ipv4Patterns = [
        /^127\./, /^10\./, /^172\.(1[6-9]|2[0-9]|3[0-1])\./, /^192\.168\./,
        /^169\.254\./, /^0\./, /^22[4-9]\./, /^23[0-9]\./, /^24[0-9]\./, /^25[0-5]\./
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
            fullIp.startsWith('fe8') || fullIp.startsWith('fe9') || fullIp.startsWith('fea') || fullIp.startsWith('feb')) {
            return true;
        }

        if (fullIp.startsWith('0000:0000:0000:0000:0000:ffff:')) {
            // IPv4-mapped
            const hex = fullIp.substring(30).replace(':', '');
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
            // Use Cloudflare DoH to resolve the IP to prevent DNS rebinding or resolving to internal IPs
            const dohUrl = `https://cloudflare-dns.com/dns-query?name=${hostname}&type=A`;
            const res = await fetch(dohUrl, { headers: { 'accept': 'application/dns-json' } });
            if (res.ok) {
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
            }
        }
        return true;
    } catch {
        return false;
    }
}

export async function handleRequest(request, env, ctx) {
        const url = new URL(request.url);

        // --- Static File Routing ---
        if (request.method === "GET" && STATIC_ROUTES[url.pathname]) {
            return STATIC_ROUTES[url.pathname](request);
        }

        // --- API Route ---
        if (request.method === "POST" && url.pathname === "/api/audit") {
            try {
                let body = await request.json();
                let targetUrl = body.targetUrl;

                if (!targetUrl || !targetUrl.startsWith('http')) {
                    return new Response(JSON.stringify({ error: "Invalid URL" }), { status: 400 });
                }

                // SSRF Protection
                const safeUrl = await isSafeUrl(targetUrl);
                if (!safeUrl) {
                    return new Response(JSON.stringify({ error: "Access to internal or restricted network resources is not allowed" }), { status: 403 });
                }

                // Domain existence check
                try {
                    const parsedUrl = new URL(targetUrl);
                    await internalFetch(parsedUrl.origin, { method: 'HEAD' }, parsedUrl.origin, url.origin, env, ctx);
                } catch {
                    return new Response(JSON.stringify({ error: "Domain does not exist or is unreachable" }), { status: 400 });
                }

                const result = await performAudit(targetUrl, url.origin, env, ctx);
                return new Response(JSON.stringify(result), {
                    headers: { "Content-Type": "application/json" }
                });

            } catch(e) {
                console.error('Audit API Error:', e);
                return new Response(JSON.stringify({ error: "Internal Server Error" }), {
                    status: 500,
                    headers: { "Content-Type": "application/json" }
                });
            }
        }

        return new Response("Not Found", { status: 404 });
}

async function performAudit(baseUrl, requestOrigin, env, ctx) {
    const headersStandard = { 'User-Agent': 'Mozilla/5.0 (compatible; AI-Valid/1.0)' };
    const headersAgent = { 'User-Agent': 'OAI-SearchBot', 'Accept': 'text/markdown' };

    // Ensure baseUrl doesn't end with slash securely
    const base = new URL(baseUrl).origin;

    let totalScore = 0;

    const iFetch = async (url, options = {}) => await internalFetch(url, options, base, requestOrigin, env, ctx);

    // 1. Discoverability & Bots
    let robotsFound = false;
    let hasAI = false;
    let sitemapFound = false;
    let robotsText = "";

    try {
        const r_robots = await iFetch(`${base}/robots.txt`, { headers: headersStandard, cf: { cacheEverything: false } });
        if (r_robots.status === 200) {
            robotsFound = true;
            totalScore += 5;
            robotsText = await r_robots.text();
            const lowerText = robotsText.toLowerCase();
            if (['oai-searchbot', 'gptbot', 'perplexitybot'].some(bot => lowerText.includes(bot))) {
                hasAI = true;
                totalScore += 5;
            }
        }
    } catch { /* silent fail */ }

    try {
        let sitemapUrl = `${base}/sitemap.xml`;
        if (robotsText) {
            const sitemapMatch = robotsText.match(/^Sitemap:\s*(.*)$/im);
            if (sitemapMatch && sitemapMatch[1]) {
                sitemapUrl = sitemapMatch[1].trim();

                // Handle relative sitemap URL edge case
                if (sitemapUrl.startsWith('/')) {
                    sitemapUrl = `${base}${sitemapUrl}`;
                }
            }
        }

        const r_sitemap = await iFetch(sitemapUrl, { headers: headersStandard, cf: { cacheEverything: false } });
        if (r_sitemap.status === 200) {
            sitemapFound = true;
            totalScore += 5;
        }
    } catch { /* silent fail for sitemap */ }

    // 2. Content Accessibility
    let supportsMarkdown = false;
    let hasContentSignal = false;
    let hasSchema = false;
    let schemaType = "";

    try {
        const r_home = await iFetch(base, { headers: headersAgent, cf: { cacheEverything: false } });
        const cType = (r_home.headers.get('content-type') || '').toLowerCase();
        if (cType.includes('text/markdown')) {
            supportsMarkdown = true;
            totalScore += 15;
        }
        if (r_home.headers.has('content-signal')) {
            hasContentSignal = true;
            totalScore += 10;
        }

        const htmlText = await r_home.text();
        const scriptRegex = /<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
        let match;
        while ((match = scriptRegex.exec(htmlText)) !== null) {
            try {
                const json = JSON.parse(match[1]);
                const checkSchema = (obj) => {
                    if (!obj || typeof obj !== 'object') return;
                    if (obj['@type']) {
                        hasSchema = true;
                        if (typeof obj['@type'] === 'string') {
                            schemaType = obj['@type'];
                        } else if (Array.isArray(obj['@type'])) {
                            schemaType = obj['@type'][0];
                        }
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

        if (hasSchema) {
            totalScore += 10;
        }
    } catch { /* silent fail */ }

    // 3. Protocol Discovery Detailed Tooltips
    const wellKnownFiles = [
        {
            name: 'A2A Agent Card', prompt: `Write a JSON file named agent-card.json that follows the A2A protocol specification. It should list my application's capabilities, endpoints, and OAuth 2.0 authorization rules. Please provide the file content and tell me to place it in /.well-known/agent-card.json.`, path: '/.well-known/agent-card.json', spec: 'https://a2a-protocol.org/latest/specification/', isJson: true, points: 10,
            tooltip: `<strong>What it is:</strong> Expected at <code>/.well-known/agent-card.json</code>, this is the standard Agent-to-Agent (A2A) protocol entry point.<br/><br/><strong>Why it's critical:</strong> It details exactly what your application is capable of doing from a machine's perspective, listing supported actions and state schemas.<br/><br/><strong>Impact of missing it:</strong> Other autonomous agents cannot dynamically negotiate data exchanges with your platform, isolating you from the agentic economy. You lose machine-to-machine traffic.<br/><br/><strong>Implementation Example:</strong> Publish a JSON file containing your agent's name, capabilities (Skills), endpoints, and OAuth 2.0 authorization rules.\`
        },
        {
            name: 'API Catalog', prompt: `Create an RFC 9727 HTTP API Catalog file at /.well-known/api-catalog that points to my OpenAPI/Swagger documentation.`, path: '/.well-known/api-catalog', spec: 'https://www.rfc-editor.org/rfc/rfc9727.txt', isJson: true, points: 5,            tooltip: `<strong>What it is:</strong> RFC 9727 HTTP API Catalog.<br/><br/><strong>Why it's critical:</strong> It standardizes where autonomous systems can find machine-readable descriptions (like OpenAPI/Swagger) of your APIs.<br/><br/><strong>Impact of missing it:</strong> LLMs won't be able to map out your API endpoints natively. If an agent wants to extract specific business data or trigger an action, it will fail to 'understand' how to structure the HTTP requests, reducing integrations to zero.<br/><br/><strong>Implementation Example:</strong> Create a <code>/.well-known/api-catalog</code> that points to your public <code>openapi.json</code> or Swagger documentation so models instantly learn your exact HTTP request structures.\`
        },
        {
            name: 'Agent Skills', prompt: `Create an Agent Skills index file at /.well-known/agent-skills/index.json that maps my complex REST endpoints into actionable skills for an AI agent.`, path: '/.well-known/agent-skills/index.json', spec: 'https://agentskills.io/home', isJson: true, points: 10,
            tooltip: `<strong>What it is:</strong> A specialized index documenting actionable machine-skills (e.g. "BuyItem", "SearchDocs").<br/><br/><strong>Why it's critical:</strong> It abstracts complex APIs into simple semantic 'skills' that an LLM brain can invoke.<br/><br/><strong>Impact of missing it:</strong> AI Assistants (like custom GPTs) will not be able to execute any high-level workflows on your platform, severely reducing the business automation capabilities for end-users.<br/><br/><strong>Implementation Example:</strong> Map complex REST endpoints into clean, actionable concepts like <code>FindFlight</code> or <code>CancelOrder</code> under <code>/.well-known/agent-skills/index.json</code>.\`
        },
        {
            name: 'MCP Server', prompt: `Create a Model Context Protocol (MCP) server manifest at /.well-known/mcp/server-card.json that exposes my application's core functions as tools.`, path: '/.well-known/mcp/server-card.json', spec: 'https://modelcontextprotocol.io/', isJson: true, points: 10,
            tooltip: `<strong>What it is:</strong> The Model Context Protocol (MCP) is like a 'USB-C cable for AI'. Instead of forcing AI to scrape HTML or figure out REST APIs, you host an MCP Server that streams data directly to agents via SSE (Server-Sent Events).<br/><br/><strong>Why it's critical:</strong> It allows your platform to expose its core functions as <em>Resources</em>, <em>Tools</em>, and <em>Prompts</em> natively to AI ecosystems like Claude Desktop or Cursor.<br/><br/><strong>Impact of missing it:</strong> Your platform remains isolated in the "human-only" web. Agents will not be able to securely read user data or take actions securely within their native AI workflows.<br/><br/><strong>Implementation Example:</strong> Deploy a Remote MCP Server on your infrastructure (e.g., at <code>/mcp/sse</code>) that exposes your business logic as callable Tools. Add a discovery manifest at <code>/.well-known/mcp/server-card.json</code> so agents can automatically find and connect to it.\`
        },
        {
            name: 'OAuth Discovery', prompt: `Create an OAuth 2.0 discovery metadata file at /.well-known/oauth-authorization-server following RFC 8414.`, path: '/.well-known/oauth-authorization-server', spec: 'https://www.rfc-editor.org/rfc/rfc8414.txt', isJson: true, points: 5,
            tooltip: `<strong>What it is:</strong> RFC 8414 standard for OAuth 2.0 discovery.<br/><br/><strong>Why it's critical:</strong> Allows agents to understand exactly how to authenticate, which scopes are available, and where token endpoints live.<br/><br/><strong>Impact of missing it:</strong> Agents will be completely blocked out of secure/private areas of your platform. They cannot dynamically request user consent to perform actions on their behalf.<br/><br/><strong>Implementation Example:</strong> Serve metadata at <code>/.well-known/oauth-authorization-server</code> highlighting your issuer URI and token endpoints so LLM apps can securely acquire human user consent.\`
        },
        {
            name: 'AI Plugin', prompt: `Create an AI Plugin manifest at /.well-known/ai-plugin.json with a description_for_model and a link to my OpenAPI schema.`, path: '/.well-known/ai-plugin.json', spec: 'https://projects.laion.ai/Open-Assistant/docs/plugins/details', isJson: true, points: 10,
            tooltip: `<strong>What it is:</strong> Originally introduced by OpenAI, this is the standard manifesto that turns your website's REST API into an AI "Plugin" or "Action" for consumer LLM chats.<br/><br/><strong>Why it's critical:</strong> When users chat with ChatGPT or Copilot, the AI needs to know exactly what your API does to decide when to call it. This file provides the "natural language" metadata and authentication rules connecting the LLM to your OpenAPI schema.<br/><br/><strong>Impact of missing it:</strong> You cannot create Custom GPTs or Copilot extensions that natively interact with your platform. The AI will not know how to discover your API endpoints.<br/><br/><strong>Implementation Example:</strong> Host a file at <code>/.well-known/ai-plugin.json</code>. Inside, provide a <code>name_for_human</code>, a highly detailed <code>description_for_model</code> (telling the AI explicitly when and how to use it), and a link to your <code>openapi.yaml</code> spec.\`
        },
        {
            name: 'Universal Commerce', prompt: `Create a Universal Commerce Protocol (UCP) configuration at /.well-known/ucp pointing to my headless commerce endpoints.`, path: '/.well-known/ucp', spec: 'http://ucp.dev/', isJson: true, points: 5,
            tooltip: `<strong>What it is:</strong> Protocol specifically designed for agent-based e-commerce operations.<br/><br/><strong>Why it's critical:</strong> It formats product data, checkout flows, and inventory constraints transparently for AI shopping agents.<br/><br/><strong>Impact of missing it:</strong> If your site sells goods or services, AI purchasing agents will not be able to seamlessly 'click' through your funnel or verify prices, losing you fully automated AI-driven revenue.<br/><br/><strong>Implementation Example:</strong> Place a configuration at <code>/.well-known/ucp</code> pointing agents to your headless commerce endpoints, allowing autonomous bots to load shopping carts.\`
        },
        {
            name: 'LLMs.txt', prompt: `Create an llms.txt file for my root directory containing an H1 title, a summary quote box, and a Markdown list of links to my technical documentation.`, path: '/llms.txt', spec: 'https://llmstxt.org/', isJson: false, points: 10,
            tooltip: `<strong>What it is:</strong> A navigation manifesto designed specifically for Large Language Models.<br/><br/><strong>Why it's critical:</strong> It provides a clean, markdown-based table of contents of your documentation, sidestepping heavy UI routing.<br/><br/><strong>Impact of missing it:</strong> Models trying to understand your platform's documentation will hallucinate or get stuck traversing endless JS-heavy web pages. Giving them an explicit map drastically improves AI response accuracy regarding your product.<br/><br/><strong>Implementation Example:</strong> Add <code>/llms.txt</code> to your root. Formatting: an H1 Title, a summary quote box, and a clean Markdown list of links pointing to raw <code>.md</code> technical docs.\`
        },
        {
            name: "LLMs-Full.txt",
                    prompt: \`Please check if \`/llms-full.txt\` exists in my project root. If it exists, update it; otherwise, create it. It should provide a comprehensive, concatenated Markdown version of all my primary technical documentation.
Example format:
\`\`\`markdown
# My App Docs Full
> A comprehensive guide to the application.

## Getting Started
To install the application...

## API Reference
### \`GET /api/users\`
Returns a list of users...
\`\`\``, path: '/llms-full.txt', spec: 'https://llmstxt.org/', isJson: false, points: 10,
            tooltip: `<strong>What it is:</strong> A complete, machine-readable export of your entire documentation in structured Markdown format.<br/><br/><strong>Why it's critical:</strong> It provides LLMs and agents with all context in a single file, eliminating the need for multiple API calls or web scraping.<br/><br/><strong>Impact of missing it:</strong> AI systems might miss critical details if they only read summaries or have to navigate multiple links, increasing the chance of hallucinations and degraded agentic capabilities.<br/><br/><strong>Implementation Example:</strong> Add <code>/llms-full.txt</code> to your root. Include all relevant documentation content (e.g., tutorials, API references, code samples) concatenated in clear, structured Markdown.\`
        },
        {
            name: "TDM Reservation",
            prompt: \`Please check if \`/.well-known/tdmrep.json\` exists. If it exists, update it; otherwise, create it. It should implement the TDM Reservation Protocol to express my Text and Data Mining (TDM) rights for AI scraping and training. You must also create the \`/policies/tdm-policy.json\` file referenced in the \`tdm-policy\` field if it does not already exist.
Example:
\`\`\`json
{
  "tdm-reservation": 1,
  "tdm-policy": "https://ai-valid.secmy.app/policies/tdm-policy.json"
}
\`\`\``, path: '/.well-known/tdmrep.json', spec: 'https://www.w3.org/community/reports/tdmrep/CG-FINAL-tdmrep-20240510/', isJson: true, points: 5,
            tooltip: `<strong>What it is:</strong> The W3C Text and Data Mining (TDM) Reservation Protocol.<br/><br/><strong>Why it's critical:</strong> It provides a machine-readable way to formally opt-out of or set policies for AI model training and automated scraping, which is critical for compliance with the EU CDSM Directive Article 4.<br/><br/><strong>Impact of missing it:</strong> AI crawlers and scrapers may assume they have the right to scrape your data for model training purposes. You lack a standardized mechanism to declare your copyright reservation.<br/><br/><strong>Implementation Example:</strong> Host a JSON file at <code>/.well-known/tdmrep.json</code> with a <code>tdm-reservation</code> flag and an optional link to your licensing policy.\`
        },
        {
            name: "ai.txt",
            prompt: \`Please check if \`/ai.txt\` exists. If it exists, update it; otherwise, create it. It should define permissions for AI data mining and scraping, following the Spawning.ai format.
Example:
\`\`\`text
# ai.txt — Spawning format
# Declares TDM permissions per EU CDSM Article 4

User-Agent: GPTBot
Disallow: /
\`\`\`, path: '/ai.txt', spec: 'https://site.spawning.ai/spawning-ai-txt', isJson: false, points: 5,
            tooltip: `<strong>What it is:</strong> A plain text file declaring your website's policies for AI system interaction, such as permissions for AI data mining and model training, following the Spawning format.<br/><br/><strong>Why it's critical:</strong> It adheres to the EU's Digital Single Market TDM Article 4 exception by providing a machine-readable opt-out targeted at commercial AI model training.<br/><br/><strong>Impact of missing it:</strong> AI crawlers and data scrapers may assume they have full permission to scrape and use your content for commercial AI model training.<br/><br/><strong>Implementation Example:</strong> Host a file at <code>/ai.txt</code> with explicit bot directives: <br><code>User-Agent: GPTBot<br>Disallow: /</code>\`
        }
    ];

    // Fetch protocols in batches to avoid unbounded concurrency
    const protoResults = [];
    const batchSize = 4;
    for (let i = 0; i < wellKnownFiles.length; i += batchSize) {
        const batch = wellKnownFiles.slice(i, i + batchSize);
        const batchResults = await Promise.all(batch.map(async (data) => {
            const url = \`\${base}\${data.path}\`;
            let status = 'err';
            let message = '';
            let code = null;
            try {
                const req = await iFetch(url, { headers: headersStandard, cf: { cacheEverything: false } });
                code = req.status;
                let cType = (req.headers.get('content-type') || '').toLowerCase();
                let isSoft404 = code === 200 && cType.includes('text/html');

                if (code === 200 && !isSoft404) {
                    if (data.isJson) {
                        try {
                            const jsonBody = await req.json();
                            status = 'ok';
                            message = 'Valid JSON found';
                            totalScore += data.points;
                        } catch (err) {
                            message = 'Invalid JSON content';
                        }
                    } else {
                        if (!cType.includes('text/html')) {
                            status = 'ok';
                            message = 'Readable format found';
                            totalScore += data.points;
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
                    message = \`Not found (\${code})\`;
                }
            } catch (e) {
                message = 'Network error';
            }

            return { name: data.name, path: data.path, spec: data.spec, tooltip: data.tooltip, prompt: data.prompt, status, message, code };
        }));
        protoResults.push(...batchResults);
    }

    return {
        score: {
            total: totalScore
        },
        bots: {
            robotsFound,
            hasAI,
            sitemapFound,
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
                    name: "AI Directives",
                    prompt: `Update my robots.txt to strategically manage AI crawlers, explicitly allowing OAI-SearchBot for search representation while disallowing GPTBot from scraping for training data.`,                    status: hasAI ? 'ok' : 'warn',
                    message: "Rules for OAI-SearchBot/GPTBot.",
                    spec: "https://platform.openai.com/docs/bots",
                    tooltip: `<strong>What it is:</strong> Explicit rules targeting next-gen AI crawlers exclusively (e.g. <code>User-Agent: OAI-SearchBot</code>).<br/><br/><strong>Why it's critical:</strong> Differentiates your human/SEO search permissions (Googlebot) from generative AI scraping.<br/><br/><strong>Impact of missing it:</strong> You lose fine-grained control. Your site might be weaponized in open datasets without your explicit consent or economic benefit. Allowing specific AI agents is key to participating in Answer Engines without exposing full raw data.<br/><br/><strong>Implementation Example:</strong> Strategically block Training data scraping while allowing real-time Search representation: <br><code>User-agent: GPTBot<br>Disallow: /<br><br>User-agent: OAI-SearchBot<br>Allow: /</code>`,
                    code: hasAI ? 'Found' : 'Missing'
                },
                {
                    name: "sitemap.xml",
                    prompt: `Please generate a \`sitemap.xml\` for my project if it doesn't exist, and ensure my \`/robots.txt\` includes a \`Sitemap: <url>\` directive pointing to it. The sitemap should follow standard XML schema and list all important public pages.`,
                    status: sitemapFound ? 'ok' : 'err',
                    message: sitemapFound ? "Sitemap found" : "No Sitemap found",
                    spec: "https://www.sitemaps.org/protocol.html",
                    tooltip: `<strong>What it is:</strong> An XML file that lists URLs for a site along with additional metadata about each URL.<br/><br/><strong>Why it's critical:</strong> It allows AI search bots (like SearchGPT and Perplexity) and traditional search engines to discover your content efficiently without having to guess paths or follow every link blindly.<br/><br/><strong>Impact of missing it:</strong> AI crawlers might miss critical new or updated content on your platform, significantly reducing your visibility in AI-generated answers and search results.<br/><br/><strong>Implementation Example:</strong> Host a <code>/sitemap.xml</code> and add <code>Sitemap: https://yourdomain.com/sitemap.xml</code> to your <code>robots.txt</code>.`,
                    code: sitemapFound ? 'Found' : 'Missing'
                }
            ]
        },
        content: {
            supportsMarkdown,
            hasContentSignal,
            results: [
                {
                    name: "Content Neg. (MD)",
                    prompt: `Implement content negotiation in my server so that when a client sends an 'Accept: text/markdown' header, it returns the page content in clean Markdown instead of HTML.`,
                    status: supportsMarkdown ? 'ok' : 'err',
                    message: supportsMarkdown ? "Server provides markdown" : "No markdown provided on-the-fly",
                    spec: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Content_negotiation",
                    tooltip: `<strong>What it is:</strong> Dynamic content routing. When a bot sends <code>Accept: text/markdown</code>, the server returns clean Markdown instead of full HTML.<br/><br/><strong>Why it's critical:</strong> LLMs process text tokens. Forcing an LLM to read a complex HTML DOM drastically inflates the 'noise', eating up prompt context limits and increasing latency.<br/><br/><strong>Impact of missing it:</strong> Data extraction becomes fragile. Your website remains a 'human-first' application that breaks agent logic when CSS classes and div nested structures get in the way of semantic information.<br/><br/><strong>Implementation Example:</strong> Utilize Cloudflare Workers, Nginx proxies, or Next.js middleware to sniff for <code>Accept: text/markdown</code> in the request header and return parsed Markdown text instantly without any styling wraps.`,
                    code: supportsMarkdown ? 'Supported' : 'Failed'
                },
                {
                    name: "Content-Signal",
                    prompt: `Add a 'Content-Signal' HTTP response header to my server responses (e.g., Content-Signal: ai-train=no, search=yes) to explicitly declare usage policies for AI scraping and training.`,
                    status: hasContentSignal ? 'ok' : 'warn',
                    message: "Usage policies header.",
                    spec: "https://contentsignals.org/",
                    tooltip: `<strong>What it is:</strong> An explicit HTTP Header signaling legal and policy usage metadata for machine consumers.<br/><br/><strong>Why it's critical:</strong> It informs scraping bots at the network level whether your content is free for LLM training, requires attribution, or is completely restricted copyright.<br/><br/><strong>Impact of missing it:</strong> Machine agents assume 'fair game' for all scraped data. Without signal compliance, you have no technical ground to prevent proprietary data from becoming automated training fodder.<br/><br/><strong>Implementation Example:</strong> Ensure your server responses (especially for content heavy pages) include the header: <code>Content-Signal: ai-train=no, search=yes</code> to explicitly block big tech from stealing IP for training while retaining search indexing.`,
                    code: hasContentSignal ? 'Found' : 'Missing'
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
                }
            ]
        },
        protocols: {
            results: protoResults
        }
    };
}
