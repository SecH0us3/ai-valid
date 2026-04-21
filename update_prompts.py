import re

prompts = {
    "A2A Agent Card": """Please check if `/.well-known/agent-card.json` exists in my project. If it does, update it; otherwise, create it. It must follow the A2A protocol specification. Add a JSON structure detailing my application's capabilities, endpoint routes, and OAuth 2.0 authorization rules. 
Example structure:
```json
{
  "agent_id": "my-app-id",
  "version": "1.0.0",
  "capabilities": ["search", "read"],
  "oauth2": {
    "authorization_endpoint": "https://example.com/oauth/authorize",
    "token_endpoint": "https://example.com/oauth/token"
  }
}
```""",
    "API Catalog": """Please check if `/.well-known/api-catalog` exists in my project. If it does, modify it; otherwise, create it. It should be formatted as an RFC 9727 HTTP API Catalog linking to my OpenAPI or Swagger documentation. 
Example content:
```http
Link: <https://example.com/openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json;version=3.0"
```""",
    "Agent Skills": """Please check if `/.well-known/agent-skills/index.json` exists. If it exists, update it; if not, create it. It must map my REST endpoints to actionable AI skills. 
Example structure:
```json
{
  "skills": [
    {
      "name": "SearchDocs",
      "description": "Searches the documentation",
      "endpoint": "/api/search",
      "method": "GET"
    }
  ]
}
```""",
    "MCP Server": """Please check if `/.well-known/mcp/server-card.json` exists. If it exists, update it; otherwise, create it. It must expose a Model Context Protocol (MCP) server manifest. 
Example content:
```json
{
  "mcp_version": "1.0",
  "server": {
    "url": "https://example.com/mcp/sse",
    "features": ["resources", "tools"]
  }
}
```""",
    "OAuth Discovery": """Please check if `/.well-known/oauth-authorization-server` exists. If it exists, update it; otherwise, create it. It must provide OAuth 2.0 discovery metadata compliant with RFC 8414. 
Example:
```json
{
  "issuer": "https://example.com",
  "authorization_endpoint": "https://example.com/oauth/authorize",
  "token_endpoint": "https://example.com/oauth/token",
  "scopes_supported": ["read", "write"]
}
```""",
    "AI Plugin": """Please check if `/.well-known/ai-plugin.json` exists. If it exists, update it; otherwise, create it. It should define an AI Plugin manifest with detailed instructions for LLMs. 
Example:
```json
{
  "schema_version": "v1",
  "name_for_human": "My App",
  "name_for_model": "my_app",
  "description_for_model": "Use this plugin to query my app's data.",
  "api": {
    "type": "openapi",
    "url": "https://example.com/openapi.yaml"
  }
}
```""",
    "Universal Commerce": """Please check if `/.well-known/ucp` exists. If it exists, update it; otherwise, create it. It should contain a Universal Commerce Protocol (UCP) configuration pointing to my headless commerce API. 
Example:
```json
{
  "ucp_version": "1.0",
  "checkout_url": "https://example.com/checkout",
  "inventory_url": "https://example.com/inventory"
}
```""",
    "LLMs.txt": """Please check if `/llms.txt` exists in my project root. If it exists, update it; otherwise, create it. It must provide a clean Markdown map of my technical docs. 
Example format:
```markdown
# My App Docs
> A summary of the application.

- [Getting Started](https://example.com/docs/start.md)
- [API Reference](https://example.com/docs/api.md)
```""",
    "robots.txt": """Please check if `/robots.txt` exists. If it exists, modify it; otherwise, create it. Add explicit bot designations to allow OAI-SearchBot while setting standard rules for web crawlers. 
Example:
```text
User-agent: *
Allow: /

User-agent: OAI-SearchBot
Allow: /
```""",
    "AI Directives": """Please check if `/robots.txt` exists. If it exists, update it; otherwise, create it. Add explicit directives to strategically manage generative AI scraping. Allow search bots while disallowing training data scrapers. 
Example:
```text
User-agent: GPTBot
Disallow: /

User-agent: OAI-SearchBot
Allow: /
```""",
    "Content Neg. (MD)": """Please analyze my server's routing or middleware logic. If content negotiation exists, update it; otherwise, implement it. When a client request includes the header `Accept: text/markdown`, the server should dynamically return clean Markdown instead of an HTML page. Please provide the necessary code for my backend framework (e.g., Express, Next.js, Cloudflare Workers).""",
    "Content-Signal": """Please analyze my server configuration or application middleware. If a `Content-Signal` response header is already set, update it; otherwise, implement logic to add it. This header explicitly declares AI scraping and training policies. 
Example header to add to responses: 
`Content-Signal: ai-train=no, search=yes`"""
}

with open("ai-valid/src/index.js", "r") as f:
    content = f.read()

for name, prompt in prompts.items():
    # regex match exactly the old prompt property
    # We'll replace the prompt value inside
    # Since we used backticks before, we can match prompt: `...`
    pattern = rf'name:\s*[\'"]{re.escape(name)}[\'"],\s*prompt:\s*`.*?`,'
    
    escaped_prompt = prompt.replace('`', '\\`').replace('$', '\\$')
    
    # Check if pattern is found
    if re.search(pattern, content, re.DOTALL):
        content = re.sub(pattern, f'name: "{name}",\n                    prompt: `{escaped_prompt}`,', content, flags=re.DOTALL)
    else:
        # Fallback if pattern matching fails due to some spacing differences
        # Find where name is defined
        name_pattern = rf'name:\s*[\'"]{re.escape(name)}[\'"],'
        if re.search(name_pattern, content):
            # This shouldn't happen since we already have prompt: `...` but just in case
            pass

with open("ai-valid/src/index.js", "w") as f:
    f.write(content)
