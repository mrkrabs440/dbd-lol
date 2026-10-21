// 모듈 그래프 실행 검증: 클라이언트 모듈을 Node에서 실제 import 해서 로딩되는지 확인
// (three 는 스텁으로 대체)
const fs = require('fs');
const path = require('node:path');
const os = require('node:os');
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { console.log((c ? 'PASS' : 'FAIL') + ' ' + n, x); c ? pass++ : fail++; };

// three 스텁 모듈 생성
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dbd-mod-'));
fs.mkdirSync(path.join(tmp, 'node_modules', 'three'), { recursive: true });
fs.writeFileSync(
  path.join(tmp, 'node_modules', 'three', 'package.json'),
  JSON.stringify({ name: 'three', version: '0.164.1', type: 'module', main: 'index.js', exports: { '.': './index.js', './addons/*': './addons/*' } })
);
const threeStub = `
class Obj3D { constructor(){ this.children=[]; this.position={set(){},copy(){},x:0,y:0,z:0}; this.rotation={set(){},x:0,y:0,z:0}; this.scale={set(){},setScalar(){}}; this.userData={}; this.visible=true; } add(o){this.children.push(o);} remove(){} }
class Mat { constructor(o){ this.color=(o&&o.color)||0; this.emissive={setHex(){}}; } }
class Vector3 { constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;} set(){return this;} copy(){return this;} clone(){return this;} add(){return this;} sub(){return this;} lerp(){return this;} normalize(){return this;} multiplyScalar(){return this;} length(){return 0;} distanceTo(){return 0;} angleTo(){return 0;} }
class Group extends Obj3D {}
class Mesh extends Obj3D { constructor(g,m){ super(); this.material=m; } }
class Sprite extends Obj3D {}
class Scene extends Obj3D {}
class Box3 { constructor(a,b){ this.min=a; this.max=b; } }
class Raycaster { constructor(){ this.ray={ intersectBox(){ return null; } }; } setFromCamera(){} }
class Geometry { constructor(){} }
class MathUtils { static clamp(v,a,b){return Math.max(a,Math.min(b,v));} static damp(a,b,l,dt){return a+(b-a)*(1-Math.exp(-l*dt));} static lerp(a,b,t){return a+(b-a)*t;} static randFloat(a,b){return a;} }
class Clock { constructor(){ this.t=0; } getDelta(){ this.t+=0.016; return 0.016; } }
class Color { constructor(c){ this.c=c; } set(){return this;} }
class FogExp2 { constructor(){} }
class Fog { constructor(){} }
class Light { constructor(){} }
export { Obj3D, Mat, Vector3, Group, Mesh, Sprite, Scene, Box3, Raycaster, Geometry, MathUtils, Clock, Color, FogExp2, Fog, Light };
export const MeshStandardMaterial = Mat;
export const MeshBasicMaterial = Mat;
export const MeshLambertMaterial = Mat;
export const SpriteMaterial = Mat;
export const BoxGeometry = Geometry;
export const CylinderGeometry = Geometry;
export const SphereGeometry = Geometry;
export const TorusGeometry = Geometry;
export const ConeGeometry = Geometry;
export const PlaneGeometry = Geometry;
export const CircleGeometry = Geometry;
export const RingGeometry = Geometry;
export const CanvasTexture = class { constructor(){} };
export const AmbientLight = Light;
export const HemisphereLight = Light;
export const PointLight = Light;
export const SpotLight = Light;
export const DirectionalLight = Light;
export const PCFSoftShadowMap = 2;
export const SRGBColorSpace = 1;
export default { Vector3, Group, Mesh, Sprite, Scene, Box3, Raycaster, MathUtils, Clock, Color, FogExp2, Fog, MeshStandardMaterial, MeshBasicMaterial, MeshLambertMaterial, SpriteMaterial, BoxGeometry, CylinderGeometry, SphereGeometry, TorusGeometry, ConeGeometry, PlaneGeometry, CircleGeometry, RingGeometry, CanvasTexture, AmbientLight, HemisphereLight, PointLight, SpotLight, DirectionalLight, PCFSoftShadowMap, SRGBColorSpace };
`;
fs.writeFileSync(path.join(tmp, 'node_modules', 'three', 'index.js'), threeStub);
fs.writeFileSync(path.join(tmp, 'node_modules', 'three', 'index.js'), threeStub);

