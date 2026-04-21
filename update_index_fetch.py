import re

with open("ai-valid/src/index.js", "r") as f:
    content = f.read()

# 1. Extract handleRequest
handle_request_body = re.search(r'export default \{\s*async fetch\(request, env, ctx\) \{(.*?)\s*\}\s*^\};', content, re.MULTILINE | re.DOTALL)
if not handle_request_body:
    print("Could not find fetch body")
    exit(1)

body = handle_request_body.group(1)

new_export = """export default {
    async fetch(request, env, ctx) {
        return await handleRequest(request, env, ctx);
    }
};

async function handleRequest(request, env, ctx) {""" + body + "\n}"

content = content.replace(handle_request_body.group(0), new_export)

# 2. Update performAudit call
content = content.replace("const result = await performAudit(targetUrl);", "const result = await performAudit(targetUrl, url.origin, env, ctx);")

# 3. Update performAudit signature
content = content.replace("async function performAudit(baseUrl) {", "async function performAudit(baseUrl, requestOrigin, env, ctx) {")

# 4. Add internalFetch
internal_fetch = """    let totalScore = 0;

    const internalFetch = async (url, options = {}) => {
        if (base === requestOrigin) {
            const req = new Request(url, options);
            return await handleRequest(req, env, ctx);
        }
        return await fetch(url, options);
    };"""
content = content.replace("    let totalScore = 0;", internal_fetch)

# 5. Replace fetch in performAudit
# Be careful not to replace `env.ASSETS.fetch` if any, just `await fetch(`
# We have `await fetch(`${base}/robots.txt``, `await fetch(base, {`, `await fetch(url, {`
content = content.replace("await fetch(`${base}/robots.txt`", "await internalFetch(`${base}/robots.txt`")
content = content.replace("await fetch(base, {", "await internalFetch(base, {")
content = content.replace("await fetch(url, {", "await internalFetch(url, {")

with open("ai-valid/src/index.js", "w") as f:
    f.write(content)

print("Updated index.js successfully.")
