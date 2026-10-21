// 배포된 사이트 라이브 검증: 테스트모드(생존자) + 아이템 사용
const path = require('node:path');
const { io } = require(path.join(process.env.USERPROFILE, 'Desktop', 'gun game', 'node_modules', 'socket.io-client'));
const base = 'https://dbd-lol.onrender.com';
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { console.log((c ? 'PASS' : 'FAIL') + ' ' + n, x); c ? pass++ : fail++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  // 1) 배포 client.js에 수정 반영 확인
  const c = await (await fetch(base + '/js/client.js')).text();
  ok('배포 client.js에 meSelf 수정 반영', c.includes('meSelf'));
  ok('배포 client.js에 아이템 UI 반영', c.includes('buildItemBar') && c.includes('useItem'));

  // 2) 게스트 토큰
  const gr = await fetch(base + '/api/guest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const g = await gr.json();
  ok('게스트 토큰 발급', gr.ok && !!g.token);

  // 3) 테스트 매치(생존자)
  const s = io(base, { auth: { token: g.token }, transports: ['websocket', 'polling'] });
  await new Promise((r) => s.on('connect', r));
  s.on('error:message', (d) => console.log('   (서버 메시지)', JSON.stringify(d)));
  const found = await Promise.race([
    new Promise((r) => s.once('match:found', (d) => r(d))),
    (async () => { s.emit('test:start', { role: 'survivor' }); await sleep(20000); return null; })(),
  ]);
  ok('테스트 매치 시작(생존자)', !!found, found && `역할=${found.yourRole}`);
  if (!found) { s.close(); process.exit(1); }
  ok('아이템 목록 수신', found.rules.items && found.rules.items.length === 3, JSON.stringify(found.rules.items && found.rules.items.map((i) => i.id)));
  const me = found.players.find((p) => p.socketId === found.yourSocketId);
  ok('인벤토리 지급', me && me.inventory && me.inventory.flash === 2, JSON.stringify(me && me.inventory));
  ok('봇 3명', found.players.filter((p) => p.isBot).length === 3);

  // 4) 아이템 사용
  const used = await Promise.race([
    new Promise((r) => s.once('item:used', (d) => r(d))),
    (async () => { s.emit('item:use', { item: 'flash', dx: 0, dz: -1 }); await sleep(8000); return null; })(),
  ]);
  ok('섬광탄 사용 이벤트 수신', !!used && used.item === 'flash', JSON.stringify(used && { item: used.item, hit: used.hit }));

  // 5) 봇 위치 브로드캐스트(애니메이션)
  let moved = 0;
  s.on('player:moved', (d) => { if (String(d.socketId || '').startsWith('bot_')) moved += 1; });
  await sleep(2000);
  ok('봇 위치 브로드캐스트', moved > 0, 'moved=' + moved);

  s.close();
  console.log(`DONE pass=${pass} fail=${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });