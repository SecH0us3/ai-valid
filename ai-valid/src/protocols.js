/**
 * Centralized Protocol Definitions for AI Readiness Audit
 */

const formatTooltip = ({ what, why, impact, example }) => {
    return `<strong>What it is:</strong> ${what}<br/><br/><strong>Why it's critical:</strong> ${why}<br/><br/><strong>Impact of missing it:</strong> ${impact}<br/><br/><strong>Implementation Example:</strong> ${example}`;
};

const formatPrompt = ({ path, description, example, exampleFormat = 'json' }) => {
    return `Please check if \`${path}\` exists in my project. If it does, update it; otherwise, create it. ${description}
Example structure:
\`\`\`${exampleFormat}
${example}
\`\`\``;
};

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
        isJson: true,
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
