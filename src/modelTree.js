import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

// A tree like a white architectural model tree: a thin straight trunk, a few branches,
// and an airy, lumpy crown made of many small faceted clumps (gaps between them).
// Built in a unit box: 1 wide (x and z from -0.5 to 0.5), 1 high (y from 0 to 1), standing on y = 0.
// Scale it to [width, height, width] to use it.
export const MODEL_TREE_COLOUR = '#f3f1ec'

function rng(seed) {
  let s = seed >>> 0 || 1
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

const UP = new THREE.Vector3(0, 1, 0)
function stick(a, b, r0, r1) {
  const dir = new THREE.Vector3().subVectors(b, a)
  const L = dir.length()
  const g = new THREE.CylinderGeometry(r1, r0, L, 6, 1)
  g.translate(0, L / 2, 0)
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize()))
  g.translate(a.x, a.y, a.z)
  return g
}

const cache = new Map()
// crownFrom: where the crown starts (0–1 of the height), seed: a different tree each number
export function modelTree(crownFrom = 0.38, seed = 7) {
  const key = crownFrom.toFixed(2) + ':' + seed
  if (cache.has(key)) return cache.get(key)
  const rand = rng(seed * 9973 + 17)
  const parts = []
  const c0 = crownFrom
  const cH = 1 - c0 // crown height
  const fork = new THREE.Vector3(0, c0 + cH * 0.12, 0)
  // the trunk, a little thinner at the top
  parts.push(stick(new THREE.Vector3(0, 0, 0), fork, 0.028, 0.02))
  // lobes: the big clumps that give the crown its ragged outline
  const lobes = []
  const nl = 9
  for (let i = 0; i < nl; i++) {
    const a = (i / nl) * Math.PI * 2 + rand() * 0.6
    const up = rand()
    const out = 0.22 + rand() * 0.16
    lobes.push(new THREE.Vector3(Math.cos(a) * out * (0.7 + 0.3 * up), c0 + cH * (0.2 + 0.72 * up), Math.sin(a) * out * (0.7 + 0.3 * up)))
  }
  lobes.push(new THREE.Vector3((rand() - 0.5) * 0.1, 1 - cH * 0.1, (rand() - 0.5) * 0.1)) // the top
  // branches from the fork to each lobe, with a kink halfway
  for (const l of lobes) {
    const mid = new THREE.Vector3().lerpVectors(fork, l, 0.45)
    mid.x += (rand() - 0.5) * 0.06
    mid.z += (rand() - 0.5) * 0.06
    parts.push(stick(fork, mid, 0.014, 0.01), stick(mid, l, 0.01, 0.005))
  }
  // clumps of faceted foliage around each lobe
  const blob = new THREE.IcosahedronGeometry(1, 1)
  for (const l of lobes) {
    const n = 6 + Math.floor(rand() * 4)
    for (let k = 0; k < n; k++) {
      const r = 0.035 + rand() * 0.055
      const g = blob.clone()
      const pos = g.attributes.position
      for (let v = 0; v < pos.count; v++) {
        const j = 0.75 + rand() * 0.45
        pos.setXYZ(v, pos.getX(v) * j, pos.getY(v) * j * 0.8, pos.getZ(v) * j)
      }
      g.scale(r, r, r)
      g.translate(l.x + (rand() - 0.5) * 0.17, l.y + (rand() - 0.5) * 0.12 * (cH / 0.6), l.z + (rand() - 0.5) * 0.17)
      parts.push(g)
    }
  }
  // keep every clump inside the box
  const geo = mergeGeometries(parts.map((g) => {
    const q = g.index ? g.toNonIndexed() : g
    q.deleteAttribute('uv')
    q.deleteAttribute('normal')
    return q
  }))
  const pos = geo.attributes.position
  for (let v = 0; v < pos.count; v++) {
    pos.setX(v, Math.max(-0.5, Math.min(0.5, pos.getX(v))))
    pos.setZ(v, Math.max(-0.5, Math.min(0.5, pos.getZ(v))))
    pos.setY(v, Math.max(0, Math.min(1, pos.getY(v))))
  }
  geo.computeVertexNormals() // flat facets, like a cut-paper model
  geo.computeBoundingSphere()
  cache.set(key, geo)
  return geo
}
