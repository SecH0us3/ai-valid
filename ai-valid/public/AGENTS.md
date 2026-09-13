# AGENTS.md — AI-Valid Agent Guidelines

> Operating manual for autonomous agents using AI-Valid to audit a website's AI readiness.

## Overview
AI-Valid audits how readable and actionable a website is for AI agents, crawlers and
generative search. It runs around 25 probes against a target origin and returns a weighted
readiness score, a per-category breakdown, every individual check, and a ranked list of the
fixes that would improve the score most.

## Two ways in

**MCP (preferred for agent runtimes).** A Model Context Protocol server speaking JSON-RPC 2.0
over streamable HTTP:

```
POST https://ai-valid.secmy.app/mcp
Content-Type: application/json

{"jsonrpc":"2.0","id":1,"method":"tools/list"}
```

Supported methods: `initialize`, `ping`, `tools/list`, `tools/call`. One tool, `audit_website`,
takes `targetUrl` (required) and `format` (`summary` or `full`). Discovery metadata lives at
`/.well-known/mcp/server-card.json`.

**HTTP API.**

```http
GET /api/audit?targetUrl=https://example.com HTTP/1.1
Host: ai-valid.secmy.app
Accept: application/json
```

Send `Accept: text/markdown` (or `?format=md`) for a Markdown report instead of JSON. The full
schema is at `/openapi.json`; the catalog entry is at `/.well-known/api-catalog`.

## Reading the result

- `score.total` is a percentage of the weight that was actually available, with `score.grade`
  as a letter. It is **not** a count of passing checks.
- `score.categories` breaks the same number down by area. The weakest category is where the
  remaining points are.
- `priorities` lists the highest-weight failures, most impactful first. Lead with these.
- Every check carries a `weight` and a `category`. A check marked `advisory: true` reports a
  **policy choice**, not a defect — whether to block AI training, for instance — and is excluded
  from the score in both directions. Do not present advisory checks as problems to fix.
- Each check carries a `prompt`: a remediation instruction already filled in with the audited
  origin and the specific finding. Use it rather than composing your own from the check name.

## Constraints and guardrails

- **Only public origins.** Targets resolving to private, loopback, link-local or CGNAT
  addresses are refused with 403. Do not attempt to work around this.
- **Rate limits.** Roughly 20 audits per minute per client. On 429, honour `Retry-After`.
- **Caching.** Repeat audits of the same origin are served from cache. Pass `bypassCache=true`
  only when you need a fresh scan; it costs the full round of probes.
- **One origin per call.** Paths in `targetUrl` are ignored; only the origin is audited.
- **Do not present the score as a verdict on site quality.** It measures machine readability,
  not usefulness, accuracy or design.
