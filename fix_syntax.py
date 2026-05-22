import re

with open("ai-valid/src/index.js", "r") as f:
    content = f.read()

# Fix unescaped backticks in prompts
# We match prompt: `...```, and replace it with prompt: `...\` \` \` `,
content = content.replace("```, path: '/ai.txt'", "\\`\\`\\`, path: '/ai.txt'")
content = content.replace("```, path: '/.well-known/tdmrep.json'", "\\`\\`\\`, path: '/.well-known/tdmrep.json'")

# Also check for any other unescaped triple backticks in prompts
content = re.sub(r'(`{3}), path:', r'\\`\\`\\`, path:', content)

with open("ai-valid/src/index.js", "w") as f:
    f.write(content)
