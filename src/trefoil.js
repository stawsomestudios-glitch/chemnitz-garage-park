import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

// A tree canopy: a roof shaped around three circles (a rounded, almost triangular blob, each corner a circle),
// with a blob-shaped hole in the middle, standing on a stem that grows like a tree: a trunk that splits
// into curved branches, one up to each lobe (and, if you like, each branch forking once more).
// Every measure is in metres and can be changed in the selection panel (element kind "trefoil", fields in it.tf).
export const TREFOIL = {
  R: { label: 'Lobe size', min: 1, max: 12, step: 0.1, def: 3.6, unit: 'm', title: 'Radius of each of the three round corners' },
  d: { label: 'Lobe spread', min: 0.5, max: 14, step: 0.1, def: 3.4, unit: 'm', title: 'How far each round corner sits from the middle' },
  k: { label: 'Soft joins', min: 0, max: 10, step: 0.1, def: 3, unit: 'm', title: 'How softly the three circles melt into each other (0: sharp notches)' },
  turn: { label: 'Turn lobes', min: -60, max: 60, step: 1, def: 0, unit: '°', title: 'Turn the three lobes around the middle' },
  hole: { label: 'Hole size', min: 0, max: 6, step: 0.05, def: 1.1, unit: 'm', title: 'Radius of the blob-shaped hole in the middle (0: no hole)' },
  holeD: { label: 'Hole lobes', min: 0, max: 5, step: 0.05, def: 0.8, unit: 'm', title: 'How three-lobed the hole is (0: a round hole)' },
  h: { label: 'Height', min: 2.5, max: 20, step: 0.1, def: 6, unit: 'm', title: 'Height of the top of the roof' },
  t: { label: 'Roof thickness', min: 0.05, max: 1.5, step: 0.01, def: 0.3, unit: 'm' },
  bevel: { label: 'Soft edge', min: 0, max: 0.6, step: 0.01, def: 0.12, unit: 'm', title: 'Rounding of the roof edge' },
  trunk: { label: 'Trunk', min: 0.05, max: 1.2, step: 0.01, def: 0.28, unit: 'm', title: 'Radius of the trunk' },
  split: { label: 'Branching at', min: 0.1, max: 0.9, step: 0.01, def: 0.45, unit: '× height', title: 'Where the trunk splits into branches' },
  branch: { label: 'Branches', min: 0.03, max: 0.8, step: 0.01, def: 0.14, unit: 'm', title: 'Radius of the branches' },
  reach: { label: 'Branch reach', min: 0.2, max: 1.2, step: 0.01, def: 0.8, unit: '× spread', title: 'How far out under the lobes the branches reach' },
  forks: { label: 'Forks', min: 0, max: 3, step: 1, def: 1, unit: '', title: 'How often each branch splits again on its way up' },
}
export const DEFAULT_TF = Object.fromEntries(Object.entries(TREFOIL).map(([k, v]) => [k, v.def]))
export function cleanTrefoil(tf) {
  const out = {}
  for (const [k, v] of Object.entries(TREFOIL)) {
    const n = +tf?.[k]
    out[k] = Number.isFinite(n) ? Math.min(v.max, Math.max(v.min, n)) : v.def
  }
  return out
}
// the size of its footprint (for the selection pad and connect points)
export const trefoilSize = (tf) => {
  const p = cleanTrefoil(tf)
  const s = 2 * (p.d + p.R + p.k * 0.15)
  return { w: s, d: s, h: p.h }
}

// a smooth minimum: two shapes melt together over the width k
const smin = (a, b, k) => {
  if (k <= 0) return Math.min(a, b)
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.min(a, b) - (h * h * k) / 4
}
const lobes = (dist, a0) => [0, 1, 2].map((i) => {
  const a = a0 + Math.PI / 2 + (i * 2 * Math.PI) / 3
  return [Math.cos(a) * dist, Math.sin(a) * dist]
})
// distance from a point to the edge of three melted circles (negative inside)
const field = (x, y, cs, r, k) => cs.reduce((m, [cx, cy]) => smin(m, Math.hypot(x - cx, y - cy) - r, k), Infinity)

