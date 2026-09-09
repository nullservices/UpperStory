import { PROGRESSION, TENANT_DATA } from '../data/config';
import { respondToIncident, type IncidentResponse } from '../sim/campaign';
import { progressionRequirements } from '../sim/progression';
import type { GameState } from '../sim/state';
import { TOOL_INFO } from './toolPalette';

/** Persistent incident history and an explicit checklist for every rating. */
export class CampaignPanel {
  private readonly button = document.createElement('button');
  private dialog: HTMLDialogElement | null = null;
  private state: GameState | null = null;
  constructor(private readonly focusFloor: (floor: number, x: number) => void, private readonly toast: (text: string) => void) {
    this.button.textContent = 'Events & ratings';
    this.button.onclick = () => this.open();
    document.querySelector('.game-header nav')!.append(this.button);
  }
  update(state: GameState): void {
    this.state = state;
    const count = state.campaign.incidents.length;
    this.button.textContent = `Events & ratings${count ? ` (${count})` : ''}`;
    this.button.classList.toggle('incident-alert', count > 0);
  }
  private open(): void {
    if (!this.state || this.dialog) return;
    const dialog = document.createElement('dialog');
    this.dialog = dialog;
    dialog.className = 'campaign-window';
    dialog.setAttribute('aria-label', 'Events and tower ratings');
    dialog.addEventListener('close', () => { dialog.remove(); this.dialog = null; });
    this.render();
    document.body.append(dialog);
    dialog.showModal();
  }
  private render(): void {
    const state = this.state;
    const dialog = this.dialog;
    if (!state || !dialog) return;
    dialog.replaceChildren();
    const heading = document.createElement('h2');
    heading.textContent = 'Tower operations';
    const close = this.action('Back to tower', () => dialog.close());
    const header = document.createElement('div'); header.className = 'campaign-heading'; header.append(heading, close); dialog.append(header);
    const summary = document.createElement('p');
    summary.textContent = `Day ${state.calendar.day} · ${state.calendar.day % 3 === 0 ? 'Weekend' : 'Weekday'} · ${state.campaign.weather === 'rain' ? 'Rain' : 'Clear weather'}${state.campaign.bankrupt ? ' · Tower in debt' : ''}`;
    dialog.append(summary);
    for (const incident of state.campaign.incidents) {
      const tenant = state.tenants.get(incident.tenantId);
      if (!tenant) continue;
      const section = document.createElement('section'); section.className = 'incident-card';
      const title = document.createElement('h3');
      title.textContent = `${incident.kind === 'vip' ? 'VIP inspection' : incident.kind === 'bomb' ? 'Bomb threat' : incident.kind === 'fire' ? 'Fire' : 'Cockroaches'} · ${TOOL_INFO[tenant.type].label} · ${tenant.floor <= 0 ? `B${1 - tenant.floor}` : `Floor ${tenant.floor}`}`;
      const remaining = document.createElement('p');
      remaining.textContent = `${Math.max(0, Math.ceil((incident.deadline - state.tickCount) / 10))} seconds at 1× remaining. ${incident.response ? 'Response underway.' : incident.kind === 'vip' ? 'Keep the suite clean and transport running.' : 'Choose a response, then return to the tower.'}`;
      section.append(title, remaining, this.action('Show location', () => { this.focusFloor(tenant.floor, tenant.x); dialog.close(); }));
      const options: [IncidentResponse, string][] = incident.kind === 'fire' ? [['rescue', 'Call fire rescue · $50,000']]
        : incident.kind === 'bomb' ? [['search', 'Send security'], ['ransom', 'Pay ransom · $100,000']]
          : incident.kind === 'infestation' ? [['exterminate', 'Pest control · $2,500']] : [];
      if (!incident.response) for (const [action, label] of options) section.append(this.action(label, () => {
        try { respondToIncident(state, incident.id, action); this.render(); }
        catch (error) { this.toast(error instanceof Error ? error.message : String(error)); }
      }));
      dialog.append(section);
    }
    for (const gate of PROGRESSION) {
      const section = document.createElement('section'); section.className = 'rating-card';
      const title = document.createElement('h3'); title.textContent = `${state.starLevel >= gate.star ? '✓ ' : ''}${gate.star === 6 ? 'TOWER · Cathedral wedding' : `${gate.star} stars`}`;
      const list = document.createElement('ul');
      for (const requirement of progressionRequirements(state, gate.star)) {
        const item = document.createElement('li'); item.textContent = `${requirement.met ? '✓' : '○'} ${requirement.label}`; list.append(item);
      }
      const unlocks = document.createElement('p');
      const facilities = Object.entries(TENANT_DATA).filter(([, data]) => data.unlockedAtStar === gate.star).map(([type]) => TOOL_INFO[type as keyof typeof TENANT_DATA].label);
      if (gate.star === 2) facilities.push('Service elevator');
      if (gate.star === 3) facilities.push('Express elevator');
      unlocks.textContent = 'Unlocks: ' + (facilities.join(', ') || 'Final tower rating');
      section.append(title, list, unlocks); dialog.append(section);
    }
    const history = document.createElement('section'); history.className = 'rating-card';
    const title = document.createElement('h3'); title.textContent = 'Tower journal'; history.append(title);
    for (const entry of state.campaign.history) { const p = document.createElement('p'); p.textContent = `Day ${entry.day} — ${entry.message}`; history.append(p); }
    if (!state.campaign.history.length) history.append('No events yet.');
    dialog.append(history);
  }
  private action(label: string, callback: () => void): HTMLButtonElement {
    const button = document.createElement('button'); button.textContent = label; button.onclick = callback; return button;
  }
}
