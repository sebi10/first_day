// Box and roof faces in the oblique projection (see geo.tsx P). Local space:
// x east, y up, z north; the building's front-centre ground point is (0,0,0).
import { face, lin, P, type V3 } from './geo';

export function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) {
  return {
    front: face([[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]]),
    side: face([[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]]),
    top: face([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]]),
  };
}

/** gable roof, ridge running east-west */
export function gable(x0: number, x1: number, y1: number, z0: number, z1: number, rh: number, o: number) {
  const zm = (z0 + z1) / 2;
  return {
    back: face([[x0 - o, y1, z1 + o], [x1 + o, y1, z1 + o], [x1 + o, y1 + rh, zm], [x0 - o, y1 + rh, zm]]),
    end: face([[x1, y1, z0], [x1, y1, z1], [x1, y1 + rh, zm]]),
    front: face([[x0 - o, y1 - 1.5, z0 - o], [x1 + o, y1 - 1.5, z0 - o], [x1 + o, y1 + rh, zm], [x0 - o, y1 + rh, zm]]),
    ridge: lin([P([x0 - o, y1 + rh, zm]), P([x1 + o, y1 + rh, zm])]),
    /** horizontal courses across the front slope (thatch or tiles) */
    courses: (n: number) =>
      Array.from({ length: n }, (_, i) => {
        const t = (i + 1) / (n + 1);
        const y = y1 - 1.5 + (rh + 1.5) * t, z = z0 - o + (zm - z0 + o) * t;
        return lin([P([x0 - o + 1, y, z]), P([x1 + o - 1, y, z])]);
      }).join(''),
  };
}

/** gable roof, ridge running north-south (gable faces the viewer) */
export function gableZ(x0: number, x1: number, y1: number, z0: number, z1: number, rh: number, o: number) {
  const xm = (x0 + x1) / 2;
  return {
    west: face([[x0 - o, y1, z0 - o], [x0 - o, y1, z1 + o], [xm, y1 + rh, z1 + o], [xm, y1 + rh, z0 - o]]),
    east: face([[x1 + o, y1, z0 - o], [x1 + o, y1, z1 + o], [xm, y1 + rh, z1 + o], [xm, y1 + rh, z0 - o]]),
    gable: face([[x0, y1, z0], [x1, y1, z0], [xm, y1 + rh, z0]]),
    eaves: lin([P([x0 - o, y1, z0 - o]), P([xm, y1 + rh, z0 - o]), P([x1 + o, y1, z0 - o])]),
  };
}

/** hip roof */
export function hip(x0: number, x1: number, y1: number, z0: number, z1: number, rh: number, o: number, inset: number) {
  const zm = (z0 + z1) / 2;
  const a: V3 = [x0 + inset, y1 + rh, zm], b: V3 = [x1 - inset, y1 + rh, zm];
  return {
    back: face([[x0 - o, y1, z1 + o], [x1 + o, y1, z1 + o], b, a]),
    west: face([[x0 - o, y1, z0 - o], [x0 - o, y1, z1 + o], a]),
    east: face([[x1 + o, y1, z0 - o], [x1 + o, y1, z1 + o], b]),
    front: face([[x0 - o, y1 - 1.5, z0 - o], [x1 + o, y1 - 1.5, z0 - o], b, a]),
    ridge: lin([P(a), P(b)]),
  };
}

/** a ground shadow for a footprint, thrown down-right */
export function shadowOf(x0: number, x1: number, z0: number, z1: number, h: number) {
  const k = h * 0.42;
  return face([[x0 + k * 0.3, 0, z0 - k * 0.2], [x1 + k, 0, z0 - k * 0.5], [x1 + k, 0, z1 - k * 0.3], [x1, 0, z1], [x0, 0, z1]]);
}

/** a vertical post from the ground at (x, z) */
export const post = (x: number, z: number, h: number, y0 = 0) => lin([P([x, y0, z]), P([x, y0 + h, z])]);
export const seg = (a: V3, b: V3) => lin([P(a), P(b)]);
