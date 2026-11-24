import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

// A blob canopy: a thin roof whose edge is made of circles (2 to 6 round lobes melted together),
// with a blob-shaped hole in the middle if you like, standing on stems.
// Stem "trumpet": under each lobe a slim stem that flares out like a trumpet until it meets the roof's edge;
//   neighbouring trumpets meet in a curved valley under the roof, and stop at the hole.
// Stem "tree": one trunk splitting into curved branches, one up to each lobe (forking again if you like).
// Every measure is in metres and can be changed in the selection panel (element kind "trefoil", fields in it.tf).
export const TREFOIL = {
  h: { label: 'Height', min: 2.5, max: 20, step: 0.1, def: 5.5, unit: 'm', title: 'Height of the top of the roof' },
  style: { label: 'Stems', choices: [[0, 'Trumpets'], [1, 'Tree']], def: 0, title: 'A flared trumpet under each lobe, or one branching tree stem' },
  W: { label: 'Width', min: 2, max: 60, step: 0.1, def: 14, unit: 'm', title: 'Overall width (east–west, before turning it)' },
  L: { label: 'Length', min: 2, max: 60, step: 0.1, def: 14, unit: 'm', title: 'Overall length (north–south, before turning it)' },
  sp: { label: 'Distance between points', min: 1, max: 30, step: 0.1, def: 6.2, unit: 'm', title: 'Distance between the centres of neighbouring circles; it decides how many circles fit around' },
  R: { label: 'Circle size', min: 0.5, max: 15, step: 0.1, def: 3.6, unit: 'm', title: 'Radius of each circle' },
  k: { label: 'Soft joins', min: 0, max: 10, step: 0.1, def: 2.5, unit: 'm', title: 'How softly the lobes melt into each other (0: sharp notches)' },
  turn: { label: 'Slide points', min: -180, max: 180, step: 1, def: 0, unit: '°', title: 'Slide the circle centres around the shape' },
  hole: { label: 'Hole size', min: 0, max: 6, step: 0.05, def: 1.1, unit: 'm', title: 'Radius of the blob-shaped hole in the middle (0: no hole)' },
  holeD: { label: 'Hole lobes', min: 0, max: 5, step: 0.05, def: 0.7, unit: 'm', title: 'How lobed the hole is (0: a round hole)' },
  t: { label: 'Roof thickness', min: 0.04, max: 1.5, step: 0.01, def: 0.12, unit: 'm', title: 'Thickness of the roof at its edge' },
  bevel: { label: 'Soft edge', min: 0, max: 0.6, step: 0.01, def: 0.04, unit: 'm', title: 'Rounding of the roof edge' },
  trunk: { label: 'Stem', min: 0.05, max: 1.2, step: 0.01, def: 0.2, unit: 'm', title: 'Radius of each stem (trumpets) or of the trunk (tree)' },
  flare: { label: 'Flare starts', min: 0.05, max: 0.9, step: 0.01, def: 0.3, unit: '× height', title: 'Trumpets: how high the stem starts to widen' },
  curve: { label: 'Flare curve', min: 1, max: 6, step: 0.1, def: 3, unit: '', title: 'Trumpets: 1 is a straight cone, higher stays slim long and opens wide at the top' },
  foot: { label: 'Foot', min: 0, max: 2, step: 0.05, def: 0.4, unit: '', title: 'Trumpets: how much the stem widens at the ground' },
  split: { label: 'Branching at', min: 0.1, max: 0.9, step: 0.01, def: 0.45, unit: '× height', title: 'Tree: where the trunk splits into branches' },
  branch: { label: 'Branches', min: 0.03, max: 0.8, step: 0.01, def: 0.14, unit: 'm', title: 'Tree: radius of the branches' },
  reach: { label: 'Branch reach', min: 0.2, max: 1.2, step: 0.01, def: 0.8, unit: '× spread', title: 'Tree: how far out under the lobes the branches reach' },
  forks: { label: 'Forks', min: 0, max: 3, step: 1, def: 1, unit: '', title: 'Tree: how often each branch splits again' },
}
// which sliders belong to which stem
export const FOR_STYLE = { flare: 0, curve: 0, foot: 0, split: 1, branch: 1, reach: 1, forks: 1 }
export const DEFAULT_TF = Object.fromEntries(Object.entries(TREFOIL).map(([k, v]) => [k, v.def]))
export function cleanTrefoil(tf) {
  const out = {}
  for (const [k, v] of Object.entries(TREFOIL)) {
    const n = +tf?.[k]
    if (v.choices) out[k] = v.choices.some(([c]) => c === n) ? n : v.def
    else out[k] = Number.isFinite(n) ? Math.min(v.max, Math.max(v.min, n)) : v.def
  }
  return out
}
// the size of its footprint (for the selection pad and connect points)
export const trefoilSize = (tf) => {
  const p = cleanTrefoil(tf)
  return { w: Math.max(p.W, 2 * p.R), d: Math.max(p.L, 2 * p.R), h: p.h }
}