// PointerLockControls addon 스텁 (브라우저에서는 CDN/importmap 경로)
fs.mkdirSync(path.join(tmp, 'node_modules', 'three', 'addons', 'controls'), { recursive: true });
fs.writeFileSync(
  path.join(tmp, 'node_modules', 'three', 'addons', 'controls', 'PointerLockControls.js'),
  'export class PointerLockControls { constructor(){} addEventListener(){} lock(){} unlock(){} get isLocked(){ return false; } }'
);
fs.writeFileSync(
  path.join(tmp, 'node_modules', 'three', 'addons', 'controls', 'package.json'),
  JSON.stringify({ name: 'three-addons-controls', version: '1.0.0', type: 'module', main: 'PointerLockControls.js' })
);

// 클라이언트 모듈 복사 (import 경로 유지)
for (const f of ['client.js', 'rig.js', 'maps.js']) {
  fs.copyFileSync(path.join('./public/js', f), path.join(tmp, f));
}

// DOM/브라우저 전역 스텁
const domStub = `
global.document = new Proxy({}, { get(t, k) {
  if (k === 'getElementById') return () => new Proxy({}, { get(tt, kk) {
    if (kk === 'classList') return { add(){}, remove(){}, toggle(){}, contains(){return false;} };
    if (kk === 'style') return {};
    if (kk === 'querySelector') return () => null;
    if (kk === 'querySelectorAll') return () => [];
    if (kk === 'getContext') return () => null;
    if (['appendChild','prepend','remove','addEventListener','removeEventListener','focus','click',
         'setAttribute','removeAttribute','getBoundingClientRect','closest','insertBefore',
         'cloneNode','contains','scrollIntoView','play','pause','dispatchEvent','insertAdjacentHTML',
         'getAttribute','setPointerCapture','releasePointerCapture'].includes(kk)) return () => {};
    return '';
  }, set(){ return true; } });
  if (k === 'querySelector') return () => null;
  if (k === 'querySelectorAll') return () => [];
  if (k === 'createElement') return () => ({ style:{}, appendChild(){}, getContext:()=>null });
  if (k === 'addEventListener' || k === 'removeEventListener' || k === 'exitPointerLock') return () => {};
  if (k === 'pointerLockElement') return null;
  return undefined;
}, set(){ return true; } });
global.window = { innerWidth:1280, innerHeight:720, devicePixelRatio:1, addEventListener(){}, location:{origin:'http://x'} };
global.localStorage = { getItem:()=>null, setItem(){}, removeItem(){} };
global.requestAnimationFrame = () => 0;
global.cancelAnimationFrame = () => {};
global.performance = { now: () => Date.now() };
global.addEventListener = () => {};
global.fetch = async () => ({ ok:true, json: async()=>({}), text: async()=>'' });
global.io = () => ({ on(){}, off(){}, emit(){}, connect(){}, disconnect(){}, once(){} });
global.PointerLockControls = class { constructor(){} addEventListener(){} lock(){} unlock(){} };
`;
fs.writeFileSync(path.join(tmp, 'stub.cjs'), domStub);

async function main() {
  // 1) rig.js / maps.js 개별 import
  for (const f of ['./rig.js', './maps.js']) {
    try {
      const m = await import('file:///' + path.join(tmp, f.replace('./', '')).replace(/\\/g, '/'));
      ok(`${f} import 성공`, true, Object.keys(m).join(','));
    } catch (e) {
      ok(`${f} import 성공`, false, e.message);
    }
  }

  // 2) client.js import (이게 실패하면 게임 전체가 죽는다)
  require(path.join(tmp, 'stub.cjs')); // DOM/브라우저 전역 스텁 주입
  try {
    await import('file:///' + path.join(tmp, 'client.js').replace(/\\/g, '/'));
    ok('client.js 모듈 로드 성공', true);
  } catch (e) {
    ok('client.js 모듈 로드 성공', false, e.message);
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`DONE pass=${pass} fail=${fail}`);
  process.exit(fail ? 1 : 0);
}
main();
