/** Keep the same building scale on desktop; narrower windows can zoom out. */
export function initialCameraZoom(width: number): number {
  return Math.min(1.4, Math.max(0.35, (width - 270) / 720));
}

/** Center of the world viewport, excluding the construction palette and HUD. */
export function cameraAnchor(width: number, height: number): { x: number; y: number } {
  const left = width <= 620 ? 174 : 218;
  return { x: (left + width) / 2, y: (160 + height - 29) / 2 };
}
