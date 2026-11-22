import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Line } from '@react-three/drei'
import * as THREE from 'three'
import { MODEL_TREE_COLOUR, modelTree } from './modelTree.js'
import { ground } from './terrain.js'
import { makeMaterial } from './materials.js'

// The elevated park in the model, and (while you edit it) its handles:
//   white squares = the edge points (drag; + between two adds one; Shift-click removes one)
//   orange balls  = height points, on a stem down to the ground
//   green rings   = openings (drag the dot in the middle)
const COLUMN = new THREE.CylinderGeometry(0.11, 0.11, 1, 10)
COLUMN.translate(0, 0.5, 0)
const HANDLE = new THREE.BoxGeometry(1, 1, 1)
const BALL = new THREE.SphereGeometry(0.62, 18, 12)
const PLUS = new THREE.OctahedronGeometry(0.45)
const DISC = new THREE.CylinderGeometry(0.55, 0.55, 0.18, 20)
const dummy = new THREE.Object3D()

function Columns({ list }) {
  const ref = useRef()
  useLayoutEffect(() => {
    const m = ref.current
    list.forEach(([x, y, z], i) => {
      const g = ground(x, y)
      dummy.position.set(x, g, -y)
      dummy.scale.set(1, Math.max(0.1, z - g), 1)
      dummy.updateMatrix()
      m.setMatrixAt(i, dummy.matrix)
    })
    m.count = list.length
    m.instanceMatrix.needsUpdate = true
    m.computeBoundingSphere()
  }, [list])
  return (
    <instancedMesh key={Math.max(1, list.length)} ref={ref} args={[COLUMN, null, Math.max(1, list.length)]} castShadow userData={{ layer: 'Park - columns' }}>
      <meshStandardMaterial color="#f4f3f0" roughness={0.5} metalness={0.2} />
    </instancedMesh>
  )
}

// trees growing up through the openings: white model trees, the crown starting above the deck
function Trees({ list }) {
  return list.map((t, i) => {
    const below = Math.max(0, t.deck - t.g) // trunk under the deck
    const W = Math.max(4.5, t.r * 3)
    const crown = W * 1.25 // crown height
    const H = below + 1.2 + crown
    const geo = modelTree(Math.round(((below + 1.2) / H) * 50) / 50, i + 2)
    return (
      <mesh key={t.id} geometry={geo} position={[t.x, t.g, -t.y]} scale={[W, H, W]} castShadow receiveShadow userData={{ layer: 'Park - trees' }}>
        <meshStandardMaterial color={MODEL_TREE_COLOUR} roughness={0.95} />
      </mesh>
    )
  })
}

