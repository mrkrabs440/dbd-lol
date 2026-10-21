// DBD 업그레이드 검증: 아이템 · 테스트모드 전적 제외 · 밸런스 · 봇 애니
const path = require('node:path');
const fs = require('node:fs');
const { io } = require(path.join(process.env.USERPROFILE, 'Desktop', 'gun game', 'node_modules', 'socket.io-client'));
const base = 'http://localhost:3100';
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { console.log((c ? 'PASS' : 'FAIL') + ' ' + n, x); c ? pass++ : fail++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const stamp = Date.now().toString(36).slice(-5);

async function main() {
  // 1) 상수 검증
  const C = require('./server/game/constants');
  ok('밸런스: 살인마 속도 1.18', C.KILLER_SPEED_MULTIPLIER === 1.18, String(C.KILLER_SPEED_MULTIPLIER));
  ok('밸런스: 공격 사거리 4.5', C.ATTACK_RANGE === 4.5, String(C.ATTACK_RANGE));
  ok('밸런스: 공격 쿨다운 2800', C.ATTACK_COOLDOWN_MS === 2800, String(C.ATTACK_COOLDOWN_MS));
  ok('아이템 3종 정의', C.SURVIVOR_ITEM_LIST.length === 3, C.SURVIVOR_ITEM_LIST.map((i) => i.id).join(','));
  ok('아이템 키 1/2/3', C.SURVIVOR_ITEM_LIST.map((i) => i.key).join(',') === '1,2,3');
  ok('빈사 시간 정의', C.BLEED_OUT_MS === 45000, String(C.BLEED_OUT_MS));

  // 2) 게스트 토큰 + 테스트 매치
  const gr = await fetch(base + '/api/guest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const g = await gr.json();
  ok('게스트 토큰', gr.ok && !!g.token);

  async function enter(token, role) {
    const s = io(base, { auth: { token }, transports: ['websocket', 'polling'] });
    await new Promise((r) => s.on('connect', r));
    s.emit('auth', { token });
    await Promise.race([new Promise((r) => s.once('connected', r)), sleep(6000)]);
    const found = await Promise.race([
      new Promise((r) => s.once('match:found', (d) => r(d))),
      (async () => { s.emit('test:start', { role }); await sleep(5000); return null; })(),
    ]);
    return { s, found };
  }
  const A = await enter(g.token, 'survivor');
  ok('테스트 매치(생존자) 시작', !!A.found, A.found && A.found.yourRole);
  ok('스냅샷에 아이템 목록', A.found && A.found.rules.items && A.found.rules.items.length === 3, JSON.stringify(A.found && A.found.rules.items && A.found.rules.items.map((i) => i.id)));
  const me = A.found && A.found.players.find((p) => p.socketId === A.found.yourSocketId);
  ok('생존자 인벤토리 지급', me && me.inventory && me.inventory.flash === 2 && me.inventory.decoy === 1 && me.inventory.medkit === 1, JSON.stringify(me && me.inventory));
  ok('봇 3명 생성', A.found && A.found.players.filter((p) => p.isBot).length === 3, String(A.found && A.found.players.filter((p) => p.isBot).length));
  ok('테스트 모드 플래그', A.found && A.found.isTest === true);

  // 3) 아이템 사용: 응급키트(즉시 회복)
  const healed = await Promise.race([
    new Promise((r) => A.s.once('player:healed', (d) => r(d))),
    (async () => { A.s.emit('item:use', { item: 'medkit' }); await sleep(2500); return null; })(),
  ]);
  ok('응급키트 사용 → 회복 이벤트', !!healed, JSON.stringify(healed));

  await sleep(1000); // 아이템 쿨다운(800ms) 대기
  // 4) 아이템 사용: 섬광탄
  const used = await Promise.race([
    new Promise((r) => A.s.once('item:used', (d) => r(d))),
    (async () => { A.s.emit('item:use', { item: 'flash', dx: 0, dz: -1 }); await sleep(2500); return null; })(),
  ]);
  ok('섬광탄 사용 이벤트', !!used && used.item === 'flash', JSON.stringify(used && { item: used.item, hit: used.hit }));

  // 5) 재고 소모 확인
  const rp = await Promise.race([
    new Promise((r) => A.s.once('room:players', (l) => r(l))),
    (async () => { await sleep(2000); return null; })(),
  ]);
  const me2 = rp && rp.find((p) => p.socketId === A.found.yourSocketId);
  ok('아이템 재고 감소', me2 && me2.inventory.flash === 1, JSON.stringify(me2 && me2.inventory));

  // 6) 살인마만 쓰는 아이템 불가 (생존자가 이미 소진 → 에러)
  const err = await Promise.race([
    new Promise((r) => A.s.once('error:message', (d) => r(d))),
    (async () => { A.s.emit('item:use', { item: 'medkit' }); await sleep(2000); return null; })(),
  ]);
  ok('재고 없으면 사용 거부', !!err && err.code === 'NO_ITEM', JSON.stringify(err));

  // 7) 봇 위치 브로드캐스트(애니메이션용)
  let moved = 0;
  A.s.on('player:moved', (d) => { if (d.socketId && String(d.socketId).startsWith('bot_')) moved += 1; });
  await sleep(1500);
  ok('봇 위치 브로드캐스트(애니메이션)', moved > 0, 'moved=' + moved);

  // 8) 테스트모드 전적 미반영 (서버 로그 확인은 어려우므로 코드 정적 확인)
  const rmSrc = fs.readFileSync('./server/game/roomManager.js', 'utf8');
  ok('테스트모드 전적 제외 코드', /if \(!room\.isTest\) \{\s*this\.persistMatchResults/.test(rmSrc));
  ok('빈사(혈실) 타이머 존재', /tickBleedout\(\)/.test(rmSrc));
  ok('봇 유인기 AI', /decoy/.test(rmSrc));

  // 9) 클라 정적 확인
  const cli = fs.readFileSync('./public/js/client.js', 'utf8');
  ok('클라: 아이템 바 함수', /buildItemBar/.test(cli) && /updateItemBar/.test(cli));
  ok('클라: 아이템 키 1/2/3', /Digit1.*useItem\('flash'\)/.test(cli) && /Digit3.*useItem\('medkit'\)/.test(cli));
  ok('클라: 달리기 판정 4.0', /running: remote\.speed > 4\.0/.test(cli));
  ok('클라: 스태미나 18/14', /staminaDrain: 18/.test(cli) && /staminaRegen: 14/.test(cli));
  ok('클라: 혈실 표시', /bleedOutAt/.test(cli));
  const html = fs.readFileSync('./public/index.html', 'utf8');
  ok('HTML: 아이템바/혈실 요소', html.includes('id="item-bar"') && html.includes('id="bleed-tag"'));

  A.s.close();
  console.log(`DONE pass=${pass} fail=${fail}`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error('FAIL', e); process.exit(1); });