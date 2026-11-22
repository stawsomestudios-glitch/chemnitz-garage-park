import * as THREE from 'three'
import { ground } from './terrain.js'
import { GARAGES, MODULE } from './garages.js'
import { MATERIALS } from './materials.js'
import polygonClipping from './vendor/polygon-clipping.js'

// The elevated park: one free-form deck, like a landscape mesh.
//   outlines the blobs of the deck: each a list of points [east, north] in metres, drawn as a smooth closed curve through them
//   heights  points that set the height: { id, x, y, h } h = metres above the ground there,
//            or roof: true = it sits on the roof of the building or garage below (plus `h` as a small gap)
//   holes    round openings { id, x, y, r, tree } (a tree grows up through it when `tree`)
// Between the height points the deck runs smoothly (inverse-distance weighting; `smooth` is the power:
// higher = flatter plateaus around each point and steeper slopes between them).
export const DEFAULT_PARK = {
  on: true,
  outlines: [[
    [-56, 92], [-62, 112], [-60, 132], [-40, 138], [-20, 141], [-6, 131], [-4, 116], [0, 100], [5, 84], [10, 66], [20, 53], [32, 41], [27, 33], [21, 25],
    [12, 24], [8, 31], [2, 31], [-6, 26], [-9, 36], [-7, 52], [-9, 70], [-17, 86], [-38, 87],
  ]],
  heights: [
    { id: 'h1', x: -34, y: 115, h: 17 },
    { id: 'h2', x: -55, y: 120, h: 17 },
    { id: 'h3', x: -14, y: 125, h: 17 },
    { id: 'h4', x: -32, y: 90, h: 0.5, roof: true },
    { id: 'h5', x: -4, y: 98, h: 0.5, roof: true },
    { id: 'h6', x: 1, y: 64, h: 9.5 },
    { id: 'h7', x: 25, y: 37, h: 0.4, roof: true },
    { id: 'h8', x: -1, y: 27, h: 0.4, roof: true },
    { id: 'h9', x: 16, y: 26.5, h: 0.05 },
  ],
  holes: [
    { id: 'o1', x: -42, y: 112, r: 3.5, tree: true },
    { id: 'o2', x: -22, y: 124, r: 3, tree: true },
    { id: 'o3', x: -50, y: 127, r: 2.5, tree: true },
    { id: 'o4', x: -28, y: 104, r: 4, tree: false },
    { id: 'o5', x: 1, y: 80, r: 2.2, tree: true },
  ],
  thick: 0.45,
  cell: 1.5,
  net: 1.2,
  netAngle: 11,
  columns: 7.2,
  rail: true,
  smooth: 2,
  mat: 'gdr',
  slope: false,
}

const num = (v, d, lo, hi) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d)
let idn = 0
export const newParkId = (p) => p + Date.now().toString(36) + (idn++).toString(36)
export function cleanPark(p) {
  if (!p || typeof p !== 'object') return DEFAULT_PARK
  const pt = (q) => Array.isArray(q) && q.length === 2 && q.every((v) => Number.isFinite(+v))
  const list = Array.isArray(p.outlines) ? p.outlines : Array.isArray(p.outline) ? [p.outline] : []
  const outlines = list.filter(Array.isArray).map((o) => o.filter(pt).map(([x, y]) => [+x, +y])).filter((o) => o.length >= 3)
  const heights = (Array.isArray(p.heights) ? p.heights : [])
    .filter((h) => h && Number.isFinite(+h.x) && Number.isFinite(+h.y))
    .map((h, i) => ({ id: String(h.id ?? 'h' + i), x: +h.x, y: +h.y, h: num(h.h, 0, -2, 60), ...(h.roof ? { roof: true } : {}) }))
  const holes = (Array.isArray(p.holes) ? p.holes : [])
    .filter((h) => h && Number.isFinite(+h.x) && Number.isFinite(+h.y))
    .map((h, i) => ({ id: String(h.id ?? 'o' + i), x: +h.x, y: +h.y, r: num(h.r, 2, 0.5, 20), tree: !!h.tree }))
  if (!outlines.length || !heights.length) return DEFAULT_PARK
  return {
    on: p.on !== false,
    outlines,
    heights,
    holes,
    thick: num(p.thick, 0.45, 0.1, 3),
    cell: num(p.cell, 1.5, 0.5, 6),
    net: num(p.net, 2, 0, 20),
    netAngle: num(p.netAngle, 11, -180, 180),
    columns: num(p.columns, 7.5, 0, 40),
    rail: p.rail !== false,
    smooth: num(p.smooth, 3, 1, 8),
    mat: MATERIALS[p.mat] ? p.mat : 'concrete',
    ...(typeof p.col === 'string' ? { col: p.col } : {}),
    slope: !!p.slope,
  }
}

