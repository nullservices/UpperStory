import { CONFIG } from '../data/config';
import { formatTowerDate, towerDate, type GameState } from '../sim';
import { statsHistory, type StatsField, type StatsSample, type StatsState } from '../sim/stats';
import { chromeInsets, clampWindow, closeButton, makeDraggable, raiseWindow, readUiPref, writeUiPref } from './windowing';

/**
 * Tower › Statistics (G): history graphs so players can see whether a change
 * helped. A floating window like Finances (never a dialog, so the tower keeps
 * running). Charts are hand-drawn on canvas and redrawn only when the history,
 * the tab, the range or the size changes; hovering draws a crosshair on a
 * separate overlay canvas.
 */

type Unit = 'money' | 'people' | 'percent' | 'score' | 'count' | 'stars';

interface SeriesDef {
  key: StatsField;
  label: string;
  /** Index into PALETTE: identity follows the series, never its rank. */
  color: number;
  /** Fill under the line (single-series charts). */
  area?: boolean;
}

interface ChartDef {
  title: string;
  unit: Unit;
  series: SeriesDef[];
  /** Draw a step line (discrete levels such as the star rating). */
  step?: boolean;
  height?: number;
}

interface HeadlineDef {
  label: string;
  value: (s: StatsSample) => number;
  unit: Unit;
  /** Which direction is an improvement (colours the change arrow). */
  better: 'up' | 'down' | 'none';
}

interface TabDef {
  id: string;
  label: string;
  headlines: HeadlineDef[];
  charts: ChartDef[];
  /** Adds the "lift queue by hour" bar chart. */
  hourly?: boolean;
}

/**
 * Categorical series colours, validated against the chart surface (#fbfbf7)
 * for lightness band, chroma, colour-blind separation (worst adjacent ΔE 8,
 * deutan) and 3:1 contrast. Series 2+ also get a dash pattern so identity
 * never rests on colour alone.
 */
const PALETTE = ['#2a64b4', '#d97a00', '#1b9e77', '#c2185b', '#7b5cc4'];
const DASHES: number[][] = [[], [7, 4], [2, 3], [9, 3, 2, 3], [4, 4]];

const SURFACE = '#fbfbf7';
const GRID = '#e3e3dd';
const GRID_STRONG = '#c9c9c2';
const AXIS_INK = '#4d5560';
const FONT = '10.5px "Segoe UI", system-ui, sans-serif';

const totalTakings = (s: StatsSample): number => s.revHotel + s.revFood + s.revRetail + s.revLeisure;

