import { useEffect, useMemo, useRef, useState } from 'react'
import Scene from './Scene.jsx'
import { GARAGES, BY_ID, ROW_IDS, connected, label } from './garages.js'
import { TITLES, TITLE } from './titles.js'
import { ELEMENT_GROUPS, KINDS, alignRot, dims, placeByGrip, snapPoint } from './elements.js'
import { MAP_STYLES, MAP_STYLE_IDS } from './mapStyles.js'
import { TOPO_MODES, ground, setTerrain, setTopo } from './terrain.js'
import { DEFAULT_PARK, buildPark, cleanPark, newParkId, prepBuildings, roofAt } from './park.js'
import { DEFAULT_PLAZA, buildPlaza, cleanPlaza } from './plaza.js'
import { DEFAULT_LIFTS, PLATE, buildLifts, cleanLifts } from './lifts.js'
import { ROOF_MODES } from './Roofs.jsx'
import { sectionGeom, sideName } from './Views.jsx'
import ColourField, { parseColour } from './ColourField.jsx'
import { colourOf } from './Elements.jsx'
import { MATERIALS, MATERIAL_IDS, lookOf, swatchOf } from './materials.js'
import { COBALT, DEFAULT_RIBBON, RIBBON_GROUPS, RIBBON_KINDS, STREETS, VERSION, cleanLook, cleanRibbon, cleanSize, hasHeight, moduleLen, pieceTop, pieceWidth, routeCurve } from './ribbon.js'

const BASE = import.meta.env.BASE_URL
const KEY = 'chemnitz-garage-park-v1'
const ALL = GARAGES.map((g) => g.id)
const DEFAULT_MAP = { style: 'current', colours: {}, topo: 'real' }
// Element layers: { id, name, on (shown), locked }. An element carries `layer`; without one it is on the first layer.
const DEFAULT_LAYERS = [{ id: 'l1', name: 'Layer 1', on: true, locked: false }]
// The market under the park roof: stalls in the courtyard between the two slabs on Richard-Wagner-Straße
const STALLS = [[-54, 116], [-48, 116], [-36, 116.5], [-30, 117], [-24, 118], [-18, 119], [-12, 120], [-40, 123.5], [-34, 124.5], [-28, 125.5], [-16, 127.5], [-10, 128.5]].map(([x, y], i) => ({ id: 'stall' + (i + 1), kind: 'stallopen', x, y, z: 0, rot: 11, layer: 'lm' })) // under the park roof: no shade of their own
// The open market on the city plaza: two rows of stalls in front of the shops of the southern slab,
// trees along the garages, cafe parasols by Richard-Wagner-Straße, and shared-space signs where cars come in.
const face = (x) => 83 + 0.195 * (x + 57.7) // the plaza front of the southern slab
const PLAZA_ITEMS = [
  ...[-50, -44, -38, -32, -26, -20, -14, -8].flatMap((x, i) => [
    { id: 'pm' + i + 'a', kind: 'stall', x, y: face(x) - 9, z: 0, rot: 11, layer: 'lp' },
    { id: 'pm' + i + 'b', kind: i % 2 ? 'stall' : 'stallopen', x: x + 3, y: face(x + 3) - 16, z: 0, rot: 191, layer: 'lp' },
  ]),
  ...[[-30, 15], [-20, 23.5], [-10, 32], [0, 41]].map(([x, y], i) => ({ id: 'pt' + i, kind: 'tree', x, y, z: 0, rot: 0, layer: 'lp' })),
  ...[[-49, 59], [-44, 54], [-50, 52]].map(([x, y], i) => ({ id: 'pp' + i, kind: 'parasol', x, y, z: 0, rot: 0, layer: 'lp' })),
  ...[[-49, 59], [-44, 54], [-50, 52]].map(([x, y], i) => ({ id: 'ptb' + i, kind: 'table', x, y, z: 0, rot: 0, layer: 'lp' })),
  ...[[-46, 12], [-47, 27], [27, 71], [17, 86]].map(([x, y], i) => ({ id: 'ps' + i, kind: 'trafficsign', x, y, z: 0, rot: 0, layer: 'lp', label: i === 0 ? 'Shared space · 10 km/h · pedestrians first' : undefined })),
].map((it) => (it.label ? it : (({ label, ...r }) => r)(it)))
// Opened garage roofs to start with: rows R2 and R3 as a sawtooth of tilted plates, R4 frame only, R5 removed
const DEFAULT_ROOFS = Object.fromEntries(GARAGES.filter((g) => ['R2', 'R3', 'R4', 'R5'].includes(g.row)).map((g) => [g.id, g.row === 'R4' ? 'frame' : g.row === 'R5' ? 'open' : 'tilt']))
// In this copy there is no ribbon (it is kept off) and no modules: the elevated park takes their place.
const EMPTY = { title: {}, block: {}, items: [...STALLS, ...PLAZA_ITEMS], park: DEFAULT_PARK, plaza: DEFAULT_PLAZA, lifts: DEFAULT_LIFTS, roofs: DEFAULT_ROOFS, roofColour: '#c0392b', ribbon: { ...DEFAULT_RIBBON, on: false }, map: DEFAULT_MAP, glabel: {}, drawn: [], heading: { title: '', sub: '' }, views: [], layers: [...DEFAULT_LAYERS, { id: 'lm', name: 'Market under the park', on: true, locked: false }, { id: 'lp', name: 'Plaza market and furniture', on: true, locked: false }] }
// the map layers you can recolour, in the order the Map section lists them
const MAP_LAYERS = [
  ['bg', 'Sky / background'], ['ground', 'Ground'], ['green', 'Green areas'], ['parking', 'Parking'], ['site', 'Garage yard'],
  ['road', 'Streets'], ['lane', 'Lanes'], ['path', 'Footpaths'], ['tram', 'Tram lines'],
  ['home', 'Homes'], ['other', 'Other buildings'], ['garage', 'Garages outside the site'], ['empty', 'Garages without a title'],
]
// the map style and your own colours for each style: { style, colours: { style: { layer: '#rrggbb' } } }
function cleanMap(m) {
  const style = MAP_STYLES[m?.style] ? m.style : 'current'
  const colours = {}
  for (const id of MAP_STYLE_IDS) {
    const own = {}
    for (const [k] of MAP_LAYERS) {
      const c = m?.colours?.[id]?.[k] && parseColour(m.colours[id][k])
      if (c) own[k] = c
    }
    if (Object.keys(own).length) colours[id] = own
  }
  // the ground: flat, real, or real twice as steep
  const topo = TOPO_MODES.some(([k]) => k === m?.topo) ? m.topo : 'real'
  return { style, colours, topo }
}
const newId = () => 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

// Your plan is kept in this browser so it is still there next time.
function loadSaved() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY))
    if (s && s.title && s.block) return clean(s)
  } catch {}
  return EMPTY
}
function clean(s) {
  const title = {}
  const block = {}
  for (const id of ALL) {
    if (TITLE[s.title?.[id]]) title[id] = s.title[id]
    if (s.block?.[id]) block[id] = String(s.block[id])
  }
  const num = (v) => (Number.isFinite(+v) ? +v : 0)
  const items = (Array.isArray(s.items) ? s.items : [])
    .filter((it) => it && KINDS[it.kind])
    .map((it) => {
      const out = { id: String(it.id ?? newId()), kind: it.kind, x: num(it.x), y: num(it.y), z: num(it.z), rot: num(it.rot) }
      if (TITLE[it.title] && KINDS[it.kind].titled) out.title = it.title
      for (const k of ['sw', 'sd', 'sh']) if (+it[k] > 0) out[k] = +it[k]
      if (it.col && parseColour(it.col)) out.col = parseColour(it.col)
      if (it.label) out.label = String(it.label).slice(0, 60)
      if (it.layer) out.layer = String(it.layer).slice(0, 60)
      if (it.kind === 'rmod') {
        const rk = RIBBON_KINDS[it.rk] && !RIBBON_KINDS[it.rk].gap ? it.rk : 'bench'
        out.rk = rk
        out.len = Math.max(RIBBON_KINDS[rk].min, Math.round(num(it.len) * 10) / 10 || moduleLen(rk))
        out.bw = +it.bw >= 0.6 && +it.bw <= 8 ? +it.bw : 2.4
        if (it.flip) out.flip = true
        if (MATERIALS[it.mat]) out.mat = it.mat
        Object.assign(out, cleanSize({ kind: rk, w: it.w, h: it.h }))
      }
      return out
    })
  const glabel = {}
  for (const id of ALL) if (s.glabel?.[id]) glabel[id] = String(s.glabel[id]).slice(0, 60)
  const heading = { title: String(s.heading?.title ?? '').slice(0, 80), sub: String(s.heading?.sub ?? '').slice(0, 300) }
  // saved views: { id, name, pos: camera [x, y, z], target: the point it looks at [x, y, z] }
  const three = (v) => Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(+n))
  const views = (Array.isArray(s.views) ? s.views : [])
    .filter((v) => v && three(v.pos) && three(v.target))
    .map((v, n) => ({
      id: String(v.id ?? 'v' + n),
      name: String(v.name ?? 'View ' + (n + 1)).slice(0, 60),
      pos: v.pos.map(Number),
      target: v.target.map(Number),
      ...(v.ortho ? { ortho: true, zoom: +v.zoom > 0 ? +v.zoom : 3 } : {}),
      ...(v.section && Number.isFinite(+v.section.angle) ? { section: { angle: +v.section.angle, offset: +v.section.offset || 0, flip: !!v.section.flip } } : {}),
    }))
  return { title, block, items, // a plan saved before the plate grid existed: its deck becomes reused GDR plates once
    park: s.park ? cleanPark(s.lifts ? s.park : { ...s.park, mat: 'gdr', net: 1.2, columns: 7.2, col: undefined }) : DEFAULT_PARK, plaza: s.plaza ? cleanPlaza(s.plaza) : DEFAULT_PLAZA, lifts: s.lifts ? cleanLifts(s.lifts) : DEFAULT_LIFTS,
    roofs: s.roofs ? Object.fromEntries(Object.entries(s.roofs).filter(([id, m]) => ALL.includes(id) && ['tilt', 'frame', 'open'].includes(m))) : DEFAULT_ROOFS,
    roofColour: parseColour(s.roofColour) ?? '#c0392b',
    bcut: Object.fromEntries(Object.entries(s.bcut ?? {}).filter(([i, n]) => Number.isInteger(+i) && Number.isInteger(+n) && +n > 0).map(([i, n]) => [i, +n])), ribbon: { ...cleanRibbon(s.ribbon), on: false }, map: cleanMap(s.map), glabel, drawn: [], heading, views, layers: cleanLayers(s.layers) }
}
function cleanLayers(list) {
  const seen = new Set()
  const out = (Array.isArray(list) ? list : [])
    .filter((l) => l && l.id && !seen.has(String(l.id)) && seen.add(String(l.id)))
    .map((l) => ({ id: String(l.id).slice(0, 60), name: String(l.name ?? 'Layer').slice(0, 40) || 'Layer', on: l.on !== false, locked: !!l.locked }))
  return out.length ? out : DEFAULT_LAYERS
}
// The ribbons you drew with the magic wand: { id, name, route: [[east, north], …], width, pieces }
function cleanDrawn(list) {
  if (!Array.isArray(list)) return []
  return list
    .filter((d) => d && Array.isArray(d.route))
    .map((d, n) => {
      const route = d.route.filter((p) => Array.isArray(p) && p.every((v) => Number.isFinite(+v))).map(([x, y]) => [+x, +y])
      const r = cleanRibbon({ v: VERSION, on: true, width: d.width, pieces: Array.isArray(d.pieces) && d.pieces.length ? d.pieces : [{ kind: 'path', len: 5 }] })
      return { id: String(d.id ?? 'd' + n), name: String(d.name ?? 'Drawn ribbon ' + (n + 1)).slice(0, 60), route, width: r.width, pieces: r.pieces, ...cleanLook(d) }
    })
    .filter((d) => d.route.length >= 2)
}

// Text you can click to change, for the page title and subtitle. Empty brings back the usual text.
function EditableText({ as: Tag, value, fallback, onSave, long }) {
  const [edit, setEdit] = useState(false)
  const skip = useRef(false)
  if (edit) {
    const Box = long ? 'textarea' : 'input'
    return (
      <Box
        className={'edit-text edit-' + Tag}
        autoFocus
        defaultValue={value || fallback}
        rows={long ? 3 : undefined}
        onFocus={(e) => e.target.select()}
        onBlur={(e) => {
          if (!skip.current) onSave(e.target.value.trim() === fallback ? '' : e.target.value.trim())
          skip.current = false
          setEdit(false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) e.target.blur()
          if (e.key === 'Escape') {
            skip.current = true
            e.target.blur()
          }
        }}
      />
    )
  }
  return (
    <Tag className="editable" title="Click to change" tabIndex={0} onClick={() => setEdit(true)} onKeyDown={(e) => e.key === 'Enter' && setEdit(true)}>
      {value || fallback}
      <span className="pen" aria-hidden="true"> ✎</span>
    </Tag>
  )
}

// Every change to the plan goes through here, so it can be undone and redone (up to 100 steps).
// Changes with the same key in quick succession (one drag) count as one step.
function useHistory(init) {
  const [h, setH] = useState(() => ({ past: [], present: init(), future: [] }))
  const last = useRef({ key: null, t: 0 })
  const set = (fn, key) => {
    const now = Date.now()
    const merge = !!key && last.current.key === key && now - last.current.t < 700
    last.current = { key, t: now }
    setH((st) => {
      const next = typeof fn === 'function' ? fn(st.present) : fn
      if (next === st.present) return st
      return { past: merge ? st.past : [...st.past.slice(-99), st.present], present: next, future: [] }
    })
  }
  const undo = () => {
    last.current = { key: null, t: 0 }
    setH((st) => (st.past.length ? { past: st.past.slice(0, -1), present: st.past.at(-1), future: [st.present, ...st.future] } : st))
  }
  const redo = () => {
    last.current = { key: null, t: 0 }
    setH((st) => (st.future.length ? { past: [...st.past, st.present], present: st.future[0], future: st.future.slice(1) } : st))
  }
  return [h.present, set, undo, redo, h.past.length, h.future.length]
}

function download(name, text, type) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type }))
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}

