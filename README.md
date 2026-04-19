# AI-Valid | AI Readiness Audit 🛡️

**AI-Valid** is a professional, high-fidelity auditing tool designed to evaluate how "AI-ready" your website or platform is. As the web transitions from human-only consumption to autonomous agent interaction, AI-Valid helps developers and business owners ensure their data is accessible, correctly signaled, and compatible with modern AI standards.

![AI-Valid Dashboard](public/favicon.svg)

## 🌟 Key Features

- **Semantic Protocol Discovery**: Automatically scans for `.well-known` manifests including MCP (Model Context Protocol), A2A Agent Cards, API Catalogs (RFC 9727), and AI Plugins.
- **Bot Accessibility Audit**: Validates `robots.txt` and explicit AI directives for `OAI-SearchBot`, `GPTBot`, and others.
- **Content Optimization**: Checks for Content Negotiation (Markdown support) and legal usage signals via `Content-Signal` headers.
- **Actionable Dashboard**: Results are categorized into **Passed**, **Warnings**, & **Action Required**, providing a clear implementation roadmap.
- **Dynamic UX**: Fast, parallel network scanning with a terminal-inspired reconnaissance interface.
- **Deep Linking**: Share audit results easily via persistent URL hashes.

## 🛠️ Technology Stack

- **Backend**: Cloudflare Workers (High-performance, global edge deployment).
- **Frontend**: Vanilla JavaScript (ES6+), Modern CSS (Glassmorphism), and Semantic HTML5.
- **Deployment**: Wrangler CLI.
- **Performance**: Zero external dependencies on the frontend for lightning-fast loads.

## 🚀 Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-update/)

### Installation
```bash
git clone git@github.com:SecH0us3/ai-valid.git
cd ai-valid/ai-valid
npm install
```

### Local Development
```bash
npx wrangler dev
```

### Deployment
```bash
npx wrangler deploy
```

## 📖 Specifications
AI-Valid audits against several emerging and established standards:
- [llms.txt](https://llmstxt.org/)
- [Model Context Protocol (MCP)](https://modelcontextprotocol.io/)
- [RFC 9727 (API Catalog)](https://www.rfc-editor.org/info/rfc9727)
- [Agent Skills](https://agentskills.io/)

---
Created by [SecH0us3](https://github.com/SecH0us3) ecosystem.