// ---------- geometry helpers ----------
// a smooth closed curve through the points (centripetal Catmull–Rom), about `step` metres apart
export function smoothRing(pts, step = 0.8) {
  const n = pts.length
  if (n < 3) return pts.slice()
  const out = []
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n]
    const p1 = pts[i]
    const p2 = pts[(i + 1) % n]
    const p3 = pts[(i + 2) % n]
    const L = Math.hypot(p2[0] - p1[0], p2[1] - p1[1])
    const k = Math.max(2, Math.ceil(L / step))
    const c = new THREE.CatmullRomCurve3([p0, p1, p2, p3].map(([x, y]) => new THREE.Vector3(x, y, 0)), false, 'centripetal')
    for (let j = 0; j < k; j++) {
      const v = c.getPoint((1 + j / k) / 3)
      out.push([v.x, v.y])
    }
  }
  return out
}
export function holeRing(h) {
  const n = Math.max(16, Math.round(h.r * 6))
  return Array.from({ length: n }, (_, i) => [h.x + h.r * Math.cos((i / n) * Math.PI * 2), h.y + h.r * Math.sin((i / n) * Math.PI * 2)])
}

export function inRing(x, y, r) {
  let hit = false
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i]
    const [xj, yj] = r[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit
  }
  return hit
}
function distToRing(x, y, r) {
  let best = Infinity
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [ax, ay] = r[j]
    const [bx, by] = r[i]
    const dx = bx - ax
    const dy = by - ay
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)))
    best = Math.min(best, Math.hypot(ax + dx * t - x, ay + dy * t - y))
  }
  return best
}

// What stands under a point: the roof height (site level, with the ground) of a building or garage, or null
export function roofAt(x, y, buildings) {
  let top = null
  for (const b of buildings) {
    if (x < b.box[0] || x > b.box[2] || y < b.box[1] || y > b.box[3]) continue
    if (inRing(x, y, b.p)) top = Math.max(top ?? -Infinity, b.top())
  }
  for (const g of GARAGES) {
    if (buildings.goneGarages?.has(g.id)) continue
    const dx = x - g.x
    const dy = y - g.y
    if (Math.abs(dx * g.u[0] + dy * g.u[1]) <= MODULE.width / 2 && Math.abs(dx * g.n[0] + dy * g.n[1]) <= MODULE.depth / 2) top = Math.max(top ?? -Infinity, ground(g.x, g.y) + MODULE.height)
  }
  return top
}
// the buildings of the map, ready for roofAt
export function prepBuildings(site, goneGarages) {
  const list = site.buildings
    .filter((b) => b.kind !== 'garage' && !b.hidden && !b.gone)
    .map((b) => {
      const xs = b.p.map((q) => q[0])
      const ys = b.p.map((q) => q[1])
      const c = b.p.reduce((a, q) => [a[0] + q[0] / b.p.length, a[1] + q[1] / b.p.length], [0, 0])
      return { p: b.p, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], top: () => ground(c[0], c[1]) + b.h }
    })
  list.goneGarages = goneGarages ?? null
  return list
}

// the site level of each height point (with the ground, or on the roof below)
export function heightLevels(park, buildings) {
  return park.heights.map((q) => {
    const roof = q.roof ? roofAt(q.x, q.y, buildings) : null
    return { ...q, H: roof != null ? roof + q.h : ground(q.x, q.y) + q.h, onRoof: roof != null }
  })
}
// the top of the deck at (x, y), in site level
export function deckAt(levels, power, x, y) {
  let sw = 0
  let sh = 0
  for (const q of levels) {
    const d2 = (q.x - x) ** 2 + (q.y - y) ** 2
    if (d2 < 1e-4) return q.H
    const w = 1 / d2 ** (power / 2)
    sw += w
    sh += w * q.H
  }
  return Math.max(sh / sw, ground(x, y) + 0.02)
}

// Splits every triangle edge longer than `L` (the same edge in both neighbouring triangles, so there are no cracks).
export function refine(xs, ys, tris, L) {
  for (let pass = 0; pass < 14; pass++) {
    const mid = new Map()
    const key = (a, b) => (a < b ? a * 1e7 + b : b * 1e7 + a)
    for (let t = 0; t < tris.length; t += 3)
      for (let e = 0; e < 3; e++) {
        const a = tris[t + e]
        const b = tris[t + ((e + 1) % 3)]
        const k = key(a, b)
        if (mid.has(k)) continue
        if (Math.hypot(xs[a] - xs[b], ys[a] - ys[b]) > L) {
          mid.set(k, xs.length)
          xs.push((xs[a] + xs[b]) / 2)
          ys.push((ys[a] + ys[b]) / 2)
        }
      }
    if (!mid.size) break
    const out = []
    for (let t = 0; t < tris.length; t += 3) {
      let [a, b, c] = [tris[t], tris[t + 1], tris[t + 2]]
      let m = [mid.get(key(a, b)), mid.get(key(b, c)), mid.get(key(c, a))]
      const n = m.filter((v) => v !== undefined).length
      if (n === 0) {
        out.push(a, b, c)
        continue
      }
      if (n === 3) {
        out.push(a, m[0], m[2], m[0], b, m[1], m[2], m[1], c, m[0], m[1], m[2])
        continue
      }
      // turn the triangle so the pattern is always the same
      for (let r = 0; r < 3 && m[0] === undefined; r++) {
        ;[a, b, c] = [b, c, a]
        m = [m[1], m[2], m[0]]
      }
      if (n === 1) out.push(a, m[0], c, m[0], b, c)
      else if (m[1] !== undefined) out.push(a, m[0], c, m[0], b, m[1], m[0], m[1], c)
      else out.push(a, m[0], m[2], m[0], b, c, m[2], m[0], c) // m[0] and m[2]
    }
    tris = out
  }
  return tris
}

const SLOPE_COLOURS = [
  [5, new THREE.Color('#5aa55a')],
  [8.33, new THREE.Color('#e3c33b')],
  [12, new THREE.Color('#e88a2e')],
  [Infinity, new THREE.Color('#d23b2f')],
]

// Everything the park is drawn from.
export function buildPark(park, buildings) {
  // every blob of the deck: its own smooth edge, anticlockwise
  const rings = park.outlines.map((o) => {
    const r = smoothRing(o)
    return THREE.ShapeUtils.isClockWise(r.map(([x, y]) => new THREE.Vector2(x, y))) ? r.reverse() : r
  })
  const ring = rings[0]
  const ringOf = (x, y) => rings.findIndex((r) => inRing(x, y, r))
  const inAny = (x, y) => ringOf(x, y) >= 0
  const distAny = (x, y) => Math.min(...rings.map((r) => distToRing(x, y, r)))
  // openings only where they fit inside the deck and don't touch each other
  const holes = []
  const skipped = []
  for (const h of park.holes) {
    const k = ringOf(h.x, h.y)
    const fits = k >= 0 && distToRing(h.x, h.y, rings[k]) > h.r + 0.4 && holes.every((o) => Math.hypot(o.x - h.x, o.y - h.y) > o.r + h.r + 0.4)
    ;(fits ? holes : skipped).push(h)
  }
  const holeRings = holes.map((h) => holeRing(h).reverse())
  const levels = heightLevels(park, buildings)
  const H = (x, y) => deckAt(levels, park.smooth, x, y)

  // the plan triangulated, then refined to the mesh size
  const xs = []
  const ys = []
  let faces = []
  rings.forEach((rg, k) => {
    const hr = holeRings.filter((_, j) => ringOf(holes[j].x, holes[j].y) === k)
    const base = xs.length
    for (const r of [rg, ...hr]) for (const [x, y] of r) xs.push(x), ys.push(y)
    const f = THREE.ShapeUtils.triangulateShape(rg.map(([x, y]) => new THREE.Vector2(x, y)), hr.map((r) => r.map(([x, y]) => new THREE.Vector2(x, y))))
    faces = faces.concat(f.flat().map((i) => i + base))
  })
  let tris = refine(xs, ys, faces, park.cell)
  const n = xs.length
  const zs = new Float32Array(n)
  for (let i = 0; i < n; i++) zs[i] = H(xs[i], ys[i])

  // top surface (with planar texture coordinates in metres and slope colours)
  const top = new THREE.BufferGeometry()
  const pos = new Float32Array(n * 3)
  const uv = new Float32Array(n * 2)
  const col = new Float32Array(n * 3)
  let maxSlope = 0
  let hi = -Infinity
  const c = new THREE.Color()
  const gc = Math.cos((park.netAngle * Math.PI) / 180)
  const gs = Math.sin((park.netAngle * Math.PI) / 180)
  for (let i = 0; i < n; i++) {
    pos.set([xs[i], zs[i], -ys[i]], i * 3)
    uv.set([xs[i] * gc + ys[i] * gs, -xs[i] * gs + ys[i] * gc], i * 2)
    const gx = (H(xs[i] + 0.5, ys[i]) - H(xs[i] - 0.5, ys[i])) / 1
    const gy = (H(xs[i], ys[i] + 0.5) - H(xs[i], ys[i] - 0.5)) / 1
    const s = Math.hypot(gx, gy) * 100
    if (s > maxSlope) maxSlope = s
    hi = Math.max(hi, zs[i] - ground(xs[i], ys[i]))
    c.copy(SLOPE_COLOURS.find(([lim]) => s < lim)[1])
    col.set([c.r, c.g, c.b], i * 3)
  }
  top.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  top.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  top.setAttribute('color', new THREE.BufferAttribute(col, 3))
  top.setIndex(tris)
  top.computeVertexNormals()

  // underside and the edge faces
  const edges = new Map()
  for (let t = 0; t < tris.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const a = tris[t + e]
      const b = tris[t + ((e + 1) % 3)]
      const k = a < b ? a + ',' + b : b + ',' + a
      edges.set(k, edges.has(k) ? null : [a, b])
    }
  const border = [...edges.values()].filter(Boolean)
  const T = park.thick
  const body = []
  for (let t = 0; t < tris.length; t += 3) {
    const [a, b, cc] = [tris[t], tris[t + 2], tris[t + 1]]
    for (const i of [a, b, cc]) body.push(xs[i], zs[i] - T, -ys[i])
  }
  for (const [a, b] of border) {
    const A = [xs[a], zs[a], -ys[a]]
    const B = [xs[b], zs[b], -ys[b]]
    const A2 = [A[0], A[1] - T, A[2]]
    const B2 = [B[0], B[1] - T, B[2]]
    body.push(...A, ...A2, ...B2, ...A, ...B2, ...B)
  }
  const under = new THREE.BufferGeometry()
  under.setAttribute('position', new THREE.Float32BufferAttribute(body, 3))
  under.computeVertexNormals()

  // railings: glass panels 1.1 m high along every edge more than 1 m above the ground
  const rail = []
  const handrail = []
  if (park.rail)
    for (const [a, b] of border) {
      const mx = (xs[a] + xs[b]) / 2
      const my = (ys[a] + ys[b]) / 2
      if ((zs[a] + zs[b]) / 2 - ground(mx, my) < 1) continue
      const A = [xs[a], zs[a], -ys[a]]
      const B = [xs[b], zs[b], -ys[b]]
      const A2 = [A[0], A[1] + 1.1, A[2]]
      const B2 = [B[0], B[1] + 1.1, B[2]]
      rail.push(...A, ...B, ...B2, ...A, ...B2, ...A2)
      handrail.push(...A2, ...B2)
    }
  const railGeo = new THREE.BufferGeometry()
  railGeo.setAttribute('position', new THREE.Float32BufferAttribute(rail, 3))
  railGeo.computeVertexNormals()

  // the net: lines in two directions, draped over the deck
  const net = []
  const inside = (x, y) => inAny(x, y) && !holes.some((h) => Math.hypot(h.x - x, h.y - y) < h.r)
  if (park.net > 0) {
    const a = (park.netAngle * Math.PI) / 180
    const U = [Math.cos(a), Math.sin(a)]
    const V = [-Math.sin(a), Math.cos(a)]
    let [u0, u1, v0, v1] = [Infinity, -Infinity, Infinity, -Infinity]
    for (const [x, y] of rings.flat()) {
      const u = x * U[0] + y * U[1]
      const v = x * V[0] + y * V[1]
      ;(u0 = Math.min(u0, u)), (u1 = Math.max(u1, u)), (v0 = Math.min(v0, v)), (v1 = Math.max(v1, v))
    }
    const S = park.net
    const step = Math.min(0.6, S / 2)
    const lines = (A, B, a0, a1, b0, b1) => {
      for (let k = Math.ceil(a0 / S) * S; k <= a1; k += S) {
        let prev = null
        for (let t = b0; t <= b1 + step; t += step) {
          const x = A[0] * k + B[0] * t
          const y = A[1] * k + B[1] * t
          const p = inside(x, y) ? [x, H(x, y) + 0.025, -y] : null
          if (p && prev) net.push(...prev, ...p)
          prev = p
        }
      }
    }
    lines(U, V, u0, u1, v0, v1)
    lines(V, U, v0, v1, u0, u1)
  }
  const netGeo = new THREE.BufferGeometry()
  netGeo.setAttribute('position', new THREE.Float32BufferAttribute(net, 3))
  const handGeo = new THREE.BufferGeometry()
  handGeo.setAttribute('position', new THREE.Float32BufferAttribute(handrail, 3))

  // thin columns, SANAA-like, on a grid along the net, where the deck is high and nothing stands below
  const columns = []
  if (park.columns > 0) {
    const a = (park.netAngle * Math.PI) / 180
    const U = [Math.cos(a), Math.sin(a)]
    const V = [-Math.sin(a), Math.cos(a)]
    const S = park.columns
    const R = 260
    for (let i = Math.ceil(-R / S); i <= R / S; i++)
      for (let j = Math.ceil(-R / S); j <= R / S; j++) {
        const x = U[0] * i * S + V[0] * j * S
        const y = U[1] * i * S + V[1] * j * S
        if (!inside(x, y) || distAny(x, y) < 0.8) continue
        const z = H(x, y) - T
        if (z - ground(x, y) < 2.4) continue
        if (roofAt(x, y, buildings) != null) continue
        if (holes.some((h) => Math.hypot(h.x - x, h.y - y) < h.r + 0.6)) continue
        columns.push([x, y, z])
      }
  }

  // area
  let area = 0
  for (let t = 0; t < tris.length; t += 3) {
    const [a, b, cc] = [tris[t], tris[t + 1], tris[t + 2]]
    area += Math.abs((xs[b] - xs[a]) * (ys[cc] - ys[a]) - (xs[cc] - xs[a]) * (ys[b] - ys[a])) / 2
  }
  return {
    ring,
    rings,
    holes,
    skipped,
    levels,
    H,
    top,
    under,
    rail: railGeo,
    handrail: handGeo,
    net: netGeo,
    columns,
    trees: holes.filter((h) => h.tree).map((h) => ({ ...h, deck: H(h.x, h.y), g: ground(h.x, h.y) })),
    stats: { area, maxSlope, high: hi, columns: columns.length },
  }
}

// ---------- cutting ----------
export const ringArea = (r) => {
  let a = 0
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1]
  return a / 2
}
// a closed outline cut along the line from a to b (a little longer), leaving a gap `gap` wide: the pieces
export function cutRing(ring, a, b, gap) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
  const d = [(b[0] - a[0]) / L, (b[1] - a[1]) / L]
  const n = [(-d[1] * gap) / 2, (d[0] * gap) / 2]
  const A = [a[0] - d[0], a[1] - d[1]]
  const B = [b[0] + d[0], b[1] + d[1]]
  const strip = [[A[0] + n[0], A[1] + n[1]], [B[0] + n[0], B[1] + n[1]], [B[0] - n[0], B[1] - n[1]], [A[0] - n[0], A[1] - n[1]], [A[0] + n[0], A[1] + n[1]]]
  try {
    return polygonClipping.difference([[...ring, ring[0]]], [strip]).map((poly) => poly[0].slice(0, -1))
  } catch {
    return [ring]
  }
}
// fewer points on a closed outline (Douglas–Peucker), keeping its shape within `tol` metres
function dp(pts, tol) {
  if (pts.length < 3) return pts
  const [ax, ay] = pts[0]
  const [bx, by] = pts[pts.length - 1]
  const L = Math.hypot(bx - ax, by - ay) || 1e-9
  let wd = 0
  let wi = -1
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((pts[i][0] - ax) * (by - ay) - (pts[i][1] - ay) * (bx - ax)) / L
    if (d > wd) (wd = d), (wi = i)
  }
  if (wd <= tol) return [pts[0], pts[pts.length - 1]]
  return [...dp(pts.slice(0, wi + 1), tol).slice(0, -1), ...dp(pts.slice(wi), tol)]
}
export function simplifyClosed(r, tol) {
  let k = 0
  let far = -1
  for (let i = 1; i < r.length; i++) {
    const d = Math.hypot(r[i][0] - r[0][0], r[i][1] - r[0][1])
    if (d > far) (far = d), (k = i)
  }
  return [...dp(r.slice(0, k + 1), tol).slice(0, -1), ...dp([...r.slice(k), r[0]], tol).slice(0, -1)]
}
// the park's blobs cut along a line: blobs it doesn't cross stay as they are
export function cutOutlines(outlines, a, b, gap) {
  const out = []
  for (const o of outlines) {
    const dense = smoothRing(o, 0.6)
    const pieces = cutRing(dense, a, b, gap)
    const before = Math.abs(ringArea(dense))
    const after = pieces.reduce((s, p) => s + Math.abs(ringArea(p)), 0)
    if (pieces.length === 1 && before - after < 0.5) {
      out.push(o)
      continue
    }
    for (const p of pieces) if (Math.abs(ringArea(p)) > 4) out.push(simplifyClosed(p, 0.45).map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]))
  }
  return out
}
