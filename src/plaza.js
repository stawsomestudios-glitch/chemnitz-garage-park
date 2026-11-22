import * as THREE from 'three'
import { ground } from './terrain.js'
import { MATERIALS } from './materials.js'
import { inRing, refine } from './park.js'

// The city plaza on Stollberger Straße, between the slabs on Richard-Wagner-Straße and the garages.
//   outline   the plaza edge [east, north], straight lines between the points
//   lane      the street stays only as shared lanes (one each way, beside the tram): paved like the plaza,
//             no kerbs, walking speed, pedestrians first
//   laneWidth width of each lane
//   commerce  shop fronts (glass) on the ground floor of the two slabs
export const COMMERCE = [183, 184] // the two slabs in site.json
export const DEFAULT_PLAZA = {
  on: true,
  outline: [[-44, 4], [-16, 25], [11, 48], [22, 54], [30, 62], [18, 82], [6, 97], [-57.5, 84], [-56, 62], [-46, 47], [-43, 22]],
  lane: true,
  laneWidth: 3.25,
  commerce: true,
  mat: 'granite',
}
const num = (v, d, lo, hi) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d)
export function cleanPlaza(p) {
  if (!p || typeof p !== 'object') return DEFAULT_PLAZA
  const outline = Array.isArray(p.outline) ? p.outline.filter((q) => Array.isArray(q) && q.length === 2 && q.every((v) => Number.isFinite(+v))).map(([x, y]) => [+x, +y]) : []
  if (outline.length < 3) return DEFAULT_PLAZA
  return {
    on: p.on !== false,
    outline,
    lane: p.lane !== false,
    laneWidth: num(p.laneWidth, 3.25, 2.5, 7),
    commerce: p.commerce !== false,
    mat: MATERIALS[p.mat] ? p.mat : 'granite',
    ...(typeof p.col === 'string' ? { col: p.col } : {}),
  }
}

