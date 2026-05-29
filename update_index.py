import re

with open("ai-valid/src/index.js", "r") as f:
    content = f.read()

# PROMPTS DEFINITION
prompts = {
    "A2A Agent Card": "Write a JSON file named agent-card.json that follows the A2A protocol specification. It should list my application's capabilities, endpoints, and OAuth 2.0 authorization rules. Please provide the file content and tell me to place it in /.well-known/agent-card.json.",
    "API Catalog": "Create an RFC 9727 HTTP API Catalog file at /.well-known/api-catalog that points to my OpenAPI/Swagger documentation.",
    "Agent Skills": "Create an Agent Skills index file at /.well-known/agent-skills/index.json that maps my complex REST endpoints into actionable skills for an AI agent.",
    "MCP Server": "Create a Model Context Protocol (MCP) server manifest at /.well-known/mcp/server-card.json that exposes my application's core functions as tools.",
    "OAuth Discovery": "Create an OAuth 2.0 discovery metadata file at /.well-known/oauth-authorization-server following RFC 8414.",
    "AI Plugin": "Create an AI Plugin manifest at /.well-known/ai-plugin.json with a description_for_model and a link to my OpenAPI schema.",
    "Universal Commerce": "Create a Universal Commerce Protocol (UCP) configuration at /.well-known/ucp pointing to my headless commerce endpoints.",
    "LLMs.txt": "Create an llms.txt file for my root directory containing an H1 title, a summary quote box, and a Markdown list of links to my technical documentation.",
    "robots.txt": "Create or update my robots.txt file to explicitly allow OAI-SearchBot and other relevant AI bots while setting standard rules for web crawlers.",
    "AI Directives": "Update my robots.txt to strategically manage AI crawlers, explicitly allowing OAI-SearchBot for search representation while disallowing GPTBot from scraping for training data.",
    "Content Neg. (MD)": "Implement content negotiation in my server so that when a client sends an 'Accept: text/markdown' header, it returns the page content in clean Markdown instead of HTML.",
    "Content-Signal": "Add a 'Content-Signal' HTTP response header to my server responses (e.g., Content-Signal: ai-train=no, search=yes) to explicitly declare usage policies for AI scraping and training."
}

# 1. FIX KNOWN CORRUPTIONS (cleanup before optimization)
# This removes the extra junk that was causing "Expected '}' but found 'server'"
content = re.sub(
    r"prompt: `Implement content negotiation in my server so that when a client sends an 'Accept: text/markdown' header, it returns the page content in clean Markdown instead of HTML.`, the server.*?Workers\).`,",
    "prompt: `REPLACEME`,",
    content, flags=re.DOTALL
)

# 2. OPTIMIZATION & IDEMPOTENCY
names_pattern = "|".join(map(re.escape, prompts.keys()))
pattern = re.compile(rf'(name:\s*(["\'])({names_pattern})\2,)(?:\s*prompt:\s*`.*?`,)?', re.DOTALL)

def replacer(match):
    name = match.group(3)
    prompt_text = prompts[name]
    safe_prompt = prompt_text.replace('`', '\\`').replace('$', '\\$')

    if name in ["robots.txt", "AI Directives", "Content Neg. (MD)", "Content-Signal"]:
        return f'name: "{name}",\n                    prompt: `{safe_prompt}`,'
    else:
        return f"name: '{name}', prompt: `{safe_prompt}`,"

content = pattern.sub(replacer, content)

# 3. SCHEMA UPDATE
if "prompt: data.prompt," not in content:
    content = content.replace(
        "return { name: data.name, path: data.path, spec: data.spec, tooltip: data.tooltip, status, message, code };",
        "return { name: data.name, path: data.path, spec: data.spec, tooltip: data.tooltip, prompt: data.prompt, status, message, code };"
    )

# 4. FIX PRE-EXISTING ERRORS in ai.txt / tdmrep.json
content = content.replace("User-Agent: GPTBot\nDisallow: /\n```, path: '/ai.txt'", "User-Agent: GPTBot\\nDisallow: /\\n\\`\\`\\``, path: '/ai.txt'")
content = content.replace("  \"tdm-policy\": \"https://ai-valid.secmy.app/policies/tdm-policy.json\"\n}\n```, path: '/.well-known/tdmrep.json'", "  \"tdm-policy\": \"https://ai-valid.secmy.app/policies/tdm-policy.json\"\\n}\\n\\`\\`\\``, path: '/.well-known/tdmrep.json'")

with open("ai-valid/src/index.js", "w") as f:
    f.write(content)
