import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { PLATE, PLATE_THICK, fromGrid, toGrid } from './lifts.js'
import { roofAt } from './park.js'

// Lifted roofs and areas of reused GDR plates.
// With "Lift plates" on: drag over the ground, the plaza or a roof to lay a new field of plates.
// Click a field to select it; drag a selected field to move it (it snaps to the 1.20 m grid).
const PLATE_GEO = new THREE.BoxGeometry(PLATE - 0.02, PLATE_THICK, PLATE - 0.02)
const SUPPORT = new THREE.CylinderGeometry(0.07, 0.07, 1, 8)
SUPPORT.translate(0, 0.5, 0)
const TIMBER = new THREE.BoxGeometry(1, 1, 1)
const POST = new THREE.BoxGeometry(0.12, 1, 0.12)
POST.translate(0, 0.5, 0)
const X = new THREE.Vector3(1, 0, 0)
const TONES = ['#bdb9b0', '#c7c2b6', '#aeaca6', '#c9bda6', '#b5b3ad', '#d0cbc0', '#b9ad98', '#a8a7a2'].map((c) => new THREE.Color(c))
const PICK = new THREE.Color('#ff7a1a')
const dummy = new THREE.Object3D()
const tint = new THREE.Color()

export default function Lifts({ built, lifts, deg, sel, onSel, onChange, onCreate, drawing, buildings, cutting }) {
  const { controls } = useThree()
  const plates = useRef()
  const posts = useRef()
  const beams = useRef()
  const tposts = useRef()
  useLayoutEffect(() => {
    const m = plates.current
    if (!m) return
    built.plates.forEach(([x, y, z, yaw, tu, tv, tone, id], i) => {
      dummy.position.set(x, z, -y)
      dummy.rotation.set(tv, yaw, tu, 'YZX')
      dummy.updateMatrix()
      m.setMatrixAt(i, dummy.matrix)
      tint.copy(TONES[Math.floor(tone * TONES.length)])
      if (id === sel) tint.lerp(PICK, 0.45)
      m.setColorAt(i, tint)
    })
    m.count = built.plates.length
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
    m.computeBoundingSphere()
    const s = posts.current
    if (!s) return
    built.supports.forEach(([x, y, from, to], i) => {
      dummy.position.set(x, from, -y)
      dummy.rotation.set(0, 0, 0)
      dummy.scale.set(1, Math.max(0.05, to - from), 1)
      dummy.updateMatrix()
      dummy.scale.set(1, 1, 1)
      s.setMatrixAt(i, dummy.matrix)
    })
    s.count = built.supports.length
    s.instanceMatrix.needsUpdate = true
    s.computeBoundingSphere()
    // the timber grid: each beam turned from its start to its end
    const bm = beams.current
    if (bm) {
      const dir = new THREE.Vector3()
      built.beams.forEach(([x1, y1, z1, x2, y2, z2], i) => {
        dir.set(x2 - x1, z2 - z1, -(y2 - y1))
        const L = dir.length()
        dummy.position.set((x1 + x2) / 2, (z1 + z2) / 2, -(y1 + y2) / 2)
        dummy.quaternion.setFromUnitVectors(X, dir.normalize())
        dummy.scale.set(L + 0.08, 0.18, 0.08)
        dummy.updateMatrix()
        bm.setMatrixAt(i, dummy.matrix)
      })
      dummy.quaternion.identity()
      dummy.scale.set(1, 1, 1)
      bm.count = built.beams.length
      bm.instanceMatrix.needsUpdate = true
      bm.computeBoundingSphere()
    }
    const tp = tposts.current
    if (tp) {
      built.posts.forEach(([x, y, from, to], i) => {
        dummy.position.set(x, from, -y)
        dummy.rotation.set(0, (deg * Math.PI) / 180, 0)
        dummy.scale.set(1, Math.max(0.05, to - from), 1)
        dummy.updateMatrix()
        tp.setMatrixAt(i, dummy.matrix)
      })
      dummy.scale.set(1, 1, 1)
      tp.count = built.posts.length
      tp.instanceMatrix.needsUpdate = true
      tp.computeBoundingSphere()
    }
  }, [built, sel, deg])

  // drawing a new field, and moving a selected one
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), [])
  const hit = useMemo(() => new THREE.Vector3(), [])
  const [rect, setRect] = useState(null) // { a: [i, j], b: [i, j], z, roof }
  const move = useRef(null)
  const cellAt = (x, y) => {
    const [u, v] = toGrid(x, y, deg)
    return [Math.floor(u / PLATE), Math.floor(v / PLATE)]
  }
  const onLevel = (e, z) => {
    plane.constant = -z
    if (!e.ray.intersectPlane(plane, hit)) return null
    return [hit.x, -hit.z]
  }
  const grab = (e) => {
    e.target.setPointerCapture(e.pointerId)
    if (controls) controls.enabled = false
  }
  const release = (e) => {
    e.target.releasePointerCapture?.(e.pointerId)
    if (controls) controls.enabled = true
  }

  const n = Math.max(1, built.plates.length)
  const ns = Math.max(1, built.supports.length)
  // the outline of the rectangle being drawn
  const preview = useMemo(() => {
    if (!rect) return null
    const i0 = Math.min(rect.a[0], rect.b[0])
    const j0 = Math.min(rect.a[1], rect.b[1])
    const i1 = Math.max(rect.a[0], rect.b[0]) + 1
    const j1 = Math.max(rect.a[1], rect.b[1]) + 1
    const [cx, cy] = fromGrid(((i0 + i1) / 2) * PLATE, ((j0 + j1) / 2) * PLATE, deg)
    return { cx, cy, w: (i1 - i0) * PLATE, d: (j1 - j0) * PLATE, nu: i1 - i0, nv: j1 - j0 }
  }, [rect, deg])

  return (
    <group>
      <instancedMesh
        key={'p' + n}
        ref={plates}
        args={[PLATE_GEO, null, n]}
        castShadow
        receiveShadow
        userData={{ layer: 'Lifted plates (reused GDR panels)', stack: true }}
        onPointerDown={(e) => {
          if (cutting || e.instanceId == null || !built.plates[e.instanceId]) return
          e.stopPropagation()
          const id = built.plates[e.instanceId][7]
          if (id !== sel) return onSel(id)
          // start moving the selected field
          const l = lifts.find((x) => x.id === id)
          const z = built.plates[e.instanceId][2]
          const p = onLevel(e, z)
          if (!l || !p) return
          move.current = { id, z, start: cellAt(...p), i0: l.i0, j0: l.j0 }
          grab(e)
        }}
        onPointerMove={(e) => {
          const m = move.current
          if (!m) return
          e.stopPropagation()
          const p = onLevel(e, m.z)
          if (!p) return
          const [i, j] = cellAt(...p)
          const di = i - m.start[0]
          const dj = j - m.start[1]
          onChange((ls) => ls.map((x) => (x.id === m.id ? { ...x, i0: m.i0 + di, j0: m.j0 + dj } : x)), 'lift-move:' + m.id)
        }}
        onPointerUp={(e) => {
          if (!move.current) return
          move.current = null
          release(e)
        }}
        onClick={(e) => !cutting && e.stopPropagation()}
        onPointerOver={() => (document.body.style.cursor = 'pointer')}
        onPointerOut={() => (document.body.style.cursor = '')}
      >
        <meshStandardMaterial roughness={0.92} />
      </instancedMesh>
      <instancedMesh key={'b' + Math.max(1, built.beams.length)} ref={beams} args={[TIMBER, null, Math.max(1, built.beams.length)]} castShadow userData={{ layer: 'Lifted plates - timber grid' }} raycast={() => null}>
        <meshStandardMaterial color="#cfa978" roughness={0.75} />
      </instancedMesh>
      <instancedMesh key={'t' + Math.max(1, built.posts.length)} ref={tposts} args={[POST, null, Math.max(1, built.posts.length)]} castShadow userData={{ layer: 'Lifted plates - timber posts' }} raycast={() => null}>
        <meshStandardMaterial color="#c49b68" roughness={0.75} />
      </instancedMesh>
      <instancedMesh key={'s' + ns} ref={posts} args={[SUPPORT, null, ns]} castShadow userData={{ layer: 'Lifted plates - steel supports' }} raycast={() => null}>
        <meshStandardMaterial color="#45494d" metalness={0.6} roughness={0.4} />
      </instancedMesh>

      {drawing && (
        // drag anywhere (ground, plaza, roofs, the deck) to lay a new field of plates
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, -50, 0]}
          userData={{ noExport: true }}
          onPointerDown={(e) => {
            if (e.button !== 0) return
            const first = e.intersections.find((x) => x.object.userData.layer !== undefined || x.object === e.object)
            const pt = (first ?? e).point
            const x = pt.x
            const y = -pt.z
            e.stopPropagation()
            const c = cellAt(x, y)
            setRect({ a: c, b: c, z: pt.y, roof: roofAt(x, y, buildings) != null })
            grab(e)
          }}
          onPointerMove={(e) => {
            if (!rect) return
            const p = onLevel(e, rect.z)
            if (p) setRect((r) => ({ ...r, b: cellAt(...p) }))
          }}
          onPointerUp={(e) => {
            if (!rect) return
            release(e)
            const i0 = Math.min(rect.a[0], rect.b[0])
            const j0 = Math.min(rect.a[1], rect.b[1])
            onCreate({ i0, j0, nu: Math.abs(rect.a[0] - rect.b[0]) + 1, nv: Math.abs(rect.a[1] - rect.b[1]) + 1, roof: rect.roof })
            setRect(null)
          }}
        >
          <planeGeometry args={[3000, 3000]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      )}
      {preview && (
        <mesh position={[preview.cx, rect.z + 0.3, -preview.cy]} rotation={[0, (deg * Math.PI) / 180, 0]} renderOrder={6} raycast={() => null} userData={{ noExport: true }}>
          <boxGeometry args={[preview.w, 0.2, preview.d]} />
          <meshBasicMaterial color="#ff7a1a" transparent opacity={0.45} depthTest={false} />
        </mesh>
      )}
    </group>
  )
}
