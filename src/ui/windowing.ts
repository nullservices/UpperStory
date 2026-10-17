/**
 * Small window-manager helpers for the SimTower-style chrome: per-browser UI
 * preferences, draggable title bars and a shared hover tooltip.
 */

const PREFIX = 'upper-story-ui:';

/** Read a per-browser UI preference; storage failures fall back silently. */
export function readUiPref<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : { ...fallback, ...(JSON.parse(raw) as T) };
  } catch {
    return fallback;
  }
}

export function writeUiPref(key: string, value: unknown): void {
  try { window.localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* private mode / quota: not critical */ }
}

/** Space reserved by the fixed menu/info bars and the status bar. */
export function chromeInsets(): { top: number; bottom: number } {
  const top = document.querySelector<HTMLElement>('.status-strip')?.getBoundingClientRect().bottom ?? 0;
  const footer = document.querySelector<HTMLElement>('.game-footer')?.getBoundingClientRect();
  return { top, bottom: footer ? window.innerHeight - footer.top : 0 };
}

/** Keep a fixed-position window's title bar reachable inside the viewport. */
export function clampWindow(win: HTMLElement, x: number, y: number): { x: number; y: number } {
  const { top, bottom } = chromeInsets();
  const width = win.offsetWidth || 200;
  const maxX = Math.max(0, window.innerWidth - Math.min(width, 120));
  const minX = Math.min(0, -(width - 120));
  const maxY = Math.max(top, window.innerHeight - bottom - 28);
  return { x: Math.round(Math.min(maxX, Math.max(minX, x))), y: Math.round(Math.min(maxY, Math.max(top, y))) };
}

/**
 * Drag `win` by `handle`. 'fixed' windows move via left/top (and report the
 * new spot through onMove); 'offset' windows (centred modal panels) move via
 * a translate so their flex centring keeps working.
 */
