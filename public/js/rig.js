import * as THREE from 'three';

// ===========================================================================
// 인간형 캐릭터 리그 (살인마 / 생존자)
// ---------------------------------------------------------------------------
// 뼈대(hierarchy):
//   root
//   └ pelvis ─ torso ─ neck ─ head
//               ├ armL(shoulder) ─ elbow ─ forearm ─ hand
//               └ armR(shoulder) ─ elbow ─ forearm ─ hand
//   ├ legL(hip) ─ knee ─ shin ─ foot
//   └ legR(hip) ─ knee ─ shin ─ foot
// animateHumanoid() 가 속도/체력상태를 보고 보행·달리기·절뚝임·기어긋기·사망
// 애니메이션을 갱신한다.
// ===========================================================================

const SKIN = {
  killer: 0xb9b2ad,
  survivor: 0xd0a888,
};

export function makeHumanoid(role, nickname, palette = {}) {
  const isKiller = role === 'killer';
  const group = new THREE.Group();

  const skinColor = palette.skin ?? (isKiller ? SKIN.killer : SKIN.survivor);
  const clothColor = palette.cloth ?? (isKiller ? 0x2b1016 : 0x14332b);
  const accentColor = palette.accent ?? (isKiller ? 0x6d1018 : 0x1d5344);
  const headColor = palette.head ?? (isKiller ? 0x17171b : 0x101216);

  const skinMat = new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.72, metalness: 0.02 });
  const clothMat = new THREE.MeshStandardMaterial({ color: clothColor, roughness: 0.88, metalness: 0.05 });
  const accentMat = new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.7, metalness: 0 });
  const headMat = new THREE.MeshStandardMaterial({ color: headColor, roughness: 0.55, metalness: 0.25 });

  const box = (w, h, d, mat) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };

  // --- 골반 ---
  const pelvis = new THREE.Group();
  pelvis.position.y = 0.94;
  group.add(pelvis);
  pelvis.add(box(0.36, 0.24, 0.22, clothMat));

  // --- 몸통 ---
  const torso = new THREE.Group();
  torso.position.y = 0.16;
  pelvis.add(torso);
  const chest = box(0.42, 0.5, 0.25, clothMat);
  chest.position.y = 0.26;
  torso.add(chest);
  const jacket = box(0.46, 0.26, 0.28, accentMat);
  jacket.position.y = 0.38;
  torso.add(jacket);
  // 목
  const neck = new THREE.Group();
  neck.position.y = 0.52;
  torso.add(neck);
  neck.add(box(0.11, 0.1, 0.11, skinMat));

  // --- 머리 ---
  const head = new THREE.Group();
  head.position.y = 0.08;
  neck.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 14), skinMat);
  skull.scale.set(0.94, 1.08, 1);
  skull.position.y = 0.11;
  skull.castShadow = true;
  head.add(skull);
  const jaw = box(0.2, 0.1, 0.22, skinMat);
  jaw.position.set(0, 0.02, 0.03);
  head.add(jaw);
  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(0.175, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
    headMat
  );
  cap.position.y = 0.12;
  head.add(cap);
  const eyeMat = new THREE.MeshBasicMaterial({ color: isKiller ? 0xff2020 : 0xf2f2f0 });
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 8), eyeMat);
    eye.position.set(0.058 * sx, 0.13, 0.15);
    head.add(eye);
  }
  if (isKiller) {
    const mask = box(0.24, 0.16, 0.06, new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 0.35 }));
    mask.position.set(0, 0.08, 0.16);
    head.add(mask);
    for (const sx of [-1, 1]) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 6), headMat);
      spike.position.set(0.1 * sx, 0.2, 0);
      spike.rotation.z = sx * 0.4;
      head.add(spike);
    }
  }

  // --- 팔 ---
  const arms = {};
  for (const side of ['L', 'R']) {
    const sx = side === 'L' ? -1 : 1;
    const shoulder = new THREE.Group();
    shoulder.position.set(0.235 * sx, 0.42, 0);
    torso.add(shoulder);
    shoulder.add(box(0.14, 0.14, 0.16, accentMat));
    const upper = box(0.105, 0.3, 0.115, clothMat);
    upper.position.y = -0.16;
    shoulder.add(upper);
    const elbow = new THREE.Group();
    elbow.position.y = -0.31;
    shoulder.add(elbow);
    const fore = box(0.095, 0.28, 0.1, skinMat);
    fore.position.y = -0.14;
    elbow.add(fore);
    const hand = box(0.1, 0.11, 0.11, skinMat);
    hand.position.y = -0.31;
    elbow.add(hand);
    arms[side] = { shoulder, elbow, hand };
  }

  // --- 다리 ---
  const legs = {};
  for (const side of ['L', 'R']) {
    const sx = side === 'L' ? -1 : 1;
    const hip = new THREE.Group();
    hip.position.set(0.115 * sx, -0.1, 0);
    pelvis.add(hip);
    const thigh = box(0.155, 0.42, 0.17, clothMat);
    thigh.position.y = -0.21;
    hip.add(thigh);
    const knee = new THREE.Group();
    knee.position.y = -0.42;
    hip.add(knee);
    const shin = box(0.13, 0.4, 0.14, clothMat);
    shin.position.y = -0.2;
    knee.add(shin);
    const foot = box(0.15, 0.1, 0.26, new THREE.MeshStandardMaterial({ color: 0x101012, roughness: 0.9 }));
    foot.position.set(0, -0.4, 0.05);
    knee.add(foot);
    legs[side] = { hip, knee, foot };
  }

  // 무기(살인마만)
  if (isKiller) {
    const weapon = new THREE.Group();
    const blade = box(0.05, 0.62, 0.02, new THREE.MeshStandardMaterial({ color: 0xc8ccd4, roughness: 0.25, metalness: 0.85 }));
    blade.position.y = -0.24;
    weapon.add(blade);
    const hilt = box(0.07, 0.16, 0.05, new THREE.MeshStandardMaterial({ color: 0x2a1a12, roughness: 0.8 }));
    hilt.position.y = 0.1;
    weapon.add(hilt);
    weapon.position.set(0, -0.34, 0.06);
    weapon.rotation.x = -0.5;
    arms.R.elbow.add(weapon);
  }

  return {
    group,
    rig: { pelvis, torso, neck, head, arms, legs },
    role,
    phase: Math.random() * Math.PI * 2,
    speed: 0,
  };
}