// the centres of the circles: spaced evenly (by the distance between points) around an oval
// that is the width and length minus one circle; a small canopy is a single circle in the middle
export function points(tf) {
  const p = cleanTrefoil(tf)
  const ax = Math.max(0, p.W / 2 - p.R)
  const ay = Math.max(0, p.L / 2 - p.R)
  if (ax < 0.05 && ay < 0.05) return [[0, 0]]
  const S = 720
  const a0 = Math.PI / 2 + (p.turn * Math.PI) / 180
  const pts = []
  const len = [0]
  for (let i = 0; i <= S; i++) {
    const a = a0 + (i / S) * Math.PI * 2
    pts.push([Math.cos(a) * ax, Math.sin(a) * ay])
    if (i) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
  }
  const P = len[S]
  const n = Math.max(2, Math.min(24, Math.round(P / p.sp)))
  const out = []
  let j = 0
  for (let i = 0; i < n; i++) {
    const want = (i / n) * P
    while (j < S && len[j + 1] < want) j++
    const t = (want - len[j]) / Math.max(1e-9, len[j + 1] - len[j])
    out.push([pts[j][0] + (pts[j + 1][0] - pts[j][0]) * t, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * t])
  }
  // two points on top of each other (a very thin oval) count once
  return out.filter((q, i) => out.findIndex((o) => Math.hypot(o[0] - q[0], o[1] - q[1]) < 0.05) === i)
}

// a smooth minimum: two shapes melt together over the width k
const smin = (a, b, k) => {
  if (k <= 0) return Math.min(a, b)
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.min(a, b) - (h * h * k) / 4
}
const ring = (n, dist, a0) =>
  Array.from({ length: n }, (_, i) => {
    const a = a0 + Math.PI / 2 + (i * 2 * Math.PI) / n
    return [Math.cos(a) * dist, Math.sin(a) * dist]
  })
// distance from a point to the edge of the melted circles (negative inside)
const field = (x, y, cs, r, k) => cs.reduce((m, [cx, cy]) => smin(m, Math.hypot(x - cx, y - cy) - r, k), Infinity)

function shapeOf(tf) {
  const p = cleanTrefoil(tf)
  const a0 = (p.turn * Math.PI) / 180
  const lobes = points(tf)
  const n = Math.max(2, lobes.length)
  const holeLobes = p.holeD > 0 ? ring(n, p.holeD, a0 + Math.PI / n) : [[0, 0]] // the hole's lobes point between the roof's
  const hk = Math.min(p.hole * 1.2, 2)
  const inRoof = (x, y) => field(x, y, lobes, p.R, p.k) <= 0
  const inHole = (x, y) => p.hole > 0 && field(x, y, holeLobes, p.hole, hk) <= 0
  return { p, lobes, holeLobes, hk, inRoof, inHole }
}

