import { ClothSimulation, MATERIALS, RESOLUTIONS } from './simulation.js';
export { ClothSimulation, MATERIALS, RESOLUTIONS } from './simulation.js';
export const metadata = {
  id: 'cloth-workbench', title: 'Cloth Workbench',
  description: 'Drop a woven sheet onto a ball, change its triangle count, and compare how different fabrics fold. Pull the surface, add attachments, and export the actual drape.',
  technique: 'XPBD elastic constraints · spatial-hash self-contact · bounded fixed substeps',
  instructions: ['Choose a triangle count, then press Drop onto ball. The sheet starts flat and unpinned above the sphere.', 'Compare Silk, Linen and Canvas, or change wind and gravity. Reset cloth returns to a clean, paused setup.', 'Drag the surface to pull it; the grab approaches your cursor at a bounded speed. Empty-space dragging orbits.', 'Add pins by clicking or use the row and column controls. Freeze the drape to export its mesh as OBJ.'],
  limitations: ['Self-contact separates non-neighboring particles through a spatial hash; it is not continuous triangle–triangle collision detection.', 'No tearing, sewing, thickness-volume model, or physically calibrated fabric measurements.', 'The highest triangle count costs more CPU time. The quick tier is the default on small or touch screens.'],
};
export function createExperiment(ctx) {
  const { THREE: T, root, ui } = ctx;
  const mobile = matchMedia('(max-width: 700px), (pointer: coarse)').matches;
  let cells = mobile ? 16 : 24, sim = new ClothSimulation({ columns: cells }), playing = false, editPins = false, pinColumn = 0, pinRow = 0, pinUndo = [], frame = 0;
  let pinColumnControl, pinRowControl, pause, pinMode, editPinsControl, drag = null, beforeDragPlaying = false;
  const dark = new T.MeshStandardMaterial({ color: 0x263c35, roughness: 0.7 });
  const brass = new T.MeshStandardMaterial({ color: 0xd3ad6e, roughness: 0.32, metalness: 0.6 });
  function mesh(geometry, material, position) { const result = new T.Mesh(geometry, material); result.position.set(...position); result.castShadow = result.receiveShadow = true; root.add(result); return result; }
  mesh(new T.BoxGeometry(6.6, 0.12, 6.6), dark, [0, -0.015, 0]);
  const sphere = mesh(new T.SphereGeometry(sim.sphere.radius, 64, 48), new T.MeshStandardMaterial({ color: 0x769b9b, metalness: 0.28, roughness: 0.35 }), sim.sphere.center);
  mesh(new T.CylinderGeometry(0.38, 0.48, 0.12, 40), brass, [0, 0.12, 0]);
  function texture(name) {
    const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
    g.fillStyle = name === 'Silk' ? '#c77959' : name === 'Canvas' ? '#637d88' : '#c2b38d'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 256; i += 4) { g.fillStyle = 'rgba(255,255,255,.13)'; g.fillRect(i, 0, 1, 256); g.fillStyle = 'rgba(0,0,0,.1)'; g.fillRect(0, i, 256, 1); }
    g.strokeStyle = '#ead5b4'; g.lineWidth = 3; g.strokeRect(8, 8, 240, 240); g.lineWidth = 1; g.setLineDash([4, 3]); g.strokeRect(14, 14, 228, 228);
    const map = new T.CanvasTexture(c); map.colorSpace = T.SRGBColorSpace; map.anisotropy = Math.min(8, ctx.renderer.capabilities.getMaxAnisotropy()); return map;
  }
  const material = new T.MeshPhysicalMaterial({ map: texture(sim.material), side: T.DoubleSide, roughness: 0.65, metalness: 0, sheen: 0.65, sheenColor: new T.Color(0xf4c9a9), sheenRoughness: 0.7 });
  const cloth = mesh(new T.BufferGeometry(), material, [0, 0, 0]); cloth.frustumCulled = false;
  const pinMarkers = new T.InstancedMesh(new T.SphereGeometry(0.045, 12, 8), brass, 1681); pinMarkers.count = 0; pinMarkers.frustumCulled = false; root.add(pinMarkers);
  const selection = mesh(new T.SphereGeometry(0.07, 16, 10), new T.MeshBasicMaterial({ color: 0xf0d28d, wireframe: true, depthTest: false }), [0, 0, 0]); selection.renderOrder = 5; selection.visible = false;
  const border = new T.LineSegments(new T.BufferGeometry(), new T.LineBasicMaterial({ color: 0xead4af })); root.add(border); border.frustumCulled = false;
  let borderIndices = [], borderPositions;
  function rebuildGeometry() {
    cloth.geometry.dispose(); border.geometry.dispose();
    const geometry = new T.BufferGeometry(), uv = [];
    for (let y = 0; y <= sim.rows; y++) for (let x = 0; x <= sim.columns; x++) uv.push(x / sim.columns, 1 - y / sim.rows);
    geometry.setAttribute('position', new T.BufferAttribute(new Float32Array(sim.positions), 3).setUsage(T.DynamicDrawUsage));
    geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); geometry.setIndex(sim.triangles); cloth.geometry = geometry;
    borderIndices = [];
    for (let y = 0; y <= sim.rows; y++) for (let x = 0; x <= sim.columns; x++) {
      if ((y === 0 || y === sim.rows) && x < sim.columns) borderIndices.push(sim.index(x, y), sim.index(x + 1, y));
      if ((x === 0 || x === sim.columns) && y < sim.rows) borderIndices.push(sim.index(x, y), sim.index(x, y + 1));
    }
    borderPositions = new Float32Array(borderIndices.length * 3);
    border.geometry = new T.BufferGeometry().setAttribute('position', new T.BufferAttribute(borderPositions, 3).setUsage(T.DynamicDrawUsage));
    for (const input of [pinColumnControl, pinRowControl]) if (input) input.max = cells;
    refresh();
  }
  function sync(input, value) { if (input) { input.value = value; const output = input.closest('label').querySelector('output'); if (output) output.value = value; } }
  function refresh() {
    cloth.geometry.attributes.position.array.set(sim.positions); cloth.geometry.attributes.position.needsUpdate = true; cloth.geometry.computeVertexNormals();
    const matrix = new T.Matrix4(); let index = 0;
    for (const [i] of sim.pins) { matrix.makeTranslation(...sim.positions.slice(i * 3, i * 3 + 3)); pinMarkers.setMatrixAt(index++, matrix); }
    pinMarkers.count = index; pinMarkers.instanceMatrix.needsUpdate = true;
    for (let j = 0; j < borderIndices.length; j++) for (let k = 0; k < 3; k++) borderPositions[j * 3 + k] = sim.positions[borderIndices[j] * 3 + k];
    border.geometry.attributes.position.needsUpdate = true;
    selection.visible = editPins; const selected = sim.index(pinColumn, pinRow) * 3; selection.position.set(...sim.positions.slice(selected, selected + 3));
    sync(pinColumnControl, pinColumn); sync(pinRowControl, pinRow); ctx.invalidate();
  }
  function status() {
    const d = sim.diagnostics(); if (pause) pause.textContent = playing ? 'Pause simulation' : 'Play simulation';
    ctx.setStatus(`${d.triangles.toLocaleString()} triangles · ${d.vertices.toLocaleString()} vertices · ${d.pins} pins · ${sim.material} · ${playing ? 'simulating' : sim.time ? 'paused' : 'ready to drop'}`);
  }
  function endDrag() { sim.release(); if (drag !== null && ctx.canvas.hasPointerCapture(drag)) ctx.canvas.releasePointerCapture(drag); drag = null; ctx.controls.enabled = true; }
  function cleanSetup(start) {
    endDrag(); sim.drop(); playing = start; pinUndo = []; pinColumn = pinRow = 0; editPins = false;
    if (editPinsControl) editPinsControl.checked = false; if (pinMode) pinMode.value = 'Free fall'; refresh(); status();
  }
  function rememberPins() { pinUndo.push(structuredClone([...sim.pins])); if (pinUndo.length > 24) pinUndo.shift(); }
  ui.section('Drop experiment');
  ui.button('Drop onto ball', () => cleanSetup(true), { primary: true });
  ui.button('Reset cloth', () => cleanSetup(false));
  ui.select('Triangles', RESOLUTIONS, String(cells), value => {
    const materialName = sim.material, wind = sim.wind, gravity = sim.gravity;
    endDrag(); cells = Number(value); sim = new ClothSimulation({ columns: cells, material: materialName, wind }); sim.gravity = gravity;
    pinColumn = pinRow = 0; rebuildGeometry(); cleanSetup(false);
  });
  ui.note('A fresh sheet starts flat above the ball, with no pins or stored velocity. More triangles make finer folds and increase simulation cost.');
  ui.section('Fabric & forces');
  ui.select('Material', Object.keys(MATERIALS), 'Silk', name => { sim.setMaterial(name); material.map.dispose(); material.map = texture(name); material.sheen = name === 'Silk' ? 0.65 : 0.18; material.roughness = name === 'Silk' ? 0.65 : 0.88; material.needsUpdate = true; status(); });
  ui.range('Wind strength', { min: 0, max: 5, step: 0.1, value: sim.wind, onChange: value => { sim.wind = value; status(); } });
  ui.range('Gravity', { min: 0, max: 14, step: 0.1, value: 9.8, onChange: value => { sim.gravity = -value; status(); } });
  pause = ui.button('Play simulation', () => { playing = !playing; status(); });
  ui.button('Step one frame', () => { playing = false; sim.step(1 / 60); refresh(); status(); });
  ui.section('Attachments');
  pinMode = ui.select('Pin arrangement', ['Free fall', 'Corners', 'Three points', 'Top edge'], 'Free fall', mode => { rememberPins(); sim.reset(); sim.pinTop(mode); refresh(); status(); });
  editPinsControl = ui.toggle('Edit pins by clicking cloth', false, value => { editPins = value; refresh(); });
  pinColumnControl = ui.range('Pin column', { min: 0, max: cells, step: 1, value: 0, onChange: value => { pinColumn = value; editPins = true; editPinsControl.checked = true; refresh(); } });
  pinRowControl = ui.range('Pin row', { min: 0, max: cells, step: 1, value: 0, onChange: value => { pinRow = value; editPins = true; editPinsControl.checked = true; refresh(); } });
  ui.button('Toggle selected pin', () => { rememberPins(); const i = sim.index(pinColumn, pinRow); sim.setPin(i, !sim.pins.has(i)); refresh(); status(); });
  ui.button('Undo pin edit', () => { const previous = pinUndo.pop(); if (previous) { sim.restorePins(previous); refresh(); status(); } });
  ui.note('Gold markers are pinned vertices. Row and column controls offer the same attachment editing without precise pointer selection.');
  ui.section('Inspect & export');
  ui.toggle('Wireframe collision objects', false, value => { sphere.material.wireframe = value; ctx.invalidate(); });
  ui.toggle('Show cloth mesh', false, value => { material.wireframe = value; ctx.invalidate(); });
  ui.button('Freeze & export cloth OBJ', () => { playing = false; endDrag(); ctx.download('cloth-drape.obj', sim.toOBJ()); status(); });
  ui.note('Self-contact is active: a spatial hash separates close particles from different parts of the sheet. The sphere and tabletop also constrain the surface.');
  const ray = new T.Raycaster(), plane = new T.Plane(), hit = new T.Vector3();
  function nearestVertex(found) {
    let best = found.face.a, distance = Infinity;
    for (const i of [found.face.a, found.face.b, found.face.c]) { const d = new T.Vector3(...sim.positions.slice(i * 3, i * 3 + 3)).distanceToSquared(found.point); if (d < distance) { distance = d; best = i; } }
    return best;
  }
  ctx.listen(ctx.canvas, 'pointerdown', event => {
    ray.setFromCamera(ctx.pointer(event), ctx.camera); const found = ray.intersectObject(cloth)[0]; if (!found) return;
    event.preventDefault(); const i = nearestVertex(found); pinColumn = i % (sim.columns + 1); pinRow = Math.floor(i / (sim.columns + 1));
    if (editPins) { rememberPins(); sim.setPin(i, !sim.pins.has(i)); refresh(); status(); return; }
    drag = event.pointerId; beforeDragPlaying = playing; plane.setFromNormalAndCoplanarPoint(ctx.camera.getWorldDirection(new T.Vector3()), found.point);
    ctx.controls.enabled = false; ctx.canvas.setPointerCapture(event.pointerId); sim.grab(i, found.point.toArray()); refresh();
  }, { capture: true });
  ctx.listen(ctx.canvas, 'pointermove', event => { if (drag !== event.pointerId) return; ray.setFromCamera(ctx.pointer(event), ctx.camera); if (ray.ray.intersectPlane(plane, hit)) sim.grab(sim.grabbed, hit.toArray()); });
  const release = event => { if (drag !== event.pointerId) return; endDrag(); playing = beforeDragPlaying; status(); };
  ctx.listen(ctx.canvas, 'pointerup', release); ctx.listen(ctx.canvas, 'pointercancel', release);
  let initialFraming = true;
  ctx.onFrame(dt => {
    if (initialFraming) {
      initialFraming = false;
      // Frame the working volume rather than letting the larger tabletop shrink the cloth.
      const bounds = new T.Mesh(new T.BoxGeometry(4.8, 3.4, 4.8)); bounds.position.y = 1.7;
      ctx.fit(bounds); bounds.geometry.dispose(); bounds.material.dispose();
    }
    if (!playing && drag === null) return; sim.step(dt); refresh(); if (++frame % 30 === 0) status();
  });
  rebuildGeometry(); status(); ctx.fit(root);
  return { deactivate() { endDrag(); }, dispose() { endDrag(); } };
}
