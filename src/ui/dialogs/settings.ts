import { configureDialog } from './accessibility';

// Keep the existing save key so the rebrand preserves users' saved towers.
export const SAVE_KEY = 'towerproject-save-v1';
export interface SettingsCallbacks {
  onNewGame: (seed: number) => void;
  onSave: () => string | null;
  onLoad: () => string | null;
}
export class SettingsDialog {
  private overlay = document.createElement('div');
  private status = document.createElement('p');
  private loadButton: HTMLButtonElement;
  private newButton: HTMLButtonElement;
  private seed = document.createElement('input');
  private armed: 'new' | 'load' | null = null;
  constructor(private callbacks: SettingsCallbacks) {
    this.overlay.style.cssText = 'position:fixed;inset:0;z-index:40;display:none;align-items:center;justify-content:center;background:#263e342e';
    const panel = document.createElement('div');
    panel.className = 'settings-window';
    panel.innerHTML = '<div class="settings-heading"><small>A VERTICAL WORLD</small><h2>Upper Story</h2><p>Your tower is paused while this window is open.</p></div>';
    const save = this.button('Save tower', () => {
      const error = this.callbacks.onSave();
      this.status.textContent = error ?? 'Tower saved on this browser.';
      this.status.classList.toggle('error', error !== null);
      this.refresh();
    });
    this.loadButton = this.button('Load saved tower', () => {
      if (this.armed !== 'load') {
        this.armed = 'load'; this.newButton.textContent = 'Start a new tower';
        this.loadButton.textContent = 'Replace current tower with save';
        this.status.textContent = 'Unsaved changes will be lost. Click again to load.'; return;
      }
      const error = this.callbacks.onLoad();
      if (error) { this.status.textContent = error; this.status.classList.add('error'); }
      else this.close();
    });
    this.newButton = this.button('Start a new tower', () => {
      if (this.armed !== 'new') {
        this.armed = 'new'; this.loadButton.textContent = 'Load saved tower';
        this.newButton.textContent = 'Confirm new tower';
        this.status.textContent = 'Save first if you want to keep this tower. Click again to start fresh.'; return;
      }
      const value = this.seed.value.trim();
      const seed = value === '' ? Math.floor(Math.random() * 0xffffffff) : Number(value);
      if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) {
        this.status.textContent = 'Use a whole number from 0 to 4,294,967,295.'; return;
      }
      this.callbacks.onNewGame(seed); this.close();
    });
    const actions = document.createElement('div'); actions.className = 'settings-actions';
    actions.append(save, this.loadButton, this.newButton);
    const advanced = document.createElement('details'); advanced.innerHTML = '<summary>World seed (optional)</summary>';
    this.seed.placeholder = 'Random'; this.seed.setAttribute('aria-label', 'World seed'); this.seed.inputMode = 'numeric';
    advanced.append(this.seed);
    this.status.className = 'settings-message'; this.status.setAttribute('role', 'status');
    const resume = this.button('Return to tower', () => this.close()); resume.className = 'resume-button';
    const tour = document.createElement('a');
    tour.href = '?demo=1'; tour.target = '_blank'; tour.rel = 'noopener';
    tour.className = 'tour-link'; tour.textContent = 'Explore a populated tower ↗';
    panel.append(actions, tour, advanced, this.status, resume);
    this.overlay.append(panel); document.body.append(this.overlay);
    configureDialog(this.overlay, panel, 'Game options', () => this.close());
    this.overlay.addEventListener('pointerdown', e => { if (e.target === this.overlay) this.close(); });
  }
  open(): void {
    this.armed = null; this.newButton.textContent = 'Start a new tower'; this.loadButton.textContent = 'Load saved tower';
    this.status.textContent = ''; this.status.classList.remove('error'); this.refresh(); this.overlay.style.display = 'flex';
  }
  close(): void { this.overlay.style.display = 'none'; }
  private refresh(): void {
    try { this.loadButton.disabled = localStorage.getItem(SAVE_KEY) === null; }
    catch { this.loadButton.disabled = true; }
  }
  private button(text: string, action: () => void): HTMLButtonElement {
    const button = document.createElement('button'); button.textContent = text; button.onclick = action; return button;
  }
}
