import htmlTemplate from '../public/index.html';
import cssContent from '../public/style.css';
import jsContent from '../public/app.client.js';
import faviconSvg from '../public/favicon.svg';

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        
        // --- Static File Routing ---
        if (request.method === "GET") {
            if (url.pathname === "/") {
                return new Response(htmlTemplate, {
                    headers: { "Content-Type": "text/html; charset=utf-8" },
                });
            }
            if (url.pathname === "/style.css") {
                return new Response(cssContent, {
                    headers: { "Content-Type": "text/css; charset=utf-8" },
                });
            }
            if (url.pathname === "/app.client.js") {
                return new Response(jsContent, {
                    headers: { "Content-Type": "application/javascript; charset=utf-8" },
                });
            }
            if (url.pathname === "/favicon.svg" || url.pathname === "/favicon.ico") {
                return new Response(faviconSvg, {
                    headers: { "Content-Type": "image/svg+xml" },
                });
            }
        }

        // --- API Route ---
        if (request.method === "POST" && url.pathname === "/api/audit") {
            try {
                let body = await request.json();
                let targetUrl = body.targetUrl;
                
                if (!targetUrl || !targetUrl.startsWith('http')) {
                    return new Response(JSON.stringify({ error: "Invalid URL" }), { status: 400 });
                }

                const result = await performAudit(targetUrl);
                return new Response(JSON.stringify(result), {
                    headers: { "Content-Type": "application/json" }
                });

            } catch(e) {
                return new Response(JSON.stringify({ error: e.message }), { status: 500 });
            }
        }

        return new Response("Not Found", { status: 404 });
    }
};

