import { expect, it } from 'vitest';
import { cameraAnchor, initialCameraZoom } from '../../src/render/cameraLayout';

it('keeps building scale consistent from laptop through ultrawide displays', () => {
  for (const width of [1366, 1920, 2560, 3440, 5120]) expect(initialCameraZoom(width)).toBe(1.4);
  expect(initialCameraZoom(620)).toBeLessThan(1.4);
});

it('keeps the same world point centered when viewport dimensions change', () => {
  const oldAnchor = cameraAnchor(1366, 768);
  const nextAnchor = cameraAnchor(3440, 1440);
  const zoom = 1.7; const camera = { x: -423, y: 712 };
  const world = { x: (oldAnchor.x - camera.x) / zoom, y: (oldAnchor.y - camera.y) / zoom };
  camera.x += nextAnchor.x - oldAnchor.x;
  camera.y += nextAnchor.y - oldAnchor.y;
  expect((nextAnchor.x - camera.x) / zoom).toBeCloseTo(world.x);
  expect((nextAnchor.y - camera.y) / zoom).toBeCloseTo(world.y);
});