const TABS: TabDef[] = [
  {
    id: 'population', label: 'Population',
    headlines: [
      { label: 'Population', value: s => s.pop, unit: 'people', better: 'up' },
      { label: 'Rating', value: s => s.stars, unit: 'stars', better: 'up' },
      { label: 'Offices open', value: s => s.offices, unit: 'count', better: 'up' },
      { label: 'Condos sold', value: s => s.condos, unit: 'count', better: 'up' },
    ],
    charts: [
      { title: 'Population', unit: 'people', series: [{ key: 'pop', label: 'Population', color: 0, area: true }] },
      { title: 'Star rating', unit: 'stars', step: true, height: 116, series: [{ key: 'stars', label: 'Rating', color: 1 }] },
    ],
  },
  {
    id: 'finances', label: 'Finances',
    headlines: [
      { label: 'Funds', value: s => s.funds, unit: 'money', better: 'up' },
      { label: 'Income / day', value: s => s.income, unit: 'money', better: 'up' },
      { label: 'Upkeep / day', value: s => s.upkeep, unit: 'money', better: 'down' },
      { label: 'Net / day', value: s => s.net, unit: 'money', better: 'up' },
    ],
    charts: [
      {
        title: 'Daily income and upkeep', unit: 'money',
        series: [{ key: 'income', label: 'Income', color: 0 }, { key: 'upkeep', label: 'Upkeep', color: 1 }, { key: 'net', label: 'Net', color: 2 }],
      },
      { title: 'Funds', unit: 'money', height: 130, series: [{ key: 'funds', label: 'Funds', color: 0, area: true }] },
    ],
  },
  {
    id: 'satisfaction', label: 'Satisfaction',
    headlines: [
      { label: 'Avg stress', value: s => s.stress, unit: 'score', better: 'down' },
      { label: 'Give-ups / day', value: s => s.giveUps, unit: 'count', better: 'down' },
      { label: 'Vacant offices', value: s => s.officesVacant, unit: 'count', better: 'down' },
      { label: 'Unsold condos', value: s => s.condosVacant, unit: 'count', better: 'down' },
    ],
    charts: [
      {
        title: 'Stress at 15:00 (0–100)', unit: 'score', height: 130,
        series: [{ key: 'stress', label: 'Average stress', color: 0 }, { key: 'stressed', label: 'Share at 50+ (%)', color: 1 }],
      },
      { title: 'Trips given up per day', unit: 'count', height: 110, series: [{ key: 'giveUps', label: 'Give-ups', color: 3, area: true }] },
      {
        title: 'Vacancies', unit: 'count', height: 110,
        series: [{ key: 'officesVacant', label: 'Vacant offices', color: 0 }, { key: 'condosVacant', label: 'Unsold condos', color: 1 }],
      },
    ],
  },
  {
    id: 'transport', label: 'Transport',
    hourly: true,
    headlines: [
      { label: 'Peak waiting', value: s => s.waitPeak, unit: 'people', better: 'down' },
      { label: 'Avg waiting', value: s => s.waitAvg, unit: 'people', better: 'down' },
      { label: 'Lift utilisation', value: s => s.util, unit: 'percent', better: 'none' },
      { label: 'Give-ups / day', value: s => s.giveUps, unit: 'count', better: 'down' },
    ],
    charts: [
      {
        title: 'People waiting for lifts', unit: 'people', height: 130,
        series: [{ key: 'waitPeak', label: 'Daily peak', color: 0 }, { key: 'waitAvg', label: 'Daily average', color: 1 }],
      },
      { title: 'Lift cars busy (moving or loading)', unit: 'percent', height: 110, series: [{ key: 'util', label: 'Utilisation', color: 2, area: true }] },
    ],
  },
  {
    id: 'commerce', label: 'Hotels & commerce',
    headlines: [
      { label: 'Rooms booked', value: s => s.hotelOcc, unit: 'percent', better: 'up' },
      { label: 'Hotel rooms', value: s => s.hotelRooms, unit: 'count', better: 'up' },
      { label: 'Takings / day', value: totalTakings, unit: 'money', better: 'up' },
      { label: 'Shops & venues', value: s => s.food + s.retail + s.leisure, unit: 'count', better: 'up' },
    ],
    charts: [
      { title: 'Hotel rooms booked at midnight', unit: 'percent', height: 110, series: [{ key: 'hotelOcc', label: 'Occupancy', color: 0, area: true }] },
      {
        title: 'Takings per day', unit: 'money', height: 130,
        series: [
          { key: 'revHotel', label: 'Hotels', color: 0 }, { key: 'revFood', label: 'Food', color: 1 },
          { key: 'revRetail', label: 'Retail', color: 2 }, { key: 'revLeisure', label: 'Leisure', color: 3 },
        ],
      },
      {
        title: 'Open facilities', unit: 'count', height: 120,
        series: [
          { key: 'hotelRooms', label: 'Hotel rooms', color: 0 }, { key: 'food', label: 'Food', color: 1 },
          { key: 'retail', label: 'Retail', color: 2 }, { key: 'leisure', label: 'Leisure', color: 3 }, { key: 'services', label: 'Services', color: 4 },
        ],
      },
    ],
  },
];

const YEAR_DAYS = CONFIG.QUARTER_DAYS * 4;
const RANGES = [
  { id: 'year', label: '1 year', days: YEAR_DAYS },
  { id: 'five', label: '5 years', days: YEAR_DAYS * 5 },
  { id: 'all', label: 'All', days: Infinity },
] as const;
type RangeId = (typeof RANGES)[number]['id'];

// --- Formatting -------------------------------------------------------------

function compact(n: number): string {
  const abs = Math.abs(n);
  const fmt = (v: number, suffix: string): string => `${(Math.round(v * 10) / 10).toLocaleString('en-US')}${suffix}`;
  if (abs >= 1e9) return fmt(n / 1e9, 'B');
  if (abs >= 1e6) return fmt(n / 1e6, 'M');
  if (abs >= 1e4) return fmt(n / 1e3, 'K');
  return Math.round(n * 10) / 10 === Math.round(n) ? Math.round(n).toLocaleString('en-US') : (Math.round(n * 10) / 10).toLocaleString('en-US');
}

/** Values in display units (dollars, not cents). */
function displayValue(unit: Unit, raw: number): number {
  return unit === 'money' ? raw / 100 : raw;
}

function formatAxis(unit: Unit, v: number): string {
  if (unit === 'money') return `${v < 0 ? '−' : ''}$${compact(Math.abs(v) < 1e4 ? Math.round(Math.abs(v)) : Math.abs(v))}`;
  if (unit === 'percent') return `${compact(v)}%`;
  if (unit === 'stars') return v >= 6 ? 'T' : `${v}★`;
  return compact(v);
}

function formatExact(unit: Unit, v: number): string {
  if (unit === 'money') return `${v < 0 ? '−' : ''}$${Math.round(Math.abs(v)).toLocaleString('en-US')}`;
  if (unit === 'percent') return `${(Math.round(v * 10) / 10).toLocaleString('en-US')}%`;
  if (unit === 'stars') return v >= 6 ? 'TOWER' : `${v} star${v === 1 ? '' : 's'}`;
  return (Math.round(v * 10) / 10).toLocaleString('en-US');
}