// the outline of the roof and of its hole, as points around the middle
export function outlines(tf) {
  const S = shapeOf(tf)
  const { p, lobes, holeLobes, hk } = S
  const N = 240
  const out = []
  const hole = []
  const far = Math.max(p.W, p.L) / 2 + p.R + p.k + 1
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2
    const c = Math.cos(a)
    const s = Math.sin(a)
    // outer edge: walk in from far away until inside, then narrow it down
    let r = far
    for (; r > 0; r -= 0.1) if (field(c * r, s * r, lobes, p.R, p.k) <= 0) break
    let lo = Math.max(0, r)
    let hi = r + 0.1
    for (let j = 0; j < 20; j++) {
      const m = (lo + hi) / 2
      if (field(c * m, s * m, lobes, p.R, p.k) <= 0) lo = m
      else hi = m
    }
    out.push([c * lo, s * lo])
    if (p.hole > 0) {
      // the hole's edge: walk out from the middle until outside the hole
      let q = 0
      for (; q < far; q += 0.04) if (field(c * q, s * q, holeLobes, p.hole, hk) > 0) break
      let a1 = Math.max(0, q - 0.04)
      let b1 = q
      for (let j = 0; j < 16; j++) {
        const m = (a1 + b1) / 2
        if (field(c * m, s * m, holeLobes, p.hole, hk) > 0) b1 = m
        else a1 = m
      }
      hole.push([c * Math.min(b1, lo - 0.3), s * Math.min(b1, lo - 0.3)])
    }
  }
  return { out, hole: p.hole > 0 ? hole : null, S }
}

