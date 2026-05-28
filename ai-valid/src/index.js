import htmlTemplate from '../public/index.html';
import cssContent from '../public/style.css';
import jsContent from '../public/app.client.js';
import faviconSvg from '../public/favicon.svg';
import ogImage from '../public/og-image.png';
import llmsTxt from '../public/llms.txt';
import llmsFullTxt from '../public/llms-full.txt';
import openApiJson from '../public/openapi.json';
import tdmrepJson from "../public/.well-known/tdmrep.json";
import tdmPolicyJson from "../public/policies/tdm-policy.json";
import apiCatalogTxt from '../public/api-catalog.txt';
import { wellKnownFiles, botsMetadata, contentMetadata } from "./protocols.js";

const FETCH_TIMEOUT = 5000;
const STATIC_ROUTES = {
    "/": (request) => {
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
    },
    "/style.css": () => new Response(cssContent, {
        headers: { "Content-Type": "text/css; charset=utf-8" },
    }),
    "/app.client.js": () => new Response(jsContent, {
        headers: { "Content-Type": "application/javascript; charset=utf-8" },
    }),
    "/favicon.svg": () => new Response(faviconSvg, {
        headers: { "Content-Type": "image/svg+xml" },
    }),
    "/favicon.ico": () => new Response(faviconSvg, {
        headers: { "Content-Type": "image/svg+xml" },
    }),
    "/og-image.png": () => new Response(ogImage, {
        headers: { "Content-Type": "image/png" },
    }),
    "/llms-full.txt": () => new Response(llmsFullTxt, {
        headers: { "Content-Type": "text/markdown; charset=utf-8" },
    }),
    "/llms.txt": () => new Response(llmsTxt, {
        headers: { "Content-Type": "text/markdown; charset=utf-8" },
    }),
    "/openapi.json": () => new Response(openApiJson, {
        headers: { "Content-Type": "application/json; charset=utf-8" },
    }),
    "/.well-known/api-catalog": () => new Response(apiCatalogTxt, {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
    }),
    "/.well-known/tdmrep.json": () => new Response(tdmrepJson, {
        headers: { "Content-Type": "application/json; charset=utf-8" },
    }),
    "/policies/tdm-policy.json": () => new Response(tdmPolicyJson, {
        headers: { "Content-Type": "application/json; charset=utf-8" },
    }),
    "/.well-known/agent-skills/index.json": () => {
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
};

export default {
    async fetch(request, env, ctx) {
        return await handleRequest(request, env, ctx);
    }
};

async function internalFetch(url, options = {}, base, requestOrigin, env, ctx) {
    if (base === requestOrigin) {
        const req = new Request(url, options);
        return await handleRequest(req, env, ctx);
    }

    let currentUrl = url;
    let redirects = 0;

    while (redirects < 5) {
        let fetchUrl = currentUrl;
        const fetchOptions = {
            ...options,
            redirect: 'manual',
            signal: AbortSignal.timeout(FETCH_TIMEOUT)
        };

        const response = await fetch(fetchUrl, fetchOptions);

        if ([301, 302, 303, 307, 308].includes(response.status)) {
            redirects++;
            let location = response.headers.get('Location');
            if (!location) return response;

            const absoluteLocation = new URL(location, currentUrl).toString();
            currentUrl = absoluteLocation;

            // Re-validate new location
            const safety = await isSafeUrl(currentUrl);
            if (!safety.safe) {
                throw new Error("SSRF blocked during redirect");
            }
            continue;
        }
        return response;
    }
    throw new Error("Too many redirects");
}


function isPrivateIP(ip) {
    if (!ip) return false;
    ip = ip.replace(/^\[/, '').replace(/\]$/, '');

    // IPv4 check
    if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
        const parts = ip.split('.').map(p => parseInt(p, 10));
        if (parts[0] === 127) return true; // 127.0.0.0/8
        if (parts[0] === 10) return true;  // 10.0.0.0/8
        if (parts[0] === 172 && (parts[1] >= 16 && parts[1] <= 31)) return true; // 172.16.0.0/12
        if (parts[0] === 192 && parts[1] === 168) return true; // 192.168.0.0/16
        if (parts[0] === 169 && parts[1] === 254) return true; // 169.254.0.0/16
        if (parts[0] === 0) return true;   // 0.0.0.0/8
        if (parts[0] >= 224) return true;  // Multicast & Reserved
        return false;
    }

    if (ip.includes(':')) {
        ip = ip.split('%')[0];
        if (ip === '::1' || ip === '::' || ip === '::0' || ip === '0000:0000:0000:0000:0000:0000:0000:0001') return true;
        let fullIp = ip;
        if (fullIp.includes('::')) {
            const parts = fullIp.split('::');
            const left = parts[0] ? parts[0].split(':') : [];
            const right = parts[1] ? parts[1].split(':') : [];
            const missing = 8 - (left.length + right.length);
            const zeroes = new Array(missing).fill('0000');
            fullIp = [...left, ...zeroes, ...right].map(s => s.padStart(4, '0')).join(':').toLowerCase();
        } else {
            fullIp = fullIp.split(':').map(segment => segment.padStart(4, '0').toLowerCase()).join(':');
        }

        // fc00::/7 (Unique Local Address)
        // fe80::/10 (Link-Local Unicast)
        if (fullIp.startsWith('fc') || fullIp.startsWith('fd') ||
            fullIp.startsWith('fe8') || fullIp.startsWith('fe9') || fullIp.startsWith('fea') || fullIp.startsWith('feb')) {
            return true;
        }

        // ff00::/8 (Multicast)
        if (fullIp.startsWith('ff')) return true;

        if (fullIp.startsWith('0000:0000:0000:0000:0000:ffff:')) {
            // IPv4-mapped
            const hex = fullIp.substring(30).replace(/:/g, '');
            const ipv4 = [
                parseInt(hex.substring(0, 2), 16),
                parseInt(hex.substring(2, 4), 16),
                parseInt(hex.substring(4, 6), 16),
                parseInt(hex.substring(6, 8), 16)
            ].join('.');
            return isPrivateIP(ipv4);
        }
    }
    return false;
}

