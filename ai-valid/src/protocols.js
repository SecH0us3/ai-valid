/**
 * Centralized Protocol Definitions for AI Readiness Audit
 */

/**
 * Helper to format consistent audit tooltips.
 *
 * @param {Object} params
 * @param {string} params.what - Description of the protocol or standard.
 * @param {string} params.why - Explanation of its importance for AI readiness.
 * @param {string} params.impact - Potential consequences if the protocol is missing.
 * @param {string} params.example - Actionable steps to implement the protocol.
 * @returns {string} Formatted HTML string for tooltips.
 */
export const formatTooltip = ({ what, why, impact, example }) => {
    return `<strong>What it is:</strong> ${what}<br/><br/><strong>Why it's critical:</strong> ${why}<br/><br/><strong>Impact of missing it:</strong> ${impact}<br/><br/><strong>Implementation Example:</strong> ${example}`;
};

/**
 * Helper to format consistent AI prompts for file creation/modification.
 *
 * @param {Object} params
 * @param {string} params.path - Target file path (e.g., '/.well-known/ai-plugin.json').
 * @param {string} params.description - Instructions on what the file should contain.
 * @param {string} params.example - Code snippet showing the expected structure.
 * @param {string} [params.exampleFormat='json'] - Language for the markdown code block.
 * @returns {string} Formatted markdown string for AI instructions.
 */
export const formatPrompt = ({ path, description, example, exampleFormat = 'json' }) => {
    return `Please check if \`${path}\` exists in my project. If it does, update it; otherwise, create it. ${description.trim()}
Example:
\`\`\`${exampleFormat}
${example.trim()}
\`\`\``;
};

/**
 * Metadata for AI Bot and Crawler discoverability checks.
 */
export const botsMetadata = {
    robots: {
        name: "Robots.txt",
        spec: "https://www.robotstxt.org/robotstxt.html",
        prompt: "Please check if `robots.txt` exists in my project root. If it does, update it; otherwise, create it. It should define which bots are allowed to crawl my site and where my sitemap is located.",
        tooltip: formatTooltip({
            what: "Standard web protocol (RFC 9309) telling search engines and AI bots which parts of your content they are allowed to index or scrape.",
            why: "It's the first file any well-behaved AI agent (like SearchGPT or Perplexity) checks before interacting with your site. It defines the 'rules of engagement'.",
            impact: "AI bots may either scrape data you wish to keep private (training models on your intellectual property), or they might adopt a strict default and completely ignore your site in AI search results (like Perplexity or SearchGPT).",
            example: "Add explicit bot designations in your <code>robots.txt</code>, such as: <br><code>User-agent: OAI-SearchBot<br>Allow: /</code>"
        })
    },
    aiDirectives: {
        name: "AI Directives",
        spec: "https://platform.openai.com/docs/bots",
        prompt: `Please update my existing \`/robots.txt\` file to strategically manage generative AI scraping. The configuration should depend on the type of my project:
- If this is a **landing page, marketing site, or open-source documentation**, ALLOW both AI search bots (for real-time discoverability) AND training data scrapers (like GPTBot, CCBot) to increase future brand awareness.
- If this is a **web application, forum, or contains proprietary/user-generated content (UGC)**, ALLOW AI search bots (e.g., OAI-SearchBot) for real-time citations, but DISALLOW training data scrapers (e.g., GPTBot, CCBot) to protect my intellectual property.

Example for a web application/forum:
\`\`\`text
User-agent: GPTBot
Disallow: /
User-agent: CCBot
Disallow: /

User-agent: OAI-SearchBot
Allow: /
\`\`\``,
        tooltip: formatTooltip({
            what: "Explicit rules targeting next-gen AI crawlers exclusively (e.g. <code>User-Agent: OAI-SearchBot</code>).",
            why: "Differentiates your human/SEO search permissions (Googlebot) from generative AI scraping.",
            impact: "You lose fine-grained control. Your site might be weaponized in open datasets without your explicit consent or economic benefit. Allowing specific AI agents is key to participating in Answer Engines without exposing full raw data.",
            example: "Strategically block Training data scraping while allowing real-time Search representation: <br><code>User-agent: GPTBot<br>Disallow: /<br><br>User-agent: OAI-SearchBot<br>Allow: /</code>"
        })
    },
    sitemap: {
        name: "sitemap.xml",
        spec: "https://www.sitemaps.org/protocol.html",
        prompt: "Please generate a `sitemap.xml` for my project if it doesn't exist, and ensure my `/robots.txt` includes a `Sitemap: <url>` directive pointing to it. The sitemap should follow standard XML schema and list all important public pages.",
        tooltip: formatTooltip({
            what: "An XML file that lists URLs for a site along with additional metadata about each URL.",
            why: "It allows AI search bots (like SearchGPT and Perplexity) and traditional search engines to discover your content efficiently without having to guess paths or follow every link blindly.",
            impact: "AI crawlers might miss critical new or updated content on your platform, significantly reducing your visibility in AI-generated answers and search results.",
            example: "Host a <code>/sitemap.xml</code> and add <code>Sitemap: https://yourdomain.com/sitemap.xml</code> to your <code>robots.txt</code>."
        })
    }
};