// a trumpet under lobe i: rings from the ground up; in every direction it opens until it meets the roof's edge,
// the hole, or the part of the roof that belongs to the next lobe
function trumpet(S, i) {
  const { p, lobes, inRoof, inHole } = S
  const [cx, cy] = lobes[i]
  const A = 72
  const top = p.h - p.t
  const z0 = Math.max(0.2, top * p.flare)
  const rs = p.trunk
  const rim = []
  for (let a = 0; a < A; a++) {
    const th = (a / A) * Math.PI * 2
    const ux = Math.cos(th)
    const uy = Math.sin(th)
    let r = rs
    const step = 0.05
    for (; r < p.R + p.k + Math.max(p.W, p.L) + 2; r += step) {
      const x = cx + ux * r
      const y = cy + uy * r
      const mine = lobes.every(([ox, oy], j) => j === i || Math.hypot(x - cx, y - cy) <= Math.hypot(x - ox, y - oy) + 1e-6)
      if (!inRoof(x, y) || inHole(x, y) || !mine) break
    }
    rim.push(Math.max(rs, r - step))
  }
  const M = 48
  const pos = []
  const idx = []
  for (let j = 0; j <= M; j++) {
    const z = (j / M) * top
    for (let a = 0; a <= A; a++) {
      const th = (a / A) * Math.PI * 2
      let r
      if (z <= z0) r = rs * (1 + p.foot * Math.pow(1 - z / z0, 4))
      else r = rs + (rim[a % A] - rs) * Math.pow((z - z0) / (top - z0), p.curve)
      pos.push(cx + Math.cos(th) * r, z, -(cy + Math.sin(th) * r))
    }
  }
  const W = A + 1
  for (let j = 0; j < M; j++)
    for (let a = 0; a < A; a++) {
      const q = j * W + a
      idx.push(q, q + 1, q + W, q + 1, q + W + 1, q + W)
    }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

// the roof and the stems, standing on the ground at (0, 0, 0); y is up, -z is north (the element's front is +z)
export function buildTrefoil(tf) {
  const { out, hole, S } = outlines(tf)
  const { p, lobes: L } = S
  const shape = new THREE.Shape(out.map(([x, y]) => new THREE.Vector2(x, y)))
  if (hole) shape.holes.push(new THREE.Path(hole.slice().reverse().map(([x, y]) => new THREE.Vector2(x, y))))
  const bevel = Math.min(p.bevel, p.t / 2 - 0.005)
  const roof = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.01, p.t - 2 * Math.max(0, bevel)),
    bevelEnabled: bevel > 0.005,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 4,
    curveSegments: 4,
  })
  roof.rotateX(-Math.PI / 2) // the plan lies flat, the thickness goes up
  roof.translate(0, p.h - p.t + Math.max(0, bevel), 0)

  const parts = []
  if (p.style === 0) {
    for (let i = 0; i < L.length; i++) parts.push(trumpet(S, i))
  } else {
    // the tree: a trunk with a flared foot, then curved branches up to each lobe
    const under = p.h - p.t
    const s = Math.max(0.3, under * p.split)
    const trunk = new THREE.CylinderGeometry(p.trunk * 0.85, p.trunk * 1.25, s + 0.2, 20, 1)
    trunk.translate(0, (s + 0.2) / 2, 0)
    parts.push(trunk)
    const foot = new THREE.CylinderGeometry(p.trunk * 1.25, p.trunk * 1.9, 0.35, 20, 1)
    foot.translate(0, 0.175, 0)
    parts.push(foot)
    const V = (x, y, z) => new THREE.Vector3(x, y, z)
    const tube = (curve, r0, r1) => {
      const g = new THREE.TubeGeometry(curve, 20, (r0 + r1) / 2, 10, false)
      const pos = g.attributes.position
      const centre = new THREE.Vector3()
      for (let i = 0; i <= 20; i++) {
        curve.getPointAt(i / 20, centre)
        const k = (r0 + (r1 - r0) * (i / 20)) / ((r0 + r1) / 2)
        for (let j = 0; j <= 10; j++) {
          const v = i * 11 + j
          pos.setXYZ(v, centre.x + (pos.getX(v) - centre.x) * k, centre.y + (pos.getY(v) - centre.y) * k, centre.z + (pos.getZ(v) - centre.z) * k)
        }
      }
      g.computeVertexNormals()
      parts.push(g)
    }
    const grow = (from, to, r0, r1, depth, sideways) => {
      const bend = V(sideways.x, 0, sideways.z).multiplyScalar(0.15)
      if (depth > 0) {
        const fork = from.clone().lerp(to, 0.5)
        fork.y = from.y + (to.y - from.y) * 0.5
        tube(new THREE.CatmullRomCurve3([from, from.clone().lerp(fork, 0.5).add(bend), fork]), r0, (r0 + r1) / 2)
        const side = V(-sideways.z, 0, sideways.x).normalize()
        const spread = Math.max(0.6, from.distanceTo(to) * 0.22)
        for (const sgn of [-1, 1]) grow(fork, to.clone().add(side.clone().multiplyScalar(sgn * spread)), ((r0 + r1) / 2) * 0.85, r1 * 0.85, depth - 1, sideways)
      } else {
        const mid = from.clone().lerp(to, 0.5)
        mid.y = from.y + (to.y - from.y) * 0.62
        tube(new THREE.CatmullRomCurve3([from, mid.add(bend), to]), r0, r1)
      }
    }
    const top = V(0, s, 0)
    for (const [lx, ly] of L) {
      const dir = Math.hypot(lx, ly) > 0.01 ? V(lx, 0, -ly).normalize() : V(1, 0, 0)
      grow(top, V(lx * p.reach, under + 0.02, -ly * p.reach), p.branch * 1.3, p.branch * 0.7, p.forks, dir)
    }
  }
  const clean = (g) => {
    const q = g.index ? g.toNonIndexed() : g
    for (const k of Object.keys(q.attributes)) if (k !== 'position' && k !== 'normal') q.deleteAttribute(k)
    return q
  }
  const stem = mergeGeometries(parts.map(clean))
  stem.computeBoundingSphere()
  return { roof, stem, lobes: L, R: p.R }
}