export function makeDraggable(
  win: HTMLElement,
  handle: HTMLElement,
  mode: 'fixed' | 'offset',
  onMove?: (x: number, y: number) => void,
): void {
  let start: { px: number; py: number; x: number; y: number } | null = null;
  let offset = { x: 0, y: 0 };
  // placeNear may have moved an 'offset' window since the last drag.
  const currentOffset = (): { x: number; y: number } => {
    const [x = 0, y = 0] = win.style.translate.split(' ').map(v => parseFloat(v) || 0);
    return { x, y };
  };
  handle.classList.add('drag-handle');
  if (mode === 'fixed') win.addEventListener('pointerdown', () => raiseWindow(win), true);
  handle.addEventListener('pointerdown', e => {
    if (e.button !== 0 || (e.target instanceof Element && e.target.closest('button, input, select, a'))) return;
    const rect = win.getBoundingClientRect();
    start = mode === 'fixed'
      ? { px: e.clientX, py: e.clientY, x: rect.left, y: rect.top }
      : { px: e.clientX, py: e.clientY, ...(offset = currentOffset()) };
    handle.setPointerCapture(e.pointerId);
    win.classList.add('dragging');
    e.preventDefault();
  });
  handle.addEventListener('pointermove', e => {
    if (!start) return;
    const x = start.x + e.clientX - start.px;
    const y = start.y + e.clientY - start.py;
    if (mode === 'fixed') {
      const spot = clampWindow(win, x, y);
      win.style.left = `${spot.x}px`;
      win.style.top = `${spot.y}px`;
    } else {
      // Keep the title bar on screen.
      const rect = win.getBoundingClientRect();
      const baseLeft = rect.left - offset.x, baseTop = rect.top - offset.y;
      offset = {
        x: Math.min(window.innerWidth - 80 - baseLeft, Math.max(80 - rect.width - baseLeft, x)),
        y: Math.min(window.innerHeight - 40 - baseTop, Math.max(-baseTop, y)),
      };
      win.style.translate = `${offset.x}px ${offset.y}px`;
    }
  });
  const end = (): void => {
    if (!start) return;
    start = null;
    win.classList.remove('dragging');
    if (mode === 'fixed') onMove?.(win.offsetLeft, win.offsetTop);
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}

/**
 * Move a centred ('offset') window beside a screen point, like SimTower's
 * inspectors opening next to the clicked room. Must run while it is visible.
 */
export function placeNear(win: HTMLElement, x: number, y: number): void {
  win.style.translate = '';
  const rect = win.getBoundingClientRect();
  const { top, bottom } = chromeInsets();
  const gap = 28;
  const left = x + gap + rect.width <= window.innerWidth ? x + gap : Math.max(0, x - gap - rect.width);
  const maxTop = Math.max(top, window.innerHeight - bottom - rect.height);
  const desiredTop = Math.min(maxTop, Math.max(top, y - 40));
  win.style.translate = `${Math.round(left - rect.left)}px ${Math.round(desiredTop - rect.top)}px`;
}

/**
 * Nudge a centred ('offset') window vertically back between the info bar and
 * the status bar, e.g. after a collapsible section inside it opened.
 */
export function keepInView(win: HTMLElement): void {
  const rect = win.getBoundingClientRect();
  const { top, bottom } = chromeInsets();
  const [x = 0, y = 0] = win.style.translate.split(' ').map(v => parseFloat(v) || 0);
  const maxBottom = window.innerHeight - bottom - 4;
  let dy = rect.bottom > maxBottom ? maxBottom - rect.bottom : 0;
  if (rect.top + dy < top + 4) dy = top + 4 - rect.top;
  if (dy) win.style.translate = `${Math.round(x)}px ${Math.round(y + dy)}px`;
}

let topZ = 26;
/** Bring a floating window above its siblings (click-to-front). */
export function raiseWindow(win: HTMLElement): void {
  if (win.style.zIndex === String(topZ)) return;
  // Stay below modal layers (z 40+): renumber once the counter climbs.
  if (topZ >= 38) {
    topZ = 26;
    for (const other of document.querySelectorAll<HTMLElement>('.ui-window')) other.style.zIndex = '';
  }
  win.style.zIndex = String(++topZ);
}

/** Title-bar close button in the shared window style. */
export function closeButton(label: string, action: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'window-close';
  button.type = 'button';
  button.textContent = '×';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.onclick = action;
  return button;
}

let tip: HTMLDivElement | null = null;
let tipTimer = 0;

function tooltipEl(): HTMLDivElement {
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'ui-tooltip';
    tip.setAttribute('role', 'tooltip');
    tip.id = 'ui-tooltip';
    tip.hidden = true;
    document.body.append(tip);
  }
  return tip;
}

/** Show `content()` beside `target` after a short hover (immediately on focus). */
export function attachTooltip(target: HTMLElement, content: () => string): void {
  const show = (delay: number): void => {
    window.clearTimeout(tipTimer);
    tipTimer = window.setTimeout(() => {
      if (!target.isConnected) return;
      const el = tooltipEl();
      el.innerHTML = content();
      el.hidden = false;
      target.setAttribute('aria-describedby', el.id);
      const rect = target.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      let x = rect.right + 8;
      if (x + box.width > window.innerWidth - 6) x = rect.left - box.width - 8;
      const y = Math.min(window.innerHeight - box.height - 6, Math.max(6, rect.top + rect.height / 2 - box.height / 2));
      el.style.left = `${Math.max(6, x)}px`;
      el.style.top = `${y}px`;
    }, delay);
  };
  const hide = (): void => {
    window.clearTimeout(tipTimer);
    target.removeAttribute('aria-describedby');
    if (tip) tip.hidden = true;
  };
  target.addEventListener('pointerenter', () => show(350));
  target.addEventListener('pointerleave', hide);
  target.addEventListener('focus', () => { if (target.matches(':focus-visible')) show(0); });
  target.addEventListener('blur', hide);
  target.addEventListener('pointerdown', hide);
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
