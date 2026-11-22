# Project guidelines

I study architecture or design and don't write code. Explain each step in a sentence or two of plain words. After a change, say which files you changed and what I should check on the page.

## Stack

Vite, React in JavaScript, npm. Three.js / React Three Fiber for 3D. Don't add TypeScript or switch frameworks.

## Hosting

GitHub Pages publishes every push to `main` at `https://<user>.github.io/<repo>/`, through the workflow in `.github/workflows/`. Load every data file through `import.meta.env.BASE_URL`.

## This copy: the Garage Park

A copy of `garage-blocks` (published separately as `chemnitz-garage-park`, plan kept in the browser under `chemnitz-garage-park-v1`). Here the ribbon is always off and the magic wand, ribbon panels and garage modules are gone; in their place:

- **Elevated park** (`src/park.js`, `src/Park.jsx`, `plan.park`): one free-form deck from roof level between the two slabs on Richard-Wagner-Straße (site buildings 183 and 184), over the city plaza, down onto the garage roofs and into the garage yard. Its edge is a smooth curve through `outline`; its height comes from `heights` (metres above the ground, or `roof: true` = on the roof below plus `h`), blended by inverse-distance weighting (`smooth` = power). `holes` are round openings, with a tree when `tree`. `buildPark` triangulates, refines to `cell`, and makes the top (material, or slope colours), underside, glass railings (> 1 m up), the draped net lines (`net`, `netAngle`) and thin columns (`columns` spacing; none where a roof or garage is below). ✎ Edit park shows handles: white squares = edge, grey diamonds add an edge point, balls = height points (purple on a roof), green = openings; Shift-click or Delete removes.
- **City plaza** (`src/plaza.js`, `src/Plaza.jsx`, `plan.plaza`): Stollberger Straße between the slabs and the garages paved as one plaza (straight `outline`, editable), the street only as shared lanes in setts beside the tram (`lane`, `laneWidth`), tram rails set in the paving, glass shop fronts on the ground floor of slabs 183/184 (`commerce`).
- Default elements: market stalls under the park (layer "Market under the park") and on the plaza with trees, parasols, tables and shared-space signs (layer "Plaza market and furniture"). New kinds `stall` (with its own shade roof), `stallopen` (no shade; the "Shade on / off" button in the selection panel switches selected stalls) and `kiosk`; new materials `grass`, `granite` (slabs) and `setts`.
- Views: **Park** and the plaza's "Look at it" (`park`, `plaza` in `src/Views.jsx`).

## What this is

All 115 garages of complex G3, Helbersdorf, Chemnitz (Haydnstraße / Stollberger Straße), each 3 × 6 × 3 m. Each garage gets a title; garages can be locked together into blocks. Titles and colours are in `src/titles.js`. The elements you can drag in (blocks, shade, trees, cars …) are in `src/elements.js`. Garage positions are in `src/geometry.js`. Site data is in `public/data/` — read `SOURCES.md` there first.

The cobalt ribbon (route, piece kinds, starting layout, street positions) is in `src/ribbon.js`; it is drawn by `src/Ribbon.jsx`. If you change `ROUTE`, re-measure where it crosses streets and update `STREETS` and the CROSSING pieces.

Garages the ribbon passes through are found automatically from `ROUTE` (`passages()` in `src/ribbon.js`) and drawn as cleared shells (roof see-through, inside walls removed) in `src/Scene.jsx`.

Download Rhino 8 model (Save section): `src/export3dm.js` turns the three.js scene into a .3dm with rhino3dm (loaded only on click). Meshes go on layers named by `userData.layer`; `userData.noExport` leaves helpers out.

Undo / redo: every plan change goes through `setPlan` in `src/App.jsx` (`useHistory`, 100 steps); a drag counts as one step. Detach turns a ribbon piece into a single blue module (an element of kind `rmod`, with `rk`, `len`, `flip`, `bw`) and leaves a `gap` piece; the ribbon is not drawn over gaps. Reattach puts a module into the nearest gap, or carves it into the nearest path. Single modules are added from the Ribbon section and drawn by `Module` in `src/Elements.jsx`.

Sizes: a ribbon piece or module can carry its own width `w` and top height `h` (`pieceShape`, `pieceWidth`, `cleanSize` in `src/ribbon.js`); without them it keeps its usual size, so the starting ribbon stays exactly the same. Kinds with a `height` (ONE-WAY STAIRS, the three WALL kinds) draw themselves at that height; the others are stretched. Several pieces can be picked at once (Shift-click; `chosenList` in `src/App.jsx`).

Picture (top bar and Picture section): `capture()` in `ViewApi` (`src/Elements.jsx`) draws the view again at 1–4x the screen size and copies the HTML labels onto it; `takePicture` in `src/App.jsx` hides the selection, saves PNG or JPG.

