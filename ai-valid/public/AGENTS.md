# AGENTS.md — AI-Valid Agent Guidelines

> Autonomous agent operating manual and integration rules for AI-Valid.

## Overview
AI-Valid is a web-based AI-Readiness and Generative Engine Optimization (GEO) audit platform. Autonomous AI agents can invoke our public endpoints to inspect websites, validate compliance with emerging machine protocols, and retrieve structured diagnostic reports.

## Core Capabilities
- **AI Audit**: Analyze websites for `robots.txt`, `llms.txt`, MCP server manifests, WebMCP widgets, Schema.org metadata, and RSS feeds.
- **Protocol Discovery**: Validate A2A, UCP, RFC 9727 API Catalog, RFC 8414 OAuth, and x402 payment configurations.

## API Integration for Agents
To perform an audit programmatically:
```http
GET /api/audit?targetUrl=https://example.com HTTP/1.1
Host: ai-valid.secmy.app
Accept: application/json
```

## Agent Operating Constraints & Guardrails
- **Rate Limiting**: Honor `Retry-After` headers and maintain polite request intervals (maximum 10 requests per minute per IP/identity).
- **Target URL Validation**: Ensure `targetUrl` parameter contains a valid HTTP or HTTPS scheme.
- **Content Negotiation**: Send `Accept: text/markdown` when requesting human-readable documentation summaries.
