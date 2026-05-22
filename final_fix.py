import re

with open("ai-valid/src/index.js", "r") as f:
    content = f.read()

# We need to find template literals that contain unescaped triple backticks
# and escape them.
# Triple backticks are usually part of markdown blocks within the prompt.

def escape_triple_backticks(match):
    prompt_content = match.group(2)
    # Escape backticks if not already escaped
    # We use a negative lookbehind in regex to avoid double escaping,
    # but python's re doesn't support variable length lookbehind.
    # So we do a simple replacement and then fix double escapes.
    fixed_content = prompt_content.replace('`', '\\`').replace('\\\\`', '\\`')
    return f"{match.group(1)}{fixed_content}{match.group(3)}"

# Match prompt: `...` where it might have multiple lines and unescaped backticks
# We use a non-greedy match but we have to be careful about what defines the end.
# Usually it's followed by a comma and the next property.
pattern = re.compile(r'(prompt:\s*`)(.*?)(\`,\s*(?:path|spec|isJson|points|tooltip|status|message|code|results))', re.DOTALL)

content = pattern.sub(escape_triple_backticks, content)

with open("ai-valid/src/index.js", "w") as f:
    f.write(content)
