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
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const whitelist = ['STRONG', 'CODE', 'BR', 'EM'];

        function clean(node) {
            const children = Array.from(node.childNodes);
            for (const child of children) {
                if (child.nodeType === Node.ELEMENT_NODE) {
                    if (!whitelist.includes(child.tagName)) {
                        const text = document.createTextNode(child.textContent);
                        node.replaceChild(text, child);
                    } else {
                        // Strip all attributes
                        while (child.attributes.length > 0) {
                            child.removeAttribute(child.attributes[0].name);
                        }
                        clean(child);
                    }
                }
            }
        }

        clean(doc.body);
        return doc.body.innerHTML;
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
            btn.className = 'glow-button';
            btn.style.padding = '0.4rem 1rem';
            btn.style.fontSize = '0.9rem';
            btn.innerHTML = '📋 Copy AI Prompt';
            btn.onclick = () => {
                navigator.clipboard.writeText(prompt);
                btn.innerHTML = '✅ Copied!';
                setTimeout(() => { btn.innerHTML = '📋 Copy AI Prompt'; }, 2000);
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

        // Score Render
        animateScore(data.score.total);
        
        // Flatten all checks into array
        const allChecks = [
            ...data.bots.results,
            ...data.content.results,
            ...data.protocols.results
        ];

        const passed = allChecks.filter(c => c.status === 'ok');
        const warnings = allChecks.filter(c => c.status === 'warn');
        const failed = allChecks.filter(c => c.status === 'err' || c.status === 'not found' || !['ok', 'warn'].includes(c.status));

        // Formatted renderer for the 3 grouped columns
        renderGridList('passed-grid', 'status-passed', passed, 'good', `Passed: ${passed.length}`);
        renderGridList('warn-grid', 'status-warn', warnings, warnings.length > 0 ? 'neutral' : 'good', `Warnings: ${warnings.length}`);
        renderGridList('failed-grid', 'status-failed', failed, failed.length > 0 ? 'bad' : 'good', `Failed: ${failed.length}`);
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

            card.appendChild(protoTop);
            card.appendChild(protoMsg);
            card.appendChild(actionArea);

            grid.appendChild(card);
        });
    }

    function animateScore(targetScore) {
        const circle = document.getElementById('score-circle-path');
        const text = document.getElementById('total-score');
        const verdict = document.getElementById('score-verdict');
        
        // Color update based on score
        circle.classList.remove('score-color-high', 'score-color-med', 'score-color-low');
        if (targetScore >= 80) circle.classList.add('score-color-high');
        else if (targetScore >= 40) circle.classList.add('score-color-med');
        else circle.classList.add('score-color-low');

        if (targetScore >= 85) verdict.textContent = "Outstanding. The site is perfectly ready for agents.";
        else if (targetScore >= 50) verdict.textContent = "Satisfactory. Basic protocols are configured.";
        else if (targetScore >= 10) verdict.textContent = "Needs attention. Agents will struggle to interact.";
        else verdict.textContent = "Not found. The site is completely 'blind' to AI agents.";

        let current = 0;
        circle.style.strokeDasharray = `0, 100`;
        
        const duration = 1500;
        let startTimestamp = null;

        const step = (timestamp) => {
            if (!startTimestamp) startTimestamp = timestamp;
            const progress = Math.min((timestamp - startTimestamp) / duration, 1);
            current = progress * targetScore;

            text.textContent = Math.round(current) + '%';
            circle.style.strokeDasharray = `${current}, 100`;

            if (progress < 1) {
                window.requestAnimationFrame(step);
            } else {
                current = targetScore;
                text.textContent = Math.round(current) + '%';
                circle.style.strokeDasharray = `${current}, 100`;
            }
        };

        window.requestAnimationFrame(step);
    }
});