// a flat area draped over the ground, `lift` metres up, with planar texture coordinates in metres
function drape(rings, lift, cell = 2.5) {
  const [outer, ...holes] = rings
  const xs = []
  const ys = []
  for (const r of rings) for (const [x, y] of r) xs.push(x), ys.push(y)
  const faces = THREE.ShapeUtils.triangulateShape(
    outer.map(([x, y]) => new THREE.Vector2(x, y)),
    holes.map((r) => r.map(([x, y]) => new THREE.Vector2(x, y))),
  )
  const tris = refine(xs, ys, faces.flat(), cell)
  const pos = new Float32Array(xs.length * 3)
  const uv = new Float32Array(xs.length * 2)
  for (let i = 0; i < xs.length; i++) {
    pos.set([xs[i], ground(xs[i], ys[i]) + lift, -ys[i]], i * 3)
    uv.set([xs[i], ys[i]], i * 2)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  g.setIndex(tris)
  g.computeVertexNormals()
  return g
}

// the parts of a line that lie inside the plaza, every metre: [[x, y], …] runs
function runsInside(line, ring) {
  const runs = []
  let run = []
  for (let i = 0; i + 1 < line.length; i++) {
    const [ax, ay] = line[i]
    const [bx, by] = line[i + 1]
    const L = Math.hypot(bx - ax, by - ay)
    const n = Math.max(1, Math.ceil(L))
    for (let k = i ? 1 : 0; k <= n; k++) {
      const p = [ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]
      if (inRing(p[0], p[1], ring)) run.push(p)
      else if (run.length) runs.push(run), (run = [])
    }
  }
  if (run.length > 1) runs.push(run)
  return runs.filter((r) => r.length > 1)
}
// a band along a run, `w` wide, draped `lift` up; `off` shifts it sideways
function band(runs, w, lift, off = 0) {
  const pos = []
  const uv = []
  for (const r of runs)
    for (let i = 0; i + 1 < r.length; i++) {
      const [ax, ay] = r[i]
      const [bx, by] = r[i + 1]
      const L = Math.hypot(bx - ax, by - ay) || 1
      const nx = -(by - ay) / L
      const ny = (bx - ax) / L
      const q = (x, y, s) => [x + nx * (off + s), y + ny * (off + s)]
      const P = [q(ax, ay, w / 2), q(ax, ay, -w / 2), q(bx, by, -w / 2), q(bx, by, w / 2)]
      for (const k of [0, 1, 2, 0, 2, 3]) {
        const [x, y] = P[k]
        pos.push(x, ground(x, y) + lift, -y)
        uv.push(x, y)
      }
    }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.computeVertexNormals()
  return g
}

export function buildPlaza(plaza, site) {
  const ring = plaza.outline
  const floor = drape([ring], 0.07)
  // the street becomes shared lanes: the two carriageways of Stollberger Straße inside the plaza
  const roads = site.lines.filter((l) => l.kind === 'road' && l.name === 'Stollberger Straße').flatMap((l) => runsInside(l.p, ring))
  const trams = site.lines.filter((l) => l.kind === 'tram').flatMap((l) => runsInside(l.p, ring))
  const lane = plaza.lane ? band(roads, plaza.laneWidth, 0.09) : null
  // tram rails, 1.435 m apart, set into the paving
  const rails = trams.length ? [band(trams, 0.09, 0.105, 0.7175), band(trams, 0.09, 0.105, -0.7175)] : []
  // lane edges for dashed studs, both sides of each lane
  const edges = []
  if (plaza.lane)
    for (const r of roads)
      for (const s of [plaza.laneWidth / 2, -plaza.laneWidth / 2]) {
        const pts = []
        for (let i = 0; i < r.length; i++) {
          const a = r[Math.max(0, i - 1)]
          const b = r[Math.min(r.length - 1, i + 1)]
          const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
          const x = r[i][0] - ((b[1] - a[1]) / L) * s
          const y = r[i][1] + ((b[0] - a[0]) / L) * s
          pts.push([x, ground(x, y) + 0.13, -y])
        }
        edges.push(pts)
      }
  // shop fronts: a glass band on the ground floor of the slabs, with mullions and a fascia
  const glass = []
  const mullions = []
  const fascia = []
  if (plaza.commerce)
    for (const i of COMMERCE) {
      const b = site.buildings[i]
      if (!b) continue
      const p = b.p
      const cx = p.reduce((a, q) => a + q[0], 0) / p.length
      const cy = p.reduce((a, q) => a + q[1], 0) / p.length
      for (let k = 0; k < p.length; k++) {
        const [ax, ay] = p[k]
        const [bx, by] = p[(k + 1) % p.length]
        const L = Math.hypot(bx - ax, by - ay)
        if (L < 0.5) continue
        // outward by 6 cm
        let nx = -(by - ay) / L
        let ny = (bx - ax) / L
        if (((ax + bx) / 2 + nx - cx) ** 2 + ((ay + by) / 2 + ny - cy) ** 2 < ((ax + bx) / 2 - cx) ** 2 + ((ay + by) / 2 - cy) ** 2) (nx = -nx), (ny = -ny)
        const o = 0.06
        const A = [ax + nx * o, ay + ny * o]
        const B = [bx + nx * o, by + ny * o]
        const ga = ground(A[0], A[1])
        const gb = ground(B[0], B[1])
        const quad = (list, h0, h1) => {
          const P = [[A[0], ga + h0, -A[1]], [B[0], gb + h0, -B[1]], [B[0], gb + h1, -B[1]], [A[0], ga + h1, -A[1]]]
          for (const j of [0, 1, 2, 0, 2, 3]) list.push(...P[j])
        }
        quad(glass, 0.05, 3.6)
        quad(fascia, 3.6, 4.3)
        const n = Math.max(1, Math.round(L / 2.5))
        for (let j = 0; j <= n; j++) mullions.push([A[0] + ((B[0] - A[0]) * j) / n, A[1] + ((B[1] - A[1]) * j) / n, Math.atan2(by - ay, bx - ax)])
      }
    }
  const geo = (a) => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(a, 3))
    g.computeVertexNormals()
    return g
  }
  let area = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) area += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]
  let laneLen = 0
  for (const r of roads) for (let i = 1; i < r.length; i++) laneLen += Math.hypot(r[i][0] - r[i - 1][0], r[i][1] - r[i - 1][1])
  return { ring, floor, lane, rails, edges, glass: geo(glass), fascia: geo(fascia), mullions, stats: { area: Math.abs(area / 2), lane: laneLen } }
}
