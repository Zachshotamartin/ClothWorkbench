export const MATERIALS = {
  Silk: { stretch: 2e-8, shear: 8e-8, bend: 0.018, damping: 0.993, mass: 0.55, friction: 0.12 },
  Linen: { stretch: 8e-9, shear: 3e-8, bend: 0.0015, damping: 0.989, mass: 0.9, friction: 0.2 },
  Canvas: { stretch: 2e-9, shear: 8e-9, bend: 0.000025, damping: 0.983, mass: 1.35, friction: 0.3 },
};
export const RESOLUTIONS = [
  { label: '512 triangles · quick', value: '16', cells: 16 },
  { label: '1,152 triangles · balanced', value: '24', cells: 24 },
  { label: '2,048 triangles · fine', value: '32', cells: 32 },
  { label: '3,200 triangles · detailed', value: '40', cells: 40 },
];
const STEP = 1 / 120;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class ClothSimulation {
  constructor({ columns = 24, rows = columns, width = 4.4, height = 4.4, material = 'Silk', wind = 0, sphere = { center: [0, 1.3, 0], radius: 1.15 }, box = null, selfContact = true } = {}) {
    if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 3 || rows < 3 || columns > 40 || rows > 40) throw new RangeError('Grid dimensions must be integers between 3 and 40.');
    if (![width, height, wind].every(Number.isFinite) || width <= 0 || height <= 0) throw new RangeError('Positive dimensions and finite wind required.');
    if (sphere && (!sphere.center?.every(Number.isFinite) || sphere.center.length !== 3 || !Number.isFinite(sphere.radius) || sphere.radius <= 0)) throw new RangeError('A finite sphere with positive radius is required.');
    this.columns = columns; this.rows = rows; this.width = width; this.height = height;
    this.count = (columns + 1) * (rows + 1); this.material = MATERIALS[material] ? material : 'Silk';
    this.wind = wind; this.gravity = -9.81; this.sphere = structuredClone(sphere); this.box = structuredClone(box);
    this.floor = 0.045; this.spacing = Math.min(width / columns, height / rows);
    this.thickness = 0.022; this.selfDistance = this.spacing * 0.78; this.selfContact = selfContact;
    // This chord allowance keeps the facets between contact particles outside the sphere too.
    this.sphereMargin = this.thickness + (sphere ? 0.55 * (width / columns) ** 2 / sphere.radius + 0.55 * (height / rows) ** 2 / sphere.radius : 0);
    this.positions = new Float64Array(this.count * 3); this.previous = new Float64Array(this.count * 3);
    this.rest = new Float64Array(this.count * 3); this.invMass = new Float64Array(this.count).fill(1);
    this.normals = new Float64Array(this.count * 3); this.contactDepth = new Float64Array(this.count); this.pins = new Map(); this.constraints = []; this.triangles = [];
    this.gridX = new Int16Array(this.count); this.gridY = new Int16Array(this.count);
    this.time = 0; this.accumulator = 0; this.grabbed = null; this.lastContacts = 0; this.totalContacts = 0;
    this.hash = new Map(); this.pairs = [];
    for (let y = 0; y <= rows; y++) for (let x = 0; x <= columns; x++) {
      const i = this.index(x, y); this.gridX[i] = x; this.gridY[i] = y;
      this.rest.set([(x / columns - 0.5) * width, 3.2, (y / rows - 0.5) * height], i * 3);
      if (x < columns && y < rows) {
        const a = i, b = i + 1, c = i + columns + 1, d = c + 1;
        this.triangles.push(a, c, b, b, c, d);
      }
    }
    this.positions.set(this.rest); this.previous.set(this.rest);
    const add = (x, y, dx, dy, kind) => {
      if (x + dx > columns || y + dy > rows || x + dx < 0) return;
      this.constraints.push({ a: this.index(x, y), b: this.index(x + dx, y + dy), rest: Math.hypot(dx * width / columns, dy * height / rows), kind, lambda: 0 });
    };
    for (let y = 0; y <= rows; y++) for (let x = 0; x <= columns; x++) {
      add(x, y, 1, 0, 'stretch'); add(x, y, 0, 1, 'stretch');
      add(x, y, 1, 1, 'shear'); add(x, y, -1, 1, 'shear');
      add(x, y, 2, 0, 'bend'); add(x, y, 0, 2, 'bend');
    }
  }
  index(x, y) { return y * (this.columns + 1) + x; }
  setMaterial(name) { if (!MATERIALS[name]) throw new RangeError('Unknown material.'); this.material = name; }
  pinTop(mode) {
    this.release(); this.pins.clear(); this.invMass.fill(1);
    if (mode === 'Free fall') return;
    const xs = mode === 'Top edge' ? Array.from({ length: this.columns + 1 }, (_, i) => i) : mode === 'Three points' ? [0, Math.round(this.columns / 2), this.columns] : [0, this.columns];
    for (const x of xs) this.setPin(this.index(x, 0), true);
  }
  setPin(i, enabled) {
    if (!Number.isInteger(i) || i < 0 || i >= this.count) throw new RangeError('Invalid vertex index.');
    if (enabled) { this.pins.set(i, [...this.positions.slice(i * 3, i * 3 + 3)]); this.invMass[i] = 0; }
    else { this.pins.delete(i); this.invMass[i] = 1; }
  }
  reset({ clearPins = false } = {}) {
    this.release(); this.positions.set(this.rest); this.previous.set(this.rest); this.time = 0; this.accumulator = 0;
    this.lastContacts = this.totalContacts = 0; this.pairs.length = 0;
    for (const c of this.constraints) c.lambda = 0;
    if (clearPins) { this.pins.clear(); this.invMass.fill(1); }
    else for (const [i] of this.pins) this.pins.set(i, [...this.rest.slice(i * 3, i * 3 + 3)]);
  }
  drop() { this.reset({ clearPins: true }); }
  restorePins(entries) {
    this.release(); this.pins.clear(); this.invMass.fill(1);
    for (const [i, point] of entries) { this.positions.set(point, i * 3); this.previous.set(point, i * 3); this.setPin(i, true); }
  }
  grab(i, point) {
    if (!Number.isInteger(i) || i < 0 || i >= this.count || point?.length !== 3 || !point.every(Number.isFinite)) throw new RangeError('Valid vertex and finite grab position required.');
    this.grabbed = i; this.grabTarget = point.map((v, k) => clamp(v, k === 1 ? this.floor + this.thickness : -3.5, k === 1 ? 5 : 3.5));
    // A pinned vertex moves its attachment, while a free vertex remains dynamic under a compliant grab.
  }
  release() { this.grabbed = null; this.grabTarget = null; }
  clipGrab(from, to) {
    const out = [...to], s = this.sphere;
    if (s) {
      const d = to.map((v, k) => v - from[k]), m = from.map((v, k) => v - s.center[k]);
      const a = d.reduce((sum, v) => sum + v * v, 0), b = m.reduce((sum, v, k) => sum + v * d[k], 0), c = m.reduce((sum, v) => sum + v * v, 0) - (s.radius + this.sphereMargin) ** 2;
      const discriminant = b * b - a * c;
      if (a > 1e-12 && c >= -1e-6 && discriminant >= 0 && b < 0) {
        const t = (-b - Math.sqrt(discriminant)) / a;
        if (t >= 0 && t < 1) for (let k = 0; k < 3; k++) out[k] = from[k] + d[k] * Math.max(0, t - 0.001);
      }
    }
    out[1] = Math.max(this.floor + this.thickness, out[1]); return out;
  }
  step(dt) {
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Finite nonnegative timestep required.');
    this.accumulator += Math.min(dt, 1 / 30); let steps = 0;
    while (this.accumulator + 1e-10 >= STEP && steps < 4) { this.substep(STEP); this.accumulator = Math.max(0, this.accumulator - STEP); steps++; }
    return steps;
  }
  solveDistance(c, compliance, h, limit = false) {
    const p = this.positions, a = c.a * 3, b = c.b * 3, wa = this.invMass[c.a], wb = this.invMass[c.b];
    if (!wa && !wb) return;
    const dx = p[a] - p[b], dy = p[a + 1] - p[b + 1], dz = p[a + 2] - p[b + 2], length = Math.hypot(dx, dy, dz);
    if (length < 1e-10 || (limit && length <= c.rest * 1.06)) return;
    const alpha = compliance / (h * h), dl = (-(length - c.rest * (limit ? 1.06 : 1)) - (limit ? 0 : alpha * c.lambda)) / (wa + wb + alpha);
    if (!limit) c.lambda += dl;
    const factor = dl / length;
    p[a] += wa * factor * dx; p[a + 1] += wa * factor * dy; p[a + 2] += wa * factor * dz;
    p[b] -= wb * factor * dx; p[b + 1] -= wb * factor * dy; p[b + 2] -= wb * factor * dz;
  }
  substep(h = STEP) {
    if (!Number.isFinite(h) || h <= 0 || h > 1 / 60) throw new RangeError('Use a positive bounded substep.');
    this.time += h; const p = this.positions, old = this.previous, m = MATERIALS[this.material];
    const maxDisplacement = this.spacing * 0.38;
    for (let i = 0; i < this.count; i++) {
      if (!this.invMass[i]) continue;
      const k = i * 3, vx = (p[k] - old[k]) * m.damping, vy = (p[k + 1] - old[k + 1]) * m.damping, vz = (p[k + 2] - old[k + 2]) * m.damping;
      const scale = Math.min(1, maxDisplacement / Math.max(1e-10, Math.hypot(vx, vy, vz)));
      old[k] = p[k]; old[k + 1] = p[k + 1]; old[k + 2] = p[k + 2];
      p[k] += vx * scale + Math.sin(this.time * 1.2 + p[k + 2]) * this.wind * 0.3 * h * h / m.mass;
      p[k + 1] += vy * scale + this.gravity * h * h;
      p[k + 2] += vz * scale + Math.sin(this.time * 0.8 + p[k]) * this.wind * 0.45 * h * h / m.mass;
    }
    let grabPoint = null;
    if (this.grabbed !== null) {
      const k = this.grabbed * 3, from = [...p.slice(k, k + 3)], d = this.grabTarget.map((v, j) => v - from[j]);
      const scale = Math.min(1, this.spacing * 0.3 / Math.max(1e-10, Math.hypot(...d)));
      grabPoint = this.clipGrab(from, from.map((v, j) => v + d[j] * scale));
      if (this.pins.has(this.grabbed)) this.pins.set(this.grabbed, grabPoint);
    }
    for (const c of this.constraints) c.lambda = 0;
    this.normals.fill(0); this.contactDepth.fill(0); this.lastContacts = 0;
    for (let pass = 0; pass < 8; pass++) {
      // Reverse the sweep every pass rather than biasing all strain toward one corner.
      for (let j = 0; j < this.constraints.length; j++) {
        const c = this.constraints[pass % 2 ? this.constraints.length - 1 - j : j];
        this.solveDistance(c, m[c.kind], h);
      }
      if (grabPoint && this.invMass[this.grabbed]) {
        const k = this.grabbed * 3; for (let j = 0; j < 3; j++) p[k + j] += (grabPoint[j] - p[k + j]) * 0.3;
      }
      for (const [i, point] of this.pins) p.set(point, i * 3);
      if (this.selfContact && (pass === 3 || pass === 7)) this.resolveSelfContacts();
      this.resolveCollisions();
    }
    // An inequality safety constraint bounds extreme manipulation without removing elastic material differences.
    for (let pass = 0; pass < 2; pass++) {
      for (const c of this.constraints) if (c.kind === 'stretch') this.solveDistance(c, 0, h, true);
      this.resolveCollisions();
    }
    for (let i = 0; i < this.count; i++) {
      const k = i * 3, nx = this.normals[k], ny = this.normals[k + 1], nz = this.normals[k + 2], nlen = Math.hypot(nx, ny, nz);
      if (!nlen || !this.invMass[i]) continue;
      const x = nx / nlen, y = ny / nlen, z = nz / nlen, vx = p[k] - old[k], vy = p[k + 1] - old[k + 1], vz = p[k + 2] - old[k + 2];
      const normalVelocity = vx * x + vy * y + vz * z;
      const tx = vx - normalVelocity * x, ty = vy - normalVelocity * y, tz = vz - normalVelocity * z;
      // Coulomb-style positional friction prevents a resting contact from slowly creeping off the ball.
      const tangential = Math.hypot(tx, ty, tz), friction = Math.min(1, (0.7 + m.friction) * this.contactDepth[i] / Math.max(1e-10, tangential));
      p[k] -= tx * friction; p[k + 1] -= ty * friction; p[k + 2] -= tz * friction;
      old[k] = p[k] - tx * (1 - friction) * (1 - m.friction);
      old[k + 1] = p[k + 1] - ty * (1 - friction) * (1 - m.friction);
      old[k + 2] = p[k + 2] - tz * (1 - friction) * (1 - m.friction);
    }
    this.resolveCollisions();
    this.totalContacts += this.lastContacts;
  }
  resolveCollisions() {
    const p = this.positions, n = this.normals;
    for (let i = 0; i < this.count; i++) {
      if (!this.invMass[i]) continue;
      const k = i * 3;
      if (p[k + 1] < this.floor + this.thickness) { this.contactDepth[i] += this.floor + this.thickness - p[k + 1]; p[k + 1] = this.floor + this.thickness; n[k + 1] = 1; }
      if (this.sphere) {
        const s = this.sphere, dx = p[k] - s.center[0], dy = p[k + 1] - s.center[1], dz = p[k + 2] - s.center[2], len = Math.hypot(dx, dy, dz), r = s.radius + this.sphereMargin;
        if (len < r) {
          this.contactDepth[i] += r - len;
          const nx = len > 1e-10 ? dx / len : 0, ny = len > 1e-10 ? dy / len : 1, nz = len > 1e-10 ? dz / len : 0;
          p[k] = s.center[0] + nx * r; p[k + 1] = s.center[1] + ny * r; p[k + 2] = s.center[2] + nz * r;
          n[k] = nx; n[k + 1] = ny; n[k + 2] = nz;
        }
      }
      if (this.box) {
        const b = this.box, delta = [p[k] - b.center[0], p[k + 1] - b.center[1], p[k + 2] - b.center[2]], half = b.half.map(v => v + this.thickness);
        if (delta.every((v, j) => Math.abs(v) < half[j])) {
          let axis = 0; for (let j = 1; j < 3; j++) if (half[j] - Math.abs(delta[j]) < half[axis] - Math.abs(delta[axis])) axis = j;
          p[k + axis] = b.center[axis] + Math.sign(delta[axis] || 1) * half[axis]; n[k + axis] = Math.sign(delta[axis] || 1);
        }
      }
    }
  }
  neighboring(a, b) { return Math.abs(this.gridX[a] - this.gridX[b]) <= 1 && Math.abs(this.gridY[a] - this.gridY[b]) <= 1; }
  resolveSelfContacts() {
    const p = this.positions, size = this.selfDistance, hash = this.hash; hash.clear(); this.pairs.length = 0;
    const key = (x, y, z) => `${x},${y},${z}`;
    for (let i = 0; i < this.count; i++) {
      const k = i * 3, x = Math.floor(p[k] / size), y = Math.floor(p[k + 1] / size), z = Math.floor(p[k + 2] / size);
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const list = hash.get(key(x + dx, y + dy, z + dz)); if (!list) continue;
        for (const j of list) {
          if (this.neighboring(i, j)) continue;
          const q = j * 3, vx = p[k] - p[q], vy = p[k + 1] - p[q + 1], vz = p[k + 2] - p[q + 2], length = Math.hypot(vx, vy, vz);
          if (length >= size) continue;
          const wa = this.invMass[i], wb = this.invMass[j]; if (!(wa + wb)) continue;
          // The history supplies a stable normal for coincident particles instead of a random impulse.
          let nx = vx, ny = vy, nz = vz, normalLength = length;
          if (normalLength < 1e-8) { nx = this.previous[k] - this.previous[q]; ny = this.previous[k + 1] - this.previous[q + 1]; nz = this.previous[k + 2] - this.previous[q + 2]; normalLength = Math.hypot(nx, ny, nz); }
          if (normalLength < 1e-8) { nx = 0; ny = 1; nz = 0; normalLength = 1; }
          const correction = (size - length) / (wa + wb) / normalLength;
          p[k] += wa * correction * nx; p[k + 1] += wa * correction * ny; p[k + 2] += wa * correction * nz;
          p[q] -= wb * correction * nx; p[q + 1] -= wb * correction * ny; p[q + 2] -= wb * correction * nz;
          this.lastContacts++; this.pairs.push(i, j);
        }
      }
      const cell = key(x, y, z); const list = hash.get(cell); if (list) list.push(i); else hash.set(cell, [i]);
    }
  }
  diagnostics() {
    let maxStretch = 1, maxPenetration = 0, kinetic = 0;
    const p = this.positions;
    for (const c of this.constraints) if (c.kind === 'stretch') {
      const a = c.a * 3, b = c.b * 3; maxStretch = Math.max(maxStretch, Math.hypot(p[a] - p[b], p[a + 1] - p[b + 1], p[a + 2] - p[b + 2]) / c.rest);
    }
    for (let i = 0; i < this.count; i++) {
      const k = i * 3; kinetic += (p[k] - this.previous[k]) ** 2 + (p[k + 1] - this.previous[k + 1]) ** 2 + (p[k + 2] - this.previous[k + 2]) ** 2;
      if (this.sphere) maxPenetration = Math.max(maxPenetration, this.sphere.radius - Math.hypot(p[k] - this.sphere.center[0], p[k + 1] - this.sphere.center[1], p[k + 2] - this.sphere.center[2]));
    }
    return { vertices: this.count, triangles: this.triangles.length / 3, constraints: this.constraints.length, pins: this.pins.size, finite: p.every(Number.isFinite), maxStretch, maxPenetration, movement: Math.sqrt(kinetic / this.count), selfContacts: this.lastContacts, totalContacts: this.totalContacts, time: this.time };
  }
  toOBJ() {
    const lines = ['# XPBD cloth snapshot; world-space vertices'];
    for (let i = 0; i < this.count; i++) lines.push(`v ${[...this.positions.slice(i * 3, i * 3 + 3)].map(v => v.toFixed(6)).join(' ')}`);
    for (let i = 0; i < this.triangles.length; i += 3) lines.push(`f ${this.triangles[i] + 1} ${this.triangles[i + 1] + 1} ${this.triangles[i + 2] + 1}`);
    return lines.join('\n');
  }
}
