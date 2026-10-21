// 인체 리그 방향 검증: 무릎은 뒤로, 팔꿈치는 앞으로, 모델은 카메라와 같은 방향
const fs = require('fs');
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { console.log((c ? 'PASS' : 'FAIL') + ' ' + n, x); c ? pass++ : fail++; };

// 회전 벡터 연산 (Three.js와 동일)
const rotX = (v, t) => [v[0], v[1] * Math.cos(t) - v[2] * Math.sin(t), v[1] * Math.sin(t) + v[2] * Math.cos(t)];
const rotY = (v, t) => [v[0] * Math.cos(t) + v[2] * Math.sin(t), v[1], -v[0] * Math.sin(t) + v[2] * Math.cos(t)];

const rigSrc = fs.readFileSync('./public/js/rig.js', 'utf8');
const cliSrc = fs.readFileSync('./public/js/client.js', 'utf8');

// 1) 모델 정면 방향
const eye = rigSrc.match(/eye\.position\.set\(([^)]+)\)/);
ok('모델 눈이 로컬 +Z(정면)', eye && /0\.15/.test(eye[1]), eye && eye[1]);

// 2) 클라이언트가 모델 yaw에 PI를 더하는지
ok('클라: spawnRemotes에 +Math.PI', /group\.rotation\.y = \(p\.rotation\?\.y \|\| 0\) \+ Math\.PI;/.test(cliSrc));
ok('클라: targetYaw에 +Math.PI', /targetYaw: \(p\.rotation\?\.y \|\| 0\) \+ Math\.PI,/.test(cliSrc));
ok('클라: 이동 수신에도 +Math.PI', /remote\.targetYaw = data\.rotation\.y \+ Math\.PI;/.test(cliSrc));

// 3) 무릎 부호
const kneeLine = rigSrc.match(/knee\.rotation\.x = damp\([^;]+;/);
ok('무릎 회전 부호 = 양수(뒤로 굽힘)', !!kneeLine && !/,\s*-kneeBend/.test(kneeLine[0]), kneeLine && kneeLine[0].trim().slice(0, 90));

// 4) 팔꿈치 부호
const elbowLine = rigSrc.match(/rig\.arms\[side\]\.elbow\.rotation\.x = damp\([^,]+,\s*([^,]+),/);
ok('팔꿈치 회전 부호 = 음수(앞으로 굽힘)', elbowLine && elbowLine[1].trim().startsWith('-'), elbowLine && elbowLine[1].trim());

// 5) 수학 검증: 정면(+Z)을 기준으로
const DOWN = [0, -1, 0];      // 팔다리가 아래로 뻗는 로컬 방향
const face = [0, 0, 1];        // 모델 정면
const kneeDir = rotX(DOWN, 0.6);   // 무릎 +0.6rad
const elbowDir = rotX(DOWN, -0.5); // 팔꿈치 -0.5rad
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
ok('무릎이 정면 반대쪽으로 굽힘', dot(kneeDir, face) < 0, `dot=${dot(kneeDir, face).toFixed(3)}`);
ok('팔꿈치가 정면 방향으로 굽힘', dot(elbowDir, face) > 0, `dot=${dot(elbowDir, face).toFixed(3)}`);

// 6) 모델이 카메라와 같은 방향인지 (그룹 yaw = 카메라 yaw + PI)
const camYaw = 0.7;
const modelYaw = camYaw + Math.PI;
const modelFaceWorld = rotY(face, modelYaw);
const camForwardWorld = rotY([0, 0, -1], camYaw); // 카메라는 -Z를 정면으로 봄
const d = dot(modelFaceWorld, camForwardWorld);
ok('모델 정면 = 카메라 시선방향', d > 0.999, `dot=${d.toFixed(4)}`);

// 7) 사망 낙하 방향 (앞으로 쓰러짐)
const deathDir = rotX([0, 1, 0], Math.PI / 2 - 0.1);
ok('사망 시 몸이 정면(앞)으로 쓰러짐', dot(deathDir, face) > 0, `dot=${dot(deathDir, face).toFixed(3)}`);

console.log(`DONE pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);