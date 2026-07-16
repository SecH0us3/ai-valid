# Share Results Preview Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a "Share results" feature that lets users copy/download a beautiful neon-dark preview card of their website's AI readiness score and generate dynamic Open Graph SVG cards on the server.

**Architecture:** 
1. Client-side: Draw a glowing dark dashboard card onto a `<canvas>`, display it in a modal dialog, and hook up clipboard copying (via PNG blob), PNG download, and pre-filled Twitter sharing.
2. Server-side: Cloudflare Worker serves `/share` (meta tag wrapper and redirect) and `/api/og-image` (generates custom SVG on-the-fly).

**Tech Stack:** Vanilla JS, CSS variables, HTML `<canvas>` & `<dialog>`, Cloudflare Worker routing & template rendering.

## Global Constraints

- Preserve clean styling, dark/neon accents matching the user's design requirements.
- Shell commands must be prefixed with `rtk` (e.g. `rtk npm test`).
- Ensure no placeholders or TBDs are left in code.

---

### Task 1: Server-side Routing & SVG Generator

**Files:**
- Modify: `src/index.js:23-45` (Add static route `/share`), `src/index.js:358-412` (Add API route `/api/og-image` and `/share` handlers)
- Test: `tests/static-routes.test.js`

**Interfaces:**
- Produces: `/share` HTML page and `/api/og-image` SVG endpoint.

