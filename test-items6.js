// DBD 교란 아이템 6종 검증 (서버 실동작)
const path = require('node:path');
const { io } = require(path.join(process.env.USERPROFILE, 'Desktop', 'gun game', 'node_modules', 'socket.io-client'));
const base = 'http://localhost:3100';
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { console.log((c ? 'PASS' : 'FAIL') + ' ' + n, x); c ? pass++ : fail++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const C = require('./server/game/constants');
  ok('아이템 6종 정의', C.SURVIVOR_ITEM_LIST.length === 6, C.SURVIVOR_ITEM_LIST.map((i) => i.id).join(','));
  ok('키 1~6 중복없음', new Set(C.SURVIVOR_ITEM_LIST.map((i) => i.key)).size === 6, C.SURVIVOR_ITEM_LIST.map((i) => i.key).join(','));

  const gr = await fetch(base + '/api/guest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const g = await gr.json();
  const s = io(base, { auth: { token: g.token }, transports: ['websocket', 'polling'] });
  await new Promise((r) => s.on('connect', r));
  const found = await Promise.race([
    new Promise((r) => s.once('match:found', (d) => r(d))),
    (async () => { s.emit('test:start', { role: 'survivor' }); await sleep(6000); return null; })(),
  ]);
  ok('테스트 매치(생존자)', !!found, found && found.yourRole);
  if (!found) process.exit(1);
  const me = found.players.find((p) => p.socketId === found.yourSocketId);
  ok('인벤토리 6종 지급', me && Object.keys(me.inventory).length === 6, JSON.stringify(me && me.inventory));
  ok('스냅샷 아이템 6종', found.rules.items && found.rules.items.length === 6);

  const usedEv = [];
  s.on('item:used', (d) => usedEv.push(d));
  const playersEv = [];
  s.on('room:players', (l) => playersEv.push(l));
  const effEv = [];
  s.on('player:effect', (d) => effEv.push(d));

  // 각 아이템 사용 (쿨다운 800ms 간격)
  for (const id of ['trap', 'smoke', 'emp', 'decoy']) {
    s.emit('item:use', { item: id, dx: 0, dz: -1 });
    await sleep(1000);
  }
  const got = usedEv.map((e) => e.item);
  ok('트랩 사용 이벤트', got.includes('trap'), got.join(','));
  ok('연막 사용 이벤트', got.includes('smoke'), got.join(','));
  ok('EMP 사용 이벤트', got.includes('emp'), got.join(','));
  ok('유인기 사용 이벤트', got.includes('decoy'), got.join(','));
  ok('EMP가 살인마 스킬 정지(이벤트)', effEv.some((e) => e.effect === 'emp'), JSON.stringify(effEv.map((e) => e.effect)));

  // 남은 재고 확인 (모두 수신한 마지막 room:players 사용)
  await sleep(800);
  const rp = playersEv[playersEv.length - 1];
  const me2 = rp && rp.find((p) => p.socketId === found.yourSocketId);
  ok('재고 감소 반영', me2 && me2.inventory.trap === 1 && me2.inventory.smoke === 0, JSON.stringify(me2 && me2.inventory));

  s.close();
  console.log(`DONE pass=${pass} fail=${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });