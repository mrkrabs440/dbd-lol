// 히트박스 + 살인마 공격 검증 (클라 레이캐스트 대상 + 서버 판정)
const path = require('node:path');
const { io } = require(path.join(process.env.USERPROFILE, 'Desktop', 'gun game', 'node_modules', 'socket.io-client'));
const base = 'http://localhost:3100';
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { console.log((c ? 'PASS' : 'FAIL') + ' ' + n, x); c ? pass++ : fail++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  // ---------- 1) 클라: 히트박스가 Mesh 인지 (Group면 raycast 불가) ----------
  const rigSrc = fsRead('./public/js/rig.js');
  ok('rig.js에 bodyHit/headHit 생성', /bodyHit/.test(rigSrc) && /headHit/.test(rigSrc));
  ok('rig.js 반환에 히트박스 포함', /bodyHit, headHit/.test(rigSrc));
  const cliSrc = fsRead('./public/js/client.js');
  ok('클라가 headHit/bodyHit 사용', /human\.rig\.headHit/.test(cliSrc) && /human\.rig\.bodyHit/.test(cliSrc));
  ok('클라가 rig.head/torso(Group) 미사용', !/human\.rig\.head;/.test(cliSrc) && !/human\.rig\.torso;/.test(cliSrc));

  // ---------- 2) 서버: 살인마가 봇을 때리는 판정 ----------
  const gr = await fetch(base + '/api/guest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const g = await gr.json();
  const s = io(base, { auth: { token: g.token }, transports: ['websocket', 'polling'] });
  await new Promise((r) => s.on('connect', r));
  const found = await Promise.race([
    new Promise((r) => s.once('match:found', (d) => r(d))),
    (async () => { s.emit('test:start', { role: 'killer' }); await sleep(6000); return null; })(),
  ]);
  ok('테스트 매치(살인마)', !!found && found.yourRole === 'killer', found && found.yourRole);
  if (!found) process.exit(1);
  const bot = found.players.find((p) => p.isBot && p.role === 'survivor');
  ok('봇 생존자 존재', !!bot, bot && bot.nickname);

  // 살인마를 봇 근처로 이동 (서버 거리 검증용)
  s.emit('move', { position: { x: bot.position.x + 1, y: 0, z: bot.position.z }, rotation: { x: 0, y: 0, z: 0 } });
  await sleep(500);

  const dam = [], kill = [];
  s.on('player:damaged', (d) => dam.push(d));
  s.on('player:killed', (d) => kill.push(d));

  // 근접 공격 (서버 판정: 거리 4.5+1.5 이내)
  s.emit('attack_hit', { targetId: bot.socketId });
  await sleep(600);
  ok('근접 공격 판정 (봇 피격)', dam.length > 0, JSON.stringify(dam[dam.length - 1] || '없음'));
  ok('봇 HP 감소', dam.length > 0 && dam[dam.length - 1].health !== 'healthy', JSON.stringify(dam[dam.length - 1]));

  // 거리 밖 공격 → 무효
  s.emit('move', { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } });
  await sleep(400);
  const before = dam.length;
  s.emit('attack_hit', { targetId: bot.socketId });
  await sleep(500);
  ok('거리 밖 공격은 무효', dam.length === before, `추가=${dam.length - before}`);

  s.close();
  console.log(`DONE pass=${pass} fail=${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });

function fsRead(p) { return require('node:fs').readFileSync(p, 'utf8'); }
