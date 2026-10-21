// DBD 클라이언트 모듈 로딩 + 시작Match 스모크 테스트 (three.js 자동 스텁)
const fs = require('fs');
const path = require('node:path');
const os = require('node:os');
let src = fs.readFileSync('./public/js/client.js', 'utf8');
src = src.replace(/^import[\s\S]*?from\s*'[^']+';\s*$/gm, '');

// ---------- three.js 스텁 ----------
class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { if (x !== undefined) this.x = x; if (y !== undefined) this.y = y; if (z !== undefined) this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new V3(this.x, this.y, this.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  length() { return Math.hypot(this.x, this.y, this.z); }
  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
  distanceToSquared(v) { const a = this.x - v.x, b = this.y - v.y, c = this.z - v.z; return a * a + b * b + c * c; }
  normalize() { const l = this.length() || 1; return this.set(this.x / l, this.y / l, this.z / l); }
  crossVectors(a, b) { return this.set(0, 0, 0); }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  applyMatrix4() { return this; }
  lerpVectors(a, b, t) { this.x = a.x + (b.x - a.x) * t; this.y = a.y + (b.y - a.y) * t; this.z = a.z + (b.z - a.z) * t; return this; }
  lerp(b, t) { this.x += (b.x - this.x) * t; this.y += (b.y - this.y) * t; this.z += (b.z - this.z) * t; return this; }
}
class Box3 {
  constructor(a, b) { this.min = a || new V3(); this.max = b || new V3(); }
  setFromObject() { return this; } intersectsBox() { return false; } intersectsSphere() { return false; }
  getCenter(v) { return v || new V3(); } getSize(v) { return v || new V3(); }
}
class Ray { intersectBox() { return null; } }
class Raycaster { constructor(o, d) { this.ray = new Ray(); this.far = 100; } setFromCamera() {} intersectObjects() { return []; } }
class Obj3D {
  constructor() {
    this.children = []; this.position = new V3(); this.rotation = { x: 0, y: 0, z: 0, set() {} };
    this.scale = { x: 1, y: 1, z: 1, set() {}, setScalar() {} }; this.quaternion = { setFromUnitVectors() {} };
    this.userData = {}; this.visible = true; this.castShadow = false; this.receiveShadow = false;
    this.up = new V3(0, 1, 0); this.intensity = 1; this.color = 0xffffff;
    this.shadow = { camera: { left: 0, right: 0, top: 0, bottom: 0 }, mapSize: { set() {} }, bias: 0, map: null };
    this.target = { position: new V3(), rotation: { x: 0, y: 0, z: 0, set() {} } };
    this.map = null; this.isLight = false;
  }
  add(o) { this.children.push(o); } remove() {} traverse() {} lookAt() {} clone() { return this; }
  updateMatrix() {} updateMatrixWorld() {} getWorldPosition(v) { return v || new V3(); } getWorldDirection(v) { return v.set(0, 0, -1); }
  translateX(x) { this.position.x += x; return this; } translateY(y) { this.position.y += y; return this; } translateZ(z) { this.position.z += z; return this; }
  setFromPoints() { return this; } setFromBufferAttribute() { return this; } setDrawRange() {} computeBoundingSphere() {} computeBoundingBox() {}
  setAttribute() {} getAttribute() { return { array: [], count: 0, setXYZ() {} }; }
}
class Group extends Obj3D { }
class Mesh extends Obj3D { constructor(g, m) { super(); this.material = m; this.geometry = g; } }
class Scene extends Group { }
class Camera extends Obj3D { constructor() { super(); this.aspect = 1; this.fov = 70; this.near = 0.05; this.far = 600; } updateProjectionMatrix() {} getWorldDirection(v) { return v.set(0, 0, -1); } }

const SPECIFIC = {
  Vector3: V3, Box3, Raycaster, Group, Mesh, Scene, Camera, Object3D: Obj3D,
  PerspectiveCamera: class extends Camera { constructor(fov, aspect, near, far) { super(); this.fov = fov; this.aspect = aspect; this.near = near; this.far = far; } },
  WebGLRenderer: class {
    constructor() { this.domElement = { style: {}, addEventListener() {}, removeEventListener() {} }; this.shadowMap = { enabled: false, type: 0 }; this.info = { render: { calls: 0 } }; }
    setPixelRatio() {} setSize() {} render() { this.info.render.calls++; } dispose() {} setClearColor() {} clear() {}
  },
  Clock: class { constructor() { this.t = 0; } getDelta() { this.t += 0.016; return 0.016; } },
  CanvasTexture: class { constructor() { this.repeat = { set() {} }; this.offset = { set() {} }; this.image = { width: 64, height: 64 }; } clone() { return new THREE.CanvasTexture(); } set() {} setRepeat() {} },
  MeshBasicMaterial: class { constructor(o) { this.color = (o && o.color) || 0; } clone() { return new THREE.MeshBasicMaterial(this); } },
  MeshLambertMaterial: class { constructor(o) { this.color = (o && o.color) || 0; this.emissive = { setHex() {} }; } clone() { return new THREE.MeshLambertMaterial(this); } },
  MeshStandardMaterial: class { constructor(o) { this.color = (o && o.color) || 0; this.emissive = { setHex() {} }; this.emissiveIntensity = 1; } clone() { return new THREE.MeshStandardMaterial(this); } },
  SpriteMaterial: class { constructor(o) { this.color = (o && o.color) || 0; } },
  GridHelper: class extends Obj3D { constructor() { super(); this.material = { transparent: false, opacity: 1 }; } },
};
const THREE = new Proxy(SPECIFIC, {
  get(t, k) {
    if (k in t) return t[k];
    if (typeof k !== 'string') return undefined;
    const gen = class extends Obj3D {
      constructor(...args) { super(); this.args = args; }
      set() { return this; } copy() { return this; } clone() { return this; }
      setFromObject() { return this; } setFromCamera() {} lookAt() {}
      intersectBox() { return null; } intersectObjects() { return []; }
      getWorldDirection(v) { return v.set(0, 0, -1); } updateProjectionMatrix() {}
    };
    t[k] = gen;
    return gen;
  },
});

// ---------- DOM 스텁 ----------
const mkEl = () => ({
  style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  textContent: '', innerHTML: '', value: '', width: 0, height: 0, hidden: false,
  querySelector: () => null, querySelectorAll: () => [], appendChild() {}, prepend() {}, remove() {},
  onclick: null, addEventListener() {}, removeEventListener() {},
  children: [], firstChild: null, lastChild: null, parentNode: null,
  getContext: () => ({
    fillRect() {}, clearRect() {}, fillText() {}, strokeText() {}, beginPath() {}, arc() {}, fill() {},
    moveTo() {}, lineTo() {}, stroke() {}, save() {}, restore() {}, translate() {}, rotate() {},
    createLinearGradient: () => ({ addColorStop() {} }), measureText: () => ({ width: 10 }),
    font: '', fillStyle: '', strokeStyle: '', textAlign: '', textBaseline: '',
  }),
});
global.THREE = THREE;
global.document = {
  getElementById: () => mkEl(), createElement: () => mkEl(),
  querySelector: () => mkEl(), querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {}, exitPointerLock() {}, pointerLockElement: null,
  body: { appendChild() {}, style: {} }, documentElement: { style: {} },
  body: { appendChild() {} },
};
global.window = { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1, addEventListener() {}, removeEventListener() {}, location: { origin: 'http://x' } };
global.innerWidth = 1280; global.innerHeight = 720;
global.performance = { now: () => Date.now() };
global.addEventListener = () => {}; global.removeEventListener = () => {};
global.requestAnimationFrame = () => 0; global.cancelAnimationFrame = () => {};
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
global.fetch = async () => ({ ok: true, json: async () => ({}), text: async () => '' });
global.io = () => ({ on() {}, off() {}, emit() {}, connect() {}, disconnect() {}, once() {} });
global.PointerLockControls = class { constructor() { this.isLocked = false; } addEventListener() {} lock() {} unlock() {} };

// ---------- maps.js 제공(rig/maps 모듈 스텁) ----------
let mapsSrc = fs.readFileSync('./public/js/maps.js', 'utf8');
mapsSrc = mapsSrc.replace(/^import[\s\S]*?from\s*'[^']+';\s*$/gm, '');
mapsSrc = mapsSrc.replace(/^export\s+/gm, '');
const mapsMod = new Function('THREE', mapsSrc + '\nreturn { MAP_CONCEPTS, getConcept, CONCEPT_LAYOUT };')(THREE);
// rig.js 제공(인체 리그 스텁)
let rigSrc = fs.readFileSync('./public/js/rig.js', 'utf8');
rigSrc = rigSrc.replace(/^import[\s\S]*?from\s*'[^']+';\s*$/gm, '').replace(/^export\s+/gm, '');
const rigMod = new Function('THREE', rigSrc + '\nreturn { makeHumanoid, animateHumanoid, animateExecution };')(THREE);
global.makeHumanoid = rigMod.makeHumanoid;
global.animateHumanoid = rigMod.animateHumanoid;
global.animateExecution = rigMod.animateExecution;

global.getConcept = mapsMod.getConcept;
global.MAP_CONCEPTS = mapsMod.MAP_CONCEPTS;
global.CONCEPT_LAYOUT = mapsMod.CONCEPT_LAYOUT;

// ---------- 평가 ----------
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { console.log((c ? 'PASS' : 'FAIL') + ' ' + n, x); c ? pass++ : fail++; };
const where = (e) => {
  const st = (e.stack || '').split('\n').slice(1, 3);
  for (const line of st) {
    const m = line.match(/<anonymous>:(\d+):(\d+)/);
    if (m) { const ln = parseInt(m[1], 10); const lines = src.split('\n'); return lines.slice(Math.max(0, ln - 2), ln + 1).map((l, i) => (Math.max(0, ln - 2) + i + 1 === ln ? '>>' : '  ') + l.trim().slice(0, 100)).join('\n      '); }
  }
  return '';
};

try {
  const mod = new Function('THREE', 'document', 'window', 'performance', 'addEventListener', 'requestAnimationFrame', 'removeEventListener', 'fetch', 'io', 'localStorage',
    src + '\nreturn { startMatch, initGame, buildItemBar, useItem, updateItemBar, onItemUsed, onPlayerHealed, updateEffectUI };')
    (THREE, global.document, global.window, global.performance, global.addEventListener, global.requestAnimationFrame, global.removeEventListener, global.fetch, global.io, global.localStorage);
  ok('클라이언트 모듈 평가', !!mod, '');

  // startMatch 스냅샷으로 시작 (검은 화면 원인 재현 지점)
  const snapshot = {
    roomId: 'room_test_x', status: 'playing', startedAt: Date.now(), timeLimitMs: 600000,
    yourRole: 'survivor', yourSocketId: 'me',
    players: [
      { socketId: 'me', nickname: '나', role: 'survivor', health: 'healthy', escaped: false, position: { x: 0, y: 0, z: 20 }, rotation: { x: 0, y: 0, z: 0 }, inventory: { flash: 2, decoy: 1, medkit: 1 }, bleedOutAt: 0 },
      { socketId: 'bot_1', nickname: 'BOT_훈련병', role: 'survivor', health: 'healthy', escaped: false, position: { x: 5, y: 0, z: 5 }, rotation: { x: 0, y: 0, z: 0 }, isBot: true },
      { socketId: 'bot_2', nickname: 'BOT_살인마', role: 'killer', health: 'healthy', escaped: false, position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, isBot: true },
    ],
    generators: [{ id: 'gen_1', index: 0, position: { x: -18, y: 0, z: -18 }, progress: 0, completed: false }],
    gates: [{ id: 'gate_1', position: { x: 0, y: 0, z: -28 }, open: false }],
    rules: {
      matchSize: 4, survivors: 3, killers: 1, repairRatePerSec: 6, attackRange: 4.5,
      attackCooldownMs: 2800, interactRange: 3, escapeRadius: 3,
      skills: [{ id: 'chase', name: '미궁', key: 'Q', cooldownMs: 20000, durationMs: 2500, range: 0, desc: '돌진' }],
      items: [
        { id: 'flash', name: '섬광탄', key: '1', count: 2, throwRange: 20, effectRange: 10, durationMs: 3000, desc: '실명' },
        { id: 'decoy', name: '소음 유인기', key: '2', count: 1, throwRange: 26, effectRange: 0, durationMs: 12000, desc: '유인' },
        { id: 'medkit', name: '응급 키트', key: '3', count: 1, throwRange: 0, effectRange: 0, durationMs: 0, desc: '회복' },
      ],
    },
    isTest: true,
  };
  let err = null;
  try { mod.startMatch(snapshot); } catch (e) { err = e.message + ' @ ' + where(e); }
  ok('startMatch() 무예외 (검은 화면 원인)', !err, err || '');
  err = null;
  try { mod.buildItemBar(); mod.updateItemBar(); mod.useItem('flash'); } catch (e) { err = e.message + ' @ ' + where(e); }
  ok('아이템 함수 무예외', !err, err || '');
  err = null;
  try { mod.onItemUsed({ item: 'flash', position: { x: 1, y: 0, z: 1 }, hit: true }); mod.onPlayerHealed({ socketId: 'me', to: 'injured' }); mod.updateEffectUI(); } catch (e) { err = e.message + ' @ ' + where(e); }
  ok('아이템 이벤트 핸들러 무예외', !err, err || '');
} catch (e) {
  ok('테스트 실행', false, e.message + ' @ ' + where(e));
}
console.log(`DONE pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);