async function isSafeUrl(targetUrl) {
    try {
        const parsedUrl = new URL(targetUrl);
        const hostname = parsedUrl.hostname;

        if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
            return { safe: false };
        }

        if (isPrivateIP(hostname)) {
            return { safe: false };
        }

        let resolvedIP = null;

        // Only do DNS resolution for non-IP hostnames
        if (!/^[0-9\.]+$/.test(hostname) && !hostname.includes(':')) {
            // Use Cloudflare DoH to resolve the IP to prevent DNS rebinding or resolving to internal IPs
            const types = ['A', 'AAAA'];
            const dnsPromises = types.map(type =>
                fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`, {
                    headers: { 'accept': 'application/dns-json' }
                }).then(res => res.ok ? res.json() : null)
            );

            const results = await Promise.all(dnsPromises);
            for (const data of results) {
                if (data && data.Answer) {
                    for (const record of data.Answer) {
                        if (record.type === 1 || record.type === 28) { // A or AAAA
                            if (isPrivateIP(record.data)) {
                                return { safe: false };
                            }
                            if (!resolvedIP) {
                                resolvedIP = record.data;
                            }
                        }
                    }
                }
            }
        } else {
            resolvedIP = hostname;
        }
        return { safe: true, resolvedIP };
    } catch {
        return { safe: false };
    }
}

export async function handleRequest(request, env, ctx) {
        const url = new URL(request.url);
        
        // --- Static File Routing ---
        if (request.method === "GET" && STATIC_ROUTES[url.pathname]) {
            return STATIC_ROUTES[url.pathname](request);
        }

        // --- API Route ---
        if (request.method === "POST" && url.pathname === "/api/audit") {
            try {
                let body = await request.json();
                let targetUrl = body.targetUrl;
                
                if (!targetUrl || !targetUrl.startsWith('http')) {
                    return new Response(JSON.stringify({ error: "Invalid URL" }), { status: 400 });
                }

                // SSRF Protection
                const safety = await isSafeUrl(targetUrl);
                if (!safety.safe) {
                    return new Response(JSON.stringify({ error: "Access to internal or restricted network resources is not allowed" }), { status: 403 });
                }

                // Domain existence check
                try {
                    const parsedUrl = new URL(targetUrl);
                    await internalFetch(parsedUrl.origin, { method: 'HEAD' }, parsedUrl.origin, url.origin, env, ctx);
                } catch (e) {
                    console.error("Domain check error:", e);
                    return new Response(JSON.stringify({ error: "Domain does not exist or is unreachable" }), { status: 400 });
                }

                const result = await performAudit(targetUrl, url.origin, env, ctx);
                return new Response(JSON.stringify(result), {
                    headers: { "Content-Type": "application/json" }
                });

            } catch(e) {
                console.error('Audit API Error:', e);
                return new Response(JSON.stringify({ error: "Internal Server Error" }), {
                    status: 500,
                    headers: { "Content-Type": "application/json" }
                });
            }
        }

        return new Response("Not Found", { status: 404 });
}

async function performAudit(baseUrl, requestOrigin, env, ctx) {
    const headersStandard = { 'User-Agent': 'Mozilla/5.0 (compatible; AI-Valid/1.0)' };
    const headersAgent = { 'User-Agent': 'OAI-SearchBot', 'Accept': 'text/markdown' };
    
    // Ensure baseUrl doesn't end with slash securely
    const base = new URL(baseUrl).origin;

    let totalScore = 0;

    const iFetch = async (url, options = {}) => {
        let currentUrl = url;
        if (!currentUrl.startsWith(base)) {
            const safety = await isSafeUrl(currentUrl);
            if (!safety.safe) throw new Error("SSRF blocked");
        }
        return await internalFetch(currentUrl, options, base, requestOrigin, env, ctx);
    };

    // 1. Discoverability & Bots
    let robotsFound = false;
    let hasAI = false;
    let sitemapFound = false;
    let robotsText = "";

    try {
        const r_robots = await iFetch(`${base}/robots.txt`, { headers: headersStandard, cf: { cacheEverything: false } });
        if (r_robots.status === 200) {
            robotsFound = true;
            totalScore += 5;
            robotsText = await r_robots.text();
            const lowerText = robotsText.toLowerCase();
            if (['oai-searchbot', 'gptbot', 'perplexitybot'].some(bot => lowerText.includes(bot))) {
                hasAI = true;
                totalScore += 5;
            }
        }
    } catch { /* silent fail */ }

    try {
        let sitemapUrl = `${base}/sitemap.xml`;
        if (robotsText) {
            const sitemapMatch = robotsText.match(/^Sitemap:\s*(.*)$/im);
            if (sitemapMatch && sitemapMatch[1]) {
                sitemapUrl = sitemapMatch[1].trim();

                // Handle relative sitemap URL edge case
                if (sitemapUrl.startsWith('/')) {
                    sitemapUrl = `${base}${sitemapUrl}`;
                }
            }
        }

        const r_sitemap = await iFetch(sitemapUrl, { headers: headersStandard, cf: { cacheEverything: false } });
        if (r_sitemap.status === 200) {
            sitemapFound = true;
            totalScore += 5;
        }
    } catch { /* silent fail for sitemap */ }

    // 2. Content Accessibility
    let supportsMarkdown = false;
    let hasContentSignal = false;
    let hasSchema = false;
    let schemaType = "";

    try {
        const r_home = await iFetch(base, { headers: headersAgent, cf: { cacheEverything: false } });
        const cType = (r_home.headers.get('content-type') || '').toLowerCase();
        if (cType.includes('text/markdown')) {
            supportsMarkdown = true;
            totalScore += 15;
        }
        if (r_home.headers.has('content-signal')) {
            hasContentSignal = true;
            totalScore += 10;
        }

        const htmlText = await r_home.text();
        const scriptRegex = /<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
        let match;
        while ((match = scriptRegex.exec(htmlText)) !== null) {
            try {
                const json = JSON.parse(match[1]);
                const checkSchema = (obj) => {
                    if (!obj || typeof obj !== 'object') return;
                    if (obj['@type']) {
                        hasSchema = true;
                        if (typeof obj['@type'] === 'string') {
                            schemaType = obj['@type'];
                        } else if (Array.isArray(obj['@type'])) {
                            schemaType = obj['@type'][0];
                        }
                    }
                };
                
                if (Array.isArray(json)) {
                    json.forEach(checkSchema);
                } else if (json['@graph'] && Array.isArray(json['@graph'])) {
                    json['@graph'].forEach(checkSchema);
                } else {
                    checkSchema(json);
                }
            } catch { /* ignore parse error */ }
        }
        
        if (hasSchema) {
            totalScore += 10;
        }
    } catch { /* silent fail */ }

    // 3. Protocol Discovery & Verification

    // Fetch protocols in batches to avoid unbounded concurrency
    const protoResults = [];
    const batchSize = 4;
    for (let i = 0; i < wellKnownFiles.length; i += batchSize) {
        const batch = wellKnownFiles.slice(i, i + batchSize);
        const batchResults = await Promise.all(batch.map(async (data) => {
            const url = `${base}${data.path}`;
            let status = 'err';
            let message = '';
            let code = null;
            try {
                const req = await iFetch(url, { headers: headersStandard, cf: { cacheEverything: false } });
                code = req.status;
                let cType = (req.headers.get('content-type') || '').toLowerCase();
                let isSoft404 = code === 200 && cType.includes('text/html');

                if (code === 200 && !isSoft404) {
                    if (data.isJson) {
                        try {
                            const jsonBody = await req.json();
                            status = 'ok';
                            message = 'Valid JSON found';
                            totalScore += data.points;
                        } catch (err) {
                            message = 'Invalid JSON content';
                        }
                    } else {
                        if (!cType.includes('text/html')) {
                            status = 'ok';
                            message = 'Readable format found';
                            totalScore += data.points;
                        } else {
                            message = 'Received HTML (Soft 404)';
                        }
                    }
                } else if (isSoft404) {
                    message = 'Soft 404 (Placeholder page)';
                } else if ([401, 403].includes(code)) {
                    status = 'warn';
                    message = 'Authorization required';
                } else {
                    message = `Not found (${code})`;
                }
            } catch (e) {
                message = 'Network error';
            }

            return { name: data.name, path: data.path, spec: data.spec, tooltip: data.tooltip, prompt: data.prompt, status, message, code };
        }));
        protoResults.push(...batchResults);
    }

    return {
        score: {
            total: totalScore
        },
        bots: {
            robotsFound,
            hasAI,
            sitemapFound,
            results: [
                {
                    ...botsMetadata.robots,
                    status: robotsFound ? 'ok' : 'err',
                    message: robotsFound ? "Found manifest file" : "Not Found manifest file",
                    code: robotsFound ? 'Found' : 'Missing'
                },
                {
                    ...botsMetadata.aiDirectives,
                    status: hasAI ? 'ok' : 'warn',
                    message: "Rules for OAI-SearchBot/GPTBot.",
                    code: hasAI ? 'Found' : 'Missing'
                },
                {
                    ...botsMetadata.sitemap,
                    status: sitemapFound ? 'ok' : 'err',
                    message: sitemapFound ? "Sitemap found" : "No Sitemap found",
                    code: sitemapFound ? 'Found' : 'Missing'
                }
            ]
        },
        content: {
            supportsMarkdown,
            hasContentSignal,
            results: [
                {
                    ...contentMetadata.markdown,
                    status: supportsMarkdown ? 'ok' : 'err',
                    message: supportsMarkdown ? "Server provides markdown" : "No markdown provided on-the-fly",
                    code: supportsMarkdown ? 'Supported' : 'Failed'
                },
                {
                    ...contentMetadata.signal,
                    status: hasContentSignal ? 'ok' : 'warn',
                    message: "Usage policies header.",
                    code: hasContentSignal ? 'Found' : 'Missing'
                },
                {
                    ...contentMetadata.jsonld,
                    status: hasSchema ? 'ok' : 'err',
                    message: hasSchema ? `Found ${schemaType} markup` : "No JSON-LD markup found",
                    code: hasSchema ? 'Found' : 'Missing'
                }
            ]
        },
        protocols: {
            results: protoResults
        }
    };
}
