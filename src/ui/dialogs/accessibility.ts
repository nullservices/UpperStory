/** Focus ownership and keyboard handling for the existing simulation windows. */
export function configureDialog(overlay: HTMLDivElement, panel: HTMLDivElement, name: string, close: () => void): void {
  panel.classList.add('game-window');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', name);
  overlay.dataset.open = 'false';
  let previous: HTMLElement | null = null;
  const focusable = (): HTMLElement[] => [...panel.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, [tabindex="0"]')];
  new MutationObserver(() => {
    const open = overlay.style.display !== 'none';
    if (open === (overlay.dataset.open === 'true')) return;
    overlay.dataset.open = String(open);
    if (open) {
      previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      focusable()[0]?.focus();
    } else previous?.focus();
  }).observe(overlay, { attributes: true, attributeFilter: ['style'] });
  window.addEventListener('keydown', e => {
    if (overlay.style.display === 'none') return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); }
    if (e.key === 'Tab') {
      const elements = focusable(), first = elements[0], last = elements[elements.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
  }, true);
}
