import { describe, expect, it } from 'vitest';
import { friendlyAlert, plural } from '../../src/game/controller';

describe('player-facing message text', () => {
  it('rewrites vacancy alerts with palette names and floor labels', () => {
    expect(friendlyAlert('A fastfood on floor 0 has gone vacant!')).toBe('Fast food on B1 has gone vacant');
    expect(friendlyAlert('A office on floor 12 has new occupants!')).toBe('Office on floor 12 has new occupants');
    expect(friendlyAlert('Funds are negative!')).toBe('Funds are negative!');
  });

  it('pluralises tool labels for row-build summaries', () => {
    expect(plural('Office')).toBe('offices');
    expect(plural('Single hotel')).toBe('single hotels');
    expect(plural('Stairs')).toBe('stairs');
    expect(plural('Parking')).toBe('parking spaces');
    expect(plural('Sky lobby')).toBe('sky lobbies');
    expect(plural('Escalator ↑')).toBe('escalators');
  });
});
