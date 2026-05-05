export const onboardingCSS = `
.onboarding-overlay {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.72);
  backdrop-filter: blur(2px);
  z-index: 10000;
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
  font-family: var(--font, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif);
  animation: ob-fade-in 160ms ease-out;
}
@keyframes ob-fade-in { from { opacity: 0; } to { opacity: 1; } }

.onboarding-modal {
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 16px;
  width: 100%; max-width: 760px;
  max-height: 92vh;
  color: var(--text);
  display: flex; flex-direction: column;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
}

.onboarding-header {
  display: flex; align-items: baseline; justify-content: space-between;
  padding: 22px 28px 16px;
  border-bottom: 1px solid var(--border);
}
.onboarding-header h2 { margin: 0; font-size: 18px; font-weight: 600; color: var(--text); }
.onboarding-step-indicator { font-size: 12px; color: var(--text-muted); }

.onboarding-body {
  padding: 24px 28px;
  overflow-y: auto;
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px;
}

.onboarding-footer {
  display: flex; justify-content: space-between; align-items: center;
  padding: 16px 28px;
  border-top: 1px solid var(--border);
}
.onboarding-actions { display: flex; gap: 8px; }

.onboarding-skip {
  background: none; border: none;
  color: var(--text-muted);
  font-size: 13px; cursor: pointer;
  padding: 8px 4px;
  text-decoration: underline;
}
.onboarding-skip:hover { color: var(--text); }

.onboarding-back, .onboarding-next {
  padding: 8px 18px; border-radius: 8px;
  font-size: 14px; font-weight: 500; cursor: pointer;
  border: 1px solid var(--border);
  background: var(--bg-surface);
  color: var(--text);
  transition: background 120ms, border-color 120ms;
}
.onboarding-back:hover { background: var(--border); }
.onboarding-next:not(:disabled) {
  background: var(--accent);
  border-color: var(--accent);
  color: #0a0f1c;
}
.onboarding-next:not(:disabled):hover { filter: brightness(1.08); }
.onboarding-next:disabled { opacity: 0.4; cursor: not-allowed; }

.case-card, .therapy-card {
  display: flex; flex-direction: column; align-items: center;
  padding: 18px 12px;
  border: 2px solid var(--border);
  border-radius: 12px;
  background: var(--bg-surface);
  cursor: pointer; text-align: center;
  user-select: none;
  transition: border-color 140ms, transform 140ms, background 140ms;
  color: var(--text);
}
.case-card:hover, .therapy-card:hover {
  border-color: var(--accent);
  transform: translateY(-2px);
}
.case-card.selected, .therapy-card.selected {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.case-card:focus-visible, .therapy-card:focus-visible {
  outline: 2px solid var(--accent); outline-offset: 2px;
}

.case-figure, .therapy-icon {
  height: 110px;
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 12px;
  color: var(--text);
}
.case-label, .therapy-label { font-size: 14px; font-weight: 600; margin-bottom: 4px; line-height: 1.3; }
.case-sub, .therapy-sub { font-size: 12px; color: var(--text-muted); line-height: 1.4; }
`;