// The material of a ribbon, a piece or a module, and its colour. `inherit` adds a "same as the ribbon" choice.
function MaterialPicker({ look, own, inherit, onMat, onCol }) {
  return (
    <div className="mat-picker">
      <div className="mat-grid">
        {inherit && (
          <button className={!own.mat && !own.col ? 'on' : ''} onClick={() => onMat(null)} title="Take the ribbon's material and colour">
            <span className="mat-sw inherit" />
            {inherit}
          </button>
        )}
        {MATERIAL_IDS.map((m) => (
          <button key={m} className={(inherit ? own.mat : look.mat) === m ? 'on' : ''} onClick={() => onMat(m)}>
            <span className="mat-sw" style={{ background: swatchOf(m) }} />
            {MATERIALS[m].name}
          </button>
        ))}
      </div>
      <ColourField label="Colour" value={look.colour} changed={!!own.col} onChange={onCol} onReset={() => onCol(null)} />
    </div>
  )
}

// A number for the park: a slider and a box. Dragging the slider counts as one step for Undo.
function ParkVal({ label, value, min, max, step, unit, title, onChange }) {
  return (
    <label className="park-val" title={title}>
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} />
      <input type="number" min={min} max={max} step={step} value={value} onChange={(e) => e.target.value !== '' && Number.isFinite(+e.target.value) && onChange(Math.min(max, Math.max(min, +e.target.value)))} />
      <small>{unit ?? ''}</small>
    </label>
  )
}

