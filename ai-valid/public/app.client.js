// Frontend Logic for AI-Valid API

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('audit-form');
    const input = document.getElementById('url-input');
    input.addEventListener('input', () => {
        input.value = input.value.replace(/\s+/g, '');
    });
    const btn = document.getElementById('submit-btn');
    const loader = document.getElementById('btn-loader');
    const btnText = document.querySelector('.btn-text');
    const errorMsg = document.getElementById('error-message');
    const loadingOverlay = document.getElementById('loading-overlay');
    const dashboard = document.getElementById('results-dashboard');
    const container = document.querySelector('.container');

    /**
     * Safe HTML Sanitizer
     * Whitelists only safe tags: strong, code, br, em
     */
    function sanitizeHTML(html) {
        // Use DOMPurify to securely sanitize HTML, whitelisting only safe tags.
        // This prevents mXSS vulnerabilities associated with manual DOM parsing and .innerHTML serialization.
        if (typeof DOMPurify !== 'undefined') {
            return DOMPurify.sanitize(html, {
                ALLOWED_TAGS: ['strong', 'code', 'br', 'em'],
                ALLOWED_ATTR: [] // Strip all attributes just like the original logic
            });
        }

        // Fallback that explicitly removes all HTML if DOMPurify is unavailable (fail closed)
        const div = document.createElement('div');
        div.textContent = html;
        return div.innerHTML;
    }

    // Modal elements
    const modalOverlay = document.getElementById('info-modal');
    const modalCloseBtn = document.getElementById('modal-close');
    const modalTitle = document.getElementById('modal-title');
    const modalBody = document.getElementById('modal-body');
    const modalFooter = document.getElementById('modal-footer');

    modalCloseBtn.addEventListener('click', () => {
        modalOverlay.classList.remove('active');
    });

    modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) {
            modalOverlay.classList.remove('active');
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modalOverlay.classList.contains('active')) {
            modalOverlay.classList.remove('active');
        }
    });

    function openModal(title, content, spec, prompt) {
        modalTitle.textContent = title;
        modalBody.innerHTML = sanitizeHTML(content);
        
        modalFooter.textContent = '';

        if (prompt) {
            const btn = document.createElement('button');
            btn.className = 'copy-btn';
            btn.style.padding = '0.4rem 1rem';
            btn.style.fontSize = '0.9rem';
            btn.innerHTML = '📋 Copy AI Prompt';
            btn.onclick = () => {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(prompt).then(() => {
                        btn.innerHTML = '✅ Copied!';
                        btn.classList.add('copied');
                        setTimeout(() => { 
                            btn.innerHTML = '📋 Copy AI Prompt';
                            btn.classList.remove('copied');
                        }, 2000);
                    }).catch(err => {
                        console.error('Failed to copy text: ', err);
                    });
                } else {
                    const textarea = document.createElement('textarea');
                    textarea.value = prompt;
                    textarea.style.position = 'fixed';
                    textarea.style.opacity = '0';
                    document.body.appendChild(textarea);
                    textarea.select();
                    try {
                        document.execCommand('copy');
                        btn.innerHTML = '✅ Copied!';
                        btn.classList.add('copied');
                        setTimeout(() => { 
                            btn.innerHTML = '📋 Copy AI Prompt';
                            btn.classList.remove('copied');
                        }, 2000);
                    } catch (err) {
                        console.error('Fallback copy failed: ', err);
                    }
                    document.body.removeChild(textarea);
                }
            };
            modalFooter.appendChild(btn);
        }

        if (spec) {
            const link = document.createElement('a');
            link.href = spec;
            link.target = '_blank';
            link.className = 'proto-link';
            link.style.fontSize = '0.9rem';
            link.style.marginLeft = 'auto';
            link.innerHTML = '📖 Read the full Specification &rarr;';
            modalFooter.appendChild(link);
        }
        
        if (spec || prompt) {
            modalFooter.style.display = 'flex';
            modalFooter.style.alignItems = 'center';
            modalFooter.style.gap = '1rem';
        } else {
            modalFooter.style.display = 'none';
        }
        modalOverlay.classList.add('active');
    }

    async function startAudit(domain) {
        const baseDomain = domain.trim().replace(/^https?:\/\//i, '').replace(/\/$/, '');
        if (!baseDomain) return;

        const targetUrl = `https://${baseDomain}`;
        input.value = baseDomain;
        window.location.hash = baseDomain;

        // UI Reset & Compact Layout trigger
        container.classList.add('compact-mode');
        errorMsg.classList.add('hidden');
        dashboard.classList.add('hidden');
        loadingOverlay.classList.remove('hidden');
        btn.disabled = true;
        btnText.style.display = 'none';
        loader.style.display = 'block';

        const dynamicText = document.getElementById('dynamic-loading-text');
        const stages = [
            `> Initiating deep scan: ${targetUrl}`,
            '> Analyzing agent restrictions (robots.txt)...',
            '> Verifying Content Negotiation (Headers)...',
            '> Deploying radar for /.well-known/* ...'
        ];
        let stageIdx = 0;
        const stageInterval = setInterval(() => {
            stageIdx = (stageIdx + 1) % stages.length;
            dynamicText.textContent = stages[stageIdx];
        }, 1500);

        try {
            const res = await fetch('/api/audit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetUrl })
            });

            if (!res.ok) throw new Error(`Server error: ${res.status}`);
            
            const data = await res.json();
            clearInterval(stageInterval);

            if (data.error) throw new Error(data.error);

            renderResults(data);

        } catch (err) {
            clearInterval(stageInterval);
            errorMsg.textContent = `Scan error: ${err.message}`;
            errorMsg.classList.remove('hidden');
            loadingOverlay.classList.add('hidden');
        } finally {
            btn.disabled = false;
            btnText.style.display = 'block';
            loader.style.display = 'none';
        }
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        startAudit(input.value);
    });

    // Handle deep-linking on load
    if (window.location.hash) {
        const initialDomain = window.location.hash.substring(1);
        if (initialDomain) {
            startAudit(initialDomain);
        }
    }

    function renderResults(data) {
        loadingOverlay.classList.add('hidden');
        dashboard.classList.remove('hidden');
        
        // Reset animation states optionally by forcing reflow
        dashboard.style.animation = 'none';
        dashboard.offsetHeight; /* trigger reflow */
        dashboard.style.animation = null; 

        // Summary counters will be rendered below after categorizing checks
        
        const importanceWeights = {
            "Content Neg. (MD)": 15,
            "A2A Agent Card": 10,
            "Agent Skills": 10,
            "MCP Server": 10,
            "AI Plugin": 10,
            "LLMs.txt": 10,
            "LLMs-Full.txt": 10,
            "x402 Payment Standard": 10,
            "AI Fallback (No-JS)": 10,
            "Content-Signal": 10,
            "Semantic JSON-LD": 10,
            
            "AI Search Allowed": 10,
            "AI Agent Allowed": 10,
            "AI Training Blocked": 10,
            "Differentiated Policy": 10,
            "Conditional Requests (304)": 10,

            "robots.txt": 5,
            "AI Directives": 5,
            "sitemap.xml": 5,
            "FAQ Schema": 5,
            "Authorship (E-E-A-T)": 5,
            "Content Freshness": 5,
            "External Citations": 5,
            "Quotation Addition": 5,
            "Statistics Addition": 5,
            "Viewport Meta Tag": 5,
            "NoAI Meta Tag": 5,
            "Semantic HTML": 5,
            "Heading Hierarchy": 5,
            "Scannable Formats": 5,
            "Internal Architecture": 5,
            "API Catalog": 5,
            "OAuth Discovery": 5,
            "Universal Commerce": 5,
            "TDM Reservation": 5,
            "ai.txt": 5,
            "Sitemap Lastmod": 5,
            "Content-Use Parameter": 5,
            "Freshness Headers": 5
        };

        // Flatten all checks into array and sort by importance descending, then alphabetically by name
        const allChecks = [
            ...(data?.bots?.results || []),
            ...(data?.content?.results || []),
            ...(data?.protocols?.results || [])
        ].sort((a, b) => {
            const weightA = importanceWeights[a.name] || 0;
            const weightB = importanceWeights[b.name] || 0;
            if (weightB !== weightA) {
                return weightB - weightA;
            }
            return a.name.localeCompare(b.name);
        });

        const passed = allChecks.filter(c => c.status === 'ok');
        const warnings = allChecks.filter(c => c.status === 'warn');
        const failed = allChecks.filter(c => c.status === 'err' || c.status === 'not found' || !['ok', 'warn'].includes(c.status));

        // Render Summary Counters
        animateCount('summary-passed', passed.length);
        animateCount('summary-warn', warnings.length);
        animateCount('summary-failed', failed.length);

        // Formatted renderer for the 3 grouped columns
        renderGridList('passed-grid', 'status-passed', passed, 'good', `Passed: ${passed.length}`);
        renderGridList('warn-grid', 'status-warn', warnings, warnings.length > 0 ? 'warn' : 'good', `Warnings: ${warnings.length}`);
        renderGridList('failed-grid', 'status-failed', failed, failed.length > 0 ? 'bad' : 'good', `Not found: ${failed.length}`);
    }

    function renderGridList(containerId, statusId, items, overallStatusClass, overallStatusText) {
        const grid = document.getElementById(containerId);
        const statusBadge = document.getElementById(statusId);
        grid.textContent = '';
        
        statusBadge.className = `metric-status ${overallStatusClass}`;
        statusBadge.textContent = overallStatusText;

        if (items.length === 0) {
            const emptyMsg = document.createElement('div');
            emptyMsg.style.color = 'var(--text-secondary)';
            emptyMsg.style.fontSize = '0.9rem';
            emptyMsg.style.textAlign = 'center';
            emptyMsg.style.marginTop = '1rem';
            emptyMsg.textContent = 'No items in this category.';
            grid.appendChild(emptyMsg);
            return;
        }

        const fragment = document.createDocumentFragment();
        items.forEach(p => {
            const card = document.createElement('div');
            card.className = 'protocol-card';
            
            let statusIcon = p.status === 'ok' ? '✅' : (p.status === 'warn' ? '⚠️' : '❌');
            let statusClass = p.status === 'ok' ? 'icon-ok' : (p.status === 'warn' ? 'icon-warn' : 'icon-err');
            
            // Build card structure using DOM methods to avoid innerHTML vulnerabilities
            const protoTop = document.createElement('div');
            protoTop.className = 'proto-top';

            const protoName = document.createElement('span');
            protoName.className = 'proto-name';

            const iconSpan = document.createElement('span');
            iconSpan.className = `${statusClass} icon`;
            iconSpan.textContent = statusIcon;

            protoName.appendChild(iconSpan);
            protoName.appendChild(document.createTextNode(` ${p.name}`));

            const protoBadge = document.createElement('span');
            protoBadge.className = 'proto-badge';
            protoBadge.textContent = p.code || 'Soft 404';
            
            // Map styles dynamically
            if (p.status === 'ok') {
                protoBadge.style.backgroundColor = 'var(--status-success-bg)';
                protoBadge.style.color = 'var(--status-success-text)';
            } else if (p.status === 'warn') {
                protoBadge.style.backgroundColor = 'var(--status-warning-bg)';
                protoBadge.style.color = 'var(--status-warning-text)';
            } else {
                protoBadge.style.backgroundColor = 'var(--status-error-bg)';
                protoBadge.style.color = 'var(--status-error-text)';
            }

            protoTop.appendChild(protoName);
            protoTop.appendChild(protoBadge);

            const protoMsg = document.createElement('div');
            protoMsg.className = 'proto-msg';
            protoMsg.textContent = p.message;

            const actionArea = document.createElement('div');
            actionArea.style.display = 'flex';
            actionArea.style.justifyContent = 'space-between';
            actionArea.style.alignItems = 'center';
            actionArea.style.marginTop = '0.5rem';

            if (p.tooltip) {
                const learnMoreBtn = document.createElement('button');
                learnMoreBtn.className = 'learn-more-btn';
                learnMoreBtn.textContent = 'Learn more';
                learnMoreBtn.addEventListener('click', () => {
                    const finalPrompt = p.spec && p.prompt ? `${p.prompt}\n\nFor reference, please consult the official specification: ${p.spec}` : p.prompt;
                    openModal(p.name, p.tooltip, p.spec, finalPrompt);
                });
                actionArea.appendChild(learnMoreBtn);
            } else {
                actionArea.appendChild(document.createElement('div'));
            }

            if (p.spec) {
                const specLink = document.createElement('a');
                specLink.href = p.spec;
                specLink.target = '_blank';
                specLink.className = 'proto-link';
                specLink.style.margin = '0';
                specLink.style.fontSize = '0.8rem';
                specLink.textContent = '📖 Spec →';
                actionArea.appendChild(specLink);
            }
            fragment.appendChild(card);

            card.appendChild(protoTop);
            card.appendChild(protoMsg);
            card.appendChild(actionArea);
        });
        grid.appendChild(fragment);
    }

    function animateCount(id, targetValue) {
        const el = document.getElementById(id);
        if (!el) return;
        let current = 0;
        const duration = 1000;
        let startTimestamp = null;

        const step = (timestamp) => {
            if (!startTimestamp) startTimestamp = timestamp;
            const progress = Math.min((timestamp - startTimestamp) / duration, 1);
            current = progress * targetValue;

            el.textContent = Math.round(current);

            if (progress < 1) {
                window.requestAnimationFrame(step);
            } else {
                el.textContent = targetValue;
            }
        };

        window.requestAnimationFrame(step);
    }
});
