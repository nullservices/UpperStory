import type { TowerAudio } from '../audio/towerAudio';
import { closeButton, makeDraggable } from './windowing';

/** Build the Sound window; returns a function that opens it (Game › Sound…). */
export function installAudioPanel(audio: TowerAudio): () => void {
  const dialog = document.createElement('dialog'); dialog.className = 'ui-dialog sound-window';
  dialog.setAttribute('aria-label', 'Sound settings');
  const title = document.createElement('div'); title.className = 'window-title';
  title.innerHTML = '<span class="title-text">Sound</span>';
  title.append(closeButton('Close sound settings', () => dialog.close()));
  const body = document.createElement('div'); body.className = 'window-body';
  const mute = document.createElement('input'); mute.type = 'checkbox'; mute.checked = audio.preferences.muted;
  const label = document.createElement('label'); label.className = 'check-row'; label.append(mute, ' Mute all sounds'); body.append(label);
  mute.onchange = () => { audio.configure({ muted: mute.checked }); };
  for (const [key, name] of [['volume', 'Master volume'], ['ambience', 'Elevators & weather']] as const) {
    const row = document.createElement('label'); row.className = 'slider-row';
    const text = document.createElement('span');
    const slider = document.createElement('input'); slider.type = 'range'; slider.min = '0'; slider.max = '100';
    slider.value = String(audio.preferences[key] * 100); slider.setAttribute('aria-label', name);
    const refresh = (): void => { text.textContent = `${name} · ${slider.value}%`; };
    refresh(); slider.oninput = () => { audio.configure({ [key]: Number(slider.value) / 100 }); refresh(); };
    row.append(text, slider); body.append(row);
  }
  const help = document.createElement('p'); help.className = 'window-hint';
  help.textContent = 'Sound starts after your first interaction. These settings are saved on this browser.';
  body.append(help);
  const footer = document.createElement('div'); footer.className = 'window-footer';
  const preview = document.createElement('button'); preview.type = 'button'; preview.textContent = 'Test elevator chime';
  preview.onclick = () => { void audio.unlock().then(() => audio.play('door')); };
  const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Back to tower'; close.onclick = () => dialog.close();
  footer.append(preview, close);
  dialog.append(title, body, footer); document.body.append(dialog);
  makeDraggable(dialog, title, 'offset');
  return () => { mute.checked = audio.preferences.muted; dialog.showModal(); };
}
