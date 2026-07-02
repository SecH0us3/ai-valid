# Remove Hero Badge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the `hero-badge` UI element and its associated styling from the AI-Valid platform.

**Architecture:** Remove the HTML node in the index template, remove the CSS styling blocks in the stylesheet, and verify that the worker tests pass.

**Tech Stack:** HTML5, CSS3, Vitest, Cloudflare Wrangler.

## Global Constraints

- No project-wide version floors or dependency changes are required.
- Maintain clean, semantic HTML structure and CSS formatting.

---

### Task 1: Clean up markup and styles

**Files:**
- Modify: `ai-valid/public/index.html:58-62`
- Modify: `ai-valid/public/style.css:107-123`
- Test: `tests/static-routes.test.js`

**Interfaces:**
- Consumes: Existing HTML structure and CSS stylesheets.
- Produces: Updated `index.html` without the `hero-badge` div element and `style.css` without `.hero-badge` classes.

- [ ] **Step 1: Modify HTML to remove the hero badge**

  Edit `ai-valid/public/index.html` to remove the badge element.
  
  ```html
  <<<<
          <header class="hero">
              <div class="hero-badge">secmy.app ecosystem</div>
              <h1 class="hero-title">AI-Ready <br><span class="text-gradient">Platform Audit</span></h1>
  ====
          <header class="hero">
              <h1 class="hero-title">AI-Ready <br><span class="text-gradient">Platform Audit</span></h1>
  >>>>
  ```

- [ ] **Step 2: Modify CSS to remove the hero badge classes**

  Edit `ai-valid/public/style.css` to delete the styles for `.hero-badge` and `.compact-mode .hero-badge`.
  
  ```css
  <<<<
  .hero-badge {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 20px;
      background: var(--accent-blue-light);
      border: 1px solid rgba(37, 99, 235, 0.15);
      color: var(--accent-blue);
      font-size: 0.875rem;
      font-weight: 600;
      margin-bottom: 1rem;
      text-transform: uppercase;
      letter-spacing: 1px;
  }

  .compact-mode .hero-badge {
      display: none;
  }
  ====
  /* Removed hero-badge styles */
  >>>>
  ```

- [ ] **Step 3: Run the test suite to verify tests pass**

  Run: `rtk npm test` in `/Users/alex/src/agent-check/ai-valid`
  Expected: All 32 tests pass.

- [ ] **Step 4: Commit the changes**

  Run:
  ```bash
  rtk git add ai-valid/public/index.html ai-valid/public/style.css
  rtk git commit -m "feat: remove hero badge from index and styles"
  ```