/**
 * Metadata for Content Accessibility and Semantic Markup checks.
 */
export const contentMetadata = {
    markdown: {
        name: "Content Neg. (MD)",
        spec: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Content_negotiation",
        prompt: "Please analyze my server's routing or middleware logic. If content negotiation exists, update it; otherwise, implement it. When a client request includes the header `Accept: text/markdown`, the server should dynamically return clean Markdown instead of an HTML page. Please provide the necessary code for my backend framework (e.g., Express, Next.js, Cloudflare Workers).",
        tooltip: formatTooltip({
            what: "Dynamic content routing. When a bot sends <code>Accept: text/markdown</code>, the server returns clean Markdown instead of full HTML.",
            why: "LLMs process text tokens. Forcing an LLM to read a complex HTML DOM drastically inflates the 'noise', eating up prompt context limits and increasing latency.",
            impact: "Data extraction becomes fragile. Your website remains a 'human-first' application that breaks agent logic when CSS classes and div nested structures get in the way of semantic information.",
            example: "Utilize Cloudflare Workers, Nginx proxies, or Next.js middleware to sniff for <code>Accept: text/markdown</code> in the request header and return parsed Markdown text instantly without any styling wraps."
        })
    },
    signal: {
        name: "Content-Signal",
        spec: "https://contentsignals.org/",
        prompt: `Please analyze my server configuration or application middleware. If a \`Content-Signal\` response header is already set, update it; otherwise, implement logic to add it. This header explicitly declares AI scraping and training policies.
                Example header to add to responses:
                \`Content-Signal: ai-train=no, search=yes\``,
        tooltip: formatTooltip({
            what: "An explicit HTTP Header signaling legal and policy usage metadata for machine consumers.",
            why: "It informs scraping bots at the network level whether your content is free for LLM training, requires attribution, or is completely restricted copyright.",
            impact: "Machine agents assume 'fair game' for all scraped data. Without signal compliance, you have no technical ground to prevent proprietary data from becoming automated training fodder.",
            example: "Ensure your server responses (especially for content heavy pages) include the header: <code>Content-Signal: ai-train=no, search=yes</code> to explicitly block big tech from stealing IP for training while retaining search indexing."
        })
    },
    jsonld: {
        name: "Semantic JSON-LD",
        spec: "https://schema.org/docs/documents.html",
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
        tooltip: formatTooltip({
            what: "Schema.org JSON-LD semantic markup.",
            why: "AI agents and answer engines use this invisible structured data to deeply understand what your page is actually about, what entities it describes (like products, organizations, or articles), and how they relate to each other.",
            impact: "The AI will have to \"guess\" the context of your page from raw text, increasing hallucinations and decreasing the chance your business is accurately categorized in AI search results.",
            example: "Add a JSON-LD script block defining your core entity, such as <code>@type: \"Organization\"</code> or <code>@type: \"WebSite\"</code>."
        })
    }
};

/**
 * List of Well-Known files and protocols to be audited for AI readiness.
 */
