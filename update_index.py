import re

with open("ai-valid/src/protocols.js", "r") as f:
    content = f.read()

# All prompts to be managed by this script
prompts = {
    "Robots.txt": "Create or update my robots.txt file to explicitly allow OAI-SearchBot and other relevant AI bots while setting standard rules for web crawlers.",
    "AI Directives": "Update my robots.txt to strategically manage AI crawlers, explicitly allowing OAI-SearchBot for search representation while disallowing GPTBot from scraping for training data.",
    "sitemap.xml": "Create a sitemap.xml and point to it in robots.txt.",
    "Content Neg. (MD)": "Implement content negotiation in my server so that when a client sends an 'Accept: text/markdown' header, it returns the page content in clean Markdown instead of HTML.",
    "Content-Signal": "Add a 'Content-Signal' HTTP response header to my server responses (e.g., Content-Signal: ai-train=no, search=yes) to explicitly declare usage policies for AI scraping and training.",
    "Semantic JSON-LD": "Implement appropriate Schema.org JSON-LD markup (like LocalBusiness or Organization) in my website HTML.",
    "Semantic Tags": "Ensure the main content of my HTML is wrapped in semantic HTML5 tags like <article> or <main> instead of generic <div> tags.",
    "Heading Structure": "Ensure my HTML content uses a logical heading hierarchy (H1, H2, H3) with at least one <h1> tag representing the main title.",
    "Mobile Viewport": "Add a valid viewport meta tag (e.g., <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">) to my HTML head to optimize the page for mobile devices.",
    
    "A2A Agent Card": "Write a JSON file named agent-card.json that follows the A2A protocol specification. It should list my application's capabilities, endpoints, and OAuth 2.0 authorization rules. Please provide the file content and tell me to place it in /.well-known/agent-card.json.",
    "API Catalog": "Create an RFC 9727 HTTP API Catalog file at /.well-known/api-catalog that points to my OpenAPI/Swagger documentation.",
    "Agent Skills": "Create an Agent Skills index file at /.well-known/agent-skills/index.json that maps my complex REST endpoints into actionable skills for an AI agent.",
    "MCP Server": "Create a Model Context Protocol (MCP) server manifest at /.well-known/mcp/server-card.json that exposes my application's core functions as tools.",
    "OAuth Discovery": "Create an OAuth 2.0 discovery metadata file at /.well-known/oauth-authorization-server following RFC 8414.",
    "AI Plugin": "Create an AI Plugin manifest at /.well-known/ai-plugin.json with a description_for_model and a link to my OpenAPI schema.",
    "Universal Commerce": "Create a Universal Commerce Protocol (UCP) configuration at /.well-known/ucp pointing to my headless commerce endpoints.",
    "LLMs.txt": "Create an llms.txt file for my root directory containing an H1 title, a summary quote box, and a Markdown list of links to my technical documentation.",
    "LLMs-Full.txt": "Create a comprehensive, concatenated Markdown version of all my primary technical documentation.",
    "TDM Reservation": "Implement the TDM Reservation Protocol at /.well-known/tdmrep.json and create /policies/tdm-policy.json to express my training rights.",
    "ai.txt": "Create an ai.txt file following the Spawning.ai format to declare AI permissions.",
    "security.txt": "Create an RFC 9116 security.txt file at /.well-known/security.txt with security contact and expiration details."
}

for name, new_prompt in prompts.items():
    pattern_desc = re.compile(
        rf'(name:\s*["\']{re.escape(name)}["\'][^}}]+?description:\s*)(["\'`])(?:(?!\2).|\\.)*?\2',
        re.DOTALL
    )
    pattern_prompt = re.compile(
        rf'(name:\s*["\']{re.escape(name)}["\'][^}}]+?prompt:\s*)(["\'`])(?:(?!\2).|\\.)*?\2',
        re.DOTALL
    )
    
    escaped_val = new_prompt.replace("'", "\\'").replace('"', '\\"')
    content = pattern_desc.sub(rf"\1'{escaped_val}'", content)
    content = pattern_prompt.sub(rf"\1'{escaped_val}'", content)

with open("ai-valid/src/protocols.js", "w") as f:
    f.write(content)
