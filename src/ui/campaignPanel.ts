import { PROGRESSION, TENANT_DATA } from '../data/config';
import { respondToIncident, responseQuote, type IncidentResponse } from '../sim/campaign';
import { progressionRequirements } from '../sim/progression';
import { formatTowerDate } from '../sim/time';
import type { GameState } from '../sim/state';
import { TOOL_INFO } from './toolPalette';
import { hasLocation, historyEntries } from './simCompat';

const dollars = (cents: number): string => `$${Math.round(cents / 100).toLocaleString('en-US')}`;

/** Button label for a response, from the simulation's own quote. */
function responseLabel(state: GameState, id: number, action: IncidentResponse): { label: string; error: string | null } {
  const quote = responseQuote(state, id, action);
  // Odds and arrival time only mean something when the response can be ordered.
  const eta = quote.error ? '' : ` · ${Math.max(1, Math.ceil(quote.delayTicks / 10))}s`;
  const odds = quote.error ? '' : ` · ${Math.round(quote.successChance * 100)}% chance`;
  switch (action) {
    case 'security': return { label: `Send security (free${odds}${eta})`, error: quote.error };
    case 'rescue': return { label: `Call fire department (${dollars(quote.costCents)}${eta})`, error: quote.error };
    case 'search': return { label: `Send security to search${eta ? ` (${eta.slice(3)})` : ''}`, error: quote.error };
    case 'ransom': return { label: `Pay ransom (${dollars(quote.costCents)})`, error: quote.error };
    case 'exterminate': return { label: `Pest control (${dollars(quote.costCents)})`, error: quote.error };
  }
}

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
  open(): void {
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
    summary.textContent = `${formatTowerDate(state.calendar.day)} · ${state.campaign.weather === 'rain' ? 'Rain' : 'Clear weather'}${state.campaign.bankrupt ? ' · Tower in debt' : ''}`;
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
      const options: IncidentResponse[] = incident.kind === 'fire' ? ['security', 'rescue']
        : incident.kind === 'bomb' ? ['search', 'ransom'] : incident.kind === 'infestation' ? ['exterminate'] : [];
      if (!incident.response) for (const action of options) {
        const { label, error } = responseLabel(state, incident.id, action);
        const button = this.action(label, () => {
          try { respondToIncident(state, incident.id, action); this.render(); }
          catch (err) { this.toast(err instanceof Error ? err.message : String(err)); }
        });
        if (error) {
          button.disabled = true;
          button.title = error;
          const reason = document.createElement('small');
          reason.className = 'response-reason';
          reason.textContent = error;
          section.append(button, reason);
        } else section.append(button);
      }
      if (incident.kind === 'fire' && !incident.response) {
        const hint = document.createElement('p');
        hint.className = 'window-hint';
        hint.textContent = 'Security fights fires for free, but only guards who can reach the floor help and they may fail. The fire department always succeeds; a nearby Fire station makes it cheaper and faster. Unanswered fires spread to neighbouring rooms.';
        section.append(hint);
      }
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
    for (const entry of historyEntries(state)) {
      const text = `${formatTowerDate(entry.day)} — ${entry.message}`;
      if (hasLocation(entry)) {
        const jump = this.action(`${text} →`, () => { this.focusFloor(entry.floor, entry.x); dialog.close(); });
        jump.className = 'journal-jump';
        jump.title = 'Show where this happened';
        history.append(jump);
      } else {
        const p = document.createElement('p'); p.textContent = text; history.append(p);
      }
    }
    if (!state.campaign.history.length) history.append('No events yet.');
    dialog.append(history);
  }
  private action(label: string, callback: () => void): HTMLButtonElement {
    const button = document.createElement('button'); button.textContent = label; button.onclick = callback; return button;
  }
}