// ---------------------------------------------------------------------------
// 애니메이션
// ---------------------------------------------------------------------------
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

export function animateHumanoid(h, dt, time, st = {}) {
  const { rig } = h;
  const speed = st.speed || 0;
  const running = !!st.running;
  const health = st.health || 'healthy';
  const dead = !!st.dead;
  const down = !!st.down;

  const stride = running ? 7.2 : 5.4;
  h.phase += dt * stride * Math.min(1, speed / (running ? 6 : 3.4));
  const p = h.phase;
  const swing = Math.min(1, speed / (running ? 6 : 3.4));
  const legAmp = (running ? 0.85 : 0.55) * swing;
  const armAmp = (running ? 0.7 : 0.42) * swing;
  const injured = health === 'injured' || health === 'dying';

  if (dead) {
    rig.pelvis.position.y = damp(rig.pelvis.position.y, 0.22, 6, dt);
    rig.pelvis.rotation.x = damp(rig.pelvis.rotation.x, Math.PI / 2 - 0.1, 6, dt);
    rig.torso.rotation.x = damp(rig.torso.rotation.x, 0.12, 6, dt);
    rig.neck.rotation.x = damp(rig.neck.rotation.x, 0.5, 6, dt);
    for (const side of ['L', 'R']) {
      const s = side === 'L' ? -1 : 1;
      rig.arms[side].shoulder.rotation.x = damp(rig.arms[side].shoulder.rotation.x, 0.4, 6, dt);
      rig.arms[side].shoulder.rotation.z = damp(rig.arms[side].shoulder.rotation.z, 0.9 * s, 6, dt);
      rig.arms[side].elbow.rotation.x = damp(rig.arms[side].elbow.rotation.x, -0.3, 6, dt);
      rig.legs[side].hip.rotation.x = damp(rig.legs[side].hip.rotation.x, -0.25 * s, 6, dt);
      rig.legs[side].knee.rotation.x = damp(rig.legs[side].knee.rotation.x, 0.5, 6, dt);
    }
    return;
  }

  if (down) {
    rig.pelvis.position.y = damp(rig.pelvis.position.y, 0.34, 6, dt);
    rig.pelvis.rotation.x = damp(rig.pelvis.rotation.x, 0.28, 6, dt);
    rig.torso.rotation.x = damp(rig.torso.rotation.x, 0.12, 6, dt);
    for (const side of ['L', 'R']) {
      const s = side === 'L' ? -1 : 1;
      const crawl = Math.sin(p * 1.6 + (s > 0 ? Math.PI : 0));
      rig.arms[side].shoulder.rotation.x = damp(rig.arms[side].shoulder.rotation.x, -1.1 + crawl * 0.5, 8, dt);
      rig.arms[side].elbow.rotation.x = damp(rig.arms[side].elbow.rotation.x, -0.5, 8, dt);
      rig.legs[side].hip.rotation.x = damp(rig.legs[side].hip.rotation.x, 0.25 - crawl * 0.25, 8, dt);
      rig.legs[side].knee.rotation.x = damp(rig.legs[side].knee.rotation.x, -0.7, 8, dt);
    }
    return;
  }

  // --- 서 있음 / 걷기 / 달리기 ---
  const bobY = Math.abs(Math.sin(p)) * (running ? 0.075 : 0.035) * swing;
  rig.pelvis.position.y = damp(rig.pelvis.position.y, 0.94 + bobY, 14, dt);
  rig.pelvis.rotation.z = damp(rig.pelvis.rotation.z, Math.sin(p) * 0.05 * swing, 10, dt);
  rig.pelvis.rotation.y = damp(rig.pelvis.rotation.y, -Math.sin(p) * 0.09 * swing, 10, dt);

  const lean = running ? 0.16 : 0.05;
  rig.torso.rotation.x = damp(rig.torso.rotation.x, lean * swing + (injured ? 0.14 : 0), 8, dt);
  rig.torso.position.y = damp(rig.torso.position.y, Math.sin(time * 1.6) * 0.012, 6, dt);
  rig.neck.rotation.x = damp(rig.neck.rotation.x, -lean * 0.6 * swing, 8, dt);

  for (const side of ['L', 'R']) {
    const s = side === 'L' ? -1 : 1;
    const phase = p + (s < 0 ? 0 : Math.PI);
    const legSin = Math.sin(phase);
    const limp = injured && s < 0 ? 0.45 : 1;

    rig.legs[side].hip.rotation.x = damp(rig.legs[side].hip.rotation.x, -legSin * legAmp * limp, 16, dt);
    // 무릎은 뒤로 굽혀야 한다(+X) — 앞(모델 정면)으로 꺾이면 이상하게 보인다
    const kneeBend = Math.max(0, -legSin) * 0.9 * limp + (injured && s < 0 ? 0.25 : 0);
    rig.legs[side].knee.rotation.x = damp(rig.legs[side].knee.rotation.x, kneeBend, 16, dt);
    rig.legs[side].foot.rotation.x = damp(rig.legs[side].foot.rotation.x, -Math.max(0, legSin) * 0.35, 12, dt);

    const armSin = Math.sin(phase + Math.PI);
    if (injured && s < 0) {
      rig.arms[side].shoulder.rotation.x = damp(rig.arms[side].shoulder.rotation.x, -0.5, 10, dt);
      rig.arms[side].shoulder.rotation.z = damp(rig.arms[side].shoulder.rotation.z, 0.85 * s, 10, dt);
      rig.arms[side].elbow.rotation.x = damp(rig.arms[side].elbow.rotation.x, -1.7, 10, dt);
    } else {
      rig.arms[side].shoulder.rotation.x = damp(rig.arms[side].shoulder.rotation.x, armSin * armAmp, 14, dt);
      rig.arms[side].shoulder.rotation.z = damp(rig.arms[side].shoulder.rotation.z, 0.12 * s, 12, dt);
      rig.arms[side].elbow.rotation.x = damp(rig.arms[side].elbow.rotation.x, -0.28 - Math.max(0, armSin) * 0.4, 14, dt);
    }
  }

  // 공격 모션(살인마)
  if (st.attackT > 0) {
    const k = Math.min(1, st.attackT / 0.22);
    const swingCurve = Math.sin(k * Math.PI);
    rig.arms.R.shoulder.rotation.x = -1.9 * swingCurve;
    rig.arms.R.elbow.rotation.x = -0.4 * swingCurve;
    rig.torso.rotation.y = -0.5 * swingCurve;
    rig.torso.rotation.x += 0.18 * swingCurve;
  } else {
    rig.torso.rotation.y = damp(rig.torso.rotation.y, 0, 8, dt);
  }
}

// 처형(내치기) 모션 — 살인마가 붙잡고 들어올리는 연출
export function animateExecution(h, dt, time, progress) {
  const { rig } = h;
  const k = Math.min(1, Math.max(0, progress));
  rig.pelvis.position.y = 0.94;
  rig.torso.rotation.x = 0.12 + k * 0.28;
  rig.torso.rotation.y = -0.45 * k;
  rig.neck.rotation.x = 0.18 * k;
  rig.arms.R.shoulder.rotation.x = -2.0 * k;
  rig.arms.R.elbow.rotation.x = -0.5 * k;
  rig.arms.L.shoulder.rotation.x = -1.4 * k;
  rig.arms.L.elbow.rotation.x = -0.8 * k;
  for (const side of ['L', 'R']) {
    const s = side === 'L' ? -1 : 1;
    rig.legs[side].hip.rotation.x = 0.15 * k;
    rig.legs[side].knee.rotation.x = -0.2 * k;
    rig.arms[side].shoulder.rotation.z = 0.3 * s * (1 - k);
  }
}
