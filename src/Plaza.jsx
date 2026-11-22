import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Line } from '@react-three/drei'
import * as THREE from 'three'
import { ground } from './terrain.js'
import { makeMaterial } from './materials.js'

// The city plaza in the model: paving, the shared lanes (setts, no kerbs), tram rails,
// shop fronts on the slabs, and (while you edit it) white squares to drag the edge.
const MULLION = new THREE.BoxGeometry(0.08, 3.55, 0.1)
MULLION.translate(0, 1.825, 0)
const HANDLE = new THREE.BoxGeometry(1, 1, 1)
const PLUS = new THREE.OctahedronGeometry(0.45)
const dummy = new THREE.Object3D()

function Mullions({ list }) {
  const ref = useRef()
  useLayoutEffect(() => {
    const m = ref.current
    list.forEach(([x, y, a], i) => {
      dummy.position.set(x, ground(x, y), -y)
      dummy.rotation.set(0, a, 0)
      dummy.updateMatrix()
      m.setMatrixAt(i, dummy.matrix)
    })
    m.count = list.length
    m.instanceMatrix.needsUpdate = true
    m.computeBoundingSphere()
  }, [list])
  return (
    <instancedMesh key={Math.max(1, list.length)} ref={ref} args={[MULLION, null, Math.max(1, list.length)]} userData={{ layer: 'Plaza - shop fronts, mullions' }}>
      <meshStandardMaterial color="#3d4247" roughness={0.5} metalness={0.4} />
    </instancedMesh>
  )
}

export default function Plaza({ plaza, built, edit, onChange }) {
  const { controls, camera } = useThree()
  const floorMat = useMemo(() => makeMaterial(plaza.mat, plaza.col), [plaza.mat, plaza.col])
  const laneMat = useMemo(() => makeMaterial('setts'), [])
  useEffect(() => () => floorMat.dispose(), [floorMat])
  useEffect(() => () => laneMat.dispose(), [laneMat])
  useEffect(
    () => () => {
      if (!built) return
      for (const g of [built.floor, built.lane, built.glass, built.fascia, ...built.rails]) g?.dispose()
    },
    [built],
  )
  const handles = useRef([])
  useFrame(() => {
    for (const m of handles.current) if (m) m.scale.setScalar(camera.isOrthographicCamera ? 14 / camera.zoom : camera.position.distanceTo(m.position) * 0.016)
  })
  handles.current = []
  const keep = (m) => m && handles.current.push(m)
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), [])
  const hit = useMemo(() => new THREE.Vector3(), [])
  const drag = useRef(null)
  if (!built) return null
  const ring3 = [...built.ring, built.ring[0]].map(([x, y]) => [x, ground(x, y) + 0.14, -y])
  const n = plaza.outline.length
  return (
    <group>
      <mesh geometry={built.floor} material={floorMat} receiveShadow userData={{ layer: 'Plaza - paving', stack: true }} />
      {built.lane && <mesh geometry={built.lane} material={laneMat} receiveShadow userData={{ layer: 'Plaza - shared lanes' }} raycast={() => null} />}
      {built.rails.map((g, i) => (
        <mesh key={i} geometry={g} userData={{ layer: 'Plaza - tram rails' }} raycast={() => null}>
          <meshStandardMaterial color="#5e6266" metalness={0.8} roughness={0.35} />
        </mesh>
      ))}
      {built.edges.map((pts, i) => (
        <Line key={i} points={pts} color="#f4f1e8" lineWidth={2.2} dashed dashSize={0.35} gapSize={0.9} raycast={() => null} userData={{ noExport: true }} />
      ))}
      <Line points={ring3} color="#8c8678" lineWidth={1.2} raycast={() => null} userData={{ noExport: true }} />
      {plaza.commerce && (
        <>
          <mesh geometry={built.glass} renderOrder={2} userData={{ layer: 'Plaza - shop fronts, glass' }}>
            <meshStandardMaterial color="#cfe3ef" transparent opacity={0.55} roughness={0.08} metalness={0.3} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
          <mesh geometry={built.fascia} userData={{ layer: 'Plaza - shop fronts, fascia' }}>
            <meshStandardMaterial color="#3d4247" roughness={0.6} side={THREE.DoubleSide} />
          </mesh>
          <Mullions list={built.mullions} />
        </>
      )}
      {edit && (
        <group userData={{ noExport: true }}>
          {plaza.outline.map(([x, y], i) => {
            const z = ground(x, y) + 0.6
            return (
              <mesh
                key={'q' + i}
                ref={keep}
                geometry={HANDLE}
                position={[x, z, -y]}
                renderOrder={8}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  if (e.shiftKey) return
                  drag.current = { i, z }
                  e.target.setPointerCapture(e.pointerId)
                  if (controls) controls.enabled = false
                }}
                onPointerMove={(e) => {
                  if (drag.current?.i !== i) return
                  e.stopPropagation()
                  plane.constant = -drag.current.z
                  if (!e.ray.intersectPlane(plane, hit)) return
                  const p = [Math.round(hit.x * 10) / 10, Math.round(-hit.z * 10) / 10]
                  onChange((pl) => ({ ...pl, outline: pl.outline.map((q, k) => (k === i ? p : q)) }), 'plaza-drag:' + i)
                }}
                onPointerUp={(e) => {
                  drag.current = null
                  e.target.releasePointerCapture?.(e.pointerId)
                  if (controls) controls.enabled = true
                }}
                onClick={(e) => {
                  e.stopPropagation()
                  if (e.shiftKey && n > 3) onChange((pl) => ({ ...pl, outline: pl.outline.filter((_, k) => k !== i) }))
                }}
                onPointerOver={() => (document.body.style.cursor = 'move')}
                onPointerOut={() => (document.body.style.cursor = '')}
              >
                <meshBasicMaterial color="#3a7bd5" depthTest={false} />
              </mesh>
            )
          })}
          {plaza.outline.map(([x, y], i) => {
            const [x2, y2] = plaza.outline[(i + 1) % n]
            const mx = (x + x2) / 2
            const my = (y + y2) / 2
            return (
              <mesh
                key={'m' + i}
                ref={keep}
                geometry={PLUS}
                position={[mx, ground(mx, my) + 0.6, -my]}
                renderOrder={8}
                onClick={(e) => {
                  e.stopPropagation()
                  onChange((pl) => ({ ...pl, outline: [...pl.outline.slice(0, i + 1), [Math.round(mx * 10) / 10, Math.round(my * 10) / 10], ...pl.outline.slice(i + 1)] }))
                }}
                onPointerOver={() => (document.body.style.cursor = 'copy')}
                onPointerOut={() => (document.body.style.cursor = '')}
              >
                <meshBasicMaterial color="#9aa0a6" depthTest={false} transparent opacity={0.85} />
              </mesh>
            )
          })}
        </group>
      )}
    </group>
  )
}
