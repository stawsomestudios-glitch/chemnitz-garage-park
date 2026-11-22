import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { GARAGES, MODULE } from './garages.js'
import { TITLE } from './titles.js'
import { ground } from './terrain.js'

// Garages with an opened roof, to let light and air in (like a model with lifted, sawtooth roof plates):
//   tilt   the roof plate hinged up on one side, on a light steel frame
//   frame  the roof plate taken off, the steel frame left
//   open   the roof taken off, walls only
// Each opened garage is drawn from its four walls (and door), plus the frame and plate.
export const ROOF_MODES = [
  ['closed', 'Closed'],
  ['tilt', 'Tilted open'],
  ['frame', 'Frame only'],
  ['open', 'Removed'],
]
export const TILT = (35 * Math.PI) / 180
const box = new THREE.BoxGeometry(1, 1, 1)
const dummy = new THREE.Object3D()
const col = new THREE.Color()
const PICK = new THREE.Color('#ff7a1a')

// one part of a garage, in its own frame: a along the row, b across (towards the doors), y up; size [along, up, across]
function put(list, g, a, b, y, size, tilt = 0, extra = {}) {
  list.push({ x: g.x + g.u[0] * a + g.n[0] * b, y: g.y + g.u[1] * a + g.n[1] * b, z: y, size, angle: g.angle, tilt, id: g.id, ...extra })
}

export default function Roofs({ roofs, title, picked, onPick, connecting, look, colour, topo }) {
  const H = MODULE.height
  const W = MODULE.width / 2
  const D = MODULE.depth / 2
  const t = 0.12
  const parts = useMemo(() => {
    const walls = []
    const doors = []
    const frame = []
    const plates = []
    for (const g of GARAGES) {
      const mode = roofs[g.id]
      if (!mode || mode === 'closed') continue
      put(walls, g, -W + t / 2, 0, H / 2, [t, H, MODULE.depth])
      put(walls, g, W - t / 2, 0, H / 2, [t, H, MODULE.depth])
      put(walls, g, 0, -D + t / 2, H / 2, [MODULE.width, H, t])
      put(walls, g, 0, D - t / 2, H / 2, [MODULE.width, H, t])
      put(doors, g, 0, D + 0.03, 1.2, [2.5, 2.4, 0.06])
      if (mode === 'tilt' || mode === 'frame') {
        const rise = MODULE.width * Math.tan(TILT)
        const top = H + 0.08
        // on both gable ends: a post on the high side and the rafter along the plate
        for (const b of [-D, D]) {
          put(frame, g, W, b, top + rise / 2, [0.07, rise, 0.07])
          const L = MODULE.width / Math.cos(TILT)
          put(frame, g, 0, b, top + rise / 2, [L, 0.07, 0.07], TILT)
          put(frame, g, 0, b, top - 0.04, [MODULE.width, 0.07, 0.07])
        }
        // the ridge on the high side and the eave on the hinge side, along the depth
        put(frame, g, W, 0, top + rise, [0.07, 0.07, MODULE.depth + 0.07])
        put(frame, g, -W, 0, top, [0.07, 0.07, MODULE.depth + 0.07])
        if (mode === 'tilt') put(plates, g, 0, 0, top + rise / 2 + 0.06, [MODULE.width / Math.cos(TILT) + 0.05, 0.05, MODULE.depth + 0.2], TILT)
      }
    }
    return { walls, doors, frame, plates }
  }, [roofs]) // eslint-disable-line react-hooks/exhaustive-deps

  const refs = { walls: useRef(), doors: useRef(), frame: useRef(), plates: useRef() }
  useLayoutEffect(() => {
    for (const k of Object.keys(refs)) {
      const m = refs[k].current
      if (!m) continue
      parts[k].forEach((q, i) => {
        dummy.position.set(q.x, q.z + ground(q.x, q.y), -q.y)
        dummy.rotation.set(0, q.angle, q.tilt, 'YXZ')
        dummy.scale.set(...q.size)
        dummy.updateMatrix()
        m.setMatrixAt(i, dummy.matrix)
        if (k === 'walls' || k === 'doors') {
          const ti = title[q.id]
          col.set(ti ? TITLE[ti].color : look.empty)
          if (k === 'doors') col.multiplyScalar(0.72)
          if (picked.has(q.id)) col.lerp(PICK, 0.55)
        } else col.set(colour)
        m.setColorAt(i, col)
      })
      m.count = parts[k].length
      m.instanceMatrix.needsUpdate = true
      if (m.instanceColor) m.instanceColor.needsUpdate = true
      m.computeBoundingSphere()
    }
  }, [parts, title, picked, look, colour, topo]) // eslint-disable-line react-hooks/exhaustive-deps

  const click = (k) => (e) => {
    if (connecting) return
    e.stopPropagation()
    if (e.delta > 6) return
    const q = parts[k][e.instanceId]
    if (q) onPick(q.id, e.shiftKey || e.ctrlKey || e.metaKey)
  }
  const mesh = (k, layer, mat) => (
    <instancedMesh key={k + parts[k].length} ref={refs[k]} args={[box, null, Math.max(1, parts[k].length)]} castShadow receiveShadow userData={{ layer, stack: k === 'walls' }} onClick={click(k)} onPointerOver={() => (document.body.style.cursor = 'pointer')} onPointerOut={() => (document.body.style.cursor = '')}>
      {mat}
    </instancedMesh>
  )
  if (!parts.walls.length) return null
  return (
    <group>
      {mesh('walls', 'Garages - opened, walls', <meshStandardMaterial roughness={0.8} />)}
      {mesh('doors', 'Garages - opened, doors', <meshStandardMaterial roughness={0.6} />)}
      {parts.frame.length > 0 && mesh('frame', 'Garages - roof frames', <meshStandardMaterial roughness={0.5} metalness={0.3} />)}
      {parts.plates.length > 0 && mesh('plates', 'Garages - tilted roof plates', <meshStandardMaterial roughness={0.7} side={THREE.DoubleSide} />)}
    </group>
  )
}
