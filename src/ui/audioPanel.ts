import type { TowerAudio } from '../audio/towerAudio';

export function installAudioPanel(audio: TowerAudio): void {
  const button = document.createElement('button');
  const update = (): void => { button.textContent = audio.preferences.muted ? 'Sound: off' : 'Sound'; };
  update();
  const dialog = document.createElement('dialog'); dialog.className = 'campaign-window';
  dialog.style.maxWidth = '380px'; dialog.setAttribute('aria-label', 'Sound settings');
  const heading = document.createElement('h2'); heading.textContent = 'Tower sounds'; dialog.append(heading);
  const mute = document.createElement('input'); mute.type = 'checkbox'; mute.checked = audio.preferences.muted;
  const label = document.createElement('label'); label.append(mute, ' Mute all sounds'); dialog.append(label);
  mute.onchange = () => { audio.configure({ muted: mute.checked }); update(); };
  for (const [key, title] of [['volume', 'Master volume'], ['ambience', 'Elevators & weather']] as const) {
    const row = document.createElement('label'); row.style.cssText = 'display:grid;gap:8px;margin:22px 0';
    const text = document.createElement('span');
    const slider = document.createElement('input'); slider.type = 'range'; slider.min = '0'; slider.max = '100';
    slider.style.accentColor = '#3f6958';
    slider.value = String(audio.preferences[key] * 100); slider.setAttribute('aria-label', title);
    const refresh = (): void => { text.textContent = `${title} · ${slider.value}%`; };
    refresh(); slider.oninput = () => { audio.configure({ [key]: Number(slider.value) / 100 }); refresh(); };
    row.append(text, slider); dialog.append(row);
  }
  const preview = document.createElement('button'); preview.textContent = 'Test elevator chime';
  preview.onclick = () => { void audio.unlock().then(() => audio.play('door')); };
  const close = document.createElement('button'); close.textContent = 'Back to tower'; close.style.marginLeft = '12px'; close.onclick = () => dialog.close();
  const help = document.createElement('p'); help.textContent = 'Sound starts after your first interaction. These settings are saved on this browser.';
  dialog.append(preview, close, help); document.body.append(dialog);
  button.onclick = () => dialog.showModal();
  document.querySelector('.game-header nav')!.append(button);
}
