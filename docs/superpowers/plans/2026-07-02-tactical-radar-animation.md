# Tactical Radar Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the loading state radar spinner to a high-fidelity Tactical Sci-Fi scanning HUD.

**Architecture:** Edit `index.html` to add sub-elements for the radar grid, crosshair, pulses, and blips. Update `style.css` to add animations and visual style properties. Run tests and rebuild compiled wrangler assets.

**Tech Stack:** HTML5, CSS3, Vitest, Cloudflare Wrangler.

## Global Constraints

- Keep the layout pristine and responsive.
- Maintain clean, semantic HTML structure and CSS formatting.

---

### Task 1: Markup and stylesheet implementation

**Files:**
- Modify: `ai-valid/public/index.html:77-88`
- Modify: `ai-valid/public/style.css:480-511`
- Test: `tests/static-routes.test.js`

**Interfaces:**
- Consumes: Existing HTML structure and CSS variables.
- Produces: Upgraded `.radar-container` layout and CSS animations.

- [ ] **Step 1: Update index.html with new radar elements**

  Edit `ai-valid/public/index.html` to include the grid, crosshair, pulses, and blips.
  
  ```html
  <<<<
          <!-- Loading Overlay -->
          <div id="loading-overlay" class="loading-state hidden">
              <div class="radar-container">
                  <div class="radar"></div>
                  <div class="radar-scan"></div>
              </div>
              <div class="terminal-loader">
  ====
          <!-- Loading Overlay -->
          <div id="loading-overlay" class="loading-state hidden">
              <div class="radar-container">
                  <div class="radar-grid"></div>
                  <div class="radar-crosshair"></div>
                  <div class="radar-pulse"></div>
                  <div class="radar-pulse-2"></div>
                  <div class="radar-blip blip-1"></div>
                  <div class="radar-blip blip-2"></div>
                  <div class="radar"></div>
                  <div class="radar-scan"></div>
              </div>
              <div class="terminal-loader">
  >>>>
  ```

- [ ] **Step 2: Update style.css with radar HUD styling**

  Edit `ai-valid/public/style.css` to style all new radar sub-elements and add keyframe animations.
  
  ```css
  <<<<
  .radar-container {
      width: 80px; height: 80px;
      position: relative;
      border-radius: 50%;
      border: 2px solid var(--accent-blue-light);
      overflow: hidden;
      box-shadow: 0 4px 12px rgba(37, 99, 235, 0.05);
      background: var(--bg-panel);
  }

  .radar {
      position: absolute;
      top: 50%; left: 50%;
      width: 2px; height: 50%;
      background: var(--accent-blue);
      transform-origin: top;
      animation: radarSpin 2s linear infinite;
      box-shadow: 0 0 4px var(--accent-blue);
      z-index: 2;
  }

  .radar-scan {
      position: absolute;
      top: 0; left: 0;
      width: 100%; height: 100%;
      background: conic-gradient(from 180deg at 50% 50%, rgba(37, 99, 235, 0.18) 0deg, transparent 270deg);
      border-radius: 50%;
      animation: radarSpin 2s linear infinite;
      z-index: 1;
  }

  @keyframes radarSpin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
  ====
  .radar-container {
      width: 100px;
      height: 100px;
      position: relative;
      border-radius: 50%;
      border: 2px solid var(--accent-blue);
      overflow: hidden;
      box-shadow: 0 0 20px rgba(37, 99, 235, 0.25), inset 0 0 15px rgba(37, 99, 235, 0.1);
      background: #0f172a;
  }

  .radar-grid {
      position: absolute;
      top: 0; left: 0; width: 100%; height: 100%;
      background: radial-gradient(circle, transparent 20%, rgba(37, 99, 235, 0.1) 21%, transparent 22%, transparent 45%, rgba(37, 99, 235, 0.1) 46%, transparent 47%, transparent 70%, rgba(37, 99, 235, 0.1) 71%, transparent 72%);
      z-index: 1;
  }

  .radar-crosshair {
      position: absolute;
      top: 0; left: 0; width: 100%; height: 100%;
      background: 
          linear-gradient(90deg, transparent 49.5%, rgba(37, 99, 235, 0.15) 50%, transparent 50.5%),
          linear-gradient(0deg, transparent 49.5%, rgba(37, 99, 235, 0.15) 50%, transparent 50.5%);
      z-index: 1;
  }

  .radar-pulse, .radar-pulse-2 {
      position: absolute;
      top: 50%; left: 50%;
      width: 10px; height: 10px;
      border: 1px solid rgba(59, 130, 246, 0.4);
      border-radius: 50%;
      transform: translate(-50%, -50%);
      animation: radarPulse 4s cubic-bezier(0.1, 0.8, 0.3, 1) infinite;
      z-index: 1;
  }

  .radar-pulse-2 {
      animation-delay: 2s;
  }

  .radar-blip {
      position: absolute;
      width: 6px; height: 6px;
      background: #10b981;
      border-radius: 50%;
      transform: translate(-50%, -50%);
      box-shadow: 0 0 10px #10b981, 0 0 20px #10b981;
      opacity: 0;
      z-index: 3;
  }

  .blip-1 {
      top: 30%; left: 70%;
      animation: blipFade1 2s linear infinite;
  }

  .blip-2 {
      top: 65%; left: 25%;
      animation: blipFade2 2s linear infinite;
  }

  .radar {
      position: absolute;
      top: 50%; left: 50%;
      width: 2px; height: 50%;
      background: linear-gradient(to bottom, var(--accent-glow) 0%, rgba(37, 99, 235, 0) 100%);
      transform-origin: top;
      animation: radarSpin 2s linear infinite;
      box-shadow: 0 0 8px var(--accent-glow);
      z-index: 4;
  }

  .radar-scan {
      position: absolute;
      top: 0; left: 0;
      width: 100%; height: 100%;
      background: conic-gradient(from 180deg at 50% 50%, rgba(37, 99, 235, 0.3) 0deg, transparent 180deg);
      border-radius: 50%;
      animation: radarSpin 2s linear infinite;
      z-index: 2;
  }

  @keyframes radarSpin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
  }

  @keyframes radarPulse {
      0% { width: 0; height: 0; opacity: 1; }
      100% { width: 120px; height: 120px; opacity: 0; }
  }

  @keyframes blipFade1 {
      0% { opacity: 0; }
      12% { opacity: 0; }
      15% { opacity: 1; }
      45% { opacity: 0.2; }
      100% { opacity: 0; }
  }

  @keyframes blipFade2 {
      0% { opacity: 0; }
      62% { opacity: 0; }
      65% { opacity: 1; }
      95% { opacity: 0.2; }
      100% { opacity: 0; }
  }
  >>>>
  ```

- [ ] **Step 3: Run local tests**

  Run: `rtk npm test` in `/Users/alex/src/agent-check/ai-valid`
  Expected: PASS

- [ ] **Step 4: Commit Task 1 changes**

  Run:
  ```bash
  rtk git add ai-valid/public/index.html ai-valid/public/style.css
  rtk git commit -m "feat: add tactical sci-fi radar elements and style animations"
  ```
