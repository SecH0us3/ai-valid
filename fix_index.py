import re

with open("ai-valid/src/index.js", "r") as f:
    content = f.read()

# Fix the specific corruption for Content Neg. (MD)
content = re.sub(
    r'name: "Content Neg. (MD)",\s*prompt: `.*?`, the server should dynamically return clean Markdown instead of an HTML page. Please provide the necessary code for my backend framework \(e.g., Express, Next.js, Cloudflare Workers\).`,',
    'name: "Content Neg. (MD)",\n                    prompt: `Implement content negotiation in my server so that when a client sends an \'Accept: text/markdown\' header, it returns the page content in clean Markdown instead of HTML.`,',
    content, flags=re.DOTALL
)

# Fix ai.txt if not already fixed by sed
content = content.replace("```, path: '/ai.txt'", "\\`\\`\\`, path: '/ai.txt'")

with open("ai-valid/src/index.js", "w") as f:
    f.write(content)
