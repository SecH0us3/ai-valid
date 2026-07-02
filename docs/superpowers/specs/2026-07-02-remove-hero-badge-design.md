# Design Spec: Remove Hero Badge

This document specifies the changes required to remove the `hero-badge` UI element and its associated styles from the AI-Valid platform.

## Proposed Changes

### 1. Markup Update
Remove the `<div class="hero-badge">` container from the header section in [index.html](file:///Users/alex/src/agent-check/ai-valid/public/index.html#L59).

**Target File:** `ai-valid/public/index.html`

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

### 2. Stylesheet Update
Remove the CSS rules for `.hero-badge` and `.compact-mode .hero-badge` from `ai-valid/public/style.css`.

**Target File:** `ai-valid/public/style.css`

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
/* hero-badge rules removed */
>>>>
```

## Testing & Verification

1. Run `rtk npm test` in the `ai-valid` folder to verify that the local test suite remains green.
2. Confirm the UI compiles successfully under wrangler dev server environment.