function formatDelta(unit: Unit, d: number): string {
  const sign = d > 0 ? '+' : d < 0 ? '−' : '±';
  const abs = Math.abs(d);
  if (unit === 'money') return `${sign}$${compact(abs < 1e4 ? Math.round(abs) : abs)}`;
  if (unit === 'percent') return `${sign}${compact(abs)} pts`;
  return `${sign}${compact(abs)}`;
}

const ordinal = (n: number): string => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;

/** Calendar label for a history point (daily or a merged bucket). */
export function sampleLabel(s: StatsSample): string {
  if (s.span <= 1) return formatTowerDate(s.day);
  const a = towerDate(s.day - s.span + 1);
  const b = towerDate(s.day);
  if (a.year === b.year && a.quarter === b.quarter) return `${ordinal(b.quarter)} Qtr / Year ${b.year} · quarter summary`;
  if (a.year === b.year) return `Year ${b.year} · year summary`;
  return `Years ${a.year}–${b.year} · summary`;
}

/** 1-2-5 "nice" ticks covering [min, max]. */
export function niceTicks(min: number, max: number, target = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (max - min < 1e-9) { const pad = Math.max(1, Math.abs(max) * 0.1); min -= pad; max += pad; }
  const raw = (max - min) / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const lo = Math.floor(min / step + 1e-9) * step;
  const hi = Math.ceil(max / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step * 1e-6; v += step) ticks.push(Math.round(v / step) * step);
  return ticks;
}

/** Same calendar day one quarter earlier, if recorded daily (or the closest older point). */
function previousQuarter(history: StatsSample[]): StatsSample | null {
  const last = history[history.length - 1];
  if (!last) return null;
  const target = last.day - CONFIG.QUARTER_DAYS;
  for (let i = history.length - 2; i >= 0; i--) if (history[i]!.day <= target) return history[i]!;
  return null;
}

// --- Line chart -----------------------------------------------------------------

interface Plot { left: number; right: number; top: number; bottom: number; x0: number; x1: number; y0: number; y1: number }

class LineChart {
  readonly root = document.createElement('figure');
  private readonly legend = document.createElement('div');
  private readonly frame = document.createElement('div');
  private readonly canvas = document.createElement('canvas');
  private readonly overlay = document.createElement('canvas');
  private readonly tip = document.createElement('div');
  private points: StatsSample[] = [];
  private plot: Plot | null = null;
  private width = 0;
  private dpr = 1;
  private hoverIndex = -1;

  constructor(private readonly def: ChartDef) {
    const caption = document.createElement('figcaption');
    caption.className = 'stats-chart-head';
    const title = document.createElement('span');
    title.className = 'stats-chart-title';
    title.textContent = def.title;
    this.legend.className = 'stats-legend';
    if (def.series.length > 1) {
      for (const s of def.series) {
        const item = document.createElement('span');
        item.className = 'stats-legend-item';
        item.innerHTML = `<svg width="22" height="8" aria-hidden="true"><line x1="1" y1="4" x2="21" y2="4" stroke="${PALETTE[s.color]}" stroke-width="2.2" stroke-dasharray="${DASHES[s.color]!.join(' ')}" stroke-linecap="round"/></svg>`;
        item.append(s.label);
        this.legend.append(item);
      }
    }
    caption.append(title, this.legend);
    this.frame.className = 'stats-frame';
    this.frame.style.height = `${def.height ?? 150}px`;
    this.overlay.className = 'stats-overlay';
    this.tip.className = 'stats-tip';
    this.tip.hidden = true;
    this.frame.append(this.canvas, this.overlay, this.tip);
    this.root.className = 'stats-chart';
    this.root.append(caption, this.frame);
    this.canvas.setAttribute('role', 'img');
    this.frame.addEventListener('pointermove', e => this.hover(e));
    this.frame.addEventListener('pointerleave', () => this.setHover(-1));
  }

  setData(points: StatsSample[]): void {
    this.points = points;
    this.hoverIndex = -1;
    this.draw();
  }

  /** Redraw if the frame width changed. */
  resize(): void {
    if (this.frame.clientWidth !== this.width || window.devicePixelRatio !== this.dpr) this.draw();
  }

  private value(s: StatsSample, key: StatsField): number {
    return displayValue(this.def.unit, s[key]);
  }

