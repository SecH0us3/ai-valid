// Frontend Logic for AI-Valid API

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('audit-form');
    const input = document.getElementById('url-input');
    const btn = document.getElementById('submit-btn');
    const loader = document.getElementById('btn-loader');
    const btnText = document.querySelector('.btn-text');
    const errorMsg = document.getElementById('error-message');
    const loadingOverlay = document.getElementById('loading-overlay');
    const dashboard = document.getElementById('results-dashboard');
    const container = document.querySelector('.container');

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

    function openModal(title, content, spec) {
        modalTitle.textContent = title;
        modalBody.innerHTML = content;
        if (spec) {
            modalFooter.innerHTML = `<a href="${spec}" target="_blank" class="proto-link" style="font-size: 0.9rem;">📖 Read the full Specification &rarr;</a>`;
            modalFooter.style.display = 'block';
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
        grid.innerHTML = '';
        
        statusBadge.className = `metric-status ${overallStatusClass}`;
        statusBadge.textContent = overallStatusText;

        if (items.length === 0) {
            grid.innerHTML = `<div style="color: var(--text-secondary); font-size: 0.9rem; text-align: center; margin-top: 1rem;">No items in this category.</div>`;
            return;
        }

        items.forEach(p => {
            const card = document.createElement('div');
            card.className = 'protocol-card';
            
            let statusIcon = p.status === 'ok' ? '✅' : (p.status === 'warn' ? '⚠️' : '❌');
            let statusClass = p.status === 'ok' ? 'icon-ok' : (p.status === 'warn' ? 'icon-warn' : 'icon-err');
            
            card.innerHTML = `
                <div class="proto-top">
                    <span class="proto-name">
                        <span class="${statusClass} icon">${statusIcon}</span> 
                        ${p.name}
                    </span>
                    <span class="proto-badge">${p.code || 'Soft 404'}</span>
                </div>
                <div class="proto-msg">${p.message}</div>
                <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.5rem;">
                    ${p.tooltip ? `<button class="learn-more-btn">Learn more</button>` : '<div></div>'}
                    ${p.spec ? `<a href="${p.spec}" target="_blank" class="proto-link" style="margin: 0; font-size: 0.8rem;">📖 Spec &rarr;</a>` : ''}
                </div>
            `;
            const btn = card.querySelector('.learn-more-btn');
            if (btn) {
                btn.addEventListener('click', () => {
                    openModal(p.name, p.tooltip, p.spec);
                });
            }
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
        const interval = 20;
        const steps = duration / interval;
        const increment = targetScore / steps;

        const timer = setInterval(() => {
            current += increment;
            if (current >= targetScore) {
                current = targetScore;
                clearInterval(timer);
            }
            text.textContent = Math.round(current) + '%';
            circle.style.strokeDasharray = `${current}, 100`;
        }, interval);
    }
});