Map styles: `src/mapStyles.js` (colours of every map layer, sky, light, shadows per style). Your own colours per style are kept in the plan (`plan.map`), and an element can carry its own colour `col`. Colour boxes (picker, code as #RRGGBB or R,G,B, palette, pipette) are `src/ColourField.jsx`. Elements are listed in groups (`ELEMENT_GROUPS` in `src/elements.js`).

Magic wand: `Wand` in `src/Scene.jsx` (click points on the ground, drag, Ctrl-click inserts, Shift-click removes); "Turn into ribbon" adds a drawn ribbon to `plan.drawn` ({ id, name, route, width, pieces }). The piece panels edit the ribbon in `cur` (main or drawn, `active` in `src/App.jsx`). Labels: switches in `show` (garages / ribbon / elements, kept in this browser); your own texts in `plan.glabel`, `piece.label`, `it.label`; double-click a label to change it. Page title and subtitle: `plan.heading`, click to edit.

Saved views: `plan.views` ({ id, name, pos, target }); the ★ Views menu in `src/App.jsx`, `cameraNow()` in `ViewApi` (`src/Elements.jsx`), and the glide back in `Camera` (`src/Scene.jsx`, view name `saved`). Keys 1–9 jump to the first nine.

Materials: `src/materials.js` (painted, light/dark wood, concrete, corten, steel, rubber, terrazzo; patterns drawn on a canvas, tinted by the colour). A ribbon, a drawn ribbon, a piece or a module can carry `mat` and `col`; `lookOf(piece, ribbon)` decides. `src/Ribbon.jsx` sorts the triangles by look, one material each. `src/ribbon.js` now imports `materials.js`, so copying it to the catalog needs that file too.

Topography: `public/data/terrain.json` (281 × 281 heights, 5 m apart, made by `node scripts/terrain.mjs` from AWS Terrain Tiles / EU-DEM). `src/terrain.js` gives `ground(east, north)` (0 in Flat mode); garages, buildings, the ribbons and elements are drawn at their height above the ground. Element `z` is the height above the ground. Mode in `plan.map.topo` (flat / real / x2).

Drawing views: `src/Views.jsx`. `CameraRig` carries out every view (3D, Ribbon, Top, Side n/e/s/w, Iso, Section, saved) in a perspective or parallel (orthographic, `ortho` in `src/App.jsx`) camera. `SectionCut` cuts with a clipping plane, fills cut surfaces dark (a small addition to three.js `opaque_fragment`), and draws the ground cut as a band. Saved views keep `ortho`, `zoom` and `section`.

Layers: `plan.layers` ({ id, name, on, locked }, at least one); an element carries `layer` (without one it is on the first). The Layers menu in the top bar of `src/App.jsx` adds, renames, orders, deletes, shows/hides and locks them; new elements go on the current layer. Only elements on shown layers reach the Scene (`shownItems`), so hidden ones are also left out of pictures and the Rhino file; locked ones (`lockedIds`) are drawn but cannot be picked or dragged. With more than one layer, Rhino layer names start with the layer name.

## Reused GDR plates, lifted roofs and areas

Everything is built from reused GDR prefab plates on one 1.20 × 1.20 m grid, turned by `park.netAngle` (11°, along the slabs) from the site origin. The park deck uses the material `gdr` (texture 2.4 m = 2 × 2 plates, texture coordinates turned with the grid in `buildPark`), joints = `net` 1.2, columns every `columns` 7.2 m on the same grid.

Lifted roofs and areas: `plan.lifts` (`src/lifts.js`, `src/Lifts.jsx`): fields of separate plates `{ id, i0, j0, nu, nv, h, roof, tiltU, tiltV, supports }` in grid numbers. `roof: true` stands on the roof under the field's middle (`roofAt`), otherwise on the ground. ▦ Lift plates (top bar) draws a field by dragging (on a roof it becomes a lifted roof); click a field to select it, drag it to move it (snaps to the grid). Arrow keys: ↑ / ↓ lift the selected field (10 cm, Shift = 1.20 m), else the selected park height point, else the whole deck (roof points stay), else selected elements. Delete removes the selected field. Plans saved before the plates existed have their deck switched to `gdr` once (in `clean()`).

## Opened garage roofs and the timber grid

Opened roofs: `plan.roofs` ({ garage id: `tilt` | `frame` | `open` }; missing = closed) and `plan.roofColour`. `src/Roofs.jsx` draws opened garages from walls and door (they leave the solid boxes in `Garages`), plus a light steel frame and a roof plate hinged up 35° (`tilt`), the frame only (`frame`), or nothing (`open`). The Roof switch is in the selection panel (works on whole blocks); counts, colour, Close all in the Lifted roofs and areas section.

Plate fields can have a timber grid frame (`grid`: beams under every 1.20 m joint, posts every `postEvery` plates) instead of steel supports, and open bays (`gaps`: none / stripes / checker / scatter). Field L4 is the market roof on the plaza.

Building heights: `plan.bcut` ({ building number in site.json: steps of 1.20 m lower }). `siteAdj` in `src/App.jsx` is the site with those heights; it feeds the Scene and `prepBuildings`, so the park and lifted roofs follow lowered roofs. Click a building (Context in `src/Scene.jsx`, picked one glows orange), then ↓ / ↑ or the panel buttons; never above its real height. A lowered building keeps its original volume as a dotted black outline (Context, `orig`).
