import {ClothSimulation,MATERIALS} from './simulation.js';
export {ClothSimulation,MATERIALS} from './simulation.js';
export const metadata={id:'cloth-workbench',title:'Cloth Workbench',description:'Pin, pull and drape a woven sheet. Compare compliant silk with stiff canvas around solid collision objects, then export the simulated surface.',technique:'Extended position-based dynamics · structural, shear and bending constraints',instructions:['Drag the cloth to grab a vertex; drag empty space to orbit.','Enable Edit pins to toggle attachment points on the surface.','Use fabric, wind, and pin controls to change the simulation.','Pause to inspect a fold, or export its current geometry as OBJ.'],limitations:['A bounded particle-grid simulation with sphere, box and floor contact.','No cloth self-collision, tearing, sewing patterns or full shell bending model.','Fast pulls are constrained at collision objects; very tight folds can still show triangle-level contact artifacts.']};
export function createExperiment(ctx){
  const {THREE:T,root,ui}=ctx;
  const sim=new ClothSimulation();let playing=!ctx.reducedMotion,editPins=false,pinColumn=0,pinRow=0,pinUndo=[],frame=0,pinColumnControl,pinRowControl;
  for(let i=0;i<80;i++)sim.step(1/60);
  const metal=new T.MeshStandardMaterial({color:0x7faaa1,metalness:.65,roughness:.3}),dark=new T.MeshStandardMaterial({color:0x263c35,roughness:.7}),brass=new T.MeshStandardMaterial({color:0xd3ad6e,roughness:.32,metalness:.68});
  function mesh(geometry,material,position,parent=root){const m=new T.Mesh(geometry,material);m.position.set(...position);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
  mesh(new T.BoxGeometry(6.4,.12,4.2),dark,[0,-.015,0]);
  const stand=new T.Group();root.add(stand);
  for(const x of [-2.65,2.65]){mesh(new T.CylinderGeometry(.045,.045,4.5,16),metal,[x,2.28,.77],stand);mesh(new T.BoxGeometry(.52,.1,1.3),metal,[x,.1,.77],stand);}
  const rail=mesh(new T.CylinderGeometry(.047,.047,5.4,16),metal,[0,4.43,.77],stand);rail.rotation.z=Math.PI/2;
  const sphere=mesh(new T.SphereGeometry(sim.sphere.radius,48,32),new T.MeshStandardMaterial({color:0x6c989d,metalness:.48,roughness:.3}),sim.sphere.center);
  const cradle=mesh(new T.CylinderGeometry(.72,.8,.22,48),metal,[.65,.11,0]);
  const box=mesh(new T.BoxGeometry(...sim.box.half.map(v=>v*2)),new T.MeshStandardMaterial({color:0xb99065,roughness:.67}),sim.box.center);
  for(const y of [.16,.44,.72,1])mesh(new T.BoxGeometry(1.08,.012,.013),dark,[-1.45,y,.579]);
  for(const x of [-1.88,-1.02])mesh(new T.BoxGeometry(.08,1.18,.019),metal,[x,.62,.59]);
  function texture(name){const c=document.createElement('canvas');c.width=c.height=256;const g=c.getContext('2d'),base=name==='Silk'?'#ca805f':name==='Canvas'?'#637d88':'#c2b38d';g.fillStyle=base;g.fillRect(0,0,256,256);for(let i=0;i<256;i+=4){g.fillStyle='rgba(255,255,255,.13)';g.fillRect(i,0,1,256);g.fillStyle='rgba(0,0,0,.1)';g.fillRect(0,i,256,1);}g.fillStyle='rgba(242,226,196,.8)';g.fillRect(13,0,8,256);g.fillRect(235,0,8,256);g.fillRect(0,13,256,6);g.fillRect(0,237,256,6);const map=new T.CanvasTexture(c);map.colorSpace=T.SRGBColorSpace;map.anisotropy=Math.min(8,ctx.renderer.capabilities.getMaxAnisotropy());return map;}
  const material=new T.MeshPhysicalMaterial({map:texture(sim.material),side:T.DoubleSide,roughness:.61,metalness:0,sheen:.7,sheenColor:new T.Color(0xf4c9a9),sheenRoughness:.7});
  const geometry=new T.BufferGeometry(),positions=new Float32Array(sim.positions),uv=[];for(let y=0;y<=sim.rows;y++)for(let x=0;x<=sim.columns;x++)uv.push(x/sim.columns,1-y/sim.rows);
  geometry.setAttribute('position',new T.BufferAttribute(positions,3).setUsage(T.DynamicDrawUsage));geometry.setAttribute('uv',new T.Float32BufferAttribute(uv,2));geometry.setIndex(sim.triangles);geometry.computeVertexNormals();
  const cloth=mesh(geometry,material,[0,0,0]);cloth.frustumCulled=false;
  const pinGeometry=new T.SphereGeometry(.055,12,8),pinMarkers=new T.InstancedMesh(pinGeometry,brass,sim.count);pinMarkers.count=0;pinMarkers.frustumCulled=false;root.add(pinMarkers);
  const selection=mesh(new T.SphereGeometry(.08,16,10),new T.MeshBasicMaterial({color:0xf0d28d,wireframe:true,depthTest:false}),[0,0,0]);selection.renderOrder=5;selection.visible=false;
  const borderIndices=[];for(let y=0;y<=sim.rows;y++)for(let x=0;x<=sim.columns;x++){if((y===0||y===sim.rows)&&x<sim.columns)borderIndices.push(sim.index(x,y),sim.index(x+1,y));if((x===0||x===sim.columns)&&y<sim.rows)borderIndices.push(sim.index(x,y),sim.index(x,y+1));}
  const borderPositions=new Float32Array(borderIndices.length*3),stitchMaterial=new T.LineBasicMaterial({color:0xead4af}),border=new T.LineSegments(new T.BufferGeometry().setAttribute('position',new T.BufferAttribute(borderPositions,3).setUsage(T.DynamicDrawUsage)),stitchMaterial);root.add(border);border.frustumCulled=false;
  function refresh(){positions.set(sim.positions);geometry.attributes.position.needsUpdate=true;geometry.computeVertexNormals();const m=new T.Matrix4();let index=0;for(const [i]of sim.pins){m.makeTranslation(...sim.positions.slice(i*3,i*3+3));pinMarkers.setMatrixAt(index++,m);}pinMarkers.count=index;pinMarkers.instanceMatrix.needsUpdate=true;
    for(let j=0;j<borderIndices.length;j++)for(let k=0;k<3;k++)borderPositions[j*3+k]=sim.positions[borderIndices[j]*3+k];border.geometry.attributes.position.needsUpdate=true;selection.visible=editPins;selection.position.set(...sim.positions.slice(sim.index(pinColumn,pinRow)*3,sim.index(pinColumn,pinRow)*3+3));for(const[input,value]of[[pinColumnControl,pinColumn],[pinRowControl,pinRow]])if(input){input.value=value;input.closest('label').querySelector('output').value=value;}ctx.invalidate();}
  function status(){const d=sim.diagnostics();ctx.setStatus(`${d.vertices} vertices · ${d.constraints} constraints · ${d.pins} pins · ${sim.material} · ${playing?'simulating':'paused'}`);}
  function rememberPins(){pinUndo.push(structuredClone([...sim.pins]));if(pinUndo.length>24)pinUndo.shift();}
  ui.section('Fabric & forces');
  ui.select('Material',Object.keys(MATERIALS),'Silk',name=>{sim.setMaterial(name);material.map.dispose();material.map=texture(name);material.sheen=name==='Silk'?.7:.2;material.roughness=name==='Silk'?.61:.88;material.needsUpdate=true;status();});
  ui.range('Wind strength',{min:0,max:8,step:.1,value:sim.wind,onChange:value=>{sim.wind=value;status();}});
  ui.range('Gravity',{min:0,max:14,step:.1,value:9.81,onChange:value=>{sim.gravity=-value;status();}});
  const pause=ui.button(playing?'Pause simulation':'Play simulation',()=>{playing=!playing;pause.textContent=playing?'Pause simulation':'Play simulation';status();},{primary:true});
  ui.button('Step one frame',()=>{playing=false;pause.textContent='Play simulation';sim.step(1/60);refresh();status();});
  ui.button('Reset cloth',()=>{sim.reset();refresh();status();});
  ui.section('Attachments');
  ui.select('Pin arrangement',['Corners','Three points','Top edge','Free fall'],'Corners',mode=>{rememberPins();sim.reset();sim.pinTop(mode);refresh();status();});
  const editPinsControl=ui.toggle('Edit pins by clicking cloth',false,value=>{editPins=value;refresh();});
  pinColumnControl=ui.range('Pin column',{min:0,max:sim.columns,step:1,value:0,onChange:value=>{pinColumn=value;editPins=true;editPinsControl.checked=true;refresh();}});
  pinRowControl=ui.range('Pin row',{min:0,max:sim.rows,step:1,value:0,onChange:value=>{pinRow=value;editPins=true;editPinsControl.checked=true;refresh();}});
  ui.button('Toggle selected pin',()=>{rememberPins();const index=sim.index(pinColumn,pinRow);sim.setPin(index,!sim.pins.has(index));refresh();status();});
  ui.button('Undo pin edit',()=>{const prior=pinUndo.pop();if(prior){sim.restorePins(prior);refresh();status();}});
  ui.note('Gold markers are attachments. In grab mode, drag any patch of cloth; releasing it returns the vertex to the simulation. The selected row and column offer a keyboard alternative.');
  ui.section('Collision inspection');
  ui.toggle('Wireframe collision objects',false,value=>{sphere.material.wireframe=value;box.material.wireframe=value;ctx.invalidate();});
  ui.toggle('Show cloth mesh',false,value=>{material.wireframe=value;ctx.invalidate();});
  ui.button('Freeze & export cloth OBJ',()=>{playing=false;pause.textContent='Play simulation';ctx.download('cloth-drape.obj',sim.toOBJ());status();});
  ui.note('The sphere, crate, and tabletop participate in particle contact. The stand is a visual support for the editable attachments.');
  const ray=new T.Raycaster(),plane=new T.Plane(),hit=new T.Vector3();let drag=null;
  function nearestVertex(found){const candidates=[found.face.a,found.face.b,found.face.c];let best=candidates[0],distance=Infinity;for(const i of candidates){const p=new T.Vector3(...sim.positions.slice(i*3,i*3+3)),d=p.distanceToSquared(found.point);if(d<distance){distance=d;best=i;}}return best;}
  ctx.listen(ctx.canvas,'pointerdown',event=>{ray.setFromCamera(ctx.pointer(event),ctx.camera);const found=ray.intersectObject(cloth)[0];if(!found)return;event.preventDefault();const index=nearestVertex(found);pinColumn=index%(sim.columns+1);pinRow=Math.floor(index/(sim.columns+1));if(editPins){rememberPins();sim.setPin(index,!sim.pins.has(index));refresh();status();return;}drag=event.pointerId;plane.setFromNormalAndCoplanarPoint(ctx.camera.getWorldDirection(new T.Vector3()),found.point);ctx.controls.enabled=false;ctx.canvas.setPointerCapture(event.pointerId);sim.grab(index,found.point.toArray());refresh();},{capture:true});
  ctx.listen(ctx.canvas,'pointermove',event=>{if(drag!==event.pointerId)return;ray.setFromCamera(ctx.pointer(event),ctx.camera);if(ray.ray.intersectPlane(plane,hit)){sim.grab(sim.grabbed,hit.toArray());if(!playing)for(let i=0;i<3;i++)sim.substep(1/120);refresh();}});
  const release=event=>{if(drag!==event.pointerId)return;drag=null;sim.release();ctx.controls.enabled=true;if(ctx.canvas.hasPointerCapture(event.pointerId))ctx.canvas.releasePointerCapture(event.pointerId);status();};ctx.listen(ctx.canvas,'pointerup',release);ctx.listen(ctx.canvas,'pointercancel',release);
  ctx.onFrame(dt=>{if(!playing)return;sim.step(dt);refresh();if(++frame%90===0)status();});
  refresh();status();ctx.fit(root);
  return {dispose(){sim.release();ctx.controls.enabled=true;}};
}
