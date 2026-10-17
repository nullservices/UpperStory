import { expect, it } from 'vitest';
import { cameraAnchor, deviceZoom, initialCameraZoom, stepZoom } from '../../src/render/cameraLayout';

it('keeps building scale consistent from laptop through ultrawide displays', () => {
  for (const width of [1366, 1920, 2560, 3440, 5120]) expect(initialCameraZoom(width)).toBe(2);
  expect(initialCameraZoom(620)).toBe(1);
});

it('zooms through whole-number pixel scales', () => {
  expect(stepZoom(1, 1)).toBe(2);
  expect(stepZoom(2, 1)).toBe(3);
  expect(stepZoom(3, 1)).toBe(3);
  expect(stepZoom(1, -1)).toBe(0.5);
  expect(stepZoom(0.5, -1)).toBe(0.5);
  expect(stepZoom(1.4, 1)).toBe(2); // legacy non-integer zoom snaps onto the ladder
  expect(stepZoom(1.4, -1)).toBe(1);
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

it('snaps zoom to whole device pixels on scaled displays', () => {
  expect(deviceZoom(2, 1)).toBe(2);
  expect(deviceZoom(2, 2)).toBe(2);
  expect(deviceZoom(2, 1.25) * 1.25).toBe(3); // 2.5 device px rounds to 3
  expect(deviceZoom(1, 1.5) * 1.5).toBe(2);
  expect(deviceZoom(0.5, 1)).toBe(0.5); // overview stays below one device pixel
});
