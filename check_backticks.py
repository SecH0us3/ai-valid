import re

with open("ai-valid/src/index.js", "r") as f:
    lines = f.readlines()

in_template = False
for i, line in enumerate(lines):
    # This is a bit naive but helpful
    # Count unescaped backticks
    unescaped = re.findall(r'(?<!\\)`', line)
    if unescaped:
        print(f"Line {i+1}: Found {len(unescaped)} unescaped backticks: {line.strip()}")