// the outline of the roof and of its hole, as points around the middle
export function outlines(tf) {
  const p = cleanTrefoil(tf)
  const a0 = (p.turn * Math.PI) / 180
  const outer = lobes(p.d, a0)
  const inner = lobes(p.holeD, a0 + Math.PI / 3) // the hole's lobes point between the roof's lobes
  const holeR = p.hole
  const N = 220
  const out = []
  const hole = []
  const far = p.d + p.R + p.k + 1
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2
    const c = Math.cos(a)
    const s = Math.sin(a)
    // outer edge: walk in from far away until inside, then narrow it down
    let lo = 0
    let hi = far
    let r = far
    for (; r > 0; r -= 0.1) if (field(c * r, s * r, outer, p.R, p.k) <= 0) break
    lo = Math.max(0, r)
    hi = r + 0.1
    for (let j = 0; j < 20; j++) {
      const m = (lo + hi) / 2
      if (field(c * m, s * m, outer, p.R, p.k) <= 0) lo = m
      else hi = m
    }
    out.push([c * lo, s * lo])
    if (holeR > 0) {
      // the hole's edge: walk out from the middle until outside the hole
      const hk = Math.min(holeR * 1.2, 2)
      let q = 0
      for (; q < far; q += 0.04) if (field(c * q, s * q, inner, holeR, hk) > 0) break
      let a1 = Math.max(0, q - 0.04)
      let b1 = q
      for (let j = 0; j < 16; j++) {
        const m = (a1 + b1) / 2
        if (field(c * m, s * m, inner, holeR, hk) > 0) b1 = m
        else a1 = m
      }
      hole.push([c * Math.min(b1, lo - 0.3), s * Math.min(b1, lo - 0.3)])
    }
  }
  return { out, hole: holeR > 0 ? hole : null, lobes: outer, p }
}

// the roof and the stem, standing on the ground at (0, 0, 0); y is up, -z is north (the element's front is +z)
export function buildTrefoil(tf) {
  const { out, hole, lobes: L, p } = outlines(tf)
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

  // the stem: a trunk, flaring a little at its foot, then curved branches up to each lobe
  const under = p.h - p.t
  const s = Math.max(0.3, under * p.split)
  const parts = []
  const trunk = new THREE.CylinderGeometry(p.trunk * 0.85, p.trunk * 1.25, s + 0.2, 20, 1)
  trunk.translate(0, (s + 0.2) / 2, 0)
  parts.push(trunk)
  const foot = new THREE.CylinderGeometry(p.trunk * 1.25, p.trunk * 1.9, 0.35, 20, 1)
  foot.translate(0, 0.175, 0)
  parts.push(foot)
  const V = (x, y, z) => new THREE.Vector3(x, y, z)
  const grow = (from, to, r0, r1, depth, sideways) => {
    // one branch from `from` to `to`; it may split once more on the way
    const mid = from.clone().lerp(to, 0.5)
    mid.y = from.y + (to.y - from.y) * 0.62
    const bend = V(sideways.x, 0, sideways.z).multiplyScalar(0.15)
    if (depth > 0) {
      const fork = from.clone().lerp(to, 0.5)
      fork.y = from.y + (to.y - from.y) * 0.5
      tube(new THREE.CatmullRomCurve3([from, from.clone().lerp(fork, 0.5).add(bend), fork]), r0, (r0 + r1) / 2)
      const side = V(-sideways.z, 0, sideways.x).normalize()
      const spread = Math.max(0.6, from.distanceTo(to) * 0.22)
      for (const sgn of [-1, 1]) grow(fork, to.clone().add(side.clone().multiplyScalar(sgn * spread)), (r0 + r1) / 2 * 0.85, r1 * 0.85, depth - 1, sideways)
    } else tube(new THREE.CatmullRomCurve3([from, mid.add(bend), to]), r0, r1)
  }
  const tube = (curve, r0, r1) => {
    const g = new THREE.TubeGeometry(curve, 20, (r0 + r1) / 2, 10, false)
    // taper: thinner towards the roof
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
  const top = V(0, s, 0)
  for (const [lx, ly] of L) {
    const to = V(lx * p.reach, under + 0.02, -ly * p.reach)
    grow(top, to, p.branch * 1.3, p.branch * 0.7, p.forks, V(lx, 0, -ly).normalize())
  }
  const clean = (g) => {
    const q = g.index ? g.toNonIndexed() : g
    for (const k of Object.keys(q.attributes)) if (k !== 'position' && k !== 'normal') q.deleteAttribute(k)
    return q
  }
  const stem = mergeGeometries(parts.map(clean))
  stem.computeBoundingSphere()
  return { roof, stem }
}
