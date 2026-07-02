# Design Spec: Cloudflare Smarter Search & Differentiated AI Bot Policies

## 1. Introduction & Objectives
Based on Cloudflare's "Making AI Search Smarter" and "Your site, your rules" initiatives (July 2026), search and agent models are evolving to reward publishers while reducing redundant bot crawling. This specification introduces auditing capabilities into **AI-Valid** to evaluate:
- **Crawler Hints & Caching Freshness**: Verifying that sites use headers (`ETag`, `Last-Modified`), support conditional GET requests (`304 Not Modified`), and utilize sitemap `<lastmod>` parameters.
- **Content-Use Preference**: Checking if sites define the new `use` parameter (`use=immediate`, `use=reference`, or `use=full`) in `Content-Signal` (either in HTTP headers or `robots.txt` directives).
- **Differentiated AI Crawler Directives**: Checking if sites distinguish between:
  1. **AI Search bots**: (e.g. `OAI-SearchBot`, `PerplexityBot`, `YouBot` - should be allowed for discovery/citations).
  2. **AI Agent bots**: (e.g. `ChatGPT-User` - should be allowed to run real-time tasks for users).
  3. **AI Training bots**: (e.g. `GPTBot`, `ClaudeBot`, `Google-Extended`, `Amazonbot`, `cohere-ai` - should be blocked to prevent scraping for foundation models without referral value).

---

## 2. Technical Details & Architecture

### A. Backend Audit Logic (`ai-valid/src/index.js`)

We will modify `performAudit(baseUrl, requestOrigin, env, ctx)` to add the following checks:

#### 1. Freshness & Caching Audits
- **Freshness Headers Check**:
  - Track if primary page response contains `ETag` or `Last-Modified`.
- **Conditional GET Validation (`304 Not Modified`)**:
  - If headers are present, perform a secondary probe fetch to `baseUrl` containing:
    - `If-None-Match: <etag_value>` (if ETag found)
    - `If-Modified-Since: <last_modified_value>` (if Last-Modified found)
  - Verify that the target server returns a `304` status code.
- **Sitemap `<lastmod>` Check**:
  - During the sitemap fetch, parse the XML content to check if `<lastmod>` tags exist for the URLs.

#### 2. Differentiated Bot Audit
We will deprecate the general `AI Directives` check and split it into four separate checks:
- **AI Search Allowed**:
  - Verify that `OAI-SearchBot`, `PerplexityBot`, and `YouBot` are allowed in `robots.txt`.
- **AI Agent Allowed**:
  - Verify that `ChatGPT-User` (representing user-directed real-time agents) is allowed in `robots.txt`.
- **AI Training Blocked**:
  - Verify that `GPTBot`, `ClaudeBot`, `Google-Extended`, `Amazonbot`, and `cohere-ai` are explicitly blocked (i.e. `Disallow: /`).
- **Differentiated Policy**:
  - Returns `'ok'` if AI Search and AI Agent are allowed, AND AI Training is blocked. Otherwise returns `'warn'`.

#### 3. Content-Signal & Content-Use Audit
- **Content-Signal Check**:
  - Check if the HTTP header `Content-Signal` is present, OR if a line starting with `Content-Signal:` is present in `robots.txt`.
  - Parse the parameters of `Content-Signal` (comma-separated keys like `search=yes`, `ai-train=no`, and the new `use=reference` / `use=immediate` / `use=full` parameter).
  - Award maximum points/status if the new `use` parameter is declared.

#### 4. Scoring Adjustments
We will adjust the scoring mapping to accommodate the new checks:
- **Conditional Requests (304)**: 10 points
- **Freshness Headers**: 5 points
- **Sitemap Lastmod**: 5 points
- **AI Search Allowed**: 10 points
- **AI Agent Allowed**: 10 points
- **AI Training Blocked**: 10 points
- **Differentiated Policy**: 10 points
- **Content-Signal**: 10 points
- **Content-Use Parameter**: 5 points

---

### B. Frontend / UI (`ai-valid/public/app.client.js`)

We will update the importance weights and register tooltips, specs, and copyable prompts for the new checks in the frontend client logic:

1. **Conditional Requests (304)**
   - **Tooltip**: Explains the value of returning a `304 Not Modified` response to save bandwidth and crawler CPU.
   - **Prompt**: "Configure my web server to support conditional GET requests by returning an HTTP 304 Not Modified response when the client sends valid If-None-Match or If-Modified-Since headers."
2. **Freshness Headers**
   - **Tooltip**: Explains `ETag` and `Last-Modified` headers.
   - **Prompt**: "Ensure my web server returns ETag and Last-Modified HTTP response headers for all dynamic and static pages."
3. **Sitemap Lastmod**
   - **Tooltip**: Explains why including `<lastmod>` in `sitemap.xml` is critical for crawler hints.
   - **Prompt**: "Update my sitemap generator to include the `<lastmod>` tag with the last modification date for each URL in my sitemap.xml."
4. **AI Search Allowed**
   - **Tooltip**: Explains why allowing Search crawlers like `OAI-SearchBot` and `PerplexityBot` is necessary for discoverability and citations.
   - **Prompt**: "Update my robots.txt to explicitly allow AI search agents like OAI-SearchBot, PerplexityBot, and YouBot."
5. **AI Agent Allowed**
   - **Tooltip**: Explains why allowing user-directed agents like `ChatGPT-User` is important to allow real-time tasks to run on behalf of users.
   - **Prompt**: "Update my robots.txt to explicitly allow user-directed AI agents like ChatGPT-User."
6. **AI Training Blocked**
   - **Tooltip**: Explains why blocking training bots like `GPTBot` and `ClaudeBot` protects intellectual property.
   - **Prompt**: "Update my robots.txt to disallow AI training and model scraping bots such as GPTBot, ClaudeBot, Google-Extended, and Amazonbot."
7. **Differentiated Policy**
   - **Tooltip**: Explains the recommended balanced approach of allowing search/agent discovery while blocking model training.
   - **Prompt**: "Configure a differentiated AI crawler policy in robots.txt that allows Search/Citation bots (e.g. OAI-SearchBot, PerplexityBot) and user-directed agents (e.g. ChatGPT-User) but blocks model training/scraping bots (e.g. GPTBot, ClaudeBot, Google-Extended)."
8. **Content-Use Parameter**
   - **Tooltip**: Explains the new `use` field in Content-Signal (e.g., `use=reference`, `use=immediate`, `use=full`) introduced by Cloudflare to govern how crawlers can use/reproduce content.
   - **Prompt**: "Extend my Content-Signal declaration in HTTP headers or robots.txt to include the content-use preference parameter (e.g., Content-Signal: search=yes,ai-train=no,use=reference)."

---

## 3. Test Plan & Verification

We will update the unit tests in `ai-valid/tests/index.test.js`:
- Mock the fetch calls to simulate:
  - Responses with/without `ETag` and `Last-Modified`.
  - Responses returning `304 Not Modified` when conditional headers are passed.
  - Sitemap responses with/without `<lastmod>` tags.
  - Different `robots.txt` patterns (allowing all, blocking all, differentiated policies, Content-Signal with `use=reference` parameter).
- Verify the score updates and the audit result object structure.