  draw(): void {
    const w = this.frame.clientWidth;
    const h = this.frame.clientHeight;
    this.width = w;
    this.dpr = window.devicePixelRatio || 1;
    if (w <= 0 || h <= 0) return;
    for (const c of [this.canvas, this.overlay]) {
      c.width = Math.round(w * this.dpr);
      c.height = Math.round(h * this.dpr);
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
    }
    this.clearOverlay();
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = SURFACE;
    ctx.fillRect(0, 0, w, h);
    const pts = this.points;
    if (pts.length === 0) { this.plot = null; return; }

    // Y domain over every series, always including zero for flows/counts.
    let lo = Infinity, hi = -Infinity;
    for (const s of pts) for (const series of this.def.series) {
      const v = this.value(s, series.key);
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    lo = Math.min(0, lo);
    // Whole-number units never get fractional ticks; a flat line still gets a scale.
    if (this.def.unit === 'count' || this.def.unit === 'people') hi = Math.max(hi, 4);
    if (this.def.unit === 'money' && hi - lo < 100) hi = lo + 100;
    if (this.def.unit === 'percent' || this.def.unit === 'score') hi = Math.min(100, Math.max(hi, 5));
    const ticks = this.def.unit === 'stars' ? [1, 2, 3, 4, 5, 6] : niceTicks(lo, hi, h < 120 ? 3 : 4);
    const yMin = ticks[0]!, yMax = ticks[ticks.length - 1]!;

    ctx.font = FONT;
    const labelWidth = Math.max(...ticks.map(t => ctx.measureText(formatAxis(this.def.unit, t)).width));
    const first = pts[0]!, last = pts[pts.length - 1]!;
    let x0 = first.day - first.span + 0.5, x1 = last.day + 0.5;
    if (pts.length === 1) { x0 = last.day - 1.5; x1 = last.day + 1.5; }
    const plot: Plot = { left: Math.ceil(labelWidth) + 10, right: w - 10, top: 8, bottom: h - 20, x0, x1, y0: yMin, y1: yMax };
    this.plot = plot;
    const X = (day: number): number => plot.left + ((day - plot.x0) / (plot.x1 - plot.x0)) * (plot.right - plot.left);
    const Y = (v: number): number => plot.bottom - ((v - plot.y0) / (plot.y1 - plot.y0 || 1)) * (plot.bottom - plot.top);
    const crisp = (v: number): number => Math.round(v) + 0.5;

    // Horizontal gridlines + y labels.
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1;
    for (const t of ticks) {
      const y = crisp(Y(t));
      ctx.strokeStyle = t === 0 ? GRID_STRONG : GRID;
      ctx.beginPath(); ctx.moveTo(plot.left, y); ctx.lineTo(plot.right, y); ctx.stroke();
      ctx.fillStyle = AXIS_INK;
      ctx.fillText(formatAxis(this.def.unit, t), plot.left - 5, y);
    }

    // Calendar gridlines: quarters (faint) and years (stronger, labelled).
    this.drawCalendar(ctx, plot, X, crisp);

    // Series.
    ctx.save();
    ctx.beginPath();
    ctx.rect(plot.left, plot.top - 2, plot.right - plot.left, plot.bottom - plot.top + 4);
    ctx.clip();
    for (const series of this.def.series) {
      const color = PALETTE[series.color]!;
      const path = new Path2D();
      pts.forEach((s, i) => {
        const x = X(s.day), y = Y(this.value(s, series.key));
        if (i === 0) path.moveTo(x, y);
        else if (this.def.step) { path.lineTo(x, Y(this.value(pts[i - 1]!, series.key))); path.lineTo(x, y); }
        else path.lineTo(x, y);
      });
      if (series.area && pts.length > 1) {
        const fill = new Path2D(path);
        fill.lineTo(X(last.day), Y(Math.max(plot.y0, 0)));
        fill.lineTo(X(first.day), Y(Math.max(plot.y0, 0)));
        fill.closePath();
        const grad = ctx.createLinearGradient(0, plot.top, 0, plot.bottom);
        grad.addColorStop(0, `${color}38`);
        grad.addColorStop(1, `${color}08`);
        ctx.fillStyle = grad;
        ctx.fill(fill);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.setLineDash(this.def.series.length > 1 ? DASHES[series.color]! : []);
      ctx.stroke(path);
      ctx.setLineDash([]);
      // Few points: mark each so a lone day is still visible.
      if (pts.length <= 16) {
        for (const s of pts) {
          ctx.beginPath();
          ctx.arc(X(s.day), Y(this.value(s, series.key)), pts.length === 1 ? 4 : 2.6, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = SURFACE;
          ctx.stroke();
        }
      }
    }
    ctx.restore();

    // Accessible summary of the latest values.
    this.canvas.setAttribute('aria-label', `${this.def.title}: ${this.def.series.map(s => `${s.label} ${formatExact(this.def.unit, this.value(last, s.key))}`).join(', ')} on ${sampleLabel(last)}`);
  }

  private drawCalendar(ctx: CanvasRenderingContext2D, plot: Plot, X: (d: number) => number, crisp: (v: number) => number): void {
    const Q = CONFIG.QUARTER_DAYS;
    const pxPerDay = (plot.right - plot.left) / (plot.x1 - plot.x0);
    const qPx = pxPerDay * Q;
    const yPx = pxPerDay * YEAR_DAYS;
    // Mark every k-th year so labels never crowd.
    const yearStep = [1, 2, 5, 10, 20, 50, 100, 200, 500].find(k => k * yPx >= 46) ?? 1000;
    const firstYear = Math.max(1, Math.floor((plot.x0 - 0.5) / YEAR_DAYS) + 1);
    const lastYear = Math.floor((plot.x1 - 0.5) / YEAR_DAYS) + 1;
    const labelY = plot.bottom + 14;
    const taken: [number, number][] = [];
    const free = (a: number, b: number): boolean => a >= plot.left - 4 && b <= plot.right + 8 && taken.every(([l, r]) => b + 6 < l || a - 6 > r);

    // Quarter gridlines (dotted) inside each year.
    if (qPx >= 12) {
      ctx.strokeStyle = GRID;
      ctx.setLineDash([2, 3]);
      for (let q = Math.ceil((plot.x0 - 0.5) / Q); q <= Math.floor((plot.x1 - 0.5) / Q); q++) {
        if (q % 4 === 0) continue;
        const x = crisp(X(q * Q + 0.5));
        ctx.beginPath(); ctx.moveTo(x, plot.top); ctx.lineTo(x, plot.bottom); ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    // Year boundaries and labels (labels first claim their space).
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    for (let y = firstYear; y <= lastYear; y++) {
      if ((y - 1) % yearStep !== 0) continue;
      const x = X((y - 1) * YEAR_DAYS + 0.5);
      if (x > plot.left && x <= plot.right) {
        ctx.strokeStyle = GRID_STRONG;
        ctx.beginPath(); ctx.moveTo(crisp(x), plot.top); ctx.lineTo(crisp(x), plot.bottom + 3); ctx.stroke();
      }
      ctx.font = `600 ${FONT}`;
      let text = yPx * yearStep >= 64 ? `Year ${y}` : `Y${y}`;
      const lx = Math.max(plot.left + 2, x + 3);
      if (!free(lx, lx + ctx.measureText(text).width)) text = `Y${y}`;
      const width = ctx.measureText(text).width;
      if (free(lx, lx + width)) {
        ctx.fillStyle = AXIS_INK;
        ctx.fillText(text, lx, labelY);
        taken.push([lx, lx + width]);
      }
      ctx.font = FONT;
    }
    // Quarter labels where they fit.
    if (qPx >= 30) {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#7a828c';
      for (let q = Math.max(0, Math.floor((plot.x0 - 0.5) / Q)); q <= Math.floor((plot.x1 - 0.5) / Q); q++) {
        if (q % 4 === 0) continue;
        const mid = X(q * Q + 0.5 + Q / 2);
        const text = `Q${(q % 4) + 1}`;
        const half = ctx.measureText(text).width / 2;
        if (!free(mid - half, mid + half)) continue;
        ctx.fillText(text, mid, labelY);
        taken.push([mid - half, mid + half]);
      }
    }
  }
  private hover(e: PointerEvent): void {
    const plot = this.plot;
    if (!plot || this.points.length === 0) return;
    const rect = this.frame.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const day = plot.x0 + ((x - plot.left) / (plot.right - plot.left)) * (plot.x1 - plot.x0);
    // Nearest point by day (points are sorted).
    let lo = 0, hi = this.points.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.points[mid]!.day < day) lo = mid + 1; else hi = mid;
    }
    if (lo > 0 && Math.abs(this.points[lo - 1]!.day - day) <= Math.abs(this.points[lo]!.day - day)) lo--;
    this.setHover(lo);
  }

  private clearOverlay(): void {
    const ctx = this.overlay.getContext('2d');
    ctx?.clearRect(0, 0, this.overlay.width, this.overlay.height);
  }

  private setHover(index: number): void {
    if (index === this.hoverIndex) return;
    this.hoverIndex = index;
    this.clearOverlay();
    const plot = this.plot;
    if (index < 0 || !plot) { this.tip.hidden = true; return; }
    const s = this.points[index]!;
    const ctx = this.overlay.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const X = (day: number): number => plot.left + ((day - plot.x0) / (plot.x1 - plot.x0)) * (plot.right - plot.left);
    const Y = (v: number): number => plot.bottom - ((v - plot.y0) / (plot.y1 - plot.y0 || 1)) * (plot.bottom - plot.top);
    const x = Math.round(X(s.day)) + 0.5;
    ctx.strokeStyle = '#1f293399';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, plot.top); ctx.lineTo(x, plot.bottom); ctx.stroke();
    for (const series of this.def.series) {
      ctx.beginPath();
      ctx.arc(X(s.day), Y(this.value(s, series.key)), 4.5, 0, Math.PI * 2);
      ctx.fillStyle = PALETTE[series.color]!;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = SURFACE;
      ctx.stroke();
    }
    const rows = this.def.series.map(series =>
      `<div><i style="background:${PALETTE[series.color]}"></i><span>${series.label}</span><b>${formatExact(this.def.unit, this.value(s, series.key))}</b></div>`).join('');
    this.tip.innerHTML = `<small>${sampleLabel(s)}</small>${rows}`;
    this.tip.hidden = false;
    const tipWidth = this.tip.offsetWidth;
    const left = x + 12 + tipWidth > plot.right ? x - 12 - tipWidth : x + 12;
    this.tip.style.left = `${Math.max(2, left)}px`;
    this.tip.style.top = `${plot.top + 2}px`;
  }
}

// --- Hourly bars (Transport) -------------------------------------------------------

class HourlyChart {
  readonly root = document.createElement('figure');
  private readonly frame = document.createElement('div');
  private readonly canvas = document.createElement('canvas');
  private readonly tip = document.createElement('div');
  private hours: number[] = [];
  private width = 0;
  private bars: { x: number; w: number; hour: number }[] = [];

  constructor() {
    const caption = document.createElement('figcaption');
    caption.className = 'stats-chart-head';
    caption.innerHTML = '<span class="stats-chart-title">Lift queue by hour — last full day (peak people waiting)</span>';
    this.frame.className = 'stats-frame';
    this.frame.style.height = '104px';
    this.tip.className = 'stats-tip';
    this.tip.hidden = true;
    this.frame.append(this.canvas, this.tip);
    this.root.className = 'stats-chart';
    this.root.append(caption, this.frame);
    this.canvas.setAttribute('role', 'img');
    this.frame.addEventListener('pointermove', e => this.hover(e));
    this.frame.addEventListener('pointerleave', () => { this.tip.hidden = true; });
  }

  setData(hours: number[]): void {
    this.hours = hours;
    this.draw();
  }

  resize(): void {
    if (this.frame.clientWidth !== this.width) this.draw();
  }

  draw(): void {
    const w = this.frame.clientWidth, h = this.frame.clientHeight;
    this.width = w;
    if (w <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = SURFACE;
    ctx.fillRect(0, 0, w, h);
    ctx.font = FONT;
    const order = Array.from({ length: 24 }, (_, i) => (i + 7) % 24); // the tower day runs 07:00 → 07:00
    const max = Math.max(4, ...this.hours);
    const ticks = niceTicks(0, max, 2);
    const top = ticks[ticks.length - 1]!;
    const left = Math.ceil(Math.max(...ticks.map(t => ctx.measureText(compact(t)).width))) + 10;
    const right = w - 10, plotTop = 8, bottom = h - 20;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const t of ticks) {
      const y = Math.round(bottom - (t / top) * (bottom - plotTop)) + 0.5;
      ctx.strokeStyle = t === 0 ? GRID_STRONG : GRID;
      ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
      ctx.fillStyle = AXIS_INK;
      ctx.fillText(compact(t), left - 5, y);
    }
    const slot = (right - left) / 24;
    const barW = Math.max(2, slot - 2); // 2px surface gap between bars
    this.bars = [];
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    order.forEach((hour, i) => {
      const v = this.hours[hour] ?? 0;
      const x = left + i * slot + 1;
      this.bars.push({ x, w: barW, hour });
      const bh = (v / top) * (bottom - plotTop);
      if (bh > 0) {
        ctx.fillStyle = PALETTE[0]!;
        const r = Math.min(3, barW / 2, bh);
        ctx.beginPath();
        ctx.roundRect(x, bottom - bh, barW, bh, [r, r, 0, 0]);
        ctx.fill();
      }
      if (i % 3 === 0) {
        ctx.fillStyle = AXIS_INK;
        ctx.fillText(`${String(hour).padStart(2, '0')}:00`, x + barW / 2, bottom + 14);
      }
    });
    const busiest = order.reduce((best, hr) => ((this.hours[hr] ?? 0) > (this.hours[best] ?? 0) ? hr : best), order[0]!);
    this.canvas.setAttribute('aria-label', this.hours.length ? `Busiest hour ${String(busiest).padStart(2, '0')}:00 with ${this.hours[busiest] ?? 0} people waiting` : 'No hourly data yet');
  }

  private hover(e: PointerEvent): void {
    const x = e.clientX - this.frame.getBoundingClientRect().left;
    const bar = this.bars.find(b => x >= b.x - 1 && x < b.x + b.w + 1);
    if (!bar || this.hours.length === 0) { this.tip.hidden = true; return; }
    const hh = (n: number): string => `${String(n % 24).padStart(2, '0')}:00`;
    this.tip.innerHTML = `<small>${hh(bar.hour)}–${hh(bar.hour + 1)}</small><div><i style="background:${PALETTE[0]}"></i><span>Peak waiting</span><b>${(this.hours[bar.hour] ?? 0).toLocaleString('en-US')}</b></div>`;
    this.tip.hidden = false;
    const tw = this.tip.offsetWidth;
    this.tip.style.left = `${Math.max(2, bar.x + bar.w + 8 + tw > this.width ? bar.x - 8 - tw : bar.x + bar.w + 8)}px`;
    this.tip.style.top = '8px';
  }
}

// --- Window ---------------------------------------------------------------------

interface StatsPrefs { x: number | null; y: number | null; w: number | null; h: number | null; tab: string; range: RangeId }

export class StatsWindow {
  private readonly root = document.createElement('section');
  private readonly tabBar = document.createElement('div');
  private readonly rangeBar = document.createElement('div');
  private readonly headlines = document.createElement('div');
  private readonly charts = document.createElement('div');
  private readonly empty = document.createElement('div');
  private readonly footnote = document.createElement('p');
  private readonly tabButtons = new Map<string, HTMLButtonElement>();
  private readonly rangeButtons = new Map<RangeId, HTMLButtonElement>();
  private lineCharts: LineChart[] = [];
  private hourly: HourlyChart | null = null;
  private state: GameState | null = null;
  private lastKey = '';
  private prefs = readUiPref<StatsPrefs>('stats', { x: null, y: null, w: null, h: null, tab: 'population', range: 'all' });

  constructor() {
    const root = this.root;
    root.className = 'stats-window ui-window';
    root.setAttribute('aria-label', 'Statistics');
    root.tabIndex = -1;
    root.hidden = true;
    const title = document.createElement('div');
    title.className = 'window-title';
    title.innerHTML = '<span class="title-text">Statistics</span>';
    title.append(closeButton('Close statistics', () => this.close()));

    const toolbar = document.createElement('div');
    toolbar.className = 'stats-toolbar';
    this.tabBar.className = 'stats-tabs';
    this.tabBar.setAttribute('role', 'tablist');
    this.tabBar.setAttribute('aria-label', 'Statistics topic');
    for (const tab of TABS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = tab.label;
      b.setAttribute('role', 'tab');
      b.id = `stats-tab-${tab.id}`;
      b.onclick = () => this.selectTab(tab.id);
      this.tabButtons.set(tab.id, b);
      this.tabBar.append(b);
    }
    this.tabBar.addEventListener('keydown', e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const i = TABS.findIndex(t => t.id === this.prefs.tab);
      const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]!;
      this.selectTab(next.id);
      this.tabButtons.get(next.id)!.focus();
    });
    this.rangeBar.className = 'stats-range';
    this.rangeBar.setAttribute('role', 'group');
    this.rangeBar.setAttribute('aria-label', 'Time range');
    for (const range of RANGES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = range.label;
      b.onclick = () => { this.prefs.range = range.id; this.savePrefs(); this.refresh(); };
      this.rangeButtons.set(range.id, b);
      this.rangeBar.append(b);
    }
    toolbar.append(this.tabBar, this.rangeBar);

    const body = document.createElement('div');
    body.className = 'stats-body';
    body.setAttribute('role', 'tabpanel');
    this.headlines.className = 'stats-headlines';
    this.charts.className = 'stats-charts';
    this.empty.className = 'stats-empty';
    this.empty.innerHTML = '<b>Statistics appear after your first day.</b><span>Each midnight, after the day\'s books settle, the tower\'s population, money, stress, lift queues and trade are recorded here.</span>';
    this.footnote.className = 'window-hint stats-footnote';
    body.append(this.empty, this.headlines, this.charts, this.footnote);
    root.append(title, toolbar, body);
    document.body.append(root);

    makeDraggable(root, title, 'fixed', (x, y) => { this.prefs.x = x; this.prefs.y = y; this.savePrefs(); });
    window.addEventListener('resize', () => { if (!root.hidden) this.place(); });
    root.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); this.close(); } });
    // Redraw on resize (window drag-resize or viewport change), not per frame.
    new ResizeObserver(() => {
      if (root.hidden) return;
      for (const chart of this.lineCharts) chart.resize();
      this.hourly?.resize();
    }).observe(root);
    let resizeSave = 0;
    new ResizeObserver(() => {
      if (root.hidden || !root.style.width) return;
      window.clearTimeout(resizeSave);
      resizeSave = window.setTimeout(() => { this.prefs.w = root.offsetWidth; this.prefs.h = root.offsetHeight; this.savePrefs(); }, 300);
    }).observe(root);
    window.addEventListener('keydown', e => this.onKey(e));
  }

  get isOpen(): boolean { return !this.root.hidden; }

  toggle(): void {
    if (this.root.hidden) this.open(); else this.close();
  }

  open(): void {
    const wasHidden = this.root.hidden;
    this.root.hidden = false;
    raiseWindow(this.root);
    if (wasHidden) {
      if (this.prefs.w) this.root.style.width = `${this.prefs.w}px`;
      if (this.prefs.h) this.root.style.height = `${this.prefs.h}px`;
      this.place();
      this.lastKey = '';
      this.buildTab();
      if (this.state) this.update(this.state);
    }
    this.root.focus({ preventScroll: true });
  }

  close(): void {
    if (this.root.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    this.root.hidden = true;
  }

  /** Called every frame; only redraws when the history changes. */
  update(state: GameState): void {
    this.state = state;
    if (this.root.hidden) return;
    const stats = state.stats;
    const key = historyKey(state, stats);
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.render(stats);
  }

  private refresh(): void {
    this.lastKey = '';
    if (this.state) this.update(this.state);
  }

  private selectTab(id: string): void {
    if (this.prefs.tab === id) return;
    this.prefs.tab = id;
    this.savePrefs();
    this.buildTab();
    this.refresh();
  }

  private tab(): TabDef {
    return TABS.find(t => t.id === this.prefs.tab) ?? TABS[0]!;
  }

  /** Create the chart widgets for the current tab. */
  private buildTab(): void {
    const tab = this.tab();
    for (const [id, b] of this.tabButtons) {
      const on = id === tab.id;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    this.root.querySelector('.stats-body')?.setAttribute('aria-labelledby', `stats-tab-${tab.id}`);
    this.lineCharts = tab.charts.map(def => new LineChart(def));
    this.hourly = tab.hourly ? new HourlyChart() : null;
    this.charts.replaceChildren(...this.lineCharts.map(c => c.root), ...(this.hourly ? [this.hourly.root] : []));
  }

  private render(stats: StatsState | undefined): void {
    for (const [id, b] of this.rangeButtons) b.setAttribute('aria-pressed', String(id === this.prefs.range));
    const history = statsHistory(stats);
    const hasData = history.length > 0;
    this.empty.hidden = hasData;
    this.headlines.hidden = !hasData;
    this.charts.hidden = !hasData;
    this.footnote.hidden = !hasData;
    this.rangeBar.hidden = !hasData;
    if (!hasData) return;

    const tab = this.tab();
    const last = history[history.length - 1]!;
    const prev = previousQuarter(history);
    this.headlines.replaceChildren(...tab.headlines.map(def => headline(def, last, prev)));

    const range = RANGES.find(r => r.id === this.prefs.range) ?? RANGES[2];
    const points = history.filter(s => s.day > last.day - range.days);
    for (const chart of this.lineCharts) chart.setData(points);
    this.hourly?.setData(stats?.lastHours ?? []);
    const coarse = points.some(s => s.span > 1);
    this.footnote.textContent = `Last recorded ${formatTowerDate(last.day)}. Changes compare with the same day one quarter earlier.`
      + (coarse ? ' Older history is summarised by quarter and year: money, stress and queues as daily averages, counts at the period\'s end.' : '');
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key !== 'g' && e.key !== 'G') return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const target = e.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
    if (target instanceof HTMLElement && target.isContentEditable) return;
    if (document.querySelector('[role="dialog"][data-open="true"], dialog[open], .menu-list')) return;
    e.preventDefault();
    this.toggle();
  }

  private place(): void {
    const { top, bottom } = chromeInsets();
    const width = this.root.offsetWidth || 680;
    const maxH = window.innerHeight - top - bottom - 16;
    this.root.style.maxHeight = `${Math.max(240, maxH)}px`;
    const spot = clampWindow(this.root, this.prefs.x ?? Math.max(8, (window.innerWidth - width) / 2), this.prefs.y ?? top + 12);
    this.root.style.left = `${spot.x}px`;
    this.root.style.top = `${spot.y}px`;
  }

  private savePrefs(): void {
    writeUiPref('stats', this.prefs);
  }
}

