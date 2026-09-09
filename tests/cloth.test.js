import test from 'node:test';import assert from 'node:assert/strict';
import {ClothSimulation} from '../src/simulation.js';
test('XPBD remains finite, pins fixed, and structural strain bounded',()=>{
  const sim=new ClothSimulation({columns:14,rows:12,wind:2}),pins=structuredClone([...sim.pins]);for(let i=0;i<240;i++)sim.step(1/60);
  assert.equal(sim.diagnostics().finite,true);assert.ok(sim.diagnostics().maxStretch<1.25);
  for(const [i,p]of pins)assert.deepEqual([...sim.positions.slice(i*3,i*3+3)],p);
});
test('sphere, box and floor projection keep free particles outside solid geometry',()=>{
  const sim=new ClothSimulation({columns:6,rows:6});const i=sim.index(3,4);sim.positions.set(sim.sphere.center,i*3);sim.resolveCollisions();let p=[...sim.positions.slice(i*3,i*3+3)];assert.ok(Math.hypot(...p.map((v,j)=>v-sim.sphere.center[j]))>=sim.sphere.radius);
  sim.positions.set(sim.box.center,i*3);sim.resolveCollisions();p=[...sim.positions.slice(i*3,i*3+3)];assert.ok(p.some((v,j)=>Math.abs(v-sim.box.center[j])>=sim.box.half[j]));
  sim.positions.set([0,-10,4],i*3);sim.resolveCollisions();assert.ok(sim.positions[i*3+1]>=sim.floor);
});
test('material compliance changes the computed drape with identical forcing',()=>{
  const a=new ClothSimulation({columns:12,rows:10,material:'Silk'}),b=new ClothSimulation({columns:12,rows:10,material:'Canvas'});for(let i=0;i<120;i++){a.step(1/60);b.step(1/60);}let delta=0;a.positions.forEach((v,i)=>delta+=Math.abs(v-b.positions[i]));assert.ok(delta>.5);
});
test('grab release and pin undo preserve particle inverse mass',()=>{
  const sim=new ClothSimulation({columns:6,rows:6}),i=12;sim.grab(i,[.2,3,1]);assert.equal(sim.invMass[i],0);sim.release();assert.equal(sim.invMass[i],1);sim.setPin(i,true);sim.grab(i,[.5,3,1]);sim.release();assert.equal(sim.invMass[i],0);assert.deepEqual(sim.pins.get(i),[.5,3,1]);
});
test('fixed timestep bounded and OBJ contains simulated vertices and faces',()=>{
  const sim=new ClothSimulation({columns:6,rows:6});assert.equal(sim.step(100),4);assert.ok(sim.time<.034);const obj=sim.toOBJ();assert.equal((obj.match(/^v /gm)||[]).length,49);assert.equal((obj.match(/^f /gm)||[]).length,72);assert.throws(()=>sim.step(NaN));
});
test('a fast grab cannot tunnel through the sphere or crate',()=>{const sim=new ClothSimulation({columns:6,rows:6}),c=sim.sphere.center,p=sim.clipGrab([c[0],c[1],3],[c[0],c[1],-3]);assert.ok(p[2]>=c[2]+sim.sphere.radius);const b=sim.box.center,q=sim.clipGrab([b[0],b[1],3],[b[0],b[1],-3]);assert.ok(q[2]>=b[2]+sim.box.half[2]);});
