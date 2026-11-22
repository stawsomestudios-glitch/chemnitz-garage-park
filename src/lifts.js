import { ground } from './terrain.js'
import { roofAt } from './park.js'

// Lifted roofs and areas, built from reused GDR prefab plates on a 1.20 × 1.20 m grid.
// The grid is the park's: turned by the park's net angle, lines every 1.20 m from the site origin.
// An area is a rectangle of whole plates in grid numbers (i along the grid, j across it):
//   { id, i0, j0, nu, nv (plates along / across), h, roof, tiltU, tiltV (degrees), supports }
//   roof: true = it stands on the roof of the building or garage under its middle, h above that roof;
//   otherwise h above the ground. Tilts lift one side: tiltU rises along the grid, tiltV across it.
export const PLATE = 1.2
export const PLATE_THICK = 0.14
const SUPPORT_EVERY = 6 // plates (7.20 m)

export const toGrid = (x, y, deg) => {
  const a = (deg * Math.PI) / 180
  return [x * Math.cos(a) + y * Math.sin(a), -x * Math.sin(a) + y * Math.cos(a)]
}
export const fromGrid = (u, v, deg) => {
  const a = (deg * Math.PI) / 180
  return [u * Math.cos(a) - v * Math.sin(a), u * Math.sin(a) + v * Math.cos(a)]
}
// a rectangle of plates around a point (for the starting design)
function around(x, y, nu, nv, deg, more) {
  const [u, v] = toGrid(x, y, deg)
  return { i0: Math.round(u / PLATE - nu / 2), j0: Math.round(v / PLATE - nv / 2), nu, nv, ...more }
}
export const DEFAULT_LIFTS = [
  // a lid lifted off the roof of the northern slab, tilted open towards the courtyard
  { id: 'L1', ...around(-36, 139, 20, 8, 11, { h: 2.4, roof: true, tiltU: 0, tiltV: -8, supports: true }) },
  // a canopy of plates over the café corner of the plaza
  { id: 'L2', ...around(-46, 66, 9, 7, 11, { h: 3.6, roof: false, tiltU: 0, tiltV: 0, supports: true }) },
  // a lifted roof on the southern garage row R13, rising towards the yard
  { id: 'L3', ...around(-27, -28, 16, 5, 11, { h: 1.2, roof: true, tiltU: 4, tiltV: 0, supports: true }) },
]
const num = (v, d, lo, hi) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d)
export function cleanLifts(list) {
  if (!Array.isArray(list)) return DEFAULT_LIFTS
  return list
    .filter((l) => l && Number.isFinite(+l.i0) && Number.isFinite(+l.j0))
    .map((l, k) => ({
      id: String(l.id ?? 'L' + k),
      i0: Math.round(+l.i0),
      j0: Math.round(+l.j0),
      nu: Math.round(num(l.nu, 4, 1, 200)),
      nv: Math.round(num(l.nv, 4, 1, 200)),
      h: num(l.h, 2.4, 0, 60),
      roof: !!l.roof,
      tiltU: num(l.tiltU, 0, -45, 45),
      tiltV: num(l.tiltV, 0, -45, 45),
      supports: l.supports !== false,
    }))
}

// every plate and support of every area: plates [x, y, z, yaw, tiltU, tiltV, tone], supports [x, y, from, to]
export function buildLifts(lifts, deg, buildings) {
  const plates = []
  const supports = []
  const info = {}
  const yaw = (deg * Math.PI) / 180
  for (const l of lifts) {
    const uc = (l.i0 + l.nu / 2) * PLATE
    const vc = (l.j0 + l.nv / 2) * PLATE
    const [cx, cy] = fromGrid(uc, vc, deg)
    const roof = l.roof ? roofAt(cx, cy, buildings) : null
    const base = roof ?? ground(cx, cy)
    const tu = Math.tan((l.tiltU * Math.PI) / 180)
    const tv = Math.tan((l.tiltV * Math.PI) / 180)
    let top = -Infinity
    for (let a = 0; a < l.nu; a++)
      for (let b = 0; b < l.nv; b++) {
        const u = (l.i0 + a + 0.5) * PLATE
        const v = (l.j0 + b + 0.5) * PLATE
        const [x, y] = fromGrid(u, v, deg)
        const z = base + l.h + tu * (u - uc) + tv * (v - vc)
        top = Math.max(top, z)
        // each reused plate has its own weathered tone (a fixed number from its place in the grid)
        const tone = ((((l.i0 + a) * 73856093) ^ ((l.j0 + b) * 19349663)) >>> 0) % 1000 / 1000
        plates.push([x, y, z, yaw, (l.tiltU * Math.PI) / 180, (l.tiltV * Math.PI) / 180, tone, l.id])
        // thin steel supports every 6 plates and at the ends, under the plate centre
        const edgeA = a === 0 || a === l.nu - 1 || a % SUPPORT_EVERY === 0
        const edgeB = b === 0 || b === l.nv - 1 || b % SUPPORT_EVERY === 0
        if (l.supports && edgeA && edgeB) {
          const from = roof ?? ground(x, y)
          if (z - PLATE_THICK / 2 - from > 0.3) supports.push([x, y, from, z - PLATE_THICK / 2])
        }
      }
    info[l.id] = { plates: l.nu * l.nv, onRoof: roof != null, wantsRoof: l.roof, base, top, centre: [cx, cy] }
  }
  return { plates, supports, info }
}
