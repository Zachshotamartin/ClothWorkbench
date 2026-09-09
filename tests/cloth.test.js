import test from 'node:test';
import assert from 'node:assert/strict';
import { Triangle, Vector3 } from 'three';
import { ClothSimulation, RESOLUTIONS } from '../src/simulation.js';

function surfacePenetration(sim) {
  const triangle = new Triangle(), point = new Vector3(), center = new Vector3(...sim.sphere.center); let penetration = 0;
  for (let i = 0; i < sim.triangles.length; i += 3) {
    triangle.a.fromArray(sim.positions, sim.triangles[i] * 3);
    triangle.b.fromArray(sim.positions, sim.triangles[i + 1] * 3);
    triangle.c.fromArray(sim.positions, sim.triangles[i + 2] * 3);
    triangle.closestPointToPoint(center, point);
    penetration = Math.max(penetration, sim.sphere.radius - point.distanceTo(center));
  }
  return penetration;
}

for (const cells of [16, 24, 40]) test(`${cells}-cell sheet stays draped, untangled and bounded through a 12-second drop`, () => {
  const sim = new ClothSimulation({ columns: cells });
  for (let frame = 0; frame < 720; frame++) {
    sim.step(1 / 60);
    if (frame % 120 === 119) {
      const d = sim.diagnostics(); assert.equal(d.finite, true); assert.ok(d.maxStretch < 1.13, `stretch ${d.maxStretch}`);
      assert.ok(d.maxPenetration < 1e-8); assert.ok(surfacePenetration(sim) < 0.005, 'The actual triangle surface must stay outside the ball.');
    }
  }
  const d = sim.diagnostics();
  assert.equal(d.pins, 0); assert.ok(d.movement < 0.0001, `resting movement ${d.movement}`);
  assert.ok(Math.max(...sim.positions.filter((_, i) => i % 3 === 1)) > sim.sphere.center[1] + sim.sphere.radius - 0.1, 'Static friction retains the unpinned drape on top of the sphere.');
  assert.ok(d.totalContacts > 0, 'The drape actually invokes non-neighbor self-contact.');
  let minimum = Infinity;
  for (let i = 0; i < sim.count; i++) for (let j = 0; j < i; j++) {
    if (sim.neighboring(i, j)) continue;
    const a = i * 3, b = j * 3;
    minimum = Math.min(minimum, Math.hypot(sim.positions[a] - sim.positions[b], sim.positions[a + 1] - sim.positions[b + 1], sim.positions[a + 2] - sim.positions[b + 2]));
  }
  assert.ok(minimum > sim.selfDistance * 0.8, `non-neighbor spacing ${minimum / sim.selfDistance}`);
});

test('self-contact broad phase separates coincident distant particles and excludes mesh neighbors', () => {
  const sim = new ClothSimulation({ columns: 8, sphere: null });
  const a = 0, b = sim.count - 1;
  sim.positions.set([10, 10, 10], a * 3); sim.positions.set([10, 10, 10], b * 3);
  sim.previous.set([9, 10, 10], a * 3); sim.previous.set([11, 10, 10], b * 3);
  sim.resolveSelfContacts();
  assert.ok(Math.hypot(...[0, 1, 2].map(k => sim.positions[a * 3 + k] - sim.positions[b * 3 + k])) >= sim.selfDistance * 0.999);
  assert.ok(sim.lastContacts > 0);
  assert.equal(sim.neighboring(0, 1), true); assert.equal(sim.neighboring(0, sim.count - 1), false);
});

test('all resolution options generate and export their actual triangle counts', () => {
  for (const { cells } of RESOLUTIONS) {
    const sim = new ClothSimulation({ columns: cells }), obj = sim.toOBJ();
    assert.equal(sim.diagnostics().triangles, cells * cells * 2);
    assert.equal((obj.match(/^v /gm) || []).length, (cells + 1) ** 2);
    assert.equal((obj.match(/^f /gm) || []).length, cells * cells * 2);
  }
});

test('Drop clears pins, grabs, velocities, accumulated time and constraint history', () => {
  const sim = new ClothSimulation({ columns: 12 });
  sim.pinTop('Top edge'); sim.grab(20, [2, 3, 1]);
  for (let i = 0; i < 90; i++) sim.step(1 / 60);
  sim.drop();
  assert.deepEqual(sim.positions, sim.rest); assert.deepEqual(sim.previous, sim.rest);
  assert.equal(sim.pins.size, 0); assert.equal(sim.grabbed, null); assert.equal(sim.accumulator, 0); assert.equal(sim.time, 0);
  assert.ok(sim.invMass.every(v => v === 1)); assert.ok(sim.constraints.every(c => c.lambda === 0));
});

test('large pointer jumps stay bounded and cannot tunnel through the ball', () => {
  const sim = new ClothSimulation({ columns: 16 });
  for (let i = 0; i < 120; i++) sim.step(1 / 60);
  const i = sim.index(1, 1), before = [...sim.positions.slice(i * 3, i * 3 + 3)];
  sim.grab(i, [-20, -20, -20]);
  assert.deepEqual([...sim.positions.slice(i * 3, i * 3 + 3)], before, 'Pointer events set a target rather than teleporting vertices.');
  for (let frame = 0; frame < 180; frame++) sim.step(1 / 60);
  assert.equal(sim.diagnostics().finite, true); assert.ok(sim.diagnostics().maxStretch < 1.25); assert.ok(sim.diagnostics().maxPenetration < 1e-8);
  const c = sim.sphere.center, clipped = sim.clipGrab([c[0], c[1], 3], [c[0], c[1], -3]);
  assert.ok(clipped[2] >= c[2] + sim.sphere.radius);
  sim.release(); assert.equal(sim.grabbed, null); assert.equal(sim.invMass[i], 1);
});

test('materials produce different drapes while pinned attachments remain fixed', () => {
  const a = new ClothSimulation({ columns: 12, material: 'Silk', wind: 2 });
  const b = new ClothSimulation({ columns: 12, material: 'Canvas', wind: 2 });
  a.pinTop('Corners'); b.pinTop('Corners'); const pins = structuredClone([...a.pins]);
  for (let i = 0; i < 180; i++) { a.step(1 / 60); b.step(1 / 60); }
  let difference = 0; a.positions.forEach((v, i) => { difference += Math.abs(v - b.positions[i]); });
  assert.ok(difference > 1);
  for (const [i, p] of pins) assert.deepEqual([...a.positions.slice(i * 3, i * 3 + 3)], p);
  assert.ok(a.diagnostics().maxStretch < 1.15); assert.ok(b.diagnostics().maxStretch < 1.15);
});

test('fixed substeps are deterministic across frame chunks and bounded after a stall', () => {
  const a = new ClothSimulation({ columns: 8 }), b = new ClothSimulation({ columns: 8 });
  for (let i = 0; i < 60; i++) a.step(1 / 60);
  for (let i = 0; i < 120; i++) b.step(1 / 120);
  assert.deepEqual(a.positions, b.positions);
  assert.equal(a.step(100), 4); assert.equal(a.step(0), 0);
  assert.throws(() => a.step(NaN)); assert.throws(() => a.step(-1)); assert.throws(() => a.substep(1));
});
