import htmlTemplate from '../public/index.html';
import cssContent from '../public/style.css';
import jsContent from '../public/app.client.js';
import faviconSvg from '../public/favicon.svg';
import ogImage from '../public/og-image.png';
import llmsTxt from '../public/llms.txt';
import openApiJson from '../public/openapi.json';
import apiCatalogTxt from '../public/api-catalog.txt';

import { performAudit } from './audit.js';

export default {
    async fetch(request, env, ctx) {
        return await handleRequest(request, env, ctx);
    }
};

async function handleRequest(request, env, ctx) {
        const url = new URL(request.url);
        
        // --- Static File Routing ---
        if (request.method === "GET") {
            if (url.pathname === "/") {
                const accept = request.headers.get("Accept") || "";
                if (accept.includes("text/markdown")) {
                    const mdContent = `# AI-Valid | AI Readiness Audit\n\nInstant analysis of your site's accessibility for intelligent agents, crawlers, and modern AI protocols.\n\n## API Usage\nSend a POST request to \`/api/audit\` with a JSON payload:\n\n\`\`\`bash\ncurl -X POST https://<your-worker-domain>/api/audit \\\n  -H "Content-Type: application/json" \\\n  -d '{"targetUrl":"https://example.com"}'\n\`\`\`\n`;
                    return new Response(mdContent, {
                        headers: { "Content-Type": "text/markdown; charset=utf-8" },
                    });
                }
                return new Response(htmlTemplate, {
                    headers: { "Content-Type": "text/html; charset=utf-8" },
                });
            }
            if (url.pathname === "/style.css") {
                return new Response(cssContent, {
                    headers: { "Content-Type": "text/css; charset=utf-8" },
                });
            }
            if (url.pathname === "/app.client.js") {
                return new Response(jsContent, {
                    headers: { "Content-Type": "application/javascript; charset=utf-8" },
                });
            }
            if (url.pathname === "/favicon.svg" || url.pathname === "/favicon.ico") {
                return new Response(faviconSvg, {
                    headers: { "Content-Type": "image/svg+xml" },
                });
            }
            if (url.pathname === "/og-image.png") {
                return new Response(ogImage, {
                    headers: { "Content-Type": "image/png" },
                });
            }
            if (url.pathname === "/llms.txt") {
                return new Response(llmsTxt, {
                    headers: { "Content-Type": "text/markdown; charset=utf-8" },
                });
            }
            if (url.pathname === "/openapi.json") {
                return new Response(openApiJson, {
                    headers: { "Content-Type": "application/json; charset=utf-8" },
                });
            }
            if (url.pathname === "/.well-known/api-catalog") {
                return new Response(apiCatalogTxt, {
                    headers: { "Content-Type": "text/plain; charset=utf-8" },
                });
            }
            if (url.pathname === "/.well-known/agent-skills/index.json") {
                const agentSkills = {
                    "skills": [
                        {
                            "name": "AuditPlatform",
                            "description": "Performs an AI readiness audit on a given URL. Validates protocols like llms.txt, API Catalogs, MCP, and AI bot accessibility.",
                            "endpoint": "/api/audit",
                            "method": "POST"
                        }
                    ]
                };
                return new Response(JSON.stringify(agentSkills, null, 2), {
                    headers: { "Content-Type": "application/json; charset=utf-8" },
                });
            }
        }

        // --- API Route ---
        if (request.method === "POST" && url.pathname === "/api/audit") {
            try {
                let body = await request.json();
                let targetUrl = body.targetUrl;
                
                if (!targetUrl || !targetUrl.startsWith('http')) {
                    return new Response(JSON.stringify({ error: "Invalid URL" }), { status: 400 });
                }

                // Domain existence check
                try {
                    const parsedUrl = new URL(targetUrl);
                    await fetch(parsedUrl.origin, { method: 'HEAD' });
                } catch (e) {
                    return new Response(JSON.stringify({ error: "Domain does not exist or is unreachable" }), { status: 400 });
                }

                const result = await performAudit(targetUrl, url.origin, env, ctx, handleRequest);
                return new Response(JSON.stringify(result), {
                    headers: { "Content-Type": "application/json" }
                });

            } catch(e) {
                return new Response(JSON.stringify({ error: e.message }), { status: 500 });
            }
        }

        return new Response("Not Found", { status: 404 });
}
