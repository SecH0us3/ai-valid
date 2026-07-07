# Enable Cloudflare Workers Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable Cloudflare Workers Cache in the AI-Valid project by configuring the Wrangler cache, caching static assets, and changing `/api/audit` to a cacheable GET endpoint with custom cache-control headers.

**Architecture:** Add standard Cloudflare cache configurations in wrangler.toml. Update routing logic in index.js to set appropriate Cache-Control headers for static assets (Varying on Accept for root route) and transition the audit endpoint to GET query-parameter parameters for cacheability. Update tests and client-side code to align with GET requests.

**Tech Stack:** Node.js, Wrangler, Vitest, JavaScript.

## Global Constraints
- Do not introduce external dependencies.
- Follow existing patterns in index.js and tests.
- Always use `rtk` prefix when proposing commands to run in the terminal.

---

### Task 1: Enable Cache in Wrangler Config and Verify Tests Run

**Files:**
- Modify: [wrangler.toml](file:///Users/alex/.gemini/antigravity/worktrees/agent-check/enable-cloudflare-workers-cache/ai-valid/wrangler.toml)

- [ ] **Step 1: Edit wrangler.toml**
  Add the cache block:
  ```toml
  [cache]
  enabled = true
  ```
- [ ] **Step 2: Run current tests to ensure nothing is broken**
  Run: `rtk npm test`
  Expected: All 37 tests pass.
- [ ] **Step 3: Commit**
  ```bash
  git add wrangler.toml
  git commit -m "config: enable cloudflare workers cache in wrangler.toml"
  ```

---

### Task 2: Update Static Route Cache Headers in index.js

**Files:**
- Modify: [src/index.js](file:///Users/alex/.gemini/antigravity/worktrees/agent-check/enable-cloudflare-workers-cache/ai-valid/src/index.js)

- [ ] **Step 1: Edit static route cache headers in index.js**
  Replace existing cache-control headers for static routes with `public, max-age=86400, stale-while-revalidate=604800`. Add `Vary: Accept` to the root `/` path.
  ```javascript
  const STATIC_ROUTES = {
      "/": (request) => {
          const accept = request.headers.get("Accept") || "";
          if (accept.includes("text/markdown")) {
              const mdContent = `# AI-Valid | AI Readiness Audit\n\n...`;
              return new Response(mdContent, {
                  headers: { 
                      "Content-Type": "text/markdown; charset=utf-8",
                      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
                      "Vary": "Accept"
                  },
              });
          }
          return new Response(htmlTemplate, {
              headers: { 
                  "Content-Type": "text/html; charset=utf-8",
                  "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
                  "Vary": "Accept"
              },
          });
      },
      "/style.css": () => new Response(cssContent, {
          headers: { 
              "Content-Type": "text/css; charset=utf-8",
              "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800"
          },
      }),
      "/app.client.js": () => new Response(jsContent, {
          headers: { 
              "Content-Type": "application/javascript; charset=utf-8",
              "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800"
          },
      }),
      "/favicon.svg": () => new Response(faviconSvg, {
          headers: { 
              "Content-Type": "image/svg+xml",
              "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800"
          },
      }),
      "/favicon.ico": () => new Response(faviconSvg, {
          headers: { 
              "Content-Type": "image/svg+xml",
              "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800"
          },
      }),
      "/og-image.png": () => new Response(ogImage, {
          headers: { 
              "Content-Type": "image/png",
              "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800"
          },
      }),
      "/llms-full.txt": () => new Response(llmsFullTxt, {
          headers: { 
              "Content-Type": "text/markdown; charset=utf-8",
              "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800"
          },
      }),
      "/llms.txt": () => new Response(llmsTxt, {
          headers: { 
              "Content-Type": "text/markdown; charset=utf-8",
              "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800"
          },
      }),
      "/openapi.json": () => new Response(openApiJson, {
          headers: { 
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800"
          },
      }),
      "/.well-known/api-catalog": () => new Response(apiCatalogTxt, {
          headers: { 
              "Content-Type": "text/plain; charset=utf-8",
              "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800"
          },
      }),
      "/.well-known/tdmrep.json": () => new Response(tdmrepJson, {
          headers: { 
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800"
          },
      }),
      "/policies/tdm-policy.json": () => new Response(tdmPolicyJson, {
          headers: { 
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800"
          },
      }),
      "/.well-known/agent-skills/index.json": () => {
          const agentSkills = {
              "skills": [
                  {
                      "name": "AuditPlatform",
                      "description": "Performs an AI readiness audit on a given URL. Validates protocols like llms.txt, API Catalogs, MCP, and AI bot accessibility.",
                      "endpoint": "/api/audit",
                      "method": "GET"
                  }
              ]
          };
          return new Response(JSON.stringify(agentSkills, null, 2), {
              headers: { 
                  "Content-Type": "application/json; charset=utf-8",
                  "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800"
              },
          });
      },
      "/.well-known/x402.json": () => {
          let content = "";
          if (typeof x402Json === 'object' && x402Json !== null) {
              content = JSON.stringify(x402Json, null, 2);
          } else if (typeof x402Json === 'string' && (x402Json.trim().startsWith('{') || x402Json.trim().startsWith('['))) {
              content = x402Json;
          }
          const body = content || JSON.stringify({
              x402Version: 2,
              endpoints: [
                  {
                      url: "/api/audit",
                      description: "AI-Readiness Audit Platform API",
                      amount: "0",
                      currency: "USDC",
                      network: "eip155:8453",
                      payTo: "0x0000000000000000000000000000000000000000"
                  }
              ]
          }, null, 2);
          return new Response(body, {
              headers: { 
                  "Content-Type": "application/json; charset=utf-8",
                  "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800"
              },
          });
      }
  };
  ```
- [ ] **Step 2: Add test assertions for Cache-Control headers in static routes**
  Modify: `tests/static-routes.test.js` to assert that responses contain `Cache-Control` header.
  ```javascript
  // For each test, assert:
  expect(res.headers.get('Cache-Control')).toBe('public, max-age=86400, stale-while-revalidate=604800');
  ```
  And for `/` path, also:
  ```javascript
  expect(res.headers.get('Vary')).toBe('Accept');
  ```
- [ ] **Step 3: Run static routes tests**
  Run: `rtk npm test tests/static-routes.test.js`
  Expected: PASS
- [ ] **Step 4: Commit**
  ```bash
  git add src/index.js tests/static-routes.test.js
  git commit -m "feat: add Cache-Control headers to static routes"
  ```

---

### Task 3: Convert /api/audit to GET in index.js with Cache Headers

**Files:**
- Modify: [src/index.js](file:///Users/alex/.gemini/antigravity/worktrees/agent-check/enable-cloudflare-workers-cache/ai-valid/src/index.js)

- [ ] **Step 1: Edit handleRequest in index.js to process GET for /api/audit**
  Replace `if (request.method === "POST" && url.pathname === "/api/audit")` block in `src/index.js:239-274`:
  ```javascript
          // --- API Route ---
          if (request.method === "GET" && url.pathname === "/api/audit") {
              try {
                  let targetUrl = url.searchParams.get("targetUrl");
                  
                  if (!targetUrl || !targetUrl.startsWith('http')) {
                      return new Response(JSON.stringify({ error: "Invalid URL" }), { 
                          status: 400,
                          headers: { "Content-Type": "application/json" }
                      });
                  }

                  // SSRF Protection
                  const safeUrl = await isSafeUrl(targetUrl);
                  if (!safeUrl) {
                      return new Response(JSON.stringify({ error: "Access to internal or restricted network resources is not allowed" }), { 
                          status: 403,
                          headers: { "Content-Type": "application/json" }
                      });
                  }

                  // Domain existence check
                  try {
                      const parsedUrl = new URL(targetUrl);
                      await internalFetch(parsedUrl.origin, { method: 'HEAD' }, parsedUrl.origin, url.origin, env, ctx);
                  } catch {
                      return new Response(JSON.stringify({ error: "Domain does not exist or is unreachable" }), { 
                          status: 400,
                          headers: { "Content-Type": "application/json" }
                      });
                  }

                  const result = await performAudit(targetUrl, url.origin, env, ctx);
                  return new Response(JSON.stringify(result), {
                      headers: { 
                          "Content-Type": "application/json",
                          "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400"
                      }
                  });

              } catch(e) {
                  console.error('Audit API Error:', e);
                  return new Response(JSON.stringify({ error: "Internal Server Error" }), {
                      status: 500,
                      headers: { "Content-Type": "application/json" }
                  });
              }
          }
  ```
- [ ] **Step 2: Commit intermediate index.js change**
  ```bash
  git add src/index.js
  git commit -m "feat: convert /api/audit to GET in worker with cache headers"
  ```

---

### Task 4: Update Client Frontend Fetch Code

**Files:**
- Modify: [public/app.client.js](file:///Users/alex/.gemini/antigravity/worktrees/agent-check/enable-cloudflare-workers-cache/ai-valid/public/app.client.js)

- [ ] **Step 1: Modify client fetch call in public/app.client.js**
  Replace POST request at `public/app.client.js:160-164`:
  ```javascript
              const res = await fetch(`/api/audit?targetUrl=${encodeURIComponent(targetUrl)}`, {
                  method: 'GET'
              });
  ```
- [ ] **Step 2: Commit client code change**
  ```bash
  git add public/app.client.js
  git commit -m "feat: update client fetch call to use GET for /api/audit"
  ```

---

### Task 5: Update Unit Tests to Target GET /api/audit

**Files:**
- Modify: [tests/index.test.js](file:///Users/alex/.gemini/antigravity/worktrees/agent-check/enable-cloudflare-workers-cache/ai-valid/tests/index.test.js)
- Modify: [tests/ssrf.test.js](file:///Users/alex/.gemini/antigravity/worktrees/agent-check/enable-cloudflare-workers-cache/ai-valid/tests/ssrf.test.js)

- [ ] **Step 1: Modify tests/index.test.js**
  Update `createRequest` and `/api/audit` endpoint test assertions:
  - Rewrite `createRequest`:
    ```javascript
        const createRequest = (params) => {
            const query = params && params.targetUrl !== undefined ? `?targetUrl=${encodeURIComponent(params.targetUrl)}` : '';
            return new Request(`https://localhost/api/audit${query}`, {
                method: 'GET'
            });
        };
    ```
  - Remove JSON parsing error test (lines 170-181).
  - Update `should return 404 for GET request to /api/audit` (lines 210-219) to `should return 404 for POST request to /api/audit`:
    ```javascript
        it('should return 404 for POST request to /api/audit', async () => {
            const req = new Request('https://localhost/api/audit', {
                method: 'POST'
            });
            const res = await index.fetch(req, env, ctx);

            expect(res.status).toBe(404);
            const text = await res.text();
            expect(text).toBe('Not Found');
        });
    ```
  - Verify that a success audit response contains the Cache-Control header:
    ```javascript
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600, stale-while-revalidate=86400');
    ```
- [ ] **Step 2: Modify tests/ssrf.test.js**
  Update `createRequest` helper:
  ```javascript
      const createRequest = (targetUrl) => {
          return new Request(`https://localhost/api/audit?targetUrl=${encodeURIComponent(targetUrl)}`, {
              method: 'GET'
          });
      };
  ```
- [ ] **Step 3: Run all unit tests**
  Run: `rtk npm test`
  Expected: All tests pass.
- [ ] **Step 4: Commit**
  ```bash
  git add tests/index.test.js tests/ssrf.test.js
  git commit -m "test: update API tests to verify GET endpoint and Cache-Control headers"
  ```