export default function Park({ park, built, edit, sel, onSel, onChange, placing, onPlace, onPick, cutting }) {
  const { controls, camera } = useThree()
  const mat = useMemo(() => makeMaterial(park.mat, park.col), [park.mat, park.col])
  useEffect(() => () => mat.dispose(), [mat])
  useEffect(
    () => () => {
      for (const k of ['top', 'under', 'rail', 'handrail', 'net']) built?.[k]?.dispose()
    },
    [built],
  )
  // handles keep the same size on screen, however far you zoom
  const handles = useRef([])
  useFrame(() => {
    const s = camera.isOrthographicCamera ? 14 / camera.zoom : 0
    for (const m of handles.current) if (m) m.scale.setScalar(camera.isOrthographicCamera ? s : camera.position.distanceTo(m.position) * 0.016)
  })
  handles.current = []
  const keep = (m) => m && handles.current.push(m)

  // dragging a handle: it slides over a level plane at the height it started from
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), [])
  const hit = useMemo(() => new THREE.Vector3(), [])
  const drag = useRef(null)
  const startDrag = (e, what, level) => {
    e.stopPropagation()
    if (e.shiftKey) return
    onSel(what)
    plane.constant = -level
    const start = e.ray.intersectPlane(plane, hit) ? [hit.x, -hit.z] : null
    drag.current = { what, level, start, orig: what.t === 'b' ? park.outlines[what.id] : null }
    e.target.setPointerCapture(e.pointerId)
    if (controls) controls.enabled = false
  }
  const moveDrag = (e, what) => {
    const d = drag.current
    if (!d || d.what.t !== what.t || d.what.id !== what.id) return
    e.stopPropagation()
    plane.constant = -d.level
    if (!e.ray.intersectPlane(plane, hit)) return
    const p = [Math.round(hit.x * 10) / 10, Math.round(-hit.z * 10) / 10]
    onChange((pk) => {
      if (what.t === 'p') return { ...pk, outlines: pk.outlines.map((o, b) => (b === what.b ? o.map((q, i) => (i === what.i ? p : q)) : o)) }
      if (what.t === 'b') {
        if (!d.start) return pk
        const dx = Math.round((hit.x - d.start[0]) * 10) / 10
        const dy = Math.round((-hit.z - d.start[1]) * 10) / 10
        return { ...pk, outlines: pk.outlines.map((o, b) => (b === what.id ? d.orig.map(([x, y]) => [Math.round((x + dx) * 10) / 10, Math.round((y + dy) * 10) / 10]) : o)) }
      }
      if (what.t === 'h') return { ...pk, heights: pk.heights.map((q) => (q.id === what.id ? { ...q, x: p[0], y: p[1] } : q)) }
      return { ...pk, holes: pk.holes.map((q) => (q.id === what.id ? { ...q, x: p[0], y: p[1] } : q)) }
    }, 'park-drag:' + what.t + what.id)
  }
  const endDrag = (e) => {
    if (!drag.current) return
    drag.current = null
    e.target.releasePointerCapture?.(e.pointerId)
    if (controls) controls.enabled = true
  }
  const remove = (e, what) => {
    e.stopPropagation()
    if (e.shiftKey) onSel(what, true)
  }
  const cursor = (c) => () => (document.body.style.cursor = c)

  // where a click lands, for placing a new height point or opening
  const onGround = (e) => {
    plane.constant = 0
    let p = null
    for (let k = 0; k < 4; k++) {
      if (!e.ray.intersectPlane(plane, hit)) return p
      p = [Math.round(hit.x * 10) / 10, Math.round(-hit.z * 10) / 10]
      plane.constant = -ground(p[0], p[1])
    }
    return p
  }
  const place = (e, p) => {
    if (e.delta > 6 || !p) return
    e.stopPropagation()
    onPlace(p)
  }

  if (!built) return null
  const H = built.H
  const isSel = (t, id) => sel && sel.t === t && sel.id === id
  const ring3 = (r, lift) => [...r, r[0]].map(([x, y]) => [x, H(x, y) + lift, -y])

  return (
    <group>
      <mesh
        key={park.slope ? 'slope' : 'mat'}
        geometry={built.top}
        material={park.slope ? undefined : mat}
        castShadow
        receiveShadow
        userData={{ layer: 'Park - deck', stack: true }}
        onClick={(e) => {
          if (cutting) return
          if (placing) return place(e, [Math.round(e.point.x * 10) / 10, Math.round(-e.point.z * 10) / 10])
          if (e.delta > 6) return
          e.stopPropagation()
          onPick?.()
        }}
        onPointerOver={cursor(placing ? 'crosshair' : 'pointer')}
        onPointerOut={cursor('')}
      >
        {park.slope && <meshStandardMaterial vertexColors roughness={0.9} side={THREE.DoubleSide} />}
      </mesh>
      <mesh geometry={built.under} castShadow receiveShadow userData={{ layer: 'Park - underside and edge' }}>
        <meshStandardMaterial color="#f1efea" roughness={0.85} side={THREE.DoubleSide} />
      </mesh>
      {park.net > 0 && (
        <lineSegments geometry={built.net} userData={{ layer: 'Park - net' }} raycast={() => null}>
          <lineBasicMaterial color="#2d2d2d" transparent opacity={0.42} />
        </lineSegments>
      )}
      {built.rings.map((r, k) => (
        <Line key={'ring' + k} points={ring3(r, 0.03)} color="#2d2d2d" lineWidth={1.6} raycast={() => null} userData={{ noExport: true }} />
      ))}
      {built.holes.map((h) => (
        <Line key={h.id} points={ring3(holeOutline(h), 0.03)} color="#2d2d2d" lineWidth={1.4} raycast={() => null} userData={{ noExport: true }} />
      ))}
      {park.rail && (
        <>
          <mesh geometry={built.rail} renderOrder={2} userData={{ layer: 'Park - glass railing' }} raycast={() => null}>
            <meshStandardMaterial color="#dbe8ef" transparent opacity={0.28} depthWrite={false} side={THREE.DoubleSide} roughness={0.1} />
          </mesh>
          <lineSegments geometry={built.handrail} userData={{ layer: 'Park - handrail' }} raycast={() => null}>
            <lineBasicMaterial color="#5b5f63" />
          </lineSegments>
        </>
      )}
      {built.columns.length > 0 && <Columns list={built.columns} />}
      <Trees list={built.trees} />

      {placing && (
        // catches clicks on the ground, to place a new point
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} onClick={(e) => place(e, onGround(e))} userData={{ noExport: true }}>
          <planeGeometry args={[2000, 2000]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}

      {edit && (
        <group userData={{ noExport: true }}>
          {/* each blob: a blue disc in its middle drags the whole blob */}
          {park.outlines.map((o, b) => {
            const cx = o.reduce((s, q) => s + q[0], 0) / o.length
            const cy = o.reduce((s, q) => s + q[1], 0) / o.length
            const z = H(cx, cy) + 1.6
            const what = { t: 'b', id: b }
            return (
              <mesh
                key={'blob' + b}
                ref={keep}
                geometry={DISC}
                scale={1.6}
                position={[cx, z, -cy]}
                renderOrder={9}
                onPointerDown={(e) => startDrag(e, what, z)}
                onPointerMove={(e) => moveDrag(e, what)}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onClick={(e) => remove(e, what)}
                onPointerOver={cursor('move')}
                onPointerOut={cursor('')}
              >
                <meshBasicMaterial color={isSel('b', b) ? '#ff7a1a' : '#3a7bd5'} depthTest={false} />
              </mesh>
            )
          })}
          {/* the edge points */}
          {park.outlines.flatMap((o, b) => o.map(([x, y], i) => {
            const z = H(x, y) + 0.5
            const what = { t: 'p', id: b + ':' + i, b, i }
            return (
              <mesh
                key={'p' + b + ':' + i}
                ref={keep}
                geometry={HANDLE}
                position={[x, z, -y]}
                renderOrder={8}
                onPointerDown={(e) => startDrag(e, what, z)}
                onPointerMove={(e) => moveDrag(e, what)}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onClick={(e) => remove(e, what)}
                onPointerOver={cursor('move')}
                onPointerOut={cursor('')}
              >
                <meshBasicMaterial color={isSel('p', b + ':' + i) ? '#ff7a1a' : '#ffffff'} depthTest={false} transparent opacity={0.95} />
              </mesh>
            )
          }))}
          {/* + between two edge points adds one */}
          {park.outlines.flatMap((o, b) => o.map(([x, y], i) => {
            const [x2, y2] = o[(i + 1) % o.length]
            const mx = (x + x2) / 2
            const my = (y + y2) / 2
            return (
              <mesh
                key={'m' + b + ':' + i}
                ref={keep}
                geometry={PLUS}
                position={[mx, H(mx, my) + 0.5, -my]}
                renderOrder={8}
                onClick={(e) => {
                  e.stopPropagation()
                  onChange((pk) => ({ ...pk, outlines: pk.outlines.map((oo, bb) => (bb === b ? [...oo.slice(0, i + 1), [Math.round(mx * 10) / 10, Math.round(my * 10) / 10], ...oo.slice(i + 1)] : oo)) }))
                  onSel({ t: 'p', id: b + ':' + (i + 1), b, i: i + 1 })
                }}
                onPointerOver={cursor('copy')}
                onPointerOut={cursor('')}
              >
                <meshBasicMaterial color="#9aa0a6" depthTest={false} transparent opacity={0.85} />
              </mesh>
            )
          }))}
          {/* height points on their stems */}
          {built.levels.map((q) => {
            const what = { t: 'h', id: q.id }
            const top = H(q.x, q.y) + 1.2
            return (
              <group key={q.id}>
                <Line points={[[q.x, ground(q.x, q.y), -q.y], [q.x, top, -q.y]]} color={q.onRoof ? '#7a4cc2' : '#ff7a1a'} lineWidth={1.5} dashed dashSize={0.5} gapSize={0.3} raycast={() => null} />
                <mesh
                  ref={keep}
                  geometry={BALL}
                  position={[q.x, top, -q.y]}
                  renderOrder={9}
                  onPointerDown={(e) => startDrag(e, what, top)}
                  onPointerMove={(e) => moveDrag(e, what)}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  onClick={(e) => remove(e, what)}
                  onPointerOver={cursor('move')}
                  onPointerOut={cursor('')}
                >
                  <meshBasicMaterial color={isSel('h', q.id) ? '#d2361f' : q.onRoof ? '#7a4cc2' : '#ff9a3c'} depthTest={false} />
                </mesh>
              </group>
            )
          })}
          {/* openings */}
          {park.holes.map((h) => {
            const what = { t: 'o', id: h.id }
            const z = H(h.x, h.y) + 0.4
            const ok = built.holes.some((o) => o.id === h.id)
            return (
              <group key={h.id}>
                <Line points={holeOutline(h).concat([holeOutline(h)[0]]).map(([x, y]) => [x, z, -y])} color={ok ? '#2f9e44' : '#d2361f'} lineWidth={2.5} dashed={!ok} dashSize={0.6} gapSize={0.4} raycast={() => null} />
                <mesh
                  ref={keep}
                  geometry={DISC}
                  position={[h.x, z, -h.y]}
                  renderOrder={9}
                  onPointerDown={(e) => startDrag(e, what, z)}
                  onPointerMove={(e) => moveDrag(e, what)}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  onClick={(e) => remove(e, what)}
                  onPointerOver={cursor('move')}
                  onPointerOut={cursor('')}
                >
                  <meshBasicMaterial color={isSel('o', h.id) ? '#d2361f' : '#2f9e44'} depthTest={false} />
                </mesh>
              </group>
            )
          })}
        </group>
      )}
    </group>
  )
}

function holeOutline(h) {
  return Array.from({ length: 40 }, (_, i) => [h.x + h.r * Math.cos((i / 40) * Math.PI * 2), h.y + h.r * Math.sin((i / 40) * Math.PI * 2)])
}
