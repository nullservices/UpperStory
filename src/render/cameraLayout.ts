/**
 * Screen chrome the default camera framing keeps clear of, in CSS px: the
 * menu + info bar on top, the footer below, and the floating construction
 * palette's default spot on the left (narrow windows reserve almost nothing).
 */
export const CHROME_INSETS = { top: 74, bottom: 24, left: 210, narrowLeft: 12 } as const;

/** Left inset for a viewport width. */
export function chromeLeft(width: number): number {
  return width <= 620 ? CHROME_INSETS.narrowLeft : CHROME_INSETS.left;
}

/**
 * Pixel art stays even only at whole-number scales (each world pixel covers
 * the same number of screen pixels); 0.5 is kept as an overview level.
 */
export const ZOOM_LEVELS = [0.5, 1, 2, 3] as const;

/** The next zoom level up (dir > 0) or down from `zoom`, clamped to the ladder. */
export function stepZoom(zoom: number, dir: number): number {
  if (dir > 0) return ZOOM_LEVELS.find(level => level > zoom + 1e-6) ?? ZOOM_LEVELS[ZOOM_LEVELS.length - 1]!;
  return [...ZOOM_LEVELS].reverse().find(level => level < zoom - 1e-6) ?? ZOOM_LEVELS[0];
}

/**
 * Zoom actually applied for a ladder level on a display with `dpr` device
 * pixels per CSS pixel. Rounding to whole device pixels per world pixel keeps
 * pixel art even on 125%/150% scaled screens; overview levels below one device
 * pixel per world pixel stay as they are.
 */
export function deviceZoom(level: number, dpr: number): number {
  const devicePixels = level * dpr;
  return devicePixels < 1 ? level : Math.round(devicePixels) / dpr;
}

/** Desktop windows open at 2×, like a magnified SimTower; small windows at 1×. */
export function initialCameraZoom(width: number): number {
  return width >= 1280 ? 2 : 1;
}

/** Center of the world viewport, excluding the palette, top chrome and footer. */
export function cameraAnchor(width: number, height: number): { x: number; y: number } {
  return {
    x: (chromeLeft(width) + width) / 2,
    y: (CHROME_INSETS.top + height - CHROME_INSETS.bottom) / 2,
  };
}