export const wellKnownFiles = [
    {
        name: "A2A Agent Card",
        path: '/.well-known/agent-card.json',
        spec: 'https://a2a-protocol.org/latest/specification/',
        isJson: true,
        points: 10,
        prompt: formatPrompt({
            path: '/.well-known/agent-card.json',
            description: "It must follow the A2A protocol specification. Add a JSON structure detailing my application's capabilities, endpoint routes, and OAuth 2.0 authorization rules.",
            example: `{
  "agent_id": "my-app-id",
  "version": "1.0.0",
  "capabilities": ["search", "read"],
  "oauth2": {
    "authorization_endpoint": "https://example.com/oauth/authorize",
    "token_endpoint": "https://example.com/oauth/token"
  }
}`
        }),
        tooltip: formatTooltip({
            what: "Expected at <code>/.well-known/agent-card.json</code>, this is the standard Agent-to-Agent (A2A) protocol entry point.",
            why: "It details exactly what your application is capable of doing from a machine's perspective, listing supported actions and state schemas.",
            impact: "Other autonomous agents cannot dynamically negotiate data exchanges with your platform, isolating you from the agentic economy. You lose machine-to-machine traffic.",
            example: "Publish a JSON file containing your agent's name, capabilities (Skills), endpoints, and OAuth 2.0 authorization rules."
        })
    },
    {
        name: "API Catalog",
        path: '/.well-known/api-catalog',
        spec: 'https://www.rfc-editor.org/rfc/rfc9727.txt',
        isJson: false,
        points: 5,
        prompt: formatPrompt({
            path: '/.well-known/api-catalog',
            description: "It should be formatted as an RFC 9727 HTTP API Catalog linking to my OpenAPI or Swagger documentation.",
            exampleFormat: 'http',
            example: 'Link: <https://example.com/openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json;version=3.0"'
        }),
        tooltip: formatTooltip({
            what: "RFC 9727 HTTP API Catalog.",
            why: "It standardizes where autonomous systems can find machine-readable descriptions (like OpenAPI/Swagger) of your APIs.",
            impact: "LLMs won't be able to map out your API endpoints natively. If an agent wants to extract specific business data or trigger an action, it will fail to 'understand' how to structure the HTTP requests, reducing integrations to zero.",
            example: "Create a <code>/.well-known/api-catalog</code> that points to your public <code>openapi.json</code> or Swagger documentation so models instantly learn your exact HTTP request structures."
        })
    },
    {
        name: "Agent Skills",
        path: '/.well-known/agent-skills/index.json',
        spec: 'https://agentskills.io/home',
        isJson: true,
        points: 10,
        prompt: formatPrompt({
            path: '/.well-known/agent-skills/index.json',
            description: "It must map my REST endpoints to actionable AI skills.",
            example: `{
  "skills": [
    {
      "name": "SearchDocs",
      "description": "Searches the documentation",
      "endpoint": "/api/search",
      "method": "GET"
    }
  ]
}`
        }),
        tooltip: formatTooltip({
            what: "A specialized index documenting actionable machine-skills (e.g. \"BuyItem\", \"SearchDocs\").",
            why: "It abstracts complex APIs into simple semantic 'skills' that an LLM brain can invoke.",
            impact: "AI Assistants (like custom GPTs) will not be able to execute any high-level workflows on your platform, severely reducing the business automation capabilities for end-users.",
            example: "Map complex REST endpoints into clean, actionable concepts like <code>FindFlight</code> or <code>CancelOrder</code> under <code>/.well-known/agent-skills/index.json</code>."
        })
    },
    {
        name: "MCP Server",
        path: '/.well-known/mcp/server-card.json',
        spec: 'https://modelcontextprotocol.io/',
        isJson: true,
        points: 10,
        prompt: formatPrompt({
            path: '/.well-known/mcp/server-card.json',
            description: "It must expose a Model Context Protocol (MCP) server manifest.",
            example: `{
  "mcp_version": "1.0",
  "server": {
    "url": "https://example.com/mcp/sse",
    "features": ["resources", "tools"]
  }
}`
        }),
        tooltip: formatTooltip({
            what: "The Model Context Protocol (MCP) is like a 'USB-C cable for AI'. Instead of forcing AI to scrape HTML or figure out REST APIs, you host an MCP Server that streams data directly to agents via SSE (Server-Sent Events).",
            why: "It allows your platform to expose its core functions as <em>Resources</em>, <em>Tools</em>, and <em>Prompts</em> natively to AI ecosystems like Claude Desktop or Cursor.",
            impact: "Your platform remains isolated in the \"human-only\" web. Agents will not be able to securely read user data or take actions securely within their native AI workflows.",
            example: "Deploy a Remote MCP Server on your infrastructure (e.g., at <code>/mcp/sse</code>) that exposes your business logic as callable Tools. Add a discovery manifest at <code>/.well-known/mcp/server-card.json</code> so agents can automatically find and connect to it."
        })
    },
    {
        name: "OAuth Discovery",
        path: '/.well-known/oauth-authorization-server',
        spec: 'https://www.rfc-editor.org/rfc/rfc8414.txt',
        isJson: true,
        points: 5,
        prompt: formatPrompt({
            path: '/.well-known/oauth-authorization-server',
            description: "It must provide OAuth 2.0 discovery metadata compliant with RFC 8414.",
            example: `{
  "issuer": "https://example.com",
  "authorization_endpoint": "https://example.com/oauth/authorize",
  "token_endpoint": "https://example.com/oauth/token",
  "scopes_supported": ["read", "write"]
}`
        }),
        tooltip: formatTooltip({
            what: "RFC 8414 standard for OAuth 2.0 discovery.",
            why: "Allows agents to understand exactly how to authenticate, which scopes are available, and where token endpoints live.",
            impact: "Agents will be completely blocked out of secure/private areas of your platform. They cannot dynamically request user consent to perform actions on their behalf.",
            example: "Serve metadata at <code>/.well-known/oauth-authorization-server</code> highlighting your issuer URI and token endpoints so LLM apps can securely acquire human user consent."
        })
    },
    {
        name: "AI Plugin",
        path: '/.well-known/ai-plugin.json',
        spec: 'https://projects.laion.ai/Open-Assistant/docs/plugins/details',
        isJson: true,
        points: 10,
        prompt: formatPrompt({
            path: '/.well-known/ai-plugin.json',
            description: "It should define an AI Plugin manifest with detailed instructions for LLMs.",
            example: `{
  "schema_version": "v1",
  "name_for_human": "My App",
  "name_for_model": "my_app",
  "description_for_model": "Use this plugin to query my app's data.",
  "api": {
    "type": "openapi",
    "url": "https://example.com/openapi.yaml"
  }
}`
        }),
        tooltip: formatTooltip({
            what: "Originally introduced by OpenAI, this is the standard manifesto that turns your website's REST API into an AI \"Plugin\" or \"Action\" for consumer LLM chats.",
            why: "When users chat with ChatGPT or Copilot, the AI needs to know exactly what your API does to decide when to call it. This file provides the \"natural language\" metadata and authentication rules connecting the LLM to your OpenAPI schema.",
            impact: "You cannot create Custom GPTs or Copilot extensions that natively interact with your platform. The AI will not know how to discover your API endpoints.",
            example: "Host a file at <code>/.well-known/ai-plugin.json</code>. Inside, provide a <code>name_for_human</code>, a highly detailed <code>description_for_model</code> (telling the AI explicitly when and how to use it), and a link to your <code>openapi.yaml</code> spec."
        })
    },
    {
        name: "Universal Commerce",
        path: '/.well-known/ucp',
        spec: 'http://ucp.dev/',
        isJson: true,
        points: 5,
        prompt: formatPrompt({
            path: '/.well-known/ucp',
            description: "It should contain a Universal Commerce Protocol (UCP) configuration pointing to my headless commerce API.",
            example: `{
  "ucp_version": "1.0",
  "checkout_url": "https://example.com/checkout",
  "inventory_url": "https://example.com/inventory"
}`
        }),
        tooltip: formatTooltip({
            what: "Protocol specifically designed for agent-based e-commerce operations.",
            why: "It formats product data, checkout flows, and inventory constraints transparently for AI shopping agents.",
            impact: "If your site sells goods or services, AI purchasing agents will not be able to seamlessly 'click' through your funnel or verify prices, losing you fully automated AI-driven revenue.",
            example: "Place a configuration at <code>/.well-known/ucp</code> pointing agents to your headless commerce endpoints, allowing autonomous bots to load shopping carts."
        })
    },
    {
        name: "LLMs.txt",
        path: '/llms.txt',
        spec: 'https://llmstxt.org/',
        isJson: false,
        points: 10,
        prompt: formatPrompt({
            path: '/llms.txt',
            description: "It must provide a clean Markdown map of my technical docs.",
            exampleFormat: 'markdown',
            example: `# My App Docs
> A summary of the application.

- [Getting Started](https://example.com/docs/start.md)
- [API Reference](https://example.com/docs/api.md)`
        }),
        tooltip: formatTooltip({
            what: "A navigation manifesto designed specifically for Large Language Models.",
            why: "It provides a clean, markdown-based table of contents of your documentation, sidestepping heavy UI routing.",
            impact: "Models trying to understand your platform's documentation will hallucinate or get stuck traversing endless JS-heavy web pages. Giving them an explicit map drastically improves AI response accuracy regarding your product.",
            example: "Add <code>/llms.txt</code> to your root. Formatting: an H1 Title, a summary quote box, and a clean Markdown list of links pointing to raw <code>.md</code> technical docs."
        })
    },
    {
        name: "LLMs-Full.txt",
        path: '/llms-full.txt',
        spec: 'https://llmstxt.org/',
        isJson: false,
        points: 10,
        prompt: formatPrompt({
            path: '/llms-full.txt',
            description: "It should provide a comprehensive, concatenated Markdown version of all my primary technical documentation.",
            exampleFormat: 'markdown',
            example: `# My App Docs Full
> A comprehensive guide to the application.

## Getting Started
To install the application...

## API Reference
### \`GET /api/users\`
Returns a list of users...`
        }),
        tooltip: formatTooltip({
            what: "A complete, machine-readable export of your entire documentation in structured Markdown format.",
            why: "It provides LLMs and agents with all context in a single file, eliminating the need for multiple API calls or web scraping.",
            impact: "AI systems might miss critical details if they only read summaries or have to navigate multiple links, increasing the chance of hallucinations and degraded agentic capabilities.",
            example: "Add <code>/llms-full.txt</code> to your root. Include all relevant documentation content (e.g., tutorials, API references, code samples) concatenated in clear, structured Markdown."
        })
    },
    {
        name: "TDM Reservation",
        path: '/.well-known/tdmrep.json',
        spec: 'https://www.w3.org/community/reports/tdmrep/CG-FINAL-tdmrep-20240510/',
        isJson: true,
        points: 5,
        prompt: formatPrompt({
            path: '/.well-known/tdmrep.json',
            description: "It should implement the TDM Reservation Protocol to express my Text and Data Mining (TDM) rights for AI scraping and training. You must also create the \`/policies/tdm-policy.json\` file referenced in the \`tdm-policy\` field if it does not already exist.",
            example: `{
  "tdm-reservation": 1,
  "tdm-policy": "https://ai-valid.secmy.app/policies/tdm-policy.json"
}`
        }),
        tooltip: formatTooltip({
            what: "The W3C Text and Data Mining (TDM) Reservation Protocol.",
            why: "It provides a machine-readable way to formally opt-out of or set policies for AI model training and automated scraping, which is critical for compliance with the EU CDSM Directive Article 4.",
            impact: "AI crawlers and scrapers may assume they have the right to scrape your data for model training purposes. You lack a standardized mechanism to declare your copyright reservation.",
            example: "Host a JSON file at <code>/.well-known/tdmrep.json</code> with a <code>tdm-reservation</code> flag and an optional link to your licensing policy."
        })
    },
    {
        name: "ai.txt",
        path: '/ai.txt',
        spec: 'https://site.spawning.ai/spawning-ai-txt',
        isJson: false,
        points: 5,
        prompt: formatPrompt({
            path: '/ai.txt',
            description: "It should define permissions for AI data mining and scraping, following the Spawning.ai format.",
            exampleFormat: 'text',
            example: `# ai.txt — Spawning format
# Declares TDM permissions per EU CDSM Article 4

User-Agent: GPTBot
Disallow: /`
        }),
        tooltip: formatTooltip({
            what: "A plain text file declaring your website's policies for AI system interaction, such as permissions for AI data mining and model training, following the Spawning format.",
            why: "It adheres to the EU's Digital Single Market TDM Article 4 exception by providing a machine-readable opt-out targeted at commercial AI model training.",
            impact: "AI crawlers and data scrapers may assume they have full permission to scrape and use your content for commercial AI model training.",
            example: "Host a file at <code>/ai.txt</code> with explicit bot directives: <br><code>User-Agent: GPTBot<br>Disallow: /</code>"
        })
    }
];
