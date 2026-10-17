import { configureDialog } from './accessibility';
import type { GameState } from '../../sim';
import { AUTOSAVE_ID, LEGACY_SAVE_KEY, SAVE_FILE_EXTENSION, SAVE_FILE_MIME, describeSaveError, type SaveFileExport, type SaveManager, type SaveMeta } from '../../persistence';
import { closeButton } from '../windowing';

// Keep the existing save key so the rebrand preserves users' saved towers.
// Saves now live in IndexedDB; this key is only read to import old saves.
export const SAVE_KEY = LEGACY_SAVE_KEY;

export interface SettingsCallbacks {
  onNewGame: (seed: number, lobbyHeight: 1 | 2 | 3) => void;
  /** The live tower to save. */
  getState: () => GameState;
  /** A slot finished loading; swap it in. */
  onLoaded: (state: GameState, meta: SaveMeta) => void;
  /** Open the scenario chooser (Game › Scenarios…). */
  onOpenScenarios?: () => void;
}

export type GameSection = 'new' | 'save' | 'load';

const KIND_LABEL: Record<SaveMeta['kind'], string> = { manual: '', auto: 'Autosave', legacy: 'Earlier version' };

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Hand a file to the browser's normal download flow. */
function download(file: SaveFileExport): void {
  const url = URL.createObjectURL(new Blob([file.bytes as BlobPart], { type: SAVE_FILE_MIME }));
  const link = document.createElement('a');
  link.href = url;
  link.download = file.fileName;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function formatSavedAt(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/**
 * The Game window: save slots (save as / overwrite / load / delete), new
 * tower options, and storage status. The tower is paused while it is open.
 */
export class SettingsDialog {
  private overlay = document.createElement('div');
  private status = document.createElement('p');
  private list = document.createElement('div');
  private nameInput = document.createElement('input');
  private saveButton: HTMLButtonElement;
  private newButton: HTMLButtonElement;
  private seed = document.createElement('input');
  private lobbyHeight = document.createElement('select');
  private armed: string | null = null;
  private busy = false;
  private metas: SaveMeta[] = [];
  private requestedPersistence = false;

  private warning = document.createElement('p');
  private fileInput = document.createElement('input');
  /** Slot to highlight after an import. */
  private highlight: string | null = null;

  constructor(private callbacks: SettingsCallbacks, private saves: SaveManager) {
    this.overlay.style.cssText = 'position:fixed;inset:0;z-index:40;display:none;align-items:center;justify-content:center;background:rgba(20,32,48,0.10)';
    const panel = document.createElement('div');
    panel.className = 'settings-window';
    const title = document.createElement('div');
    title.innerHTML = '<span class="title-text">Game</span>';
    const close = closeButton('Close game window', () => this.close());

    const body = document.createElement('div');
    body.className = 'window-body';
    const note = document.createElement('p');
    note.className = 'window-note';
    note.textContent = 'Your tower is paused while this window is open.';
    this.warning.className = 'window-note error';
    this.warning.hidden = true;
    body.append(this.warning);

    // --- Saved towers ---
    const savesGroup = this.group('Saved towers');
    this.list.className = 'save-list';
    this.list.setAttribute('role', 'list');
    const saveRow = document.createElement('div');
    saveRow.className = 'save-row';
    this.nameInput.placeholder = 'Name this save (optional)';
    this.nameInput.maxLength = 48;
    this.nameInput.setAttribute('aria-label', 'Save name');
    this.nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); void this.saveNew(); } });
    this.saveButton = this.button('Save as new', () => void this.saveNew());
    this.saveButton.classList.add('default');
    saveRow.append(this.nameInput, this.saveButton);
    const storageNote = document.createElement('p');
    storageNote.className = 'window-hint';
    storageNote.textContent = `Saved in this browser${saves.compressed ? ', compressed' : ''}. An autosave is kept at the end of every quarter and when you leave the page.`;
    // --- Save files: move towers between browsers or keep backups ---
    const fileRow = document.createElement('div');
    fileRow.className = 'save-files';
    this.fileInput.type = 'file';
    this.fileInput.accept = `${SAVE_FILE_EXTENSION},.json,.gz,application/gzip,application/json`;
    this.fileInput.hidden = true;
    this.fileInput.setAttribute('aria-label', 'Import a save file');
    this.fileInput.addEventListener('change', () => {
      const file = this.fileInput.files?.[0];
      this.fileInput.value = '';
      if (file) void this.importFile(file);
    });
    const exportCurrent = this.button('Export current tower…', () => void this.exportCurrent());
    exportCurrent.title = `Download the tower you are playing as a ${SAVE_FILE_EXTENSION} file`;
    const importButton = this.button('Import…', () => this.fileInput.click());
    importButton.title = `Add a ${SAVE_FILE_EXTENSION} file as a new saved tower (or drop it on this window)`;
    const fileHint = document.createElement('span');
    fileHint.className = 'window-hint';
    fileHint.textContent = `${SAVE_FILE_EXTENSION} files · drop one here to import`;
    fileRow.append(exportCurrent, importButton, fileHint, this.fileInput);
    savesGroup.append(this.list, saveRow, fileRow, storageNote);

    // --- New tower ---
    const newGroup = this.group('New tower');
    const heightLabel = document.createElement('label');
    heightLabel.className = 'field-row';
    heightLabel.append('Lobby height');
    for (const height of [1, 2, 3]) this.lobbyHeight.add(new Option(`${height} ${height === 1 ? 'story' : 'stories'}`, String(height)));
    this.lobbyHeight.setAttribute('aria-label', 'Lobby height for a new tower');
    heightLabel.append(this.lobbyHeight);
    const seedLabel = document.createElement('label');
    seedLabel.className = 'field-row';
    seedLabel.append('World seed');
    this.seed.placeholder = 'Random'; this.seed.setAttribute('aria-label', 'World seed'); this.seed.inputMode = 'numeric';
    seedLabel.append(this.seed);
    this.newButton = this.button('Start new tower', () => this.startNew());
    const tour = document.createElement('a');
    tour.href = '?demo=1'; tour.target = '_blank'; tour.rel = 'noopener';
    tour.className = 'tour-link'; tour.textContent = 'Explore a populated tower ↗';
    const newActions = document.createElement('div');
    newActions.className = 'new-actions';
    newActions.append(this.newButton, tour);
    newGroup.append(heightLabel, seedLabel, newActions);
    if (callbacks.onOpenScenarios) {
      const challenge = document.createElement('div');
      challenge.className = 'scenario-offer';
      const text = document.createElement('span');
      text.textContent = 'Prefer a challenge? Scenarios set goals, limits and a deadline.';
      challenge.append(text, this.button('Scenarios…', () => { this.close(); callbacks.onOpenScenarios?.(); }));
      newGroup.append(challenge);
    }

    this.status.className = 'settings-message'; this.status.setAttribute('role', 'status');
    body.append(note, savesGroup, newGroup, this.status);
    const footer = document.createElement('div');
    footer.className = 'window-footer';
    footer.append(this.button('Return to tower', () => this.close()));

    panel.append(title, close, body, footer);
    this.overlay.append(panel); document.body.append(this.overlay);
    configureDialog(this.overlay, panel, 'Game options', () => this.close());
    this.overlay.addEventListener('pointerdown', e => { if (e.target === this.overlay) this.close(); });
    // Drag a save file onto the window to import it.
    let depth = 0;
    const hasFiles = (e: DragEvent): boolean => [...(e.dataTransfer?.types ?? [])].includes('Files');
    panel.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); depth++; panel.classList.add('drop-target'); });
    panel.addEventListener('dragover', e => { if (!hasFiles(e)) return; e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; });
    panel.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) panel.classList.remove('drop-target'); });
    panel.addEventListener('drop', e => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      panel.classList.remove('drop-target');
      const files = e.dataTransfer?.files;
      if (!files?.length) return;
      if (files.length > 1) this.setStatus('Drop one save file at a time.', true);
      else void this.importFile(files[0]!);
    });
    // A file dropped beside the window must not navigate away from the game.
    this.overlay.addEventListener('dragover', e => e.preventDefault());
    this.overlay.addEventListener('drop', e => e.preventDefault());
  }

  open(section: GameSection = 'save'): void {
    this.armed = null;
    this.highlight = null;
    this.newButton.textContent = 'Start new tower';
    this.setStatus('');
    this.overlay.style.display = 'flex';
    void this.refresh().then(() => {
      if (section === 'save') this.nameInput.focus();
      else if (section === 'new') this.lobbyHeight.focus();
      else this.list.querySelector<HTMLButtonElement>('button.load')?.focus();
    });
  }

  close(): void { this.overlay.style.display = 'none'; }

  /** Shown when browser storage could not be opened (saves are session-only). */
  setStorageWarning(text: string): void {
    this.warning.textContent = text;
    this.warning.hidden = false;
  }

  private async refresh(): Promise<void> {
    try {
      this.metas = await this.saves.list();
      if (this.saves.legacyError) this.setStatus(this.saves.legacyError, true);
    } catch (err) {
      this.metas = [];
      this.setStatus(`Could not read saved towers: ${describeSaveError(err)}`, true);
    }
    this.renderList();
  }

  private renderList(): void {
    this.list.replaceChildren();
    if (!this.metas.length) {
      const empty = document.createElement('p');
      empty.className = 'save-empty';
      empty.textContent = 'No saved towers yet.';
      this.list.append(empty);
      return;
    }
    for (const meta of this.metas) {
      const row = document.createElement('div');
      row.className = 'save-slot';
      if (meta.id === this.highlight) row.classList.add('fresh');
      row.setAttribute('role', 'listitem');
      const info = document.createElement('div');
      info.className = 'save-info';
      const name = document.createElement('b');
      name.textContent = meta.name;
      if (KIND_LABEL[meta.kind]) {
        const badge = document.createElement('span');
        badge.className = `save-badge ${meta.kind}`;
        badge.textContent = KIND_LABEL[meta.kind];
        name.append(' ', badge);
      }
      const detail = document.createElement('span');
      // Default names already carry the date ("Tower · 1st WD / …"); don't repeat it.
      detail.textContent = [meta.name.includes(meta.dateLabel) ? '' : meta.dateLabel, `${meta.population.toLocaleString('en-US')} people`, meta.stars >= 6 ? 'TOWER' : '★'.repeat(Math.max(0, meta.stars))].filter(Boolean).join(' · ');
      const when = document.createElement('small');
      when.textContent = `Saved ${formatSavedAt(meta.savedAt)} · ${formatBytes(meta.bytes)}`;
      info.append(name, detail, when);
      const actions = document.createElement('div');
      actions.className = 'save-actions';
      const load = this.armable(`load:${meta.id}`, 'Load', 'Confirm load', `Load “${meta.name}”? Unsaved progress on the current tower will be lost. Click again to load.`, () => void this.load(meta));
      load.classList.add('load');
      actions.append(load);
      if (meta.kind === 'manual') {
        actions.append(this.armable(`over:${meta.id}`, 'Save here', 'Confirm overwrite', `Replace “${meta.name}” with the current tower? Click again to overwrite.`, () => void this.overwrite(meta)));
      }
      const exportButton = this.button('Export', () => void this.exportSlot(meta));
      exportButton.title = `Download “${meta.name}” as a ${SAVE_FILE_EXTENSION} file`;
      exportButton.disabled = this.busy;
      actions.append(exportButton);
      actions.append(this.armable(`del:${meta.id}`, 'Delete', 'Confirm delete', `Delete “${meta.name}” permanently? Click again to delete.`, () => void this.remove(meta), 'danger'));
      row.append(info, actions);
      this.list.append(row);
    }
  }

  private armable(key: string, label: string, armedLabel: string, warning: string, run: () => void, cls?: string): HTMLButtonElement {
    const button = this.button(this.armed === key ? armedLabel : label, () => {
      if (this.armed !== key) {
        this.armed = key;
        this.newButton.textContent = 'Start new tower';
        this.renderList();
        this.setStatus(warning);
        this.list.querySelector<HTMLButtonElement>(`button[data-key="${CSS.escape(key)}"]`)?.focus();
        return;
      }
      this.armed = null;
      run();
    });
    button.dataset.key = key;
    if (cls) button.classList.add(cls);
    if (this.armed === key) button.classList.add('armed');
    button.disabled = this.busy;
    return button;
  }

  private async saveNew(): Promise<void> {
    await this.run('Saving…', async () => {
      const meta = await this.saves.save(this.callbacks.getState(), { name: this.nameInput.value });
      this.nameInput.value = '';
      return `Saved “${meta.name}” (${formatBytes(meta.bytes)}).`;
    });
  }

  private async overwrite(meta: SaveMeta): Promise<void> {
    await this.run('Saving…', async () => {
      const saved = await this.saves.save(this.callbacks.getState(), { id: meta.id, name: meta.name });
      return `Saved over “${saved.name}” (${formatBytes(saved.bytes)}).`;
    });
  }

  private async load(meta: SaveMeta): Promise<void> {
    let loaded: GameState | null = null;
    await this.run('Loading…', async () => {
      loaded = await this.saves.load(meta.id);
      return '';
    }, false);
    if (loaded) {
      this.callbacks.onLoaded(loaded, meta);
      this.close();
    }
  }

  private async exportSlot(meta: SaveMeta): Promise<void> {
    await this.run('Preparing file…', async () => {
      const file = await this.saves.exportSlot(meta.id);
      download(file);
      return `Exported “${meta.name}” as ${file.fileName} (${formatBytes(file.bytes.byteLength)}).`;
    }, false);
  }

  private async exportCurrent(): Promise<void> {
    await this.run('Preparing file…', async () => {
      const file = await this.saves.exportState(this.callbacks.getState(), this.nameInput.value);
      download(file);
      return `Exported the current tower as ${file.fileName} (${formatBytes(file.bytes.byteLength)}).`;
    }, false);
  }

  private async importFile(file: File): Promise<void> {
    await this.run('Importing…', async () => {
      const meta = await this.saves.importFile(new Uint8Array(await file.arrayBuffer()), file.name);
      this.highlight = meta.id;
      return `Imported “${meta.name}” as a new saved tower. Load it from the list when you're ready.`;
    });
  }

  private async remove(meta: SaveMeta): Promise<void> {
    await this.run('Deleting…', async () => {
      await this.saves.delete(meta.id);
      return meta.id === AUTOSAVE_ID ? 'Autosave deleted.' : `Deleted “${meta.name}”.`;
    });
  }

  /** Run one storage operation with the window locked and errors reported. */
  private async run(progress: string, task: () => Promise<string>, refresh = true): Promise<void> {
    if (this.busy) return;
    this.setBusy(true);
    this.setStatus(progress);
    try {
      const message = await task();
      this.setStatus(message);
      this.requestPersistence();
    } catch (err) {
      this.setStatus(describeSaveError(err), true);
    } finally {
      this.setBusy(false);
      if (refresh) await this.refresh();
    }
  }

  private startNew(): void {
    if (this.armed !== 'new') {
      this.armed = 'new';
      this.renderList();
      this.newButton.textContent = 'Confirm new tower';
      this.setStatus('Save first if you want to keep this tower. Click again to start fresh.');
      return;
    }
    const value = this.seed.value.trim();
    const seed = value === '' ? Math.floor(Math.random() * 0xffffffff) : Number(value);
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) {
      this.setStatus('Use a whole number from 0 to 4,294,967,295.', true); return;
    }
    this.armed = null;
    this.callbacks.onNewGame(seed, Number(this.lobbyHeight.value) as 1 | 2 | 3);
    this.close();
  }

  /** Ask the browser not to evict saves under storage pressure (best effort). */
  private requestPersistence(): void {
    if (this.requestedPersistence) return;
    this.requestedPersistence = true;
    try { void navigator.storage?.persist?.().catch(() => false); } catch { /* unsupported */ }
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    this.overlay.classList.toggle('busy', busy);
    for (const button of this.overlay.querySelectorAll<HTMLButtonElement>('.save-list button, .save-row button, .save-files button')) button.disabled = busy;
  }

  private setStatus(text: string, error = false): void {
    this.status.textContent = text;
    this.status.classList.toggle('error', error);
  }

  private group(label: string): HTMLFieldSetElement {
    const group = document.createElement('fieldset');
    group.className = 'window-group';
    const legend = document.createElement('legend');
    legend.textContent = label;
    group.append(legend);
    return group;
  }

  private button(text: string, action: () => void): HTMLButtonElement {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = text; button.onclick = action; return button;
  }
}