async function performAudit(baseUrl) {
    const headersStandard = { 'User-Agent': 'Mozilla/5.0 (compatible; AI-Valid/1.0)' };
    const headersAgent = { 'User-Agent': 'OAI-SearchBot', 'Accept': 'text/markdown' };
    
    // Ensure baseUrl doesn't end with slash securely
    const base = new URL(baseUrl).origin;

    let totalScore = 0;

    // 1. Discoverability & Bots
    let robotsFound = false;
    let hasAI = false;
    try {
        const r_robots = await fetch(`${base}/robots.txt`, { headers: headersStandard, cf: { cacheEverything: false } });
        if (r_robots.status === 200) {
            robotsFound = true;
            totalScore += 5;
            const text = await r_robots.text();
            const lowerText = text.toLowerCase();
            if (['oai-searchbot', 'gptbot', 'perplexitybot'].some(bot => lowerText.includes(bot))) {
                hasAI = true;
                totalScore += 5;
            }
        }
    } catch (e) { /* silent fail */ }

    // 2. Content Accessibility
    let supportsMarkdown = false;
    let hasContentSignal = false;
    try {
        const r_home = await fetch(base, { headers: headersAgent, cf: { cacheEverything: false } });
        const cType = (r_home.headers.get('content-type') || '').toLowerCase();
        if (cType.includes('text/markdown')) {
            supportsMarkdown = true;
            totalScore += 15;
        }
        if (r_home.headers.has('content-signal')) {
            hasContentSignal = true;
            totalScore += 10;
        }
    } catch (e) { /* silent fail */ }

    // 3. Protocol Discovery Detailed Tooltips
    const wellKnownFiles = [
        { 
            name: 'A2A Agent Card', path: '/.well-known/agent-card.json', spec: 'https://a2a-protocol.org/latest/specification/', isJson: true, points: 10, 
            tooltip: `<strong>What it is:</strong> Expected at <code>/.well-known/agent-card.json</code>, this is the standard Agent-to-Agent (A2A) protocol entry point.<br/><br/><strong>Why it's critical:</strong> It details exactly what your application is capable of doing from a machine's perspective, listing supported actions and state schemas.<br/><br/><strong>Impact of missing it:</strong> Other autonomous agents cannot dynamically negotiate data exchanges with your platform, isolating you from the agentic economy. You lose machine-to-machine traffic.<br/><br/><strong>Implementation Example:</strong> Publish a JSON file containing your agent's name, capabilities (Skills), endpoints, and OAuth 2.0 authorization rules.` 
        },
        { 
            name: 'API Catalog', path: '/.well-known/api-catalog', spec: 'https://www.rfc-editor.org/info/rfc9727', isJson: true, points: 5, 
            tooltip: `<strong>What it is:</strong> RFC 9727 HTTP API Catalog.<br/><br/><strong>Why it's critical:</strong> It standardizes where autonomous systems can find machine-readable descriptions (like OpenAPI/Swagger) of your APIs.<br/><br/><strong>Impact of missing it:</strong> LLMs won't be able to map out your API endpoints natively. If an agent wants to extract specific business data or trigger an action, it will fail to 'understand' how to structure the HTTP requests, reducing integrations to zero.<br/><br/><strong>Implementation Example:</strong> Create a <code>/.well-known/api-catalog</code> that points to your public <code>openapi.json</code> or Swagger documentation so models instantly learn your exact HTTP request structures.` 
        },
        { 
            name: 'Agent Skills', path: '/.well-known/agent-skills/index.json', spec: 'https://agentskills.io/home', isJson: true, points: 10, 
            tooltip: `<strong>What it is:</strong> A specialized index documenting actionable machine-skills (e.g. "BuyItem", "SearchDocs").<br/><br/><strong>Why it's critical:</strong> It abstracts complex APIs into simple semantic 'skills' that an LLM brain can invoke.<br/><br/><strong>Impact of missing it:</strong> AI Assistants (like custom GPTs) will not be able to execute any high-level workflows on your platform, severely reducing the business automation capabilities for end-users.<br/><br/><strong>Implementation Example:</strong> Map complex REST endpoints into clean, actionable concepts like <code>FindFlight</code> or <code>CancelOrder</code> under <code>/.well-known/agent-skills/index.json</code>.` 
        },
        { 
            name: 'MCP Server', path: '/.well-known/mcp/server-card.json', spec: 'https://modelcontextprotocol.io/', isJson: true, points: 10, 
            tooltip: `<strong>What it is:</strong> The Model Context Protocol (MCP) is like a 'USB-C cable for AI'. Instead of forcing AI to scrape HTML or figure out REST APIs, you host an MCP Server that streams data directly to agents via SSE (Server-Sent Events).<br/><br/><strong>Why it's critical:</strong> It allows your platform to expose its core functions as <em>Resources</em>, <em>Tools</em>, and <em>Prompts</em> natively to AI ecosystems like Claude Desktop or Cursor.<br/><br/><strong>Impact of missing it:</strong> Your platform remains isolated in the "human-only" web. Agents will not be able to securely read user data or take actions securely within their native AI workflows.<br/><br/><strong>Implementation Example:</strong> Deploy a Remote MCP Server on your infrastructure (e.g., at <code>/mcp/sse</code>) that exposes your business logic as callable Tools. Add a discovery manifest at <code>/.well-known/mcp/server-card.json</code> so agents can automatically find and connect to it.` 
        },
        { 
            name: 'OAuth Discovery', path: '/.well-known/oauth-authorization-server', spec: 'https://www.rfc-editor.org/info/rfc8414', isJson: true, points: 5, 
            tooltip: `<strong>What it is:</strong> RFC 8414 standard for OAuth 2.0 discovery.<br/><br/><strong>Why it's critical:</strong> Allows agents to understand exactly how to authenticate, which scopes are available, and where token endpoints live.<br/><br/><strong>Impact of missing it:</strong> Agents will be completely blocked out of secure/private areas of your platform. They cannot dynamically request user consent to perform actions on their behalf.<br/><br/><strong>Implementation Example:</strong> Serve metadata at <code>/.well-known/oauth-authorization-server</code> highlighting your issuer URI and token endpoints so LLM apps can securely acquire human user consent.` 
        },
        { 
            name: 'AI Plugin', path: '/.well-known/ai-plugin.json', spec: 'https://projects.laion.ai/Open-Assistant/docs/plugins/details', isJson: true, points: 10, 
            tooltip: `<strong>What it is:</strong> Originally introduced by OpenAI, this is the standard manifesto that turns your website's REST API into an AI "Plugin" or "Action" for consumer LLM chats.<br/><br/><strong>Why it's critical:</strong> When users chat with ChatGPT or Copilot, the AI needs to know exactly what your API does to decide when to call it. This file provides the "natural language" metadata and authentication rules connecting the LLM to your OpenAPI schema.<br/><br/><strong>Impact of missing it:</strong> You cannot create Custom GPTs or Copilot extensions that natively interact with your platform. The AI will not know how to discover your API endpoints.<br/><br/><strong>Implementation Example:</strong> Host a file at <code>/.well-known/ai-plugin.json</code>. Inside, provide a <code>name_for_human</code>, a highly detailed <code>description_for_model</code> (telling the AI explicitly when and how to use it), and a link to your <code>openapi.yaml</code> spec.` 
        },
        { 
            name: 'Universal Commerce', path: '/.well-known/ucp', spec: 'http://ucp.dev/', isJson: true, points: 5, 
            tooltip: `<strong>What it is:</strong> Protocol specifically designed for agent-based e-commerce operations.<br/><br/><strong>Why it's critical:</strong> It formats product data, checkout flows, and inventory constraints transparently for AI shopping agents.<br/><br/><strong>Impact of missing it:</strong> If your site sells goods or services, AI purchasing agents will not be able to seamlessly 'click' through your funnel or verify prices, losing you fully automated AI-driven revenue.<br/><br/><strong>Implementation Example:</strong> Place a configuration at <code>/.well-known/ucp</code> pointing agents to your headless commerce endpoints, allowing autonomous bots to load shopping carts.` 
        },
        { 
            name: 'LLMs.txt', path: '/llms.txt', spec: 'https://llmstxt.org/', isJson: false, points: 10, 
            tooltip: `<strong>What it is:</strong> A navigation manifesto designed specifically for Large Language Models.<br/><br/><strong>Why it's critical:</strong> It provides a clean, markdown-based table of contents of your documentation, sidestepping heavy UI routing.<br/><br/><strong>Impact of missing it:</strong> Models trying to understand your platform's documentation will hallucinate or get stuck traversing endless JS-heavy web pages. Giving them an explicit map drastically improves AI response accuracy regarding your product.<br/><br/><strong>Implementation Example:</strong> Add <code>/llms.txt</code> to your root. Formatting: an H1 Title, a summary quote box, and a clean Markdown list of links pointing to raw <code>.md</code> technical docs.` 
        }
    ];

    // Fetch all protocols concurrently for max speed
    const protoPromises = wellKnownFiles.map(async (data) => {
        const url = `${base}${data.path}`;
        let status = 'err';
        let message = '';
        let code = null;
        try {
            const req = await fetch(url, { headers: headersStandard, cf: { cacheEverything: false } });
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
                message = `Not found (${code})`;
            }
        } catch (e) {
            message = 'Network error';
        }

        return { name: data.name, path: data.path, spec: data.spec, tooltip: data.tooltip, status, message, code };
    });

    const protoResults = await Promise.all(protoPromises);

    return {
        score: {
            total: totalScore
        },
        bots: {
            robotsFound,
            hasAI,
            results: [
                {
                    name: "robots.txt",
                    status: robotsFound ? 'ok' : 'err',
                    message: robotsFound ? "Found manifest file" : "Not Found manifest file",
                    spec: "https://developers.google.com/search/docs/crawling-indexing/robots/intro",
                    tooltip: `<strong>What it is:</strong> Standard web crawler directives located at <code>/robots.txt</code>.<br/><br/><strong>Why it's critical:</strong> It is the first place legacy and modern bots look for permissions on what content they are allowed to index or scrape.<br/><br/><strong>Impact of missing it:</strong> AI bots may either scrape data you wish to keep private (training models on your intellectual property), or they might adopt a strict default and completely ignore your site in AI search results (like Perplexity or SearchGPT).<br/><br/><strong>Implementation Example:</strong> Add explicit bot designations in your <code>robots.txt</code>, such as: <br><code>User-agent: OAI-SearchBot<br>Allow: /</code>`,
                    code: robotsFound ? 'Found' : 'Missing'
                },
                {
                    name: "AI Directives",
                    status: hasAI ? 'ok' : 'warn',
                    message: "Rules for OAI-SearchBot/GPTBot.",
                    spec: "https://platform.openai.com/docs/bots",
                    tooltip: `<strong>What it is:</strong> Explicit rules targeting next-gen AI crawlers exclusively (e.g. <code>User-Agent: OAI-SearchBot</code>).<br/><br/><strong>Why it's critical:</strong> Differentiates your human/SEO search permissions (Googlebot) from generative AI scraping.<br/><br/><strong>Impact of missing it:</strong> You lose fine-grained control. Your site might be weaponized in open datasets without your explicit consent or economic benefit. Allowing specific AI agents is key to participating in Answer Engines without exposing full raw data.<br/><br/><strong>Implementation Example:</strong> Strategically block Training data scraping while allowing real-time Search representation: <br><code>User-agent: GPTBot<br>Disallow: /<br><br>User-agent: OAI-SearchBot<br>Allow: /</code>`,
                    code: hasAI ? 'Found' : 'Missing'
                }
            ]
        },
        content: {
            supportsMarkdown,
            hasContentSignal,
            results: [
                {
                    name: "Content Neg. (MD)",
                    status: supportsMarkdown ? 'ok' : 'err',
                    message: supportsMarkdown ? "Server provides markdown" : "No markdown provided on-the-fly",
                    spec: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Content_negotiation",
                    tooltip: `<strong>What it is:</strong> Dynamic content routing. When a bot sends <code>Accept: text/markdown</code>, the server returns clean Markdown instead of full HTML.<br/><br/><strong>Why it's critical:</strong> LLMs process text tokens. Forcing an LLM to read a complex HTML DOM drastically inflates the 'noise', eating up prompt context limits and increasing latency.<br/><br/><strong>Impact of missing it:</strong> Data extraction becomes fragile. Your website remains a 'human-first' application that breaks agent logic when CSS classes and div nested structures get in the way of semantic information.<br/><br/><strong>Implementation Example:</strong> Utilize Cloudflare Workers, Nginx proxies, or Next.js middleware to sniff for <code>Accept: text/markdown</code> in the request header and return parsed Markdown text instantly without any styling wraps.`,
                    code: supportsMarkdown ? 'Supported' : 'Failed'
                },
                {
                    name: "Content-Signal",
                    status: hasContentSignal ? 'ok' : 'warn',
                    message: "Usage policies header.",
                    spec: "https://contentsignals.org/",
                    tooltip: `<strong>What it is:</strong> An explicit HTTP Header signaling legal and policy usage metadata for machine consumers.<br/><br/><strong>Why it's critical:</strong> It informs scraping bots at the network level whether your content is free for LLM training, requires attribution, or is completely restricted copyright.<br/><br/><strong>Impact of missing it:</strong> Machine agents assume 'fair game' for all scraped data. Without signal compliance, you have no technical ground to prevent proprietary data from becoming automated training fodder.<br/><br/><strong>Implementation Example:</strong> Ensure your server responses (especially for content heavy pages) include the header: <code>Content-Signal: ai-train=no, search=yes</code> to explicitly block big tech from stealing IP for training while retaining search indexing.`,
                    code: hasContentSignal ? 'Found' : 'Missing'
                }
            ]
        },
        protocols: {
            results: protoResults
        }
    };
}