/** Changes whenever a sample is added or the tower (state) is swapped. */
const stateIds = new WeakMap<GameState, number>();
let nextStateId = 1;
function historyKey(state: GameState, stats: StatsState | undefined): string {
  let id = stateIds.get(state);
  if (id === undefined) { id = nextStateId++; stateIds.set(state, id); }
  if (!stats) return `${id}:none`;
  const last = stats.days[stats.days.length - 1];
  return `${id}:${stats.years.length}:${stats.quarters.length}:${stats.days.length}:${last?.day ?? 0}`;
}

function headline(def: HeadlineDef, last: StatsSample, prev: StatsSample | null): HTMLElement {
  const el = document.createElement('div');
  el.className = 'stats-headline';
  const value = displayValue(def.unit, def.value(last));
  const label = document.createElement('small');
  label.textContent = def.label;
  const big = document.createElement('b');
  big.textContent = def.unit === 'money' ? formatAxis('money', value) : formatExact(def.unit, value);
  big.title = formatExact(def.unit, value);
  const change = document.createElement('span');
  change.className = 'stats-change';
  if (prev) {
    const delta = value - displayValue(def.unit, def.value(prev));
    const steady = Math.abs(delta) < (def.unit === 'money' ? 0.5 : 0.05);
    const arrow = steady ? '■' : delta > 0 ? '▲' : '▼';
    const good = def.better === 'none' || steady ? '' : (delta > 0) === (def.better === 'up') ? 'good' : 'bad';
    if (good) change.classList.add(good);
    change.textContent = `${arrow} ${steady ? 'no change' : formatDelta(def.unit, delta)}`;
    const verdict = good === 'good' ? ' (better)' : good === 'bad' ? ' (worse)' : '';
    change.title = `vs ${sampleLabel(prev)}: ${formatExact(def.unit, displayValue(def.unit, def.value(prev)))}${verdict}`;
    change.setAttribute('aria-label', `${steady ? 'No change' : `${delta > 0 ? 'Up' : 'Down'} ${formatDelta(def.unit, delta)}`} versus last quarter${verdict}`);
  } else {
    change.textContent = 'first quarter';
    change.classList.add('muted');
  }
  el.append(label, big, change);
  return el;
}
