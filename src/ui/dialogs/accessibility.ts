import { makeDraggable } from '../windowing';

/**
 * Give a panel the shared window look: its first <div> child becomes the
 * coloured title bar (and drag handle), a "Close…" button becomes the
 * title-bar close box. Runs on first open because panels append their
 * children after calling configureDialog.
 */
function decorate(panel: HTMLDivElement): void {
  if (panel.dataset.decorated) return;
  panel.dataset.decorated = 'true';
  const title = panel.querySelector<HTMLElement>(':scope > div');
  if (title) {
    title.classList.add('window-title');
    makeDraggable(panel, title, 'offset');
  }
  panel.querySelector(':scope > button[title^="Close"]')?.classList.add('window-close');
}

/** Focus ownership and keyboard handling for the existing simulation windows. */
export function configureDialog(overlay: HTMLDivElement, panel: HTMLDivElement, name: string, close: () => void): void {
  panel.classList.add('game-window');
  overlay.classList.add('window-layer');
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
      decorate(panel);
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
