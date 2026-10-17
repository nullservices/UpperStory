import type { Preferences, TowerAudio } from '../audio/towerAudio';
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
  const sliders: [keyof Preferences & ('volume' | 'ambience' | 'effects' | 'interface'), string, string][] = [
    ['volume', 'Master volume', 'Overall level of every sound.'],
    ['ambience', 'Ambience', 'Offices, shops, the street, weather and elevator machinery, following what is on screen.'],
    ['effects', 'Effects', 'Elevator bells, construction, alarms, fanfares and other tower events.'],
    ['interface', 'Interface', 'Clicks, tool selection, placement and error buzz.'],
  ];
  const inputs: [keyof Preferences, HTMLInputElement, () => void][] = [];
  for (const [key, name, hint] of sliders) {
    const row = document.createElement('label'); row.className = 'slider-row'; row.title = hint;
    const text = document.createElement('span');
    const slider = document.createElement('input'); slider.type = 'range'; slider.min = '0'; slider.max = '100';
    slider.value = String(Math.round(audio.preferences[key] * 100)); slider.setAttribute('aria-label', name);
    const refresh = (): void => { text.textContent = `${name} · ${slider.value}%`; };
    refresh(); slider.oninput = () => { audio.configure({ [key]: Number(slider.value) / 100 }); refresh(); };
    // Releasing a slider previews its bus so the level can be judged by ear.
    slider.onchange = () => { if (key === 'effects' || key === 'volume') audio.play('bell'); else if (key === 'interface') audio.play('place', 0); };
    row.append(text, slider); body.append(row);
    inputs.push([key, slider, refresh]);
  }
  const help = document.createElement('p'); help.className = 'window-hint';
  help.textContent = 'Sound starts after your first interaction, fades while the game is paused and stops in background tabs. These settings are saved on this browser.';
  body.append(help);
  const footer = document.createElement('div'); footer.className = 'window-footer';
  const preview = document.createElement('button'); preview.type = 'button'; preview.textContent = 'Test elevator chime';
  preview.onclick = () => { void audio.unlock().then(() => audio.play('bell')); };
  const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Back to tower'; close.onclick = () => dialog.close();
  footer.append(preview, close);
  dialog.append(title, body, footer); document.body.append(dialog);
  makeDraggable(dialog, title, 'offset');
  return () => {
    mute.checked = audio.preferences.muted;
    for (const [key, slider, refresh] of inputs) { slider.value = String(Math.round(Number(audio.preferences[key]) * 100)); refresh(); }
    dialog.showModal();
  };
}
