import type { PointerSignals } from '@realhuman/schema';
import { cv, push, ratio, type Scope, stamp, stat, variance } from '../util.js';

export interface PointerStats {
  move(
    x: number,
    y: number,
    t: number,
    trusted: boolean,
    type: string,
    coalesced?: number,
    pressure?: number,
  ): void;
  down(x: number, y: number, t: number, trusted: boolean, type: string, pressure?: number): void;
  /** `centre`: the click landed within 1px of the target's bounding-box centre. */
  click(x: number, y: number, t: number, trusted: boolean, centre: boolean): void;
  summary(): PointerSignals;
}

/** Pure pointer summariser: feed it samples, read the summary. Keeps only the last position. */
export function pointerStats(): PointerStats {
  let events = 0;
  let total = 0;
  let trusted = 0;
  let pauses = 0;
  let clicks = 0;
  let teleports = 0;
  let centres = 0;
  let windows = 0;
  let straight = 0;
  const types = { mouse: 0, pen: 0, touch: 0 };
  const speed = stat();
  const accel = stat();
  const coalesced = stat();
  const curve = stat();
  const pressure = stat();
  // Last move sample; lastT < 0 means none yet.
  let lastX = 0;
  let lastY = 0;
  let lastT = -1;
  let lastSpeed = -1;
  // Segments are built from an anchor until they are at least 2px long.
  let anchorX = 0;
  let anchorY = 0;
  let angle: number | null = null;
  let segments: [number, number][] = [];

  const seen = (isTrusted: boolean, type: string, p?: number) => {
    total++;
    if (isTrusted) trusted++;
    if (p !== undefined && type !== 'mouse') push(pressure, p);
  };
  const restart = (x: number, y: number) => {
    anchorX = x;
    anchorY = y;
    angle = null;
    segments = [];
    lastSpeed = -1;
  };

  return {
    move(x, y, t, isTrusted, type, coalescedCount, p) {
      seen(isTrusted, type, p);
      events++;
      if (type in types) types[type as keyof typeof types]++;
      if (coalescedCount !== undefined) push(coalesced, coalescedCount);
      const dt = t - lastT;
      if (lastT < 0 || dt > 200) {
        if (lastT >= 0 && dt >= 300) pauses++;
        restart(x, y);
      } else {
        if (dt > 0) {
          const v = Math.hypot(x - lastX, y - lastY) / dt;
          push(speed, v);
          if (lastSpeed >= 0) push(accel, Math.abs(v - lastSpeed) / dt);
          lastSpeed = v;
        }
        const dx = x - anchorX;
        const dy = y - anchorY;
        if (dx * dx + dy * dy >= 4) {
          const a = Math.atan2(dy, dx);
          if (angle !== null) {
            const turn = Math.abs(a - angle);
            push(curve, turn > Math.PI ? 2 * Math.PI - turn : turn);
          }
          angle = a;
          segments.push([dx, dy]);
          if (segments.length > 3) segments.shift();
          if (segments.length === 3) {
            let path = 0;
            let cx = 0;
            let cy = 0;
            for (const [sx, sy] of segments) {
              path += Math.hypot(sx, sy);
              cx += sx;
              cy += sy;
            }
            windows++;
            const chord = Math.hypot(cx, cy);
            if (chord > 0 && path / chord < 1.01) straight++;
          }
          anchorX = x;
          anchorY = y;
        }
      }
      lastX = x;
      lastY = y;
      lastT = t;
    },
    down(x, y, t, isTrusted, type, p) {
      seen(isTrusted, type, p);
      // Touch and pen taps have no preceding move, so their press position counts as one.
      if (type !== 'mouse') {
        lastX = x;
        lastY = y;
        lastT = t;
        restart(x, y);
      }
    },
    click(x, y, t, isTrusted, centre) {
      seen(isTrusted, 'mouse');
      clicks++;
      if (lastT < 0 || t - lastT > 500 || Math.hypot(x - lastX, y - lastY) > 30) teleports++;
      if (centre) centres++;
    },
    summary: () => ({
      events,
      trustedRatio: ratio(trusted, total),
      coalescedPerMove: coalesced.mean,
      speedMean: speed.mean,
      speedCv: cv(speed),
      accelerationCv: cv(accel),
      curvatureMean: curve.mean,
      straightRatio: ratio(straight, windows),
      pauses,
      clicks,
      teleportClicks: teleports,
      centerClicks: centres,
      pointerTypes: { ...types },
      pressureVariance: pressure.n ? variance(pressure) : null,
    }),
  };
}

const pressureOf = (e: PointerEvent) => (e.pointerType === 'mouse' ? undefined : e.pressure);

/** Wires pointer listeners to a `pointerStats()` summariser. */
export function collectPointer(s: Scope): PointerStats {
  const p = pointerStats();
  s.on<PointerEvent>(window, 'pointermove', (e) =>
    p.move(
      e.clientX,
      e.clientY,
      stamp(e),
      e.isTrusted,
      e.pointerType,
      e.getCoalescedEvents?.().length,
      pressureOf(e),
    ),
  );
  s.on<PointerEvent>(window, 'pointerdown', (e) =>
    p.down(e.clientX, e.clientY, stamp(e), e.isTrusted, e.pointerType, pressureOf(e)),
  );
  s.on<MouseEvent>(window, 'click', (e) => {
    // Trusted clicks with detail 0 come from the keyboard (Enter/Space), not a pointer.
    if (e.isTrusted && e.detail === 0) return;
    const target = e.target;
    let centre = false;
    if (target instanceof Element) {
      const r = target.getBoundingClientRect();
      centre =
        Math.abs(r.left + r.width / 2 - e.clientX) <= 1 &&
        Math.abs(r.top + r.height / 2 - e.clientY) <= 1;
    }
    p.click(e.clientX, e.clientY, stamp(e), e.isTrusted, centre);
  });
  return p;
}