- [ ] **Step 1: Write the failing tests**
  Add tests verifying `/share` returns HTML with Open Graph tags and `/api/og-image` returns SVG.
  Add this to `tests/static-routes.test.js`:
  ```javascript
  import { describe, it, expect } from 'vitest';
  
  describe("Share routes", () => {
      it("should serve HTML for /share", async () => {
          const req = new Request("http://localhost/share?domain=example.com&passed=10&warn=5&fail=2");
          const res = await handleRequest(req);
          expect(res.status).toBe(200);
          const html = await res.text();
          expect(html).toContain('og:image');
          expect(html).toContain('/api/og-image');
      });
  
      it("should serve SVG for /api/og-image", async () => {
          const req = new Request("http://localhost/api/og-image?domain=example.com&passed=10&warn=5&fail=2");
          const res = await handleRequest(req);
          expect(res.status).toBe(200);
          expect(res.headers.get("Content-Type")).toBe("image/svg+xml");
          const svg = await res.text();
          expect(svg).toContain('<svg');
          expect(svg).toContain('example.com');
      });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `rtk vitest run tests/static-routes.test.js`
  Expected: FAIL (routes not found or throw 404).

- [ ] **Step 3: Implement SVG generator and Worker routes**
  In `src/index.js`, add `generateOgImageSvg`:
  ```javascript
  function generateOgImageSvg(domain, passed, warn, fail, score) {
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
    <defs>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800&amp;family=JetBrains+Mono:wght@700&amp;display=swap');
        .title { font-family: 'Outfit', sans-serif; font-weight: 800; fill: #ffffff; font-size: 32px; letter-spacing: 0.05em; }
        .domain { font-family: 'JetBrains Mono', monospace; font-weight: 700; fill: #3b82f6; font-size: 48px; }
        .score-num { font-family: 'Outfit', sans-serif; font-weight: 800; fill: #ffffff; font-size: 96px; text-anchor: middle; }
        .score-label { font-family: 'Outfit', sans-serif; font-weight: 600; fill: #94a3b8; font-size: 20px; text-anchor: middle; text-transform: uppercase; letter-spacing: 0.1em; }
        .stat-val { font-family: 'Outfit', sans-serif; font-weight: 800; font-size: 36px; }
        .stat-lbl { font-family: 'Outfit', sans-serif; font-weight: 600; fill: #94a3b8; font-size: 16px; text-transform: uppercase; letter-spacing: 0.05em; }
        .footer { font-family: 'Outfit', sans-serif; font-weight: 600; fill: #475569; font-size: 20px; letter-spacing: 0.05em; }
        .glow-green { filter: drop-shadow(0 0 8px rgba(16, 185, 129, 0.5)); }
        .glow-yellow { filter: drop-shadow(0 0 8px rgba(217, 119, 6, 0.5)); }
        .glow-red { filter: drop-shadow(0 0 8px rgba(225, 29, 72, 0.5)); }
        .glow-blue { filter: drop-shadow(0 0 12px rgba(59, 130, 246, 0.4)); }
      </style>
      <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#0b1329" />
        <stop offset="100%" stop-color="#080b11" />
      </linearGradient>
      <linearGradient id="circleGrad" x1="0%" y1="100%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#3b82f6" />
        <stop offset="100%" stop-color="#10b981" />
      </linearGradient>
    </defs>
    <rect width="1200" height="630" fill="url(#bgGrad)" />
    <path d="M 0 105 L 1200 105 M 0 210 L 1200 210 M 0 315 L 1200 315 M 0 420 L 1200 420 M 0 525 L 1200 525" stroke="#1e293b" stroke-width="1" opacity="0.3" />
    <path d="M 200 0 L 200 630 M 400 0 L 400 630 M 600 0 L 600 630 M 800 0 L 800 630 M 1000 0 L 1000 630" stroke="#1e293b" stroke-width="1" opacity="0.3" />
    <g transform="translate(100, 80)">
      <text x="0" y="0" class="title">AI READINESS AUDIT</text>
      <text x="0" y="65" class="domain">${domain}</text>
      <g transform="translate(200, 260)">
        <circle cx="0" cy="0" r="140" fill="none" stroke="#1e293b" stroke-width="18" />
        <circle cx="0" cy="0" r="140" fill="none" stroke="url(#circleGrad)" stroke-width="18"
                stroke-dasharray="879.6" stroke-dashoffset="${879.6 - (879.6 * score / 100)}"
                stroke-linecap="round" transform="rotate(-90)" class="glow-blue" />
        <text x="0" y="15" class="score-num">${score}%</text>
        <text x="0" y="50" class="score-label">AI-READY</text>
      </g>
      <g transform="translate(550, 160)">
        <g transform="translate(0, 0)">
          <rect width="380" height="70" rx="8" fill="#111827" stroke="#1e293b" stroke-width="1" />
          <rect width="6" height="70" rx="3" fill="#10b981" class="glow-green" />
          <text x="30" y="46" class="stat-val" fill="#10b981">${passed}</text>
          <text x="110" y="42" class="stat-lbl">Checks Passed</text>
        </g>
        <g transform="translate(0, 95)">
          <rect width="380" height="70" rx="8" fill="#111827" stroke="#1e293b" stroke-width="1" />
          <rect width="6" height="70" rx="3" fill="#d97706" class="glow-yellow" />
          <text x="30" y="46" class="stat-val" fill="#d97706">${warn}</text>
          <text x="110" y="42" class="stat-lbl">Warnings</text>
        </g>
        <g transform="translate(0, 190)">
          <rect width="380" height="70" rx="8" fill="#111827" stroke="#1e293b" stroke-width="1" />
          <rect width="6" height="70" rx="3" fill="#e11d48" class="glow-red" />
          <text x="30" y="46" class="stat-val" fill="#e11d48">${fail}</text>
          <text x="110" y="42" class="stat-lbl">Not Found</text>
        </g>
      </g>
    </g>
    <text x="100" y="560" class="footer">ai-valid.secmy.app</text>
  </svg>`;
  }
  ```
  Add routes inside `handleRequest`:
  ```javascript
  if (url.pathname === "/share") {
      const domain = url.searchParams.get("domain") || "unknown";
      const passed = parseInt(url.searchParams.get("passed") || "0", 10);
      const warn = parseInt(url.searchParams.get("warn") || "0", 10);
      const fail = parseInt(url.searchParams.get("fail") || "0", 10);
      const total = passed + warn + fail;
      const score = total > 0 ? Math.round((passed / total) * 100) : 0;
      
      const shareImageUrl = `${url.origin}/api/og-image?domain=${encodeURIComponent(domain)}&passed=${passed}&warn=${warn}&fail=${fail}`;
      
      const html = `<!DOCTYPE html>
  <html>
  <head>
      <meta charset="utf-8">
      <title>AI Readiness Audit for ${domain}</title>
      <meta property="og:title" content="AI Readiness Audit: ${domain} is ${score}% AI-ready">
      <meta property="og:description" content="Passed: ${passed} | Warnings: ${warn} | Not found: ${fail}. Check your site's AI accessibility.">
      <meta property="og:image" content="${shareImageUrl}">
      <meta property="og:image:type" content="image/svg+xml">
      <meta name="twitter:card" content="summary_large_image">
      <meta name="twitter:title" content="AI Readiness Audit: ${domain} is ${score}% AI-ready">
      <meta name="twitter:description" content="Passed: ${passed} | Warnings: ${warn} | Not found: ${fail}.">
      <meta name="twitter:image" content="${shareImageUrl}">
      <script>window.location.href = "/#" + encodeURIComponent("${domain}");</script>
  </head>
  <body>Redirecting...</body>
  </html>`;
      return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", ...corsHeaders } });
  }

  if (url.pathname === "/api/og-image") {
      const domain = url.searchParams.get("domain") || "unknown";
      const passed = parseInt(url.searchParams.get("passed") || "0", 10);
      const warn = parseInt(url.searchParams.get("warn") || "0", 10);
      const fail = parseInt(url.searchParams.get("fail") || "0", 10);
      const total = passed + warn + fail;
      const score = total > 0 ? Math.round((passed / total) * 100) : 0;
      
      const svg = generateOgImageSvg(domain, passed, warn, fail, score);
      return new Response(svg, {
          headers: {
              "Content-Type": "image/svg+xml",
              "Cache-Control": "public, max-age=86400",
              ...corsHeaders
          }
      });
  }
  ```

- [ ] **Step 4: Run test to verify it passes**
  Run: `rtk vitest run tests/static-routes.test.js`
  Expected: PASS.

- [ ] **Step 5: Commit**
  Run: `rtk git commit -am "feat: implement server-side share routes and dynamic SVG card"`

---

### Task 2: Layout CSS Integration

**Files:**
- Modify: `public/style.css`

- [ ] **Step 1: Declare failing test (Visual/Style checking)**
  We want to verify mobile wrap query exists. We'll add a CSS validation rule or test structure if needed, or simply write CSS modifications.

- [ ] **Step 2: Append styles to `public/style.css`**
  Modify `/Users/alex/src/agent-check/ai-valid/public/style.css` to add layout styling:
  ```css
  /* Share button and modal styles */
  .share-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background: var(--accent-blue-light);
      color: var(--accent-blue);
      border: 1px solid rgba(37, 99, 235, 0.15);
      font-size: 0.95rem;
      padding: 0.75rem 1.25rem;
  }
  
  .share-btn:hover {
      background: rgba(37, 99, 235, 0.12);
      transform: translateY(-1px);
  }
  
  /* Share Modal Specifics */
  .share-modal-body {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1.5rem;
      padding: 0.5rem 0;
  }
  
  .preview-image-container {
      width: 100%;
      aspect-ratio: 1.91 / 1;
      background: #0b1329;
      border: 1px solid var(--border-clean);
      border-radius: 8px;
      overflow: hidden;
      display: flex;
      justify-content: center;
      align-items: center;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }
  
  .preview-image-container img {
      width: 100%;
      height: 100%;
      object-fit: contain;
  }
  
  .share-actions-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 0.75rem;
      width: 100%;
  }
  
  .share-action-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.4rem;
      padding: 0.65rem;
      border-radius: 8px;
      font-weight: 600;
      font-size: 0.85rem;
      cursor: pointer;
      border: 1px solid var(--border-clean);
      background: var(--bg-panel);
      color: var(--text-primary);
      transition: all 0.2s ease;
  }
  
  .share-action-btn:hover {
      background: var(--bg-deep);
      border-color: #cbd5e1;
  }
  
  .share-action-btn.btn-twitter {
      background: #1da1f2;
      color: white;
      border-color: #1da1f2;
  }
  
  .share-action-btn.btn-twitter:hover {
      background: #1a91da;
  }
  
  /* Mobile Responsive Updates for Summary Card */
  @media (max-width: 768px) {
      .summary-card {
          flex-direction: column;
          gap: 1.25rem;
          padding: 1.5rem 1rem;
      }
      .summary-divider {
          display: none;
      }
      .share-column {
          width: 100%;
          display: flex;
          justify-content: center;
      }
      .share-actions-grid {
          grid-template-columns: 1fr;
      }
  }
  ```

- [ ] **Step 3: Run dev & inspect style load**
  We will verify compile output.

- [ ] **Step 4: Commit**
  Run: `rtk git commit -am "style: add responsive share columns and modal layout stylesheet rules"`

---

### Task 3: HTML Markup updates

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Check existing modal structure**
  Verify where to put the new share dialog. We will add a new native `<dialog>` element `#share-modal` to the body.

- [ ] **Step 2: Modify `public/index.html`**
  Modify `/Users/alex/src/agent-check/ai-valid/public/index.html` to add the Share column and the share dialog container.
  
  Add column to `.summary-card` (near line 112):
  ```html
                  <div class="summary-divider"></div>
                  <div class="summary-item share-column">
                      <button id="share-results-btn" class="glow-button share-btn">
                          <span>🔗</span> Share Results
                      </button>
                  </div>
  ```
  
  Add modal dialog near `#info-modal` (near line 150):
  ```html
      <!-- Share Results Modal -->
      <dialog id="share-modal" class="modal-overlay" closedby="any" aria-labelledby="share-title">
          <div class="modal-content glass-panel" style="max-width: 650px;">
              <button id="share-modal-close" class="modal-close-btn">&times;</button>
              <h3 id="share-title" class="modal-title">Share Your AI Readiness</h3>
              
              <div class="share-modal-body">
                  <div class="preview-image-container">
                      <img id="share-preview-img" src="" alt="AI Readiness Scorecard">
                  </div>
                  
                  <div class="share-actions-grid">
                      <button id="btn-copy-card" class="share-action-btn">
                          <span>📋</span> Copy Image
                      </button>
                      <button id="btn-download-card" class="share-action-btn">
                          <span>📥</span> Download PNG
                      </button>
                      <button id="btn-twitter-share" class="share-action-btn btn-twitter">
                          <span>🐦</span> Post to X
                      </button>
                  </div>
              </div>
          </div>
      </dialog>
  ```

- [ ] **Step 3: Commit**
  Run: `rtk git commit -am "tmpl: introduce share button and share dialog modal containers in index.html"`

---

### Task 4: Client-side Interactive Logic

**Files:**
- Modify: `public/app.client.js`

- [ ] **Step 1: Implement Canvas drawing function**
  We will add a helper function `drawShareCard(canvas, domain, passed, warn, fail, score)` to write beautiful pixels matching the dark-neon aesthetic.
  Add code into `/Users/alex/src/agent-check/ai-valid/public/app.client.js`:
  ```javascript
  function drawShareCard(canvas, domain, passed, warn, fail, score) {
      const ctx = canvas.getContext('2d');
      const scale = 2; // high-DPI
      canvas.width = 1200 * scale;
      canvas.height = 630 * scale;
      ctx.scale(scale, scale);
  
      // Background gradient
      const bgGrad = ctx.createLinearGradient(0, 0, 1200, 630);
      bgGrad.addColorStop(0, '#0b1329');
      bgGrad.addColorStop(1, '#080b11');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, 1200, 630);
  
      // Grid lines
      ctx.strokeStyle = 'rgba(30, 41, 59, 0.5)';
      ctx.lineWidth = 1;
      for (let y = 105; y < 630; y += 105) {
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1200, y); ctx.stroke();
      }
      for (let x = 200; x < 1200; x += 200) {
          ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 630); ctx.stroke();
      }
  
      // Drawing layout parameters
      const startX = 100;
      const startY = 80;
  
      // Header Text
      ctx.fillStyle = '#ffffff';
      ctx.font = '800 32px Outfit, system-ui, sans-serif';
      ctx.fillText('AI READINESS AUDIT', startX, startY);
  
      // Domain Text
      ctx.fillStyle = '#3b82f6';
      ctx.font = '700 48px "JetBrains Mono", monospace';
      ctx.fillText(domain, startX, startY + 65);
  
      // Score Circle Gauge
      const cx = startX + 200;
      const cy = startY + 260;
      const radius = 140;
  
      // Outer track
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.lineWidth = 18;
      ctx.strokeStyle = '#1e293b';
      ctx.stroke();
  
      // Active track glow shadow
      ctx.shadowColor = 'rgba(59, 130, 246, 0.4)';
      ctx.shadowBlur = 24;
  
      // Active gauge gradient
      const arcGrad = ctx.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius);
      arcGrad.addColorStop(0, '#3b82f6');
      arcGrad.addColorStop(1, '#10b981');
  
      ctx.beginPath();
      ctx.arc(cx, cy, radius, -Math.PI / 2, (-Math.PI / 2) + (Math.PI * 2 * (score / 100)));
      ctx.strokeStyle = arcGrad;
      ctx.lineWidth = 18;
      ctx.lineCap = 'round';
      ctx.stroke();
  
      // Reset shadows
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
  
      // Percentage Text
      ctx.fillStyle = '#ffffff';
      ctx.font = '800 96px Outfit, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(score + '%', cx, cy + 15);
  
      // AI-Ready label
      ctx.fillStyle = '#94a3b8';
      ctx.font = '600 20px Outfit, sans-serif';
      ctx.fillText('AI-READY', cx, cy + 50);
  
      // Metrics Cards List
      const mx = startX + 550;
      const my = startY + 160;
      const drawCard = (yOffset, label, count, color, glowColor) => {
          // Card back rect
          ctx.fillStyle = '#111827';
          ctx.strokeStyle = '#1e293b';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.roundRect(mx, my + yOffset, 380, 70, 8);
          ctx.fill();
          ctx.stroke();
  
          // Left neon accent stripe with glow
          ctx.shadowColor = glowColor;
          ctx.shadowBlur = 10;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.roundRect(mx, my + yOffset, 6, 70, 3);
          ctx.fill();
          ctx.shadowColor = 'transparent';
          ctx.shadowBlur = 0;
  
          // Value text
          ctx.fillStyle = color;
          ctx.font = '800 36px Outfit, sans-serif';
          ctx.textAlign = 'left';
          ctx.fillText(count, mx + 30, my + yOffset + 46);
  
          // Label text
          ctx.fillStyle = '#94a3b8';
          ctx.font = '600 16px Outfit, sans-serif';
          ctx.fillText(label, mx + 110, my + yOffset + 42);
      };
  
      drawCard(0, 'Checks Passed', passed, '#10b981', 'rgba(16, 185, 129, 0.5)');
      drawCard(95, 'Warnings', warn, '#d97706', 'rgba(217, 119, 6, 0.5)');
      drawCard(190, 'Not Found', fail, '#e11d48', 'rgba(225, 29, 72, 0.5)');
  
      // Branding footer
      ctx.fillStyle = '#475569';
      ctx.font = '600 20px Outfit, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('ai-valid.secmy.app', startX, 560);
  }
  ```

- [ ] **Step 2: Connect the Share button and dialog handlers**
  Inside `document.addEventListener('DOMContentLoaded', ...)` in `public/app.client.js`:
  Store the current domain, passed, warn, and fail count dynamically as global closure state inside the handler when `renderResults` executes.
  
  ```javascript
      // Add local state at top of DOMContentLoaded
      let currentAuditContext = { domain: '', passedCount: 0, warnCount: 0, failCount: 0, score: 0 };
  ```
  
  Capture these details inside `renderResults(data)`:
  ```javascript
          // Near the end of renderResults:
          const score = data.score ? data.score.total : 0;
          currentAuditContext = {
              domain: input.value,
              passedCount: passed.length,
              warnCount: warnings.length,
              failCount: failed.length,
              score: score
          };
  ```
  
  Bind click listener on `#share-results-btn`:
  ```javascript
      const shareBtn = document.getElementById('share-results-btn');
      const shareModal = document.getElementById('share-modal');
      const shareClose = document.getElementById('share-modal-close');
      const sharePreviewImg = document.getElementById('share-preview-img');
      const btnCopyCard = document.getElementById('btn-copy-card');
      const btnDownloadCard = document.getElementById('btn-download-card');
      const btnTwitterShare = document.getElementById('btn-twitter-share');
  
      // Light dismiss dialog fallback
      if (shareModal && !('closedBy' in HTMLDialogElement.prototype)) {
          shareModal.addEventListener('click', (event) => {
              if (event.target !== shareModal) return;
              const rect = shareModal.getBoundingClientRect();
              const isContent = (
                  rect.top <= event.clientY &&
                  event.clientY <= rect.top + rect.height &&
                  rect.left <= event.clientX &&
                  event.clientX <= rect.left + rect.width
              );
              if (!isContent) shareModal.close();
          });
      }
  
      shareClose.addEventListener('click', () => shareModal.close());
  
      shareBtn.addEventListener('click', () => {
          const canvas = document.createElement('canvas');
          drawShareCard(canvas, currentAuditContext.domain, currentAuditContext.passedCount, currentAuditContext.warnCount, currentAuditContext.failCount, currentAuditContext.score);
          
          const pngUrl = canvas.toDataURL('image/png');
          sharePreviewImg.src = pngUrl;
          
          shareModal.showModal();
      });
  
      // Action button copy
      btnCopyCard.addEventListener('click', async () => {
          try {
              const canvas = document.createElement('canvas');
              drawShareCard(canvas, currentAuditContext.domain, currentAuditContext.passedCount, currentAuditContext.warnCount, currentAuditContext.failCount, currentAuditContext.score);
              canvas.toBlob(async (blob) => {
                  if (!blob) throw new Error("Canvas blob error");
                  try {
                      await navigator.clipboard.write([
                          new ClipboardItem({ 'image/png': blob })
                      ]);
                      btnCopyCard.innerHTML = '✅ Copied!';
                      setTimeout(() => btnCopyCard.innerHTML = '<span>📋</span> Copy Image', 2000);
                  } catch (clipErr) {
                      console.error("Clipboard API write failed: ", clipErr);
                      alert("Unable to copy image automatically. Please right-click the image to copy it.");
                  }
              }, 'image/png');
          } catch (e) {
              console.error(e);
          }
      });
  
      // Action button download
      btnDownloadCard.addEventListener('click', () => {
          const canvas = document.createElement('canvas');
          drawShareCard(canvas, currentAuditContext.domain, currentAuditContext.passedCount, currentAuditContext.warnCount, currentAuditContext.failCount, currentAuditContext.score);
          const link = document.createElement('a');
          link.download = `ai-valid-${currentAuditContext.domain}.png`;
          link.href = canvas.toDataURL('image/png');
          link.click();
      });
  
      // Action button X/Twitter
      btnTwitterShare.addEventListener('click', () => {
          const url = `https://${window.location.host}/share?domain=${encodeURIComponent(currentAuditContext.domain)}&passed=${currentAuditContext.passedCount}&warn=${currentAuditContext.warnCount}&fail=${currentAuditContext.failCount}`;
          const tweetText = encodeURIComponent(`My website ${currentAuditContext.domain} is ${currentAuditContext.score}% AI-ready! Scan your site's AI accessibility at:`);
          const twitterUrl = `https://twitter.com/intent/tweet?text=${tweetText}&url=${encodeURIComponent(url)}&hashtags=AIReady,WebDev`;
          window.open(twitterUrl, '_blank');
      });
  ```

- [ ] **Step 3: Verify execution and functionality**
  Verify the full integration is error-free.

- [ ] **Step 4: Commit**
  Run: `rtk git commit -am "feat: bind canvas graphics rendering and UI button behaviors to client app.client.js"`

---

## Verification Plan

### Automated Tests
Run: `rtk npm test` to ensure all tests, including our new static routes test suite, are passing cleanly.

### Manual Verification
1. Boot wrangler locally: `rtk wrangler dev`
2. Perform a test scan of `example.com`.
3. Open the Share modal, click "Copy Image" and verify clipboard paste.
4. Click "Download PNG" and verify the local downloaded image.
5. Click "Post to X" and verify the URL parameters matching the server redirects.
