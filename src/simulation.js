export const MATERIALS={
  Silk:{stretch:0.000002,shear:0.000006,bend:0.004,damping:.992,mass:.55},
  Linen:{stretch:0.0000007,shear:0.000002,bend:0.0005,damping:.987,mass:.9},
  Canvas:{stretch:0.00000003,shear:0.0000002,bend:0.000008,damping:.978,mass:1.35},
};
export class ClothSimulation {
  constructor({columns=32,rows=26,width=4.5,height=3.55,material='Silk',wind=1.8,sphere={center:[.65,1.6,0],radius:1.03},box={center:[-1.45,.61,.05],half:[.55,.61,.52]}}={}){
    if(!Number.isInteger(columns)||!Number.isInteger(rows)||columns<3||rows<3||columns>70||rows>70)throw new RangeError('Grid dimensions must be integers between 3 and 70.');
    if(![width,height,wind].every(Number.isFinite)||width<=0||height<=0)throw new RangeError('Cloth dimensions must be positive and wind finite.');
    this.columns=columns;this.rows=rows;this.width=width;this.height=height;this.count=(columns+1)*(rows+1);this.material=MATERIALS[material]?material:'Silk';this.wind=wind;this.gravity=-9.81;this.sphere=structuredClone(sphere);this.box=structuredClone(box);this.floor=.045;this.thickness=.035;
    this.positions=new Float64Array(this.count*3);this.previous=new Float64Array(this.count*3);this.rest=new Float64Array(this.count*3);this.invMass=new Float64Array(this.count).fill(1);this.pins=new Map();this.constraints=[];this.triangles=[];this.time=0;this.accumulator=0;this.grabbed=null;
    for(let y=0;y<=rows;y++)for(let x=0;x<=columns;x++){const i=this.index(x,y)*3;this.positions[i]=(x/columns-.5)*width;this.positions[i+1]=4.3-y/rows*height;this.positions[i+2]=.77+.06*Math.sin(x/columns*Math.PI);if(x<columns&&y<rows){const a=this.index(x,y),b=this.index(x+1,y),c=this.index(x,y+1),d=this.index(x+1,y+1);this.triangles.push(a,c,b,b,c,d);}}
    this.previous.set(this.positions);this.rest.set(this.positions);
    const add=(x,y,dx,dy,kind)=>{if(x+dx>columns||y+dy>rows||x+dx<0)return;const a=this.index(x,y),b=this.index(x+dx,y+dy);let sum=0;for(let k=0;k<3;k++)sum+=(this.positions[a*3+k]-this.positions[b*3+k])**2;this.constraints.push({a,b,rest:Math.sqrt(sum),kind,lambda:0});};
    for(let y=0;y<=rows;y++)for(let x=0;x<=columns;x++){add(x,y,1,0,'stretch');add(x,y,0,1,'stretch');add(x,y,1,1,'shear');add(x,y,-1,1,'shear');add(x,y,2,0,'bend');add(x,y,0,2,'bend');}
    this.pinTop('Corners');this.resolveCollisions();this.previous.set(this.positions);
  }
  index(x,y){return y*(this.columns+1)+x;}
  setMaterial(name){if(!MATERIALS[name])throw new RangeError('Unknown material.');this.material=name;}
  pinTop(mode){this.pins.clear();this.invMass.fill(1);if(mode==='Free fall')return;const xs=mode==='Top edge'?Array.from({length:this.columns+1},(_,i)=>i):mode==='Three points'?[0,Math.round(this.columns/2),this.columns]:[0,this.columns];for(const x of xs)this.setPin(this.index(x,0),true);}
  setPin(index,enabled){if(!Number.isInteger(index)||index<0||index>=this.count)throw new RangeError('Invalid vertex index.');if(enabled){this.pins.set(index,Array.from(this.positions.slice(index*3,index*3+3)));this.invMass[index]=0;}else{this.pins.delete(index);this.invMass[index]=1;}}
  grab(index,position){if(!Array.isArray(position)||position.length!==3||!position.every(Number.isFinite))throw new TypeError('Finite grab position required.');if(this.grabbed===null){if(index<0||index>=this.count)throw new RangeError('Invalid grab vertex.');this.grabbed=index;}const from=Array.from(this.positions.slice(this.grabbed*3,this.grabbed*3+3));this.grabTarget=this.clipGrab(from,position.map(v=>Math.min(8,Math.max(-8,v))));this.positions.set(this.grabTarget,this.grabbed*3);this.previous.set(this.grabTarget,this.grabbed*3);this.invMass[this.grabbed]=0;}
  clipGrab(from,to){
    const d=to.map((v,i)=>v-from[i]);let stop=1;
    if(this.sphere){const radius=this.sphere.radius+this.thickness,m=from.map((v,i)=>v-this.sphere.center[i]),a=d.reduce((s,v)=>s+v*v,0),b=m.reduce((s,v,i)=>s+v*d[i],0),c=m.reduce((s,v)=>s+v*v,0)-radius*radius,disc=b*b-a*c;if(a>1e-12&&disc>=0&&c>=-1e-6){const t=(-b-Math.sqrt(disc))/a;if(t>=-1e-6&&t<stop&&b<0)stop=Math.max(0,t-.002);}}
    if(this.box){let enter=0,exit=1;for(let i=0;i<3;i++){const lo=this.box.center[i]-this.box.half[i]-this.thickness,hi=this.box.center[i]+this.box.half[i]+this.thickness;if(Math.abs(d[i])<1e-10){if(from[i]<lo||from[i]>hi){enter=2;break;}}else{let a=(lo-from[i])/d[i],b=(hi-from[i])/d[i];if(a>b)[a,b]=[b,a];enter=Math.max(enter,a);exit=Math.min(exit,b);}}if(enter<=exit&&exit>0&&enter<stop)stop=Math.max(0,enter-.002);}
    const out=from.map((v,i)=>v+d[i]*stop);out[1]=Math.max(this.floor+this.thickness,out[1]);return out;
  }
  release(){if(this.grabbed!==null){this.invMass[this.grabbed]=this.pins.has(this.grabbed)?0:1;if(this.pins.has(this.grabbed))this.pins.set(this.grabbed,this.grabTarget.slice());this.grabbed=null;}}
  reset(){this.release();this.positions.set(this.rest);this.previous.set(this.rest);this.time=0;this.accumulator=0;for(const [i] of this.pins)this.pins.set(i,Array.from(this.rest.slice(i*3,i*3+3)));this.resolveCollisions();this.previous.set(this.positions);}
  restorePins(entries){this.release();this.pins.clear();this.invMass.fill(1);for(const entry of entries){const i=Array.isArray(entry)?entry[0]:entry;if(Array.isArray(entry)){this.positions.set(entry[1],i*3);this.previous.set(entry[1],i*3);}this.setPin(i,true);}}
  step(dt){if(!Number.isFinite(dt)||dt<0)throw new RangeError('Finite positive timestep required.');this.accumulator+=Math.min(dt,1/30);const h=1/120;let steps=0;while(this.accumulator+1e-10>=h&&steps<4){this.substep(h);this.accumulator-=h;steps++;}return steps;}
  substep(h){
    this.time+=h;const p=this.positions,old=this.previous,m=MATERIALS[this.material];
    for(let i=0;i<this.count;i++){if(!this.invMass[i])continue;const k=i*3,x=p[k],y=p[k+1],z=p[k+2],vx=(x-old[k])*m.damping,vy=(y-old[k+1])*m.damping,vz=(z-old[k+2])*m.damping;old[k]=x;old[k+1]=y;old[k+2]=z;
      p[k]=x+vx+Math.sin(this.time*1.7+y*1.2)*this.wind*.11*h*h/m.mass;p[k+1]=y+vy+this.gravity*h*h;p[k+2]=z+vz+this.wind*(.7+Math.sin(this.time*2.2+x*1.8+y)*.45)*h*h/m.mass;}
    for(const c of this.constraints)c.lambda=0;
    for(let pass=0;pass<7;pass++){
      for(const c of this.constraints){const ai=c.a*3,bi=c.b*3,wa=this.invMass[c.a],wb=this.invMass[c.b];if(!wa&&!wb)continue;const dx=p[ai]-p[bi],dy=p[ai+1]-p[bi+1],dz=p[ai+2]-p[bi+2],len=Math.hypot(dx,dy,dz);if(len<1e-12)continue;const alpha=m[c.kind]/(h*h),dl=(-(len-c.rest)-alpha*c.lambda)/(wa+wb+alpha);c.lambda+=dl;const correction=dl/len;for(let k=0;k<3;k++){const d=k===0?dx:k===1?dy:dz;p[ai+k]+=wa*correction*d;p[bi+k]-=wb*correction*d;}}
      this.resolveCollisions();
      for(const [i,position]of this.pins)p.set(position,i*3);if(this.grabbed!==null)p.set(this.grabTarget,this.grabbed*3);
    }
  }
  resolveCollisions(){const p=this.positions,old=this.previous;
    for(let i=0;i<this.count;i++){if(!this.invMass[i])continue;const k=i*3;let hit=false;
      if(p[k+1]<this.floor+this.thickness){p[k+1]=this.floor+this.thickness;hit=true;}
      if(this.sphere){const c=this.sphere.center,r=this.sphere.radius+this.thickness,dx=p[k]-c[0],dy=p[k+1]-c[1],dz=p[k+2]-c[2],len=Math.hypot(dx,dy,dz);if(len<r){const scale=r/Math.max(len,1e-8);p[k]=c[0]+dx*scale;p[k+1]=c[1]+dy*scale;p[k+2]=c[2]+(len<1e-8?r:dz*scale);hit=true;}}
      if(this.box){const b=this.box,delta=[p[k]-b.center[0],p[k+1]-b.center[1],p[k+2]-b.center[2]],half=b.half.map(v=>v+this.thickness);if(delta.every((v,j)=>Math.abs(v)<half[j])){let axis=0;for(let j=1;j<3;j++)if(half[j]-Math.abs(delta[j])<half[axis]-Math.abs(delta[axis]))axis=j;p[k+axis]=b.center[axis]+(delta[axis]>=0?1:-1)*half[axis];hit=true;}}
      if(hit)for(let j=0;j<3;j++)old[k+j]=p[k+j]-(p[k+j]-old[k+j])*.82;
    }
  }
  diagnostics(){let maxStretch=1;for(const c of this.constraints){if(c.kind!=='stretch')continue;const a=c.a*3,b=c.b*3;maxStretch=Math.max(maxStretch,Math.hypot(this.positions[a]-this.positions[b],this.positions[a+1]-this.positions[b+1],this.positions[a+2]-this.positions[b+2])/c.rest);}return {vertices:this.count,constraints:this.constraints.length,pins:this.pins.size,finite:this.positions.every(Number.isFinite),maxStretch,time:this.time};}
  toOBJ(){const lines=['# XPBD cloth snapshot; world-space vertices, meters'];for(let i=0;i<this.count;i++)lines.push(`v ${Array.from(this.positions.slice(i*3,i*3+3),v=>v.toFixed(6)).join(' ')}`);for(let i=0;i<this.triangles.length;i+=3)lines.push(`f ${this.triangles[i]+1} ${this.triangles[i+1]+1} ${this.triangles[i+2]+1}`);return lines.join('\n');}
}