// Width, length and height boxes for ribbon pieces and modules. An empty box ("mixed") means the picked pieces differ.
function SizeBoxes({ id, vals, min, heightOk, custom, onSet, onReset }) {
  const box = (key, label, step, lo, off, tip) => (
    <label title={tip}>
      <span>{label}</span>
      <input
        key={`${id}-${key}-${vals[key]}`}
        type="number" min={lo} step={step} disabled={off}
        defaultValue={vals[key] ?? ''}
        placeholder={vals[key] == null ? 'mixed' : ''}
        onBlur={(e) => e.target.value !== '' && e.target.value !== e.target.defaultValue && onSet(key, e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
      />
      <small>m</small>
    </label>
  )
  return (
    <>
      <div className="sizes">
        {box('w', 'Width', 0.1, 0.3, false, 'Across the ribbon')}
        {box('len', 'Length', 0.5, min, false, 'Along the ribbon')}
        {box('h', 'Height', 0.05, 0.25, !heightOk, heightOk ? 'Height of the highest point' : 'A flat piece has no height to change')}
      </div>
      {custom && (
        <div className="scale-btns">
          <button onClick={onReset} title="Back to the usual width and height for this kind">Normal width and height</button>
        </div>
      )}
    </>
  )
}

export default function App() {
  const [site, setSite] = useState(null)
  const [terrainReady, setTerrainReady] = useState(false)
  const [error, setError] = useState(null)
  const [plan, setPlan, undo, redo, undos, redos] = useHistory(loadSaved)
  const [picked, setPicked] = useState(() => new Set())
  const [multi, setMulti] = useState(false)
  // which labels show: garages (titles / numbers / both / off), ribbon pieces (names / numbers / both / off), elements (on / off)
  const [show, setShow] = useState(() => {
    try {
      const s = JSON.parse(localStorage.getItem('chemnitz-garage-labels'))
      if (s && s.garages) return s
    } catch {}
    return { garages: 'titles', ribbon: 'names', elements: true }
  })
  useEffect(() => {
    try {
      localStorage.setItem('chemnitz-garage-labels', JSON.stringify(show))
    } catch {}
  }, [show])
  const anyLabels = show.garages !== 'off' || show.ribbon !== 'off' || show.elements
  const [labelMenu, setLabelMenu] = useState(false)
  const [viewMenu, setViewMenu] = useState(false)
  // drawing views: a parallel (orthographic) camera, and a section cut { angle, offset, flip }
  const [ortho, setOrtho] = useState(false)
  const [section, setSection] = useState(null)
  const go = (name, extra = {}, parallel = false) => {
    setOrtho(parallel)
    setView({ name, t: Date.now(), ...extra })
  }
  const openSection = (sec) => {
    const next = sec ?? section ?? { angle: 0, offset: 0, flip: false }
    setSection(next)
    go('section', { keepZoom: !!sec }, true)
  }
  const turnSection = (angle) => {
    setSection((sc) => ({ ...sc, angle }))
    go('section', { keepZoom: true }, true)
  }
  // which way you look in the section, as a compass word
  const lookWord = (sc) => {
    const { n } = sectionGeom(sc)
    const deg = ((Math.atan2(n[0], n[1]) * 180) / Math.PI + 360) % 360
    return ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(deg / 45) % 8]
  }
  const [renaming, setRenaming] = useState(null) // the saved view whose name you are changing
  const [wand, setWand] = useState(null) // the magic wand: { pts, id (when changing a drawn ribbon's line), width }
  const [view, setView] = useState(null)
  const [note, setNote] = useState(null)
  const [snap, setSnap] = useState('grid')
  const [connect, setConnect] = useState(null) // null, or { stage: 'grip' | 'target', id, grip }
  // the ribbon pieces you picked, by their numbers; `chosen` is the one piece when only one is picked
  const [chosenList, setChosenList] = useState([])
  const chosen = chosenList.length === 1 ? chosenList[0] : null
  const setChosen = (i) => setChosenList(i == null ? [] : [i])
  const file = useRef()
  const api = useRef(null)
  const { title, block, items, ribbon } = plan

  // ----- layers of elements -----
  const layers = plan.layers?.length ? plan.layers : DEFAULT_LAYERS
  const layerById = Object.fromEntries(layers.map((l) => [l.id, l]))
  const layerOf = (it) => (layerById[it.layer] ? it.layer : layers[0].id)
  const [curLayer, setCurLayer] = useState(null)
  const [layerMenu, setLayerMenu] = useState(false)
  const current = layerById[curLayer] ?? layers[0] // new elements go on this layer
  const shownItems = useMemo(() => items.filter((it) => layerById[layerOf(it)].on), [items, layers]) // eslint-disable-line react-hooks/exhaustive-deps
  const lockedIds = useMemo(() => new Set(items.filter((it) => layerById[layerOf(it)].locked).map((it) => it.id)), [items, layers]) // eslint-disable-line react-hooks/exhaustive-deps
  const layerCount = (id) => items.filter((it) => layerOf(it) === id).length
  const setLayers = (fn) => setPlan((p) => ({ ...p, layers: fn(p.layers?.length ? p.layers : DEFAULT_LAYERS) }))
  // the current layer is shown and unlocked again when you add something to it
  const openLayer = (ls, id) => ls.map((l) => (l.id === id ? { ...l, on: true, locked: false } : l))
  const noteOpened = () => (!current.on || current.locked) && setNote(`Layer "${current.name}" was ${!current.on ? 'hidden' : 'locked'}. It is shown and unlocked again, so you can see what you added.`)
  const unpickLayer = (id) =>
    setPicked((old) => {
      const next = new Set(old)
      for (const it of items) if (layerOf(it) === id) next.delete(it.id)
      return next
    })
  const toggleLayer = (id, key) => {
    const l = layerById[id]
    if (key === 'on' ? l.on : !l.locked) unpickLayer(id) // what you hide or lock is no longer selected
    setLayers((ls) => ls.map((x) => (x.id === id ? { ...x, [key]: !x[key] } : x)))
  }
  const addLayer = () => {
    const id = 'l' + newId()
    let n = layers.length + 1
    while (layers.some((l) => l.name === 'Layer ' + n)) n++
    setLayers((ls) => [...ls, { id, name: 'Layer ' + n, on: true, locked: false }])
    setCurLayer(id)
  }
  const renameLayer = (id) => {
    const t = prompt('Name of the layer', layerById[id].name)
    if (t?.trim()) setLayers((ls) => ls.map((x) => (x.id === id ? { ...x, name: t.trim().slice(0, 40) } : x)))
  }
  const deleteLayer = (id) => {
    if (layers.length < 2) return
    const rest = layers.filter((l) => l.id !== id)
    const n = layerCount(id)
    if (n && !confirm(`Delete the layer "${layerById[id].name}"? Its ${n} element${n === 1 ? '' : 's'} move to "${rest[0].name}". (Undo brings it back.)`)) return
    setPlan((p) => ({ ...p, layers: rest, items: p.items.map((it) => (layerOf(it) === id ? { ...it, layer: rest[0].id } : it)) }))
    if (current.id === id) setCurLayer(rest[0].id)
  }
  const moveLayer = (id, by) =>
    setLayers((ls) => {
      const i = ls.findIndex((l) => l.id === id)
      const j = i + by
      if (j < 0 || j >= ls.length) return ls
      const next = [...ls]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  const selectLayer = (id) => {
    setChosen(null)
    setPicked(new Set(items.filter((it) => layerOf(it) === id).map((it) => it.id)))
  }
  const setAllLayers = (patch) => setLayers((ls) => ls.map((l) => ({ ...l, ...patch })))
  const map = plan.map ?? DEFAULT_MAP
  // the map as it looks now: the style's colours, with any you changed yourself on top
  const look = useMemo(() => ({ ...MAP_STYLES[map.style], ...(map.colours[map.style] ?? {}) }), [map])
  const own = map.colours[map.style] ?? {}
  const topo = terrainReady ? (map.topo ?? 'real') : 'flat'
  setTopo(topo) // every part of the model reads the ground from here while drawing

  // ----- the elevated park -----
  const park = plan.park ?? DEFAULT_PARK
  const [parkEdit, setParkEdit] = useState(false)
  const [parkSel, setParkSel] = useState(null) // { t: 'p' edge point (id = number) | 'h' height point | 'o' opening, id }
  const [placing, setPlacing] = useState(null) // 'h' height point, 't' opening with a tree, 'o' light well
  const setPark = (fn, key) => setPlan((p) => ({ ...p, park: fn(p.park ?? DEFAULT_PARK) }), key)
  // buildings lowered in steps of 1.20 m (one plate): plan.bcut = { building number: steps down }
  const LEVEL = 1.2
  const bcut = plan.bcut ?? {}
  const [bSel, setBSel] = useState(null)
  const siteAdj = useMemo(() => site && { ...site, buildings: site.buildings.map((b, i) => (bcut[i] ? { ...b, h: Math.max(0.6, Math.round((b.h - bcut[i] * LEVEL) * 100) / 100) } : b)) }, [site, bcut])
  const maxCut = (i) => (site ? Math.max(0, Math.ceil((site.buildings[i].h - 0.6) / LEVEL) - 1) : 0)
  const cutBuilding = (i, steps) => {
    const n = Math.max(0, Math.min(maxCut(i), (bcut[i] ?? 0) + steps))
    setPlan((p) => {
      const c = { ...(p.bcut ?? {}) }
      if (n) c[i] = n
      else delete c[i]
      return { ...p, bcut: c }
    }, 'bcut:' + i)
    const h = Math.max(0.6, site.buildings[i].h - n * LEVEL)
    setNote(`Building ${h.toFixed(2)} m high${n ? ` (${(n * LEVEL).toFixed(2)} m below its real height: ${n} step${n > 1 ? 's' : ''} of 1.20 m)` : ' (its real height)'}`)
  }
  const parkBuildings = useMemo(() => (siteAdj ? prepBuildings(siteAdj) : []), [siteAdj])
  const parkBuilt = useMemo(() => (site && park.on ? buildPark(park, parkBuildings) : null), [park, parkBuildings, topo]) // eslint-disable-line react-hooks/exhaustive-deps
  // ----- the city plaza -----
  const plaza = plan.plaza ?? DEFAULT_PLAZA
  const [plazaEdit, setPlazaEdit] = useState(false)
  const setPlaza = (fn, key) => setPlan((p) => ({ ...p, plaza: fn(p.plaza ?? DEFAULT_PLAZA) }), key)
  const plazaBuilt = useMemo(() => (site && plaza.on ? buildPlaza(plaza, site) : null), [plaza, site, topo]) // eslint-disable-line react-hooks/exhaustive-deps
  // ----- lifted roofs and areas of reused GDR plates -----
  const lifts = plan.lifts ?? DEFAULT_LIFTS
  const [liftDraw, setLiftDraw] = useState(false)
  const [liftSel, setLiftSel] = useState(null)
  const setLifts = (fn, key) => setPlan((p) => ({ ...p, lifts: fn(p.lifts ?? DEFAULT_LIFTS) }), key)
  const liftsBuilt = useMemo(() => (site ? buildLifts(lifts, park.netAngle, parkBuildings) : null), [lifts, park.netAngle, parkBuildings, topo]) // eslint-disable-line react-hooks/exhaustive-deps
  const createLift = (r) => {
    if (r.nu * r.nv < 2) return setNote('Drag over the model to draw a field of plates (at least two plates).')
    const id = newParkId('L')
    setLifts((ls) => [...ls, { id, ...r, h: r.roof ? 1.2 : 3.6, tiltU: 0, tiltV: 0, supports: true }])
    setLiftSel(id)
    setNote(`${r.nu} × ${r.nv} plates laid ${r.roof ? 'as a lifted roof, 1.20 m above the roof' : 'as a canopy, 3.60 m above the ground'}. Lift it with ↑ / ↓ (Shift: one plate, 1.20 m).`)
  }
  const liftPlates = liftsBuilt ? Object.values(liftsBuilt.info).reduce((a, x) => a + x.plates, 0) : 0
  // pick a handle, or (Shift-click / Delete) take it out
  const selectPark = (what, removeIt) => {
    if (!removeIt) return setParkSel(what)
    if (what.t === 'p') setPark((pk) => (pk.outline.length > 3 ? { ...pk, outline: pk.outline.filter((_, i) => i !== what.id) } : pk))
    if (what.t === 'h') setPark((pk) => (pk.heights.length > 1 ? { ...pk, heights: pk.heights.filter((q) => q.id !== what.id) } : pk))
    if (what.t === 'o') setPark((pk) => ({ ...pk, holes: pk.holes.filter((q) => q.id !== what.id) }))
    setParkSel(null)
  }
  const placeOnPark = ([x, y]) => {
    if (placing === 'h') {
      const id = newParkId('h')
      // a new height point keeps the deck where it is now
      const h = parkBuilt && parkBuilt.H ? Math.round((parkBuilt.H(x, y) - ground(x, y)) * 10) / 10 : 3
      setPark((pk) => ({ ...pk, heights: [...pk.heights, { id, x, y, h }] }))
      setParkSel({ t: 'h', id })
    } else if (placing) {
      const id = newParkId('o')
      setPark((pk) => ({ ...pk, holes: [...pk.holes, { id, x, y, r: placing === 't' ? 2.5 : 3, tree: placing === 't' }] }))
      setParkSel({ t: 'o', id })
    }
    setPlacing(null)
  }
  const setMapTopo = (t) => setPlan((p) => ({ ...p, map: { ...(p.map ?? DEFAULT_MAP), topo: t } }))
  const setMapStyle = (style) => setPlan((p) => ({ ...p, map: { ...(p.map ?? DEFAULT_MAP), style } }))
  // a colour picker sends many changes while you drag it; they count as one step for undo
  const setMapColour = (k, c) =>
    setPlan((p) => {
      const m = p.map ?? DEFAULT_MAP
      const mine = { ...(m.colours[m.style] ?? {}) }
      if (c) mine[k] = c
      else delete mine[k]
      return { ...p, map: { ...m, colours: { ...m.colours, [m.style]: mine } } }
    }, 'mapcol:' + k)
  const resetMapColours = () =>
    setPlan((p) => {
      const m = p.map ?? DEFAULT_MAP
      const { [m.style]: _, ...rest } = m.colours
      return { ...p, map: { ...m, colours: rest } }
    })
  const setItemColour = (c) =>
    setPlan(
      (p) => ({
        ...p,
        items: p.items.map((it) => {
          if (!picked.has(it.id)) return it
          if (c) return { ...it, col: c }
          const { col, ...rest } = it
          return rest
        }),
      }),
      'itemcol',
    )

  useEffect(() => {
    fetch(`${BASE}data/site.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`data/site.json: ${r.status}`)
        return r.json()
      })
      .then(setSite)
      .catch((e) => setError(e.message))
    // the real ground heights; without them the model stays flat
    fetch(`${BASE}data/terrain.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return
        setTerrain(d)
        setTerrainReady(true)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(plan))
    } catch {}
  }, [plan])

  useEffect(() => {
    if (!note) return
    const t = setTimeout(() => setNote(null), 3500)
    return () => clearTimeout(t)
  }, [note])

  // A garage in a block always brings its whole block with it.
  const members = (id) => (block[id] ? ALL.filter((g) => block[g] === block[id]) : [id])
  const withBlocks = (ids) => [...new Set(ids.flatMap(members))]

  const pick = (id, add) => {
    if (lockedIds.has(id)) return
    setChosen(null)
    const m = members(id)
    setPicked((old) => {
      if (!(add || multi)) return new Set(m)
      const next = new Set(old)
      if (m.every((g) => next.has(g))) m.forEach((g) => next.delete(g))
      else m.forEach((g) => next.add(g))
      return next
    })
  }

  const sel = useMemo(() => ALL.filter((id) => picked.has(id)), [picked])
  const selItems = items.filter((it) => picked.has(it.id))
  const titledItems = selItems.filter((it) => KINDS[it.kind].titled)
  const selBlocks = new Set(sel.map((id) => block[id]).filter(Boolean))
  const selTitles = new Set([...sel.map((id) => title[id] ?? null), ...titledItems.map((it) => it.title ?? null)])
  const shared = selTitles.size === 1 ? [...selTitles][0] : undefined
  const canTitle = sel.length > 0 || titledItems.length > 0

  const setTitle = (t) => {
    const ids = withBlocks(sel)
    setPlan((p) => {
      const title = { ...p.title }
      for (const id of ids) {
        if (t) title[id] = t
        else delete title[id]
      }
      const items = p.items.map((it) => {
        if (!picked.has(it.id) || !KINDS[it.kind].titled) return it
        const { title: _, ...rest } = it
        return t ? { ...rest, title: t } : rest
      })
      return { ...p, title, items }
    })
  }

  // ----- added elements -----
  const addItem = (kind, [x, y, z]) => {
    const [sx, sy] = snap === 'grid' ? snapPoint(x, y) : [x, y]
    let it = { id: newId(), kind, x: sx, y: sy, z, rot: alignRot(sx, sy), layer: current.id }
    if (kind.startsWith('rmod:')) {
      const rk = kind.slice(5)
      it = { ...it, kind: 'rmod', rk, len: moduleLen(rk), bw: ribbon.width }
    }
    setPlan((p) => ({ ...p, items: [...p.items, it], layers: openLayer(p.layers?.length ? p.layers : DEFAULT_LAYERS, current.id) }))
    noteOpened()
    setPicked(new Set([it.id]))
  }
  const moveItem = (id, pos) => setPlan((p) => ({ ...p, items: p.items.map((it) => (it.id === id ? { ...it, ...pos } : it)) }), 'move:' + id)
  const changeItems = (fn, key) => setPlan((p) => ({ ...p, items: p.items.map((it) => (picked.has(it.id) ? fn(it) : it)) }), key)
  const rotate = (deg) => changeItems((it) => ({ ...it, rot: (it.rot + deg + 360) % 360 }))
  const removeItems = () => {
    setPlan((p) => ({ ...p, items: p.items.filter((it) => !picked.has(it.id)) }))
    setPicked(new Set(sel))
  }
  const duplicate = () => {
    const copies = selItems.map((it) => {
      // the copy goes one block-width along, to the right of the original
      const a = (it.rot * Math.PI) / 180
      const step = dims(it).w + 0.2
      return { ...it, id: newId(), x: it.x + Math.cos(a) * step, y: it.y + Math.sin(a) * step }
    })
    setPlan((p) => ({ ...p, items: [...p.items, ...copies] }))
    setPicked(new Set(copies.map((c) => c.id)))
  }
  // Size: what you type in W / L / H, or a scale step for every selected element.
  const resize = (key, value) => {
    const v = Math.round(+value * 100) / 100
    if (!(v > 0)) return
    changeItems((it) => ({ ...it, [key]: v }))
  }
  const scaleBy = (f) =>
    changeItems((it) => {
      const s = dims(it)
      const r = (v) => Math.round(v * f * 100) / 100
      return { ...it, sw: r(s.w), sd: r(s.d), sh: r(s.h) }
    })
  const resetSize = () =>
    changeItems((it) => {
      const { sw, sd, sh, ...rest } = it
      return rest
    })

  // Connect: hold the element by one of its points, then put that point on another point.
  const startConnect = () => {
    if (selItems.length !== 1) return setNote('Select one element to connect.')
    setConnect({ stage: 'grip', id: selItems[0].id })
  }
  const onGrip = (grip) => setConnect((c) => ({ ...c, stage: 'target', grip }))
  const onTarget = (target) => {
    const c = connect
    setPlan((p) => ({ ...p, items: p.items.map((it) => (it.id === c.id ? { ...it, ...placeByGrip(it, c.grip, target) } : it)) }))
    setPicked(new Set([c.id]))
    setConnect(null)
    setNote('Connected.')
  }

  // ----- the ribbon -----
  // The main ribbon, and the ribbons you drew with the magic wand. The pieces you pick belong to one of them: `cur`.
  const drawn = plan.drawn ?? []
  const [active, setActive] = useState('main')
  const cur = active === 'main' ? ribbon : (drawn.find((d) => d.id === active) ?? ribbon)
  const curId = cur === ribbon ? 'main' : active
  const setRibbon = (fn, key) => setPlan((p) => ({ ...p, ribbon: fn(p.ribbon) }), key)
  const setCur = (fn, key) => (curId === 'main' ? setRibbon(fn, key) : setPlan((p) => ({ ...p, drawn: (p.drawn ?? []).map((d) => (d.id === curId ? fn(d) : d)) }), key))
  const setDrawn = (id, change, key) => setPlan((p) => ({ ...p, drawn: (p.drawn ?? []).map((d) => (d.id === id ? drop({ ...d, ...change }) : d)) }), key)
  // leaves out a material or colour set back to "usual"
  const drop = (o) => {
    for (const k of ['mat', 'col']) if (o[k] == null) delete o[k]
    return o
  }
  // the material of a whole ribbon; a new material starts in its usual colour
  const ribbonLook = (set) => ({
    onMat: (m) => set((r) => drop({ ...r, mat: m ?? undefined, col: undefined })),
    onCol: (c) => set((r) => drop({ ...r, col: c ?? undefined }), 'ribcol'),
  })
  // Shift-click (or the "Add to selection" box) adds a piece to the ones picked, or takes it out again.
  const pickPiece = (i, add, rid = 'main') => {
    if (i == null || i < 0) return
    if (rid !== curId) {
      setActive(rid)
      setChosenList([i])
    } else setChosenList((old) => (add || multi ? (old.includes(i) ? old.filter((k) => k !== i) : [...old, i]) : [i]))
    setPicked(new Set())
  }
  // A change to one piece or several. A new kind drops a height you set (a bench height makes no sense for a lookout).
  const sized = (p, change) => {
    const kind = change.rk ?? change.kind ?? (p.kind === 'rmod' ? p.rk : p.kind)
    const next = { ...p, ...change, len: Math.max(RIBBON_KINDS[kind].min, change.len ?? p.len) }
    if ((change.kind && change.kind !== p.kind) || (change.rk && change.rk !== p.rk) || !hasHeight(kind)) delete next.h
    for (const k of ['w', 'h', 'label', 'mat', 'col']) if (next[k] == null || next[k] === '') delete next[k]
    return next
  }
  const editPieces = (list, change, key) => setCur((r) => ({ ...r, pieces: r.pieces.map((p, k) => (list.includes(k) ? sized(p, change) : p)) }), key)
  // the material and colour of the picked pieces: a new material starts in its usual colour; none = the ribbon's
  const pieceLook = (list) => ({
    onMat: (m) => editPieces(list, { mat: m ?? undefined, col: undefined }),
    onCol: (c) => editPieces(list, { col: c ?? undefined }, 'piececol'),
  })
  const editPiece = (i, change) => editPieces([i], change)
  const splitPiece = (i) =>
    setCur((r) => {
      const p = r.pieces[i]
      const half = Math.round((p.len / 2) * 10) / 10
      return { ...r, pieces: [...r.pieces.slice(0, i), { ...p, len: half }, { kind: 'path', len: Math.round((p.len - half) * 10) / 10 }, ...r.pieces.slice(i + 1)] }
    })
  const deletePiece = (i) => {
    setCur((r) => ({ ...r, pieces: r.pieces.length > 1 ? r.pieces.filter((_, k) => k !== i) : r.pieces }))
    setChosen(null)
  }
  const resetRibbon = () => {
    if (!confirm('Put the ribbon back the way it started?')) return
    setRibbon(() => DEFAULT_RIBBON)
    setChosen(null)
  }
  const ribbonLen = ribbon.pieces.reduce((a, p) => a + p.len, 0)
  const curve = useMemo(() => routeCurve(), [])
  const routeLen = useMemo(() => curve.getLength(), [curve])
  // where a point along a ribbon is on the map, and which way the ribbon runs there
  const alongOn = (c, s) => {
    const u = Math.min(1, Math.max(0, s / c.getLength()))
    const P = c.getPointAt(u)
    const T = c.getTangentAt(u)
    return { x: P.x, y: -P.z, rot: (Math.atan2(-T.x, -T.z) * 180) / Math.PI }
  }
  const along = (s) => alongOn(curve, s) // on the main ribbon
  const startOf = (i) => ribbon.pieces.slice(0, i).reduce((a, p) => a + p.len, 0)
  const curCurve = useMemo(() => (curId === 'main' ? curve : routeCurve(cur.route)), [curId, cur.route, curve])

  // Detach: each piece leaves the ribbon as a single straight module, in the same place; a gap stays behind.
  const detachPieces = (list) => {
    const out = list.filter((i) => cur.pieces[i] && !RIBBON_KINDS[cur.pieces[i].kind].gap)
    if (!out.length) return
    const mods = out.map((i) => {
      const p = cur.pieces[i]
      const at = alongOn(curCurve, cur.pieces.slice(0, i).reduce((a, q) => a + q.len, 0) + p.len / 2)
      const L = lookOf(p, cur) // the module looks just like the piece did
      const look = { ...(L.mat !== 'painted' ? { mat: L.mat } : {}), ...(L.colour !== MATERIALS[L.mat].colour ? { col: L.colour } : {}) }
      return { id: newId() + i, layer: current.id, kind: 'rmod', rk: p.kind, len: p.len, bw: cur.width, x: at.x, y: at.y, z: 0, rot: at.rot, ...(p.flip ? { flip: true } : {}), ...cleanSize(p), ...look }
    })
    const gaps = (r) => ({ ...r, pieces: r.pieces.map((q, k) => (out.includes(k) ? { kind: 'gap', len: q.len } : q)) })
    setPlan((pl) => ({
      ...pl,
      items: [...pl.items, ...mods],
      layers: openLayer(pl.layers?.length ? pl.layers : DEFAULT_LAYERS, current.id),
      ...(curId === 'main' ? { ribbon: gaps(pl.ribbon) } : { drawn: pl.drawn.map((d) => (d.id === curId ? gaps(d) : d)) }),
    }))
    setChosen(null)
    setPicked(new Set(mods.map((m) => m.id)))
    setNote(
      mods.length === 1
        ? `${RIBBON_KINDS[mods[0].rk].name} detached. Drag it anywhere; Reattach puts it back into the nearest gap.`
        : `${mods.length} pieces detached as single modules. Select one to reattach it.`,
    )
  }
  const detachPiece = (i) => detachPieces([i])
  const deletePieces = (list) => {
    setCur((r) => {
      const left = r.pieces.filter((_, k) => !list.includes(k))
      return { ...r, pieces: left.length ? left : r.pieces }
    })
    setChosen(null)
  }

  // Reattach: a module goes back into the ribbon, into the nearest gap; with no gap, at the nearest point of the ribbon.
  const reattach = (it) => {
    const piece = { kind: it.rk, len: it.len, ...(it.flip ? { flip: true } : {}), ...cleanSize({ kind: it.rk, w: it.w, h: it.h }), ...cleanLook(it) }
    const pieces = ribbon.pieces
    const dist = (s) => {
      const a = along(s)
      return Math.hypot(a.x - it.x, a.y - it.y)
    }
    let next
    let at
    const gaps = pieces.map((p, i) => i).filter((i) => RIBBON_KINDS[pieces[i].kind].gap)
    if (gaps.length) {
      const mid = (g) => dist(startOf(g) + pieces[g].len / 2)
      const i = gaps.reduce((b, g) => (mid(g) < mid(b) ? g : b))
      const left = Math.round((pieces[i].len - it.len) * 10) / 10
      // a shorter module leaves the rest of the gap as flat path, so the pieces after it stay where they are
      next = [...pieces.slice(0, i), piece, ...(left >= 0.1 ? [{ kind: 'path', len: left }] : []), ...pieces.slice(i + 1)]
      at = i
      setNote(`Reattached into the gap at piece ${i + 1}.`)
    } else {
      // the nearest point on the ribbon, every half metre
      let best = 0
      let bd = Infinity
      for (let s = 0; s <= routeLen; s += 0.5) {
        const d = dist(s)
        if (d < bd) [best, bd] = [s, d]
      }
      let i = 0
      while (i < pieces.length - 1 && startOf(i + 1) <= best) i++
      const p = pieces[i]
      if (p.kind === 'path' && p.len >= it.len) {
        // carve the module out of a path, so the pieces after it stay where they are
        const a = Math.round(Math.min(p.len - it.len, Math.max(0, best - startOf(i) - it.len / 2)) * 10) / 10
        const b = Math.round((p.len - a - it.len) * 10) / 10
        next = [...pieces.slice(0, i), ...(a >= 0.1 ? [{ kind: 'path', len: a }] : []), piece, ...(b >= 0.1 ? [{ kind: 'path', len: b }] : []), ...pieces.slice(i + 1)]
        at = i + (a >= 0.1 ? 1 : 0)
        setNote(`Reattached at ${best.toFixed(0)} m along the ribbon.`)
      } else {
        next = [...pieces.slice(0, i + 1), piece, ...pieces.slice(i + 1)]
        at = i + 1
        setNote(`Reattached after piece ${i + 1}. The pieces after it moved along by ${it.len} m.`)
      }
    }
    setPlan((pl) => ({ ...pl, items: pl.items.filter((x) => x.id !== it.id), ribbon: { ...pl.ribbon, on: true, pieces: next } }))
    setPicked(new Set())
    setChosen(at)
  }
  const selModule = selItems.length === 1 && selItems[0].kind === 'rmod' ? selItems[0] : null
  const editModule = (change, key) => changeItems((it) => (it.kind === 'rmod' ? sized(it, change) : it), key)
  // the size boxes: what you type becomes the piece's own width / height / length
  const sizeChange = (key, value) => {
    const v = +value
    if (!(v > 0)) return null
    if (key === 'len') return { len: Math.round(v * 10) / 10 }
    if (key === 'w') return { w: Math.min(12, Math.max(0.3, Math.round(v * 100) / 100)) }
    return { h: Math.min(10, Math.max(0.25, Math.round(v * 100) / 100)) }
  }
  const piece = chosen != null ? cur.pieces[chosen] : null
  const startAt = chosen != null ? cur.pieces.slice(0, chosen).reduce((a, p) => a + p.len, 0) : 0
  const chosenPieces = chosenList.map((i) => cur.pieces[i]).filter(Boolean)
  // the size of a piece or module as you see it: its own width / height, or its usual one
  const sizeOf = (kind, p, bw) => ({ w: pieceWidth(kind, bw, p.w), h: pieceTop(kind, p.len, p.h), len: p.len })
  const setWidth = (e) => +e.target.value >= 0.6 && setRibbon((r) => ({ ...r, width: Math.min(8, Math.round(+e.target.value * 10) / 10) }))

  const addMiddle = (kind) => {
    const p = api.current?.centre()
    if (p) addItem(kind, p)
  }

  const lock = () => {
    const ids = withBlocks(sel)
    if (ids.length < 2) return setNote('Pick two or more garages to lock together.')
    if (!connected(ids)) return setNote('These garages don’t touch. Pick neighbours side by side or back to back.')
    const counts = {}
    for (const id of ids) if (title[id]) counts[title[id]] = (counts[title[id]] ?? 0) + 1
    const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1])
    const keep = ranked[0]?.[0]
    const id = 'b' + Date.now().toString(36)
    setPlan((p) => {
      const t = { ...p.title }
      const b = { ...p.block }
      for (const g of ids) {
        b[g] = id
        if (keep) t[g] = keep
      }
      return { ...p, title: t, block: b }
    })
    setPicked(new Set(ids))
    setNote(ranked.length > 1 ? `Locked ${ids.length} garages. They had different titles, so all are now ${TITLE[keep].name}.` : `Locked ${ids.length} garages into one block.`)
  }

  const unlock = () => {
    const ids = withBlocks(sel)
    setPlan((p) => {
      const b = { ...p.block }
      for (const g of ids) delete b[g]
      return { ...p, block: b }
    })
    setNote(`Unlocked ${selBlocks.size === 1 ? 'the block' : `${selBlocks.size} blocks`}. Each garage keeps its title.`)
  }

  useEffect(() => {
    if (chosenList.some((i) => i >= cur.pieces.length)) setChosenList((l) => l.filter((i) => i < cur.pieces.length))
    if (active !== 'main' && !drawn.some((d) => d.id === active)) setActive('main')
  }, [chosenList, cur.pieces.length, active, drawn])

  // ----- the magic wand -----
  const startWand = (d) => {
    setConnect(null)
    setPicked(new Set())
    setChosen(null)
    setWand(d ? { pts: d.route, id: d.id, width: d.width } : { pts: [], id: null, width: ribbon.width })
    if (!d) go('top', {}, true)
  }
  const wandLen = wand && wand.pts.length >= 2 ? routeCurve(wand.pts).getLength() : 0
  const finishWand = () => {
    if (!wand) return
    if (wand.pts.length < 2) return setNote('Click at least two points on the ground first.')
    const route = wand.pts.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10])
    const total = Math.max(1, Math.round(routeCurve(route).getLength() * 10) / 10)
    if (wand.id) {
      setPlan((p) => ({ ...p, drawn: (p.drawn ?? []).map((d) => (d.id === wand.id ? { ...d, route, pieces: d.pieces.length === 1 ? [{ ...d.pieces[0], len: total }] : d.pieces } : d)) }))
      setActive(wand.id)
      setNote(`Line changed: now ${total} m.`)
    } else {
      const id = newId()
      let n = drawn.length + 1
      while (drawn.some((d) => d.name === 'Drawn ribbon ' + n)) n++
      const name = 'Drawn ribbon ' + n
      setPlan((p) => ({ ...p, drawn: [...(p.drawn ?? []), { id, name, route, width: wand.width, pieces: [{ kind: 'path', len: total }] }] }))
      setActive(id)
      setChosenList([0])
      setNote(`${name}: ${total} m, one PATH piece. Choose a kind for it, split it, or pick its pieces like on the main ribbon.`)
    }
    setWand(null)
  }
  // a label you typed yourself; empty brings back the usual one
  const setLabel = (edit, text) => {
    const t = String(text ?? '').trim().slice(0, 60)
    if (edit.type === 'g') {
      const ids = members(edit.id)
      setPlan((p) => {
        const g = { ...(p.glabel ?? {}) }
        for (const id of ids) t ? (g[id] = t) : delete g[id]
        return { ...p, glabel: g }
      })
    } else if (edit.type === 'e') {
      setPlan((p) => ({ ...p, items: p.items.map((it) => (it.id === edit.id ? (t ? { ...it, label: t } : (({ label, ...rest }) => rest)(it)) : it)) }))
    } else {
      const fix = (r) => ({ ...r, pieces: r.pieces.map((q, k) => (k === edit.i ? (t ? { ...q, label: t } : (({ label, ...rest }) => rest)(q)) : q)) })
      setPlan((p) => (edit.rid === 'main' ? { ...p, ribbon: fix(p.ribbon) } : { ...p, drawn: (p.drawn ?? []).map((d) => (d.id === edit.rid ? fix(d) : d)) }))
    }
  }
  const editLabel = (edit) => {
    const t = prompt(`Label (leave it empty for the usual one: ${edit.usual})`, edit.text)
    if (t !== null) setLabel(edit, t)
  }
  // ----- saved views -----
  const views = plan.views ?? []
  const saveView = (name) => {
    const cam = api.current?.cameraNow()
    if (!cam) return
    let n = views.length + 1
    while (views.some((v) => v.name === 'View ' + n)) n++
    const v = { id: newId(), name: (name ?? '').trim().slice(0, 60) || 'View ' + n, ...cam, ...(section ? { section } : {}) }
    if (!v.ortho) delete v.zoom
    setPlan((p) => ({ ...p, views: [...(p.views ?? []), v] }))
    setNote(`Saved “${v.name}”. Open ★ Views to come back to it${views.length < 9 ? `, or press ${views.length + 1}` : ''}.`)
  }
  const goView = (v) => {
    setSection(v.section ?? null)
    go('saved', { pos: v.pos, target: v.target, zoom: v.zoom }, !!v.ortho)
    setNote(`View: ${v.name}`)
  }
  const changeView = (id, change) => setPlan((p) => ({ ...p, views: (p.views ?? []).map((v) => (v.id === id ? { ...v, ...change } : v)) }))
  const moveView = (id, d) =>
    setPlan((p) => {
      const list = [...(p.views ?? [])]
      const i = list.findIndex((v) => v.id === id)
      const j = i + d
      if (i < 0 || j < 0 || j >= list.length) return p
      ;[list[i], list[j]] = [list[j], list[i]]
      return { ...p, views: list }
    })
  const glabel = plan.glabel ?? {}
  const heading = plan.heading ?? { title: '', sub: '' }
  useEffect(() => {
    document.title = heading.title || 'Chemnitz Garage Park'
  }, [heading.title])

  useEffect(() => {
    const key = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (placing && e.key === 'Escape') {
        setPlacing(null)
        e.preventDefault()
        return
      }
      // ↑ / ↓ raise or lower the design (10 cm, with Shift 1 m); the buildings and garages keep their real heights
      if (bSel != null && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        cutBuilding(bSel, e.key === 'ArrowDown' ? 1 : -1)
        e.preventDefault()
        return
      }
      if (liftSel && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        const d = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? PLATE : 0.1)
        const l = lifts.find((x) => x.id === liftSel)
        if (l) {
          const h = Math.round(Math.min(60, Math.max(0, l.h + d)) * 100) / 100
          setLifts((ls) => ls.map((x) => (x.id === l.id ? { ...x, h } : x)), 'lift-h:' + l.id)
          setNote(`Plates ${h.toFixed(2)} m above ${l.roof ? 'the roof' : 'the ground'}`)
        }
        e.preventDefault()
        return
      }
      if (liftSel && (e.key === 'Delete' || e.key === 'Backspace')) {
        setLifts((ls) => ls.filter((x) => x.id !== liftSel))
        setLiftSel(null)
        e.preventDefault()
        return
      }
      if (liftDraw && e.key === 'Escape') {
        setLiftDraw(false)
        e.preventDefault()
        return
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const d = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 1 : 0.1)
        const r2 = (v) => Math.round(v * 100) / 100
        if (parkEdit && parkSel?.t === 'h') {
          const q = park.heights.find((x) => x.id === parkSel.id)
          if (q) {
            const h = r2(Math.min(q.roof ? 20 : 60, Math.max(0, q.h + d)))
            setPark((pk) => ({ ...pk, heights: pk.heights.map((x) => (x.id === q.id ? { ...x, h } : x)) }), 'park-h:' + q.id)
            setNote(q.roof ? `Height point: ${h.toFixed(2)} m above the roof below` : `Height point: ${h.toFixed(2)} m above the ground`)
          }
          e.preventDefault()
          return
        }
        if (parkEdit && !parkSel) {
          // the whole deck, except the points that sit on roofs (they stay on the buildings)
          setPark((pk) => ({ ...pk, heights: pk.heights.map((x) => (x.roof ? x : { ...x, h: r2(Math.min(60, Math.max(0, x.h + d))) })) }), 'park-all')
          setNote(`The deck ${d > 0 ? 'up' : 'down'} ${Math.abs(d) < 1 ? '10 cm' : '1 m'} (points on roofs stay on the roofs)`)
          e.preventDefault()
          return
        }
        if (selItems.length) {
          changeItems((it) => ({ ...it, z: r2(Math.max(0, it.z + d)) }), 'items-z')
          setNote(`${selItems.length === 1 ? 'Element' : selItems.length + ' elements'} ${d > 0 ? 'up' : 'down'}: ${r2(Math.max(0, selItems[0].z + d)).toFixed(2)} m above the ground`)
          e.preventDefault()
          return
        }
      }
      if (parkEdit && parkSel && (e.key === 'Delete' || e.key === 'Backspace')) {
        selectPark(parkSel, true)
        e.preventDefault()
        return
      }
      if (wand) {
        if (e.key === 'Escape') setWand(null)
        else if (e.key === 'Enter') finishWand()
        else if (e.key === 'Backspace' || e.key === 'Delete' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z')) setWand((w) => ({ ...w, pts: w.pts.slice(0, -1) }))
        else return
        e.preventDefault()
        return
      }
      if (e.ctrlKey || e.metaKey) {
        const k = e.key.toLowerCase()
        if (k === 'z' && !e.shiftKey) undo()
        else if (k === 'y' || (k === 'z' && e.shiftKey)) redo()
        else return
        e.preventDefault()
        return
      }
      if (e.key === 'Escape') {
        if (connect) return setConnect(null)
        setPicked(new Set())
        setChosen(null)
      }
      if ((e.key === 'c' || e.key === 'C') && selItems.length === 1) startConnect()
      if ((e.key === 'f' || e.key === 'F') && piece) editPiece(chosen, { flip: !piece.flip })
      if ((e.key === 'f' || e.key === 'F') && chosenList.length > 1) editPieces(chosenList, { flip: !chosenPieces.every((p) => p.flip) })
      if ((e.key === 'f' || e.key === 'F') && selModule) editModule({ flip: !selModule.flip })
      if (/^[1-9]$/.test(e.key) && views[+e.key - 1]) goView(views[+e.key - 1])
      if (e.key === 'l' || e.key === 'L') lock()
      if (e.key === 'u' || e.key === 'U') unlock()
      if ((e.key === 'Delete' || e.key === 'Backspace') && selItems.length) removeItems()
      if ((e.key === 'r' || e.key === 'R') && selItems.length) rotate(e.shiftKey ? -15 : 90)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  const summary = useMemo(() => {
    const out = TITLES.map((t) => ({ ...t, garages: 0, blocks: new Set() }))
    const at = Object.fromEntries(out.map((o) => [o.id, o]))
    for (const id of ALL) {
      const t = title[id]
      if (!t) continue
      at[t].garages++
      at[t].blocks.add(block[id] ?? id)
    }
    return out
  }, [title, block])
  const assigned = Object.keys(title).length
  const blockCount = new Set(Object.values(block)).size

  const exportCsv = () => {
    const rows = [['garage', 'row', 'number', 'title', 'block']]
    for (const g of GARAGES) rows.push([g.id, g.row, g.num, title[g.id] ? TITLE[title[g.id]].name : '', block[g.id] ?? ''])
    download('chemnitz-garages.csv', rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n'), 'text/csv')
  }
  // The whole 3D model, as it is on screen, as a Rhino 8 file. Titles become text dots above the garages.
  // A picture of the 3D view, drawn again at a higher resolution. The selection highlight is hidden while it is taken.
  const [pic, setPic] = useState({ format: 'png', scale: 2, labels: true })
  const [shooting, setShooting] = useState(false)
  const takePicture = async () => {
    const v = api.current
    if (!v?.capture || shooting) return
    setShooting(true)
    const keep = [picked, chosenList]
    setPicked(new Set())
    setChosenList([])
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))))
    try {
      const tags = pic.labels ? [...document.querySelectorAll('.labels .tag')].filter((el) => el.style.display !== 'none') : []
      const c = v.capture({ scale: pic.scale, labels: tags })
      const jpg = pic.format === 'jpg'
      const blob = await new Promise((r) => c.toBlob(r, jpg ? 'image/jpeg' : 'image/png', 0.95))
      if (!blob) throw new Error('no image')
      const d = new Date()
      const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `chemnitz-garage-park-${stamp}.${pic.format}`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 2000)
      setNote(`Picture saved: ${c.width} × ${c.height} pixels, ${jpg ? 'JPG' : 'PNG'}.`)
    } catch (e) {
      console.error(e)
      setNote('The picture could not be made. Try a smaller size.')
    }
    setPicked(keep[0])
    setChosenList(keep[1])
    setShooting(false)
  }
  const [saving, setSaving] = useState(false)
  const exportRhino = async () => {
    const scene = api.current?.scene
    if (!scene) return
    setSaving(true)
    try {
      const dots = GARAGES.filter((g) => title[g.id]).map((g) => ({ text: TITLE[title[g.id]].name, x: g.x, y: g.y, z: 3.6 }))
      for (const it of items) if (it.title && TITLE[it.title]) dots.push({ text: TITLE[it.title].name, x: it.x, y: it.y, z: it.z + dims(it).h + 0.6 })
      const { export3dm } = await import('./export3dm.js')
      const r = await export3dm({ scene, dots, filename: 'chemnitz-garage-park.3dm' })
      setNote(`Rhino 8 file saved: ${r.objects} objects and ${r.dots} titles, in metres.`)
    } catch (e) {
      console.error(e)
      setNote('The Rhino file could not be made. Try again, or reload the page.')
    }
    setSaving(false)
  }

  const loadFile = (e) => {
    const f = e.target.files[0]
    if (!f) return
    f.text()
      .then((t) => {
        setPlan(clean(JSON.parse(t)))
        setPicked(new Set())
        setNote('Plan loaded.')
      })
      .catch(() => setNote('That file isn’t a garage plan.'))
    e.target.value = ''
  }
  const reset = () => {
    if (!confirm('Clear every title, block and added element, and reset the ribbon? (Undo brings it back.)')) return
    setPlan(EMPTY)
    setPicked(new Set())
    setChosen(null)
  }

  if (error) return <p className="message">The site data didn’t load ({error}).</p>
  if (!site) return <p className="message">Loading the garages…</p>

  const selText = sel.length === 0 ? null : sel.length <= 6 ? sel.map(label).join(', ') : `${label(sel[0])} … ${label(sel.at(-1))}`

  return (
    <div className="app">
      <main className="stage">
        <Scene
          site={siteAdj} bSel={bSel} onPickBuilding={(i) => { setBSel(i); setLiftSel(null); setParkSel(null) }} title={title} block={block} picked={picked} onPick={pick} onClear={() => {
            setBSel(null)
            if (connect || wand) return
            setPicked(new Set())
            setChosen(null)
            setParkSel(null)
            setLiftSel(null)
          }} view={view}
          items={shownItems} locked={lockedIds} layerName={layers.length > 1 ? Object.fromEntries(items.map((it) => [it.id, layerById[layerOf(it)].name])) : null} onSelectItem={pick} onMoveItem={moveItem} onDropKind={addItem} snap={snap} api={api}
          connect={connect} onGrip={onGrip} onTarget={onTarget}
          ribbon={ribbon} chosen={chosenList} onPickPiece={pickPiece} look={look} topo={topo} ortho={ortho} section={section}
          drawn={[]} active={curId} wand={null} onWand={setWand} show={show} glabel={glabel} onEditLabel={editLabel}
          roofs={plan.roofs ?? {}} roofColour={plan.roofColour ?? '#c0392b'}
          lifts={lifts} liftsBuilt={liftsBuilt} liftDraw={liftDraw} liftSel={liftSel} onLiftSel={(id) => { setLiftSel(id); setParkSel(null) }} onLifts={setLifts} onLiftCreate={createLift} buildings={parkBuildings}
          plaza={plaza} plazaBuilt={plazaBuilt} plazaEdit={plazaEdit} onPlaza={setPlaza}
          park={park} parkBuilt={parkBuilt} parkEdit={parkEdit} parkSel={parkSel} onParkSel={selectPark} onPark={setPark} placing={placing} onPlace={placeOnPark}
          onPickPark={() => !parkEdit && setNote('That is the elevated park. Shape it with ✎ Edit park in the top bar, or in the Elevated park section of the panel.')}
        />
        {liftDraw && (
          <div className="connect-bar" role="status">
            <b>▦ Lift plates</b> Drag over the ground, the plaza or a roof to lay a field of 1.20 m plates. On a roof it becomes a lifted roof. Click a field to select it, then ↑ / ↓ lifts it (Shift: 1.20 m); drag a selected field to move it.
            <button onClick={() => setLiftDraw(false)} title="Esc">Done</button>
          </div>
        )}
        {placing && (
          <div className="connect-bar" role="status">
            <b>{placing === 'h' ? '+ Height point' : placing === 't' ? '+ Opening with a tree' : '+ Light well'}</b> Click on the deck or the ground where it should go.
            <button onClick={() => setPlacing(null)} title="Esc">Cancel</button>
          </div>
        )}
        {section && (
          <div className="section-bar" role="group" aria-label="Section">
            <b>Section</b>
            <span className="muted small nowrap">looking {lookWord(section)}</span>
            <div className="seg-group small-seg" role="group" aria-label="Direction of the cut">
              {[[0, 'W–E'], [45, 'SW–NE'], [90, 'S–N'], [135, 'SE–NW']].map(([a, l]) => (
                <button key={a} className={section.angle === a ? 'on' : ''} onClick={() => turnSection(a)} title={`The cut runs ${l}`}>{l}</button>
              ))}
            </div>
            <label className="nowrap" title="Turn the cut">
              Turn <input type="range" min="0" max="179" step="1" value={section.angle} onChange={(e) => turnSection(+e.target.value)} /> {section.angle}°
            </label>
            <label className="nowrap" title="Slide the cut across the model">
              Position <input type="range" min="-350" max="350" step="0.5" value={section.offset} onChange={(e) => setSection((sc) => ({ ...sc, offset: +e.target.value }))} />
              <input type="number" step="0.5" value={section.offset} onChange={(e) => Number.isFinite(+e.target.value) && setSection((sc) => ({ ...sc, offset: Math.max(-700, Math.min(700, +e.target.value)) }))} /> m
            </label>
            <button onClick={() => openSection({ ...section, flip: !section.flip })} title="Look at the cut from the other side">⇄ Other side</button>
            <button onClick={() => openSection(section)} title="Look straight at the cut again">Face the cut</button>
            <button onClick={() => setSection(null)}>Close</button>
          </div>
        )}
        {connect && (
          <div className="connect-bar" role="status">
            <b>{connect.stage === 'grip' ? 'Step 1 of 2' : 'Step 2 of 2'}</b>
            {connect.stage === 'grip'
              ? ' Click the orange point to hold the element by (a corner, edge middle or centre). Choose its bottom, deck or top:'
              : ' Click the blue point where it should go: any garage corner or edge, on the ground or the roof, or a point on another element.'}
            {connect.stage === 'grip' ? (
              <div className="seg-group small-seg" role="group" aria-label="Hold by">
                {[['bottom', 'Bottom'], ...(KINDS[items.find((i) => i.id === connect.id)?.kind]?.deck ? [['deck', 'Deck']] : []), ['top', 'Top']].map(([k, l]) => (
                  <button key={k} className={(connect.level ?? 'bottom') === k ? 'on' : ''} onClick={() => setConnect((c) => ({ ...c, level: k }))}>{l}</button>
                ))}
              </div>
            ) : (
              <label className="check nowrap">
                <input type="checkbox" checked={!!connect.ground} onChange={(e) => setConnect((c) => ({ ...c, ground: e.target.checked }))} /> Ground only
              </label>
            )}
            <button onClick={() => setConnect(null)}>Cancel</button>
          </div>
        )}
        <div className="bar top">
          <div className="seg-group" role="group" aria-label="History">
            <button disabled={!undos} onClick={undo} title="Undo (Ctrl+Z)">↶ Undo</button>
            <button disabled={!redos} onClick={redo} title="Redo (Ctrl+Y)">↷ Redo</button>
          </div>
          <div className="seg-group" role="group" aria-label="Camera">
            <button onClick={() => go('home')} title="3D view in perspective">3D</button>
            <button onClick={() => go('park')} title="The elevated park from the south-east">Park</button>
            <button onClick={() => go('top', {}, true)} title="Top view: a true plan from straight above">Top</button>
            <select
              value=""
              onChange={(e) => e.target.value && go('side', { dir: e.target.value }, true)}
              title="Side view (elevation), seen straight from one side"
              aria-label="Side view"
            >
              <option value="">Side</option>
              {Object.entries(sideName).map(([k, l]) => <option key={k} value={k}>From the {l.toLowerCase()}</option>)}
            </select>
            <button onClick={() => go('iso', {}, true)} title="Isometric view from the south-west">Iso</button>
            <button className={section ? 'on' : ''} onClick={() => openSection()} title="Section: cut through the model and look at the cut">Section</button>
            <button className={ortho ? 'on' : ''} onClick={() => setOrtho(!ortho)} title="Parallel projection (no perspective), for drawings">⟂ Parallel</button>
          </div>
          <div className="pop-wrap">
            <div className="seg-group" role="group" aria-label="Saved views">
              <button className={viewMenu ? 'on' : ''} onClick={() => setViewMenu(!viewMenu)} aria-expanded={viewMenu} title="Save this view, or go back to one you saved">★ Views{views.length ? ` (${views.length})` : ''} ▾</button>
            </div>
            {viewMenu && (
              <div className="label-pop view-pop" role="dialog" aria-label="Saved views">
                <form
                  className="view-save"
                  onSubmit={(e) => {
                    e.preventDefault()
                    saveView(e.target.elements.vname.value)
                    e.target.reset()
                  }}
                >
                  <input name="vname" placeholder={`Name, e.g. “Yard from the lookout”`} aria-label="Name of the view" />
                  <button className="primary" type="submit">Save this view</button>
                </form>
                {views.length === 0 ? (
                  <p className="muted small">No saved views yet. Turn and zoom the model to a view you like, then save it here. It is kept with your plan.</p>
                ) : (
                  <ol className="view-list">
                    {views.map((v, i) => (
                      <li key={v.id}>
                        <button className="view-go" onClick={() => goView(v)} title={`Go to this view${i < 9 ? ` (key ${i + 1})` : ''}`}>
                          <span className="view-key">{i < 9 ? i + 1 : '·'}</span>
                          {renaming === v.id ? (
                            <input
                              className="view-name"
                              autoFocus
                              defaultValue={v.name}
                              aria-label="Name"
                              onFocus={(e) => e.target.select()}
                              onClick={(e) => e.stopPropagation()}
                              onBlur={(e) => {
                                if (e.target.value.trim() && e.target.value !== v.name) changeView(v.id, { name: e.target.value.trim().slice(0, 60) })
                                setRenaming(null)
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === 'Escape') e.target.blur()
                                e.stopPropagation()
                              }}
                            />
                          ) : (
                            <span className="view-name" onDoubleClick={(e) => (e.stopPropagation(), setRenaming(v.id))}>{v.name}</span>
                          )}
                        </button>
                        <button className="cf-btn" title="Rename" onClick={() => setRenaming(v.id)}>✎</button>
                        <button className="cf-btn" title="Save the camera as it is now into this view" onClick={() => {
                          const cam = api.current?.cameraNow()
                          if (cam) {
                            changeView(v.id, cam)
                            setNote(`“${v.name}” now shows this view.`)
                          }
                        }}>⟳</button>
                        <button className="cf-btn" disabled={i === 0} title="Move up" onClick={() => moveView(v.id, -1)}>↑</button>
                        <button className="cf-btn" disabled={i === views.length - 1} title="Move down" onClick={() => moveView(v.id, 1)}>↓</button>
                        <button className="cf-btn danger" title="Delete this view" onClick={() => setPlan((p) => ({ ...p, views: (p.views ?? []).filter((x) => x.id !== v.id) }))}>✕</button>
                      </li>
                    ))}
                  </ol>
                )}
                <p className="muted small">Click a view to go there. ✎ or a double-click renames it. ⟳ saves where you are now into that view. Keys 1–9 jump to the first nine.</p>
              </div>
            )}
          </div>
          <div className="seg-group" role="group" aria-label="Park">
            <button className={parkEdit ? 'on' : ''} onClick={() => { setParkEdit(!parkEdit); setPlacing(null); if (!parkEdit && !park.on) setPark((pk) => ({ ...pk, on: true })) }} title="Show the handles to shape the elevated park">✎ Edit park</button>
            <button className={liftDraw ? 'on' : ''} onClick={() => { setLiftDraw(!liftDraw); setPlacing(null) }} title="Drag over the ground, the plaza or a roof to lay a field of reused 1.20 m GDR plates">▦ Lift plates</button>
          </div>
          <div className="seg-group" role="group" aria-label="Map style">
            <select value={map.style} onChange={(e) => setMapStyle(e.target.value)} title="Map style (change its colours in the Map section)">
              {MAP_STYLE_IDS.map((id) => <option key={id} value={id}>Map: {MAP_STYLES[id].name}</option>)}
            </select>
          </div>
          <div className="seg-group" role="group" aria-label="Picture">
            <button disabled={shooting} onClick={takePicture} title={`Save a picture of this view (${pic.format.toUpperCase()}, ${pic.scale === 1 ? 'screen size' : pic.scale + '× the screen'}); change the settings under Picture in the panel`}>
              {shooting ? 'Saving…' : '📷 Picture'}
            </button>
          </div>
          <div className="pop-wrap">
            <div className="seg-group" role="group" aria-label="Layers">
              <button className={layerMenu ? 'on' : ''} onClick={() => setLayerMenu(!layerMenu)} aria-expanded={layerMenu} title="Put elements on layers, show, hide and lock them">
                Layers{layers.some((l) => !l.on || l.locked) ? ' •' : ''} ▾
              </button>
            </div>
            {layerMenu && (
              <div
                className="label-pop layer-pop"
                role="dialog"
                aria-label="Layers"
                ref={(el) => {
                  // opens under its button, moved left only as far as it must to stay inside the model view
                  if (!el) return
                  el.style.left = '0px'
                  const stage = el.closest('.stage')?.getBoundingClientRect()
                  const r = el.getBoundingClientRect()
                  if (!stage) return
                  const over = Math.min(r.right - (stage.right - 8), r.left - (stage.left + 8))
                  if (over > 0) el.style.left = -over + 'px'
                }}
              >
                <ol className="layer-list">
                  {layers.map((l, i) => {
                    const n = layerCount(l.id)
                    const isCur = l.id === current.id
                    return (
                      <li key={l.id} className={[isCur && 'cur', !l.on && 'hidden'].filter(Boolean).join(' ')}>
                        <button className="layer-name" onClick={() => setCurLayer(l.id)} onDoubleClick={() => renameLayer(l.id)} title={isCur ? 'The current layer: new elements go here' : 'Make this the current layer: new elements go here'}>
                          <span className="layer-radio" aria-hidden>{isCur ? '●' : '○'}</span>
                          <span className="layer-text">{l.name}</span>
                          <small>{n}</small>
                        </button>
                        <button className={'cf-btn' + (l.on ? '' : ' off')} onClick={() => toggleLayer(l.id, 'on')} aria-pressed={l.on} title={l.on ? 'Shown: click to hide this layer' : 'Hidden: click to show this layer'}>{l.on ? '👁' : '⨯'}</button>
                        <button className={'cf-btn' + (l.locked ? ' locked' : '')} onClick={() => toggleLayer(l.id, 'locked')} aria-pressed={l.locked} title={l.locked ? 'Locked: its elements cannot be picked or moved. Click to unlock' : 'Click to lock: its elements cannot be picked or moved'}>{l.locked ? '🔒' : '🔓'}</button>
                        <button className="cf-btn" disabled={!n || !l.on || l.locked} onClick={() => selectLayer(l.id)} title="Select every element on this layer">⬚</button>
                        <button className="cf-btn" disabled={!i} onClick={() => moveLayer(l.id, -1)} title="Move up the list">↑</button>
                        <button className="cf-btn" onClick={() => renameLayer(l.id)} title="Rename">✎</button>
                        <button className="cf-btn" disabled={layers.length < 2} onClick={() => deleteLayer(l.id)} title="Delete the layer (its elements move to the first layer)">✕</button>
                      </li>
                    )
                  })}
                </ol>
                <div className="actions">
                  <button className="primary" onClick={addLayer}>+ New layer</button>
                  <button onClick={() => setAllLayers({ on: true })}>Show all</button>
                  <button onClick={() => setAllLayers({ locked: false })}>Unlock all</button>
                </div>
                <p className="muted small">● is the current layer: new elements go there. 👁 shows or hides a layer, 🔒 locks it so its elements stay put and can't be picked. To move elements to another layer, select them and pick a layer in the panel. Double-click a name to rename it.</p>
              </div>
            )}
          </div>
          <div className="pop-wrap">
            <div className="seg-group" role="group" aria-label="Labels">
              <button className={labelMenu ? 'on' : ''} onClick={() => setLabelMenu(!labelMenu)} aria-expanded={labelMenu}>Labels ▾</button>
            </div>
            {labelMenu && (
              <div className="label-pop" role="dialog" aria-label="Labels">
                {[
                  ['garages', 'Garages', [['titles', 'Titles'], ['numbers', 'Numbers'], ['both', 'Both'], ['off', 'Off']]],
                  ['elements', 'Elements', [[true, 'On'], [false, 'Off']]],
                ].map(([key, name, opts]) => (
                  <div key={key} className="snaprow">
                    <span>{name}</span>
                    <div className="seg-group small-seg" role="group" aria-label={name + ' labels'}>
                      {opts.map(([v, l]) => (
                        <button key={String(v)} className={show[key] === v ? 'on' : ''} onClick={() => setShow((s) => ({ ...s, [key]: v }))}>{l}</button>
                      ))}
                    </div>
                  </div>
                ))}
                <div className="actions">
                  <button onClick={() => setShow({ garages: 'numbers', ribbon: 'numbers', elements: false })}>Only numbers</button>
                  <button onClick={() => setShow({ garages: 'off', ribbon: 'off', elements: false })}>All off</button>
                  <button onClick={() => setShow({ garages: 'titles', ribbon: 'names', elements: true })}>Usual</button>
                </div>
                <p className="muted small">Double-click a label in the model to change its text, or select a garage or element and type it in the panel.</p>
              </div>
            )}
          </div>
        </div>
        <p className="hint">Drag to turn · scroll to zoom · right-drag to move · zoom in to see every title</p>
        {note && <div className="note" role="status">{note}</div>}
      </main>

      <aside className="panel">
        <header>
          <EditableText as="h1" value={heading.title} fallback="Chemnitz Garage Park" onSave={(t) => setPlan((p) => ({ ...p, heading: { ...(p.heading ?? {}), title: t } }))} />
          <EditableText as="p" long value={heading.sub} fallback="Helbersdorf, Haydnstraße / Stollberger Straße. 115 single garages, each 3 m wide, 6 m deep, 3 m tall." onSave={(t) => setPlan((p) => ({ ...p, heading: { ...(p.heading ?? {}), sub: t } }))} />
        </header>

        <div className="body">
          <section className="selection">
            <h2>
              {sel.length || selItems.length
                ? [sel.length && `${sel.length} garage${sel.length > 1 ? 's' : ''}`, selItems.length && `${selItems.length} element${selItems.length > 1 ? 's' : ''}`].filter(Boolean).join(' + ') + ' selected'
                : 'Nothing selected'}
            </h2>
            <p className="muted">
              {sel.length
                ? `${selText}${selBlocks.size ? ` · ${selBlocks.size} locked block${selBlocks.size > 1 ? 's' : ''}` : ''}`
                : selItems.length
                  ? [...new Set(selItems.map((it) => (it.kind === 'rmod' ? `${RIBBON_KINDS[it.rk].name} module` : KINDS[it.kind].name)))].join(', ') + '. Drag it in the model to move it.'
                  : 'Click a garage or its title. Shift-click to add more, or tick the box below.'}
            </p>
            {selItems.length > 0 && !selItems.some((it) => it.kind === 'rmod') && (
              <div className="sizes">
                {[['sw', 'Width', 'w'], ['sd', 'Length', 'd'], ['sh', 'Height', 'h']].map(([key, l, dk]) => (
                  <label key={key}>
                    <span>{l}</span>
                    <input
                      key={`${selItems[0].id}-${dims(selItems[0])[dk]}`}
                      type="number" min="0.1" step="0.1"
                      defaultValue={dims(selItems[0])[dk]}
                      onBlur={(e) => resize(key, e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && resize(key, e.target.value)}
                    />
                    <small>m</small>
                  </label>
                ))}
                <div className="scale-btns">
                  <button onClick={() => scaleBy(0.9)}>−10%</button>
                  <button onClick={() => scaleBy(1.1)}>+10%</button>
                  <button onClick={resetSize}>Normal size</button>
                </div>
              </div>
            )}
            {sel.length > 0 && (() => {
              const own = new Set(withBlocks(sel).map((id) => glabel[id] ?? ''))
              return (
                <label className="field">
                  <span>Label{sel.length > 1 ? ' of all ' + withBlocks(sel).length : ''}</span>
                  <input
                    key={'gl' + sel.join(',') + [...own].join('|')}
                    defaultValue={own.size === 1 ? [...own][0] : ''}
                    placeholder={own.size > 1 ? 'mixed' : title[sel[0]] ? TITLE[title[sel[0]]].name : sel[0]}
                    onBlur={(e) => e.target.value !== e.target.defaultValue && withBlocks(sel).length && setPlan((p) => {
                      const g = { ...(p.glabel ?? {}) }
                      for (const id of withBlocks(sel)) e.target.value.trim() ? (g[id] = e.target.value.trim().slice(0, 60)) : delete g[id]
                      return { ...p, glabel: g }
                    })}
                    onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
                  />
                </label>
              )
            })()}
            {selItems.length > 0 && (
              <label className="field">
                <span>Label{selItems.length > 1 ? ' of all ' + selItems.length : ''}</span>
                <input
                  key={'el' + selItems.map((it) => it.id + (it.label ?? '')).join(',')}
                  defaultValue={selItems.every((it) => (it.label ?? '') === (selItems[0].label ?? '')) ? (selItems[0].label ?? '') : ''}
                  placeholder={selItems[0].title && TITLE[selItems[0].title] ? TITLE[selItems[0].title].name : 'No label'}
                  onBlur={(e) => e.target.value !== e.target.defaultValue && setPlan((p) => ({ ...p, items: p.items.map((it) => (picked.has(it.id) ? (e.target.value.trim() ? { ...it, label: e.target.value.trim().slice(0, 60) } : (({ label, ...rest }) => rest)(it)) : it)) }))}
                  onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
                />
              </label>
            )}
            {selItems.length > 0 && (
              <ColourField
                label={selItems.length > 1 ? 'Colour of all ' + selItems.length : 'Colour'}
                value={colourOf(selItems[0])}
                changed={selItems.some((it) => it.col)}
                onChange={setItemColour}
                onReset={() => setItemColour(null)}
              />
            )}
            {selItems.length > 0 && (() => {
              const on = new Set(selItems.map(layerOf))
              return (
                <label className="field">
                  <span>Layer{selItems.length > 1 ? ' of all ' + selItems.length : ''}</span>
                  <select
                    value={on.size === 1 ? [...on][0] : ''}
                    onChange={(e) => {
                      const id = e.target.value
                      if (!id) return
                      changeItems((it) => ({ ...it, layer: id }))
                      const l = layerById[id]
                      if (!l.on || l.locked) {
                        setPicked(new Set(sel))
                        setNote(`Moved to "${l.name}", which is ${!l.on ? 'hidden' : 'locked'}.`)
                      }
                    }}
                  >
                    {on.size > 1 && <option value="">Several layers</option>}
                    {layers.map((l) => (
                      <option key={l.id} value={l.id}>{l.name}{!l.on ? ' (hidden)' : l.locked ? ' (locked)' : ''}</option>
                    ))}
                  </select>
                </label>
              )
            })()}
            {selItems.length > 0 && (
              <div className="actions element-actions">
                <button className="primary" disabled={selItems.length !== 1} onClick={startConnect} title="Hold the element by one point and put it on another (key C)">
                  Connect a point
                </button>
                <button onClick={() => rotate(90)}>Turn 90°</button>
                <button onClick={() => rotate(15)}>Turn 15°</button>
                <button onClick={duplicate}>Copy</button>
                <button onClick={() => changeItems((it) => ({ ...it, z: 0 }))}>To ground</button>
                {selItems.every((it) => it.kind === 'stall' || it.kind === 'stallopen') && (
                  <button onClick={() => { const shade = !selItems.every((it) => it.kind === 'stall'); changeItems((it) => (({ col, ...r }) => ({ ...r, kind: shade ? 'stall' : 'stallopen' }))(it)) }} title="Give the stall its own shade roof, or take it off">
                    {selItems.every((it) => it.kind === 'stall') ? 'Shade off' : 'Shade on'}
                  </button>
                )}
                <button className="danger" onClick={removeItems}>Delete</button>
              </div>
            )}
            <label className="check">
              <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} /> Add to selection on each click
            </label>
            {sel.length > 0 && (() => {
              const ids = withBlocks(sel)
              const modes = new Set(ids.map((id) => plan.roofs?.[id] ?? 'closed'))
              const one = modes.size === 1 ? [...modes][0] : null
              return (
                <div className="snaprow">
                  <span>Roof{ids.length > 1 ? ` of all ${ids.length}` : ''}</span>
                  <div className="seg-group small-seg" role="group" aria-label="Roof">
                    {ROOF_MODES.map(([k, l]) => (
                      <button
                        key={k}
                        className={one === k ? 'on' : ''}
                        title={k === 'tilt' ? 'The roof plate hinged up on a light steel frame, for light and air' : k === 'frame' ? 'Roof plate off, the steel frame stays' : k === 'open' ? 'Roof off: open to the sky' : 'The usual closed roof'}
                        onClick={() => setPlan((p) => { const r = { ...(p.roofs ?? {}) }; for (const id of ids) k === 'closed' ? delete r[id] : (r[id] = k); return { ...p, roofs: r } })}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
              )
            })()}
            <div className="actions">
              <button className="primary" disabled={withBlocks(sel).length < 2 || (selBlocks.size === 1 && sel.every((id) => block[id]))} onClick={lock}>
                Lock together
              </button>
              <button disabled={!selBlocks.size} onClick={unlock}>Unlock</button>
              <button disabled={!sel.length && !selItems.length} onClick={() => setPicked(new Set())}>Deselect</button>
            </div>
          </section>

          <section className="park-panel">
            <h2><span className="dot" style={{ background: '#9aa3a8' }} /> Building heights</h2>
            <p className="muted">Click a building in the model to pick it, then lower it in steps of 1.20 m (one plate) with ↓, or the buttons. ↑ raises it again, up to its real height. The park and lifted roofs on it follow its roof.</p>
            {bSel != null && site?.buildings[bSel] && (() => {
              const real = site.buildings[bSel].h
              const n = bcut[bSel] ?? 0
              const now = Math.max(0.6, real - n * LEVEL)
              return (
                <div className="park-sel">
                  <b>Picked building</b> <span className="muted small">real height {real.toFixed(1)} m (about {Math.max(1, Math.round((real - 1) / 3))} floors)</span>
                  <p className="park-stats">
                    <span>now <b>{now.toFixed(2)}</b> m</span>
                    {n > 0 && <span><b>{(n * LEVEL).toFixed(2)}</b> m lower ({n} × 1.20 m)</span>}
                  </p>
                  <div className="actions">
                    <button className="primary" disabled={n >= maxCut(bSel)} onClick={() => cutBuilding(bSel, 1)}>− 1.20 m</button>
                    <button disabled={!n} onClick={() => cutBuilding(bSel, -1)}>+ 1.20 m</button>
                    <button disabled={!n} onClick={() => cutBuilding(bSel, -n)}>Real height</button>
                  </div>
                </div>
              )
            })()}
            <div className="actions">
              <span className="muted small">{Object.keys(bcut).length} building{Object.keys(bcut).length === 1 ? '' : 's'} lowered</span>
              <button disabled={!Object.keys(bcut).length} onClick={() => setPlan((p) => ({ ...p, bcut: {} }))}>All back to real height</button>
            </div>
          </section>

          <section className="park-panel">
            <h2><span className="dot" style={{ background: '#3a7bd5' }} /> City plaza</h2>
            <p className="muted">Stollberger Straße between the slabs and the garages becomes the main plaza: shops on the ground floor of the slabs, an open market, and the street kept only as shared lanes beside the tram, at walking speed, pedestrians first.</p>
            <div className="snaprow">
              <label className="check">
                <input type="checkbox" checked={plaza.on} onChange={(e) => setPlaza((pl) => ({ ...pl, on: e.target.checked }))} /> Show the plaza
              </label>
              <button onClick={() => go('plaza')}>Look at it</button>
            </div>
            {plaza.on && (
              <>
                <div className="actions">
                  <button className={plazaEdit ? 'primary on' : 'primary'} onClick={() => setPlazaEdit(!plazaEdit)}>{plazaEdit ? '✓ Done' : '✎ Shape the plaza edge'}</button>
                  <button onClick={() => setPlaza(() => DEFAULT_PLAZA)} title="Back to the first plaza (Undo brings yours back)">Start again</button>
                </div>
                {plazaEdit && <p className="muted small">Drag the <b>blue squares</b> to move the plaza edge; click a <b>grey diamond</b> to add a corner; Shift-click a square to take it out.</p>}
                {plazaBuilt && (
                  <p className="park-stats">
                    <span><b>{Math.round(plazaBuilt.stats.area).toLocaleString('en')}</b> m² of plaza</span>
                    {plaza.lane && <span><b>{Math.round(plazaBuilt.stats.lane)}</b> m of shared lanes</span>}
                  </p>
                )}
                <label className="check">
                  <input type="checkbox" checked={plaza.lane} onChange={(e) => setPlaza((pl) => ({ ...pl, lane: e.target.checked }))} /> Shared lanes for cars (off: only trams, bikes and people)
                </label>
                {plaza.lane && <ParkVal label="Lane width" value={plaza.laneWidth} min={2.5} max={7} step={0.25} unit="m" onChange={(v) => setPlaza((pl) => ({ ...pl, laneWidth: v }), 'plaza-lane')} />}
                <label className="check">
                  <input type="checkbox" checked={plaza.commerce} onChange={(e) => setPlaza((pl) => ({ ...pl, commerce: e.target.checked }))} /> Shops on the ground floor of the two slabs
                </label>
                <h3>Paving</h3>
                <MaterialPicker
                  look={{ mat: plaza.mat, colour: plaza.col ?? MATERIALS[plaza.mat].colour }}
                  own={{}}
                  onMat={(m) => m && setPlaza(({ col, ...pl }) => ({ ...pl, mat: m }))}
                  onCol={(c) => setPlaza(({ col, ...pl }) => (c ? { ...pl, col: c } : pl), 'plaza-col')}
                />
                <p className="muted small">The market stalls, trees, parasols and signs are elements on the layers “Plaza market and furniture” and “Market under the park”: move, copy or delete them like any element, or hide and lock a whole layer in the Layers menu.</p>
              </>
            )}
          </section>

          <section className="park-panel">
            <h2><span className="dot" style={{ background: '#b9b4a9' }} /> Lifted roofs and areas</h2>
            <p className="muted">Everything is built from reused GDR prefab plates on one 1.20 × 1.20 m grid: the park deck, and fields of loose plates lifted off the roofs or over the ground on thin steel supports.</p>
            <p className="park-stats">
              <span><b>{lifts.length}</b> field{lifts.length === 1 ? '' : 's'}</span>
              <span><b>{liftPlates.toLocaleString('en')}</b> lifted plates</span>
              {park.on && parkBuilt && <span><b>{Math.ceil(parkBuilt.stats.area / (PLATE * PLATE)).toLocaleString('en')}</b> plates in the park deck</span>}
              <span>= <b>{Math.round((liftPlates + (park.on && parkBuilt ? Math.ceil(parkBuilt.stats.area / (PLATE * PLATE)) : 0)) * PLATE * PLATE).toLocaleString('en')}</b> m² reused</span>
            </p>
            <div className="actions">
              <button className={liftDraw ? 'primary on' : 'primary'} onClick={() => { setLiftDraw(!liftDraw); setPlacing(null) }}>{liftDraw ? '✓ Done drawing' : '▦ Draw a field of plates'}</button>
              <button onClick={() => { setLifts(() => DEFAULT_LIFTS); setLiftSel(null) }} title="Back to the first three fields (Undo brings yours back)">Start again</button>
            </div>
            {lifts.length > 0 && (
              <ol className="lift-list">
                {lifts.map((l, k) => (
                  <li key={l.id}>
                    <button className={liftSel === l.id ? 'on' : ''} onClick={() => setLiftSel(liftSel === l.id ? null : l.id)}>
                      <b>Field {k + 1}</b> {l.nu} × {l.nv}{l.grid ? ' timber grid' : ''} · {l.h.toFixed(2)} m {liftsBuilt?.info[l.id]?.onRoof ? 'above the roof' : l.roof ? 'up (no roof below)' : 'above the ground'}
                    </button>
                  </li>
                ))}
              </ol>
            )}
            {liftSel && (() => {
              const l = lifts.find((x) => x.id === liftSel)
              if (!l) return null
              const setL = (patch, key) => setLifts((ls) => ls.map((x) => (x.id === l.id ? { ...x, ...patch } : x)), key)
              return (
                <div className="park-sel">
                  <b>Field {lifts.indexOf(l) + 1}</b> <span className="muted small">{liftsBuilt?.info[l.id]?.plates ?? l.nu * l.nv} plates, {(l.nu * PLATE).toFixed(2)} × {(l.nv * PLATE).toFixed(2)} m · ↑ / ↓ lift it, Delete removes it</span>
                  <label className="check">
                    <input type="checkbox" checked={l.roof} onChange={(e) => setL({ roof: e.target.checked })} /> Lifted roof: stands on the roof below its middle
                  </label>
                  <ParkVal label={l.roof ? 'Above the roof' : 'Above the ground'} value={l.h} min={0} max={30} step={0.1} unit="m" onChange={(v) => setL({ h: v }, 'lift-h:' + l.id)} />
                  <ParkVal label="Plates along" value={l.nu} min={1} max={80} step={1} onChange={(v) => setL({ nu: Math.round(v) }, 'lift-nu:' + l.id)} />
                  <ParkVal label="Plates across" value={l.nv} min={1} max={80} step={1} onChange={(v) => setL({ nv: Math.round(v) }, 'lift-nv:' + l.id)} />
                  <ParkVal label="Tilt along" value={l.tiltU} min={-30} max={30} step={1} unit="°" onChange={(v) => setL({ tiltU: v }, 'lift-tu:' + l.id)} />
                  <ParkVal label="Tilt across" value={l.tiltV} min={-30} max={30} step={1} unit="°" onChange={(v) => setL({ tiltV: v }, 'lift-tv:' + l.id)} />
                  <label className="check">
                    <input type="checkbox" checked={l.grid} onChange={(e) => setL({ grid: e.target.checked })} /> Timber grid frame: beams on every 1.20 m joint
                  </label>
                  {l.grid ? (
                    <ParkVal label="Posts every" value={l.postEvery} min={1} max={10} step={1} unit="plates" onChange={(v) => setL({ postEvery: Math.round(v) }, 'lift-pe:' + l.id)} />
                  ) : (
                    <label className="check">
                      <input type="checkbox" checked={l.supports} onChange={(e) => setL({ supports: e.target.checked })} /> Steel supports (every 6 plates, 7.20 m)
                    </label>
                  )}
                  <div className="snaprow">
                    <span>Open bays</span>
                    <div className="seg-group small-seg" role="group" aria-label="Open bays">
                      {[['none', 'None'], ['stripes', 'Stripes'], ['checker', 'Checker'], ['scatter', 'Scattered']].map(([k, t]) => (
                        <button key={k} className={l.gaps === k ? 'on' : ''} onClick={() => setL({ gaps: k })}>{t}</button>
                      ))}
                    </div>
                  </div>
                  <div className="actions">
                    <button onClick={() => { const id = newParkId('L'); setLifts((ls) => [...ls, { ...l, id, i0: l.i0 + l.nu + 1 }]); setLiftSel(id) }}>Copy next to it</button>
                    <button className="danger" onClick={() => { setLifts((ls) => ls.filter((x) => x.id !== l.id)); setLiftSel(null) }}>Delete field</button>
                  </div>
                </div>
              )
            })()}
            <p className="muted small">The plate grid turns with the park's mesh direction (Elevated park section), so plates, deck joints and columns always line up.</p>
            <h3>Opened garage roofs</h3>
            <p className="muted small">Select garages (or a whole row) and choose their roof in the selection panel: Tilted open, Frame only, or Removed, to let light and air in.</p>
            <p className="park-stats">
              {ROOF_MODES.slice(1).map(([k, l]) => <span key={k}><b>{Object.values(plan.roofs ?? {}).filter((m) => m === k).length}</b> {l.toLowerCase()}</span>)}
            </p>
            <ColourField label="Frames and tilted plates" value={plan.roofColour ?? '#c0392b'} changed={(plan.roofColour ?? '#c0392b') !== '#c0392b'} onChange={(c) => setPlan((p) => ({ ...p, roofColour: c }), 'roofcol')} onReset={() => setPlan((p) => ({ ...p, roofColour: '#c0392b' }))} />
            <div className="actions">
              <button disabled={!Object.keys(plan.roofs ?? {}).length} onClick={() => setPlan((p) => ({ ...p, roofs: {} }))}>Close all roofs</button>
              <button onClick={() => setPlan((p) => ({ ...p, roofs: DEFAULT_ROOFS }))}>Start again</button>
            </div>
          </section>

          <section className="park-panel">
            <h2><span className="dot" style={{ background: '#8fb573' }} /> Elevated park</h2>
            <p className="muted">One free-form deck: a roof between the two slabs on Richard-Wagner-Straße (with a covered market below), a raised walk over Stollberger Straße, and ways down onto the garage roofs and into the garage yard.</p>
            <div className="snaprow">
              <label className="check">
                <input type="checkbox" checked={park.on} onChange={(e) => setPark((pk) => ({ ...pk, on: e.target.checked }))} /> Show the park
              </label>
              <button onClick={() => go('park')}>Look at it</button>
            </div>
            {park.on && (
              <>
                <div className="actions">
                  <button className={parkEdit ? 'primary on' : 'primary'} onClick={() => { setParkEdit(!parkEdit); setPlacing(null) }}>{parkEdit ? '✓ Done shaping' : '✎ Shape the park'}</button>
                  <button onClick={() => { setPark(() => DEFAULT_PARK); setParkSel(null) }} title="Back to the first design (Undo brings yours back)">Start again</button>
                </div>
                {parkEdit && (
                  <div className="park-edit">
                    <p className="muted small">
                      Drag the <b>white squares</b> to move the edge; click a <b>grey diamond</b> to add an edge point. Drag a <b>ball</b> to move a height point (purple: it sits on a roof). Drag a <b>green dot</b> to move an opening. Shift-click any of them, or select it and press Delete, to take it out.
                    </p>
                    <p className="muted small">
                      <b>↑ / ↓</b> raise or lower the selected height point by 10 cm (with Shift: 1 m). With nothing selected they move the whole deck; points on roofs stay on the roofs. The buildings keep their real heights.
                    </p>
                    <div className="actions">
                      <button className={placing === 'h' ? 'on' : ''} onClick={() => setPlacing(placing === 'h' ? null : 'h')}>+ Height point</button>
                      <button className={placing === 't' ? 'on' : ''} onClick={() => setPlacing(placing === 't' ? null : 't')}>+ Opening with tree</button>
                      <button className={placing === 'o' ? 'on' : ''} onClick={() => setPlacing(placing === 'o' ? null : 'o')}>+ Light well</button>
                    </div>
                    {parkSel?.t === 'h' && (() => {
                      const q = park.heights.find((x) => x.id === parkSel.id)
                      if (!q) return null
                      const L = parkBuilt?.levels.find((x) => x.id === q.id)
                      const roofHere = roofAt(q.x, q.y, parkBuildings) != null
                      const setQ = (patch, key) => setPark((pk) => ({ ...pk, heights: pk.heights.map((x) => (x.id === q.id ? { ...x, ...patch } : x)) }), key)
                      return (
                        <div className="park-sel">
                          <b>Height point</b>
                          <span className="muted small"> deck {L ? (L.H - ground(q.x, q.y)).toFixed(1) : '?'} m above the ground here</span>
                          <label className="check">
                            <input
                              type="checkbox"
                              checked={!!q.roof}
                              disabled={!roofHere && !q.roof}
                              onChange={(e) => setQ(e.target.checked ? { roof: true, h: 0.4 } : { roof: false, h: L ? Math.round((L.H - ground(q.x, q.y)) * 10) / 10 : q.h })}
                            />
                            Sit on the roof below{roofHere ? '' : ' (no roof here)'}
                          </label>
                          <ParkVal label={q.roof ? 'Gap above the roof' : 'Height above the ground'} value={q.h} min={q.roof ? 0 : 0} max={q.roof ? 6 : 40} step={0.1} unit="m" onChange={(v) => setQ({ h: v }, 'park-h:' + q.id)} />
                          <div className="actions">
                            <button className="danger" disabled={park.heights.length < 2} onClick={() => selectPark(parkSel, true)}>Delete this point</button>
                          </div>
                        </div>
                      )
                    })()}
                    {parkSel?.t === 'o' && (() => {
                      const q = park.holes.find((x) => x.id === parkSel.id)
                      if (!q) return null
                      const setQ = (patch, key) => setPark((pk) => ({ ...pk, holes: pk.holes.map((x) => (x.id === q.id ? { ...x, ...patch } : x)) }), key)
                      return (
                        <div className="park-sel">
                          <b>Opening</b>
                          {parkBuilt?.skipped.some((x) => x.id === q.id) && <span className="warn small"> doesn't fit: it must be inside the deck and not touch the edge or another opening</span>}
                          <ParkVal label="Radius" value={q.r} min={0.5} max={12} step={0.1} unit="m" onChange={(v) => setQ({ r: v }, 'park-r:' + q.id)} />
                          <label className="check">
                            <input type="checkbox" checked={q.tree} onChange={(e) => setQ({ tree: e.target.checked })} /> A tree grows up through it
                          </label>
                          <div className="actions">
                            <button className="danger" onClick={() => selectPark(parkSel, true)}>Delete this opening</button>
                          </div>
                        </div>
                      )
                    })()}
                    {parkSel?.t === 'p' && park.outline[parkSel.id] && (
                      <div className="park-sel">
                        <b>Edge point {parkSel.id + 1}</b> <span className="muted small">of {park.outline.length}</span>
                        <div className="actions">
                          <button className="danger" disabled={park.outline.length <= 3} onClick={() => selectPark(parkSel, true)}>Delete this point</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {parkBuilt && (
                  <p className="park-stats">
                    <span><b>{Math.round(parkBuilt.stats.area).toLocaleString('en')}</b> m² of deck</span>
                    <span>highest <b>{parkBuilt.stats.high.toFixed(1)}</b> m above the ground</span>
                    <span>steepest <b>{parkBuilt.stats.maxSlope.toFixed(0)}</b> %</span>
                    <span><b>{parkBuilt.stats.columns}</b> columns</span>
                    {parkBuilt.skipped.length > 0 && <span className="warn">{parkBuilt.skipped.length} opening{parkBuilt.skipped.length > 1 ? 's' : ''} left out (doesn't fit)</span>}
                  </p>
                )}
                <ParkVal label="Smoothness" title="Higher: flatter plateaus around each height point, steeper ramps between them" value={park.smooth} min={1} max={6} step={0.5} onChange={(v) => setPark((pk) => ({ ...pk, smooth: v }), 'park-smooth')} />
                <ParkVal label="Deck thickness" value={park.thick} min={0.15} max={2} step={0.05} unit="m" onChange={(v) => setPark((pk) => ({ ...pk, thick: v }), 'park-thick')} />
                <ParkVal label="Plate joints every" value={park.net} min={0} max={10} step={0.5} unit="m" title="0 = no mesh lines" onChange={(v) => setPark((pk) => ({ ...pk, net: v }), 'park-net')} />
                <ParkVal label="Plate grid direction" value={park.netAngle} min={-90} max={90} step={1} unit="°" onChange={(v) => setPark((pk) => ({ ...pk, netAngle: v }), 'park-angle')} />
                <ParkVal label="Columns every" value={park.columns} min={0} max={20} step={0.5} unit="m" title="0 = no columns" onChange={(v) => setPark((pk) => ({ ...pk, columns: v }), 'park-cols')} />
                <ParkVal label="Surface detail" value={park.cell} min={0.75} max={4} step={0.25} unit="m" title="Smaller = a finer, smoother surface (slower)" onChange={(v) => setPark((pk) => ({ ...pk, cell: v }), 'park-cell')} />
                <label className="check">
                  <input type="checkbox" checked={park.rail} onChange={(e) => setPark((pk) => ({ ...pk, rail: e.target.checked }))} /> Glass railings where the deck is more than 1 m up
                </label>
                <label className="check">
                  <input type="checkbox" checked={park.slope} onChange={(e) => setPark((pk) => ({ ...pk, slope: e.target.checked }))} /> Slope colours
                </label>
                {park.slope && (
                  <p className="slope-key small">
                    <span style={{ '--c': '#5aa55a' }}>under 5 %: walk</span>
                    <span style={{ '--c': '#e3c33b' }}>under 8.3 %: ramp</span>
                    <span style={{ '--c': '#e88a2e' }}>under 12 %: steep ramp</span>
                    <span style={{ '--c': '#d23b2f' }}>steeper: steps</span>
                  </p>
                )}
                <h3>Surface</h3>
                <MaterialPicker
                  look={{ mat: park.mat, colour: park.col ?? MATERIALS[park.mat].colour }}
                  own={{}}
                  onMat={(m) => m && setPark(({ col, ...pk }) => ({ ...pk, mat: m }))}
                  onCol={(c) => setPark(({ col, ...pk }) => (c ? { ...pk, col: c } : pk), 'park-col')}
                />
              </>
            )}
          </section>

          <section>
            <h2>Title</h2>
            {!canTitle && selItems.length > 0 && <p className="muted">Only garages and added garage or half blocks take a title.</p>}
            <div className="titles">
              {TITLES.map((t) => (
                <button key={t.id} disabled={!canTitle} className={shared === t.id ? 'on' : ''} onClick={() => setTitle(t.id)}>
                  <span className="dot" style={{ background: t.color }} />
                  {t.name}
                </button>
              ))}
              <button disabled={!canTitle} className="none" onClick={() => setTitle(null)}>No title</button>
            </div>
          </section>

          <section>
            <h2>Add elements</h2>
            <p className="muted">Drag one onto the model, or click it to drop it in the middle of the view. Drop onto a roof to stack. Add as many as you like.</p>
            <p className="muted small">New elements go on the layer <b>{current.name}</b>. Change it under Layers in the top bar.</p>
            {ELEMENT_GROUPS.map(([group, kinds]) => (
            <div key={group} className="kind-group">
            <h3>{group}</h3>
            <div className="palette">
              {kinds.map((k) => (
                <button
                  key={k}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/kind', k)
                    e.dataTransfer.effectAllowed = 'copy'
                  }}
                  onClick={() => addMiddle(k)}
                  title={`${KINDS[k].name}, ${KINDS[k].size} m`}
                >
                  <span className="pname">{KINDS[k].name}</span>
                  <small>{KINDS[k].size} m</small>
                </button>
              ))}
            </div>
            </div>
            ))}
            <p className="muted small">Select an element to give it your own colour.</p>
            <div className="snaprow">
              <span>Snap when dragging</span>
              <div className="seg-group small-seg" role="group" aria-label="Snap">
                {[['grid', 'Grid 1.5 m'], ['points', 'Points'], ['off', 'Off']].map(([k, l]) => (
                  <button key={k} className={snap === k ? 'on' : ''} onClick={() => setSnap(k)}>{l}</button>
                ))}
              </div>
            </div>
            <p className="muted small">Points: corners and edges pull onto nearby garage corners and edges, or onto other elements.</p>
            <p className="muted small">{items.length} element{items.length === 1 ? '' : 's'} added. Keys: R turn 90° · Shift+R turn back 15° · Delete removes.</p>
          </section>

          <section>
            <h2>Select a whole row</h2>
            <div className="rowchips">
              {ROW_IDS.map((r) => {
                const ids = ALL.filter((id) => BY_ID[id].row === r)
                return (
                  <button key={r} onClick={(e) => {
                    const all = withBlocks(ids)
                    setPicked((old) => (e.shiftKey || multi ? new Set([...old, ...all]) : new Set(all)))
                  }}>
                    {r} <small>{ids.length}</small>
                  </button>
                )
              })}
            </div>
          </section>

          <section>
            <h2>Summary</h2>
            <p className="muted">{assigned} of 115 garages have a title · {blockCount} locked block{blockCount === 1 ? '' : 's'}. Click a line to select those garages.</p>
            <table className="summary">
              <thead><tr><th>Title</th><th>Garages</th><th>Pieces</th></tr></thead>
              <tbody>
                {summary.map((t) => (
                  <tr key={t.id} className={t.garages ? '' : 'zero'} onClick={() => t.garages && setPicked(new Set(ALL.filter((id) => title[id] === t.id)))}>
                    <td><span className="dot" style={{ background: t.color }} />{t.name}</td>
                    <td>{t.garages}</td>
                    <td>{t.blocks.size}</td>
                  </tr>
                ))}
                <tr className="zero"><td><span className="dot empty" />No title yet</td><td>{115 - assigned}</td><td></td></tr>
              </tbody>
            </table>
          </section>

          <section>
            <h2>Map</h2>
            <p className="muted">How the base map looks. Titled garages keep their title colours and the ribbon stays cobalt. The Rhino download and pictures use these colours too.</p>
            <div className="titles map-styles">
              {MAP_STYLE_IDS.map((id) => (
                <button key={id} className={map.style === id ? 'on' : ''} onClick={() => setMapStyle(id)} title={MAP_STYLES[id].note}>
                  <span className="dot" style={{ background: 'linear-gradient(135deg, ' + MAP_STYLES[id].green + ' 0 33%, ' + MAP_STYLES[id].ground + ' 33% 66%, ' + MAP_STYLES[id].home + ' 66%)', border: '1px solid rgba(0,0,0,.25)' }} />
                  {MAP_STYLES[id].name}
                </button>
              ))}
            </div>
            <p className="muted small">{MAP_STYLES[map.style].note}</p>
            <div className="snaprow">
              <span>Ground</span>
              <div className="seg-group small-seg" role="group" aria-label="Ground">
                {TOPO_MODES.map(([k, l]) => (
                  <button key={k} disabled={!terrainReady && k !== 'flat'} className={topo === k ? 'on' : ''} onClick={() => setMapTopo(k)}>{l}</button>
                ))}
              </div>
            </div>
            <p className="muted small">
              {terrainReady
                ? 'The real topography of Helbersdorf: about 300–360 m above sea level, the garage site at 334.5 m, sloping about 6 m from west to east. Garages, buildings, the ribbon and elements sit on the ground; ×2 makes the slope twice as steep to read it better.'
                : 'Loading the ground heights…'}
            </p>
            <h3 className="sub">Colours of {MAP_STYLES[map.style].name}</h3>
            <p className="muted small">Click a swatch for the colour picker, type a code (#0047AB or true colour 0,71,171), open the palette, or pick a colour from the screen. Each style keeps its own changes.</p>
            {MAP_LAYERS.map(([k, label]) => (
              <ColourField key={map.style + k} label={label} value={look[k]} changed={!!own[k]} onChange={(c) => setMapColour(k, c)} onReset={() => setMapColour(k, null)} />
            ))}
            <div className="actions">
              <button disabled={!Object.keys(own).length} onClick={resetMapColours}>Reset the colours of {MAP_STYLES[map.style].name}</button>
            </div>
          </section>

          <section>
            <h2>Picture</h2>
            <p className="muted">Save a high-quality picture of the 3D view exactly as you see it. Turn and zoom the view first; the selection highlight is left out.</p>
            <div className="snaprow">
              <span>Format</span>
              <div className="seg-group small-seg" role="group" aria-label="Picture format">
                {[['png', 'PNG'], ['jpg', 'JPG']].map(([k, l]) => (
                  <button key={k} className={pic.format === k ? 'on' : ''} onClick={() => setPic((p) => ({ ...p, format: k }))}>{l}</button>
                ))}
              </div>
            </div>
            <div className="snaprow">
              <span>Size</span>
              <div className="seg-group small-seg" role="group" aria-label="Picture size">
                {[[1, 'Screen'], [2, '2×'], [3, '3×'], [4, '4×']].map(([k, l]) => (
                  <button key={k} className={pic.scale === k ? 'on' : ''} onClick={() => setPic((p) => ({ ...p, scale: k }))}>{l}</button>
                ))}
              </div>
            </div>
            <label className="check">
              <input type="checkbox" checked={pic.labels && anyLabels} disabled={!anyLabels} onChange={(e) => setPic((p) => ({ ...p, labels: e.target.checked }))} />
              {!anyLabels ? 'Labels are off (turn them on under Labels at the top)' : 'Include the labels'}
            </label>
            <div className="actions">
              <button className="primary" disabled={shooting} onClick={takePicture}>
                {shooting ? 'Making the picture…' : `Save picture (${pic.format.toUpperCase()}${api.current?.pictureSize ? `, ${api.current.pictureSize(pic.scale).join(' × ')} px` : ''})`}
              </button>
            </div>
            <p className="muted small">PNG keeps every pixel sharp (best for drawings and printing); JPG makes a smaller file (best for sending).</p>
          </section>

          <section>
            <h2>Save</h2>
            <p className="muted">Your plan saves itself in this browser. To keep it or send it on, download it.</p>
            <div className="actions">
              <button onClick={() => download('chemnitz-garage-plan.json', JSON.stringify(plan, null, 1), 'application/json')}>Download plan</button>
              <button onClick={() => file.current.click()}>Open plan…</button>
              <button onClick={exportCsv}>Download list (CSV)</button>
              <button className="primary" disabled={saving} onClick={exportRhino}>{saving ? 'Preparing the Rhino file…' : 'Download Rhino 8 model (.3dm)'}</button>
              <button className="danger" onClick={reset}>Start over</button>
              <input ref={file} type="file" accept=".json,application/json" hidden onChange={loadFile} />
            </div>
            <p className="muted small">Keys: Ctrl+Z undo · Ctrl+Y redo · L lock · U unlock · Esc deselect</p>
          </section>
        </div>
        <footer>Map data © OpenStreetMap contributors (ODbL). Heights: EU-DEM / SRTM via AWS Terrain Tiles.</footer>
      </aside>
    </div>
  )
}
