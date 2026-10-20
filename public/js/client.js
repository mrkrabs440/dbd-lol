import * as THREE from 'three';
import { makeHumanoid, animateHumanoid, animateExecution } from './rig.js';
import { MAP_CONCEPTS, getConcept } from './maps.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

// ===========================================================================
// DBD Clone 게임 클라이언트 (Vanilla JS + Three.js)
// ---------------------------------------------------------------------------
// 화면 흐름: [로그인/회원가입] → [로비/매칭] → [인게임 HUD]
// 서버 권위 모델: 이동은 50ms 스로틀로 전송, 수리/공격/승패 판정은 서버가 최종 검증.
// ===========================================================================

const $ = (id) => document.getElementById(id);

const els = {
  screens: {
    auth: $('screen-auth'),
    lobby: $('screen-lobby'),
    game: $('screen-game'),
  },
  tabLogin: $('tab-login'),
  tabRegister: $('tab-register'),
  formLogin: $('form-login'),
  formRegister: $('form-register'),
  authMessage: $('auth-message'),
  connStatus: $('conn-status'),
  userChip: $('user-chip'),
  lobbyNickname: $('lobby-nickname'),
  lobbyEmail: $('lobby-email'),
  statWins: $('stat-wins'),
  statLosses: $('stat-losses'),
  statWinrate: $('stat-winrate'),
  statPlayed: $('stat-played'),
  btnFindMatch: $('btn-find-match'),
  btnCancelMatch: $('btn-cancel-match'),
  btnLogout: $('btn-logout'),
  btnRefreshProfile: $('btn-refresh-profile'),
  queuePanel: $('queue-panel'),
  queueStatus: $('queue-status'),
  lobbyMessage: $('lobby-message'),
  gameContainer: $('game-container'),
  roleBox: $('hud-role'),
  roleTitle: $('role-title'),
  roleDesc: $('role-desc'),
  objective: $('hud-objective'),
  mapTag: $('map-tag'),
  generators: $('hud-generators'),
  crosshair: $('crosshair'),
  hitmarker: $('hitmarker'),
  interactPrompt: $('interact-prompt'),
  repairWrap: $('repair-wrap'),
  repairLabel: $('repair-label'),
  repairFill: $('repair-fill'),
  repairText: $('repair-text'),
  cooldownWrap: $('cooldown-wrap'),
  skillWrap: $('skill-wrap'),
  skillBar: $('skill-bar'),
  blindOverlay: $('blind-overlay'),
  testKillerBtn: $('btn-test-killer'),
  testSurvivorBtn: $('btn-test-survivor'),
  cooldownFill: $('cooldown-fill'),
  cooldownText: $('cooldown-text'),
  healthWrap: $('health-wrap'),
  healthBar: $('health-bar'),
  healthFill: $('health-fill'),
  staminaWrap: $('stamina-wrap'),
  staminaFill: $('stamina-fill'),
  execOverlay: $('exec-overlay'),
  stunTag: $('stun-tag'),
  chaseTag: $('chase-tag'),
  healthPips: $('health-pips'),
  killfeed: $('killfeed'),
  toast: $('toast'),
  lockHint: $('lock-hint'),
  damageFlash: $('damage-flash'),
  eventFlash: $('event-flash'),
  killerVignette: $('killer-vignette'),
  matchEnd: $('match-end'),
  endTitle: $('end-title'),
  endReason: $('end-reason'),
  endPlayers: $('end-players'),
  btnBackLobby: $('btn-back-lobby'),
};

// ---------------------------------------------------------------------------
// 세션 / 소켓 상태
// ---------------------------------------------------------------------------
const TOKEN_KEY = 'dbd_token';
const USER_KEY = 'dbd_user';

const session = {
  token: localStorage.getItem(TOKEN_KEY),
  user: JSON.parse(localStorage.getItem(USER_KEY) || 'null'),
};

const net = {
  pendingTestRole: null,
  socket: null,
  socketId: null,
  inQueue: false,
};

const game = {
  active: false,
  match: null,
  role: null,
  mySocketId: null,
  gatesOpen: false,
  myHealth: 'healthy',
  escaped: false,
  // 살인마 스킬
  skills: [],
  skillReadyAt: {},
  skillActiveUntil: 0,
  chaseUntil: 0,
  // 상태 이상
  stunnedUntil: 0,
  blindedUntil: 0,
  isTest: false,
  // 처형(내치기) 연출
  executing: false,
  execT: 0,
  execTarget: null,
  execBy: null,
};

// ---------------------------------------------------------------------------
// Three.js 상태
// ---------------------------------------------------------------------------
const view = {
  renderer: null,
  scene: null,
  camera: null,
  controls: null,
  clock: null,
  rafId: 0,
  keys: new Set(),
  playerPos: new THREE.Vector3(0, 1.7, 0),
  eyeHeight: 1.7,
  baseSpeed: 3.2,
  walkSpeed: 3.2,
  runSpeed: 6.4,
  crouchSpeed: 1.7,
  velocity: new THREE.Vector3(),
  sprinting: false,
  stamina: 100,
  staminaMax: 100,
  staminaDrain: 22,
  staminaRegen: 16,
  bobPhase: 0,
  bobAmount: 0,
  landShake: 0,
  moveAccum: 0,
  remotes: new Map(),
  generators: new Map(),
  gates: [],
  colliders: [],
  flashlight: null,
  repair: { generatorId: null, progress: 0, lastEmit: 0, active: false },
  cooldownUntil: 0,
  cooldownMs: 2500,
  chaseUntil: 0,
  blindUntil: 0,
  shakeUntil: 0,
  shakeAmp: 0,
  escapeEmitAt: 0,
  raycaster: new THREE.Raycaster(),
};

const HEALTH_LABEL = {
  healthy: '건강',
  injured: '부상',
  dying: '빈사',
  dead: '사망',
};

const HEALTH_PIPS = {
  healthy: '●●●',
  injured: '●●○',
  dying: '●○○',
  dead: '○○○',
};

// ===========================================================================
// 공용 UI 헬퍼
// ===========================================================================
function setScreen(name) {
  for (const [key, section] of Object.entries(els.screens)) {
    section.classList.toggle('active', key === name);
  }
}

function setConn(online, text) {
  els.connStatus.classList.toggle('online', online);
  els.connStatus.classList.toggle('offline', !online);
  els.connStatus.textContent = text;
}

function authMessage(text) {
  els.authMessage.textContent = text || '';
}

function lobbyMessage(text) {
  els.lobbyMessage.textContent = text || '';
}

let toastTimer = null;
function toast(text, ms = 2600) {
  els.toast.textContent = text;
  els.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.add('hidden'), ms);
}

function feed(text, good = false) {
  const li = document.createElement('li');
  if (good) li.classList.add('good');
  li.textContent = text;
  els.killfeed.prepend(li);
  while (els.killfeed.children.length > 5) {
    els.killfeed.lastChild.remove();
  }
  setTimeout(() => li.remove(), 8000);
}

function flash(element, ms = 180) {
  element.classList.add('show');
  setTimeout(() => element.classList.remove('show'), ms);
}

// ===========================================================================
// REST API
// ===========================================================================
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(session.token ? { Authorization: `Bearer ${session.token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || `요청 실패 (${res.status})`);
  }
  return data;
}

function saveSession(token, user) {
  session.token = token;
  session.user = user;
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  els.userChip.textContent = user.nickname || user.email;
  els.userChip.classList.remove('hidden');
}

function clearSession() {
  session.token = null;
  session.user = null;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  els.userChip.classList.add('hidden');
}

function renderProfile(user) {
  if (!user) return;
  els.lobbyNickname.textContent = user.nickname || '(닉네임 없음)';
  els.lobbyEmail.textContent = user.email || '';
  const stats = user.gameStats || {};
  const wins = stats.wins || 0;
  const losses = stats.losses || 0;
  const played = stats.matchesPlayed ?? wins + losses;
  const rate = user.winRate ?? (played > 0 ? Number(((wins / played) * 100).toFixed(1)) : 0);
  els.statWins.textContent = String(wins);
  els.statLosses.textContent = String(losses);
  els.statPlayed.textContent = String(played);
  els.statWinrate.textContent = `${rate}%`;
}

async function refreshProfile() {
  try {
    const data = await api('/api/auth/me');
    session.user = data.user;
    localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    renderProfile(data.user);
  } catch (err) {
    lobbyMessage(err.message);
  }
}

// ===========================================================================
// 인증 화면 이벤트
// ===========================================================================
els.tabLogin.addEventListener('click', () => {
  els.tabLogin.classList.add('active');
  els.tabRegister.classList.remove('active');
  els.formLogin.classList.remove('hidden');
  els.formRegister.classList.add('hidden');
  authMessage('');
});

els.tabRegister.addEventListener('click', () => {
  els.tabRegister.classList.add('active');
  els.tabLogin.classList.remove('active');
  els.formRegister.classList.remove('hidden');
  els.formLogin.classList.add('hidden');
  authMessage('');
});

els.formLogin.addEventListener('submit', async (e) => {
  e.preventDefault();
  authMessage('로그인 중...');
  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: {
        email: $('login-email').value.trim(),
        password: $('login-password').value,
      },
    });
    saveSession(data.token, data.user);
    renderProfile(data.user);
    enterLobby();
  } catch (err) {
    authMessage(err.message);
  }
});

els.formRegister.addEventListener('submit', async (e) => {
  e.preventDefault();
  authMessage('회원가입 중...');
  try {
    const data = await api('/api/auth/register', {
      method: 'POST',
      body: {
        email: $('reg-email').value.trim(),
        nickname: $('reg-nickname').value.trim() || undefined,
        password: $('reg-password').value,
      },
    });
    saveSession(data.token, data.user);
    renderProfile(data.user);
    enterLobby();
  } catch (err) {
    authMessage(err.message);
  }
});

function enterLobby() {
  authMessage('');
  setScreen('lobby');
  connectSocket();
}

els.btnLogout.addEventListener('click', () => {
  teardownGame();
  try {
    net.socket?.disconnect();
  } catch {
    // 무시
  }
  net.socket = null;
  net.inQueue = false;
  clearSession();
  setConn(false, '연결 안 됨');
  setScreen('auth');
});

els.btnRefreshProfile.addEventListener('click', refreshProfile);

// ===========================================================================
// Socket.io 연결 및 매치메이킹
// ===========================================================================
// ---------------------------------------------------------------------------
// 싱글 테스트 모드
// ---------------------------------------------------------------------------
async function startTestMode(role) {
  net.pendingTestRole = role;
  net.inQueue = false;
  updateQueueUI(null);
  lobbyMessage('테스트 모드 준비 중...');

  // 로그인 상태가 아니거나 소켓이 없으면 게스트 토큰을 발급받아 진행한다.
  if (!session.token || !net.socket || !net.socket.connected) {
    try {
      const g = await api('/api/guest', { method: 'POST', body: { nickname: '테스트' } });
      session.token = g.token;
      session.user = g.user;
      localStorage.setItem(TOKEN_KEY, g.token);
      localStorage.setItem(USER_KEY, JSON.stringify(g.user));
      if (els.userChip) {
        els.userChip.textContent = g.user.nickname || '게스트';
        els.userChip.classList.remove('hidden');
      }
    } catch (err) {
      lobbyMessage(`테스트 모드를 시작할 수 없습니다: ${err.message}`);
      return;
    }
  }

  // 소켓이 없거나 끊겼으면 새로 연결한다.
  if (!net.socket || !net.socket.connected) {
    connectSocket();
    // 연결 완료 후 test:start 전송
    const waitStart = setInterval(() => {
      if (net.socket && net.socket.connected) {
        clearInterval(waitStart);
        net.socket.emit('test:start', { role: net.pendingTestRole });
      }
    }, 200);
    setTimeout(() => clearInterval(waitStart), 10000);
    return;
  }

  lobbyMessage(`테스트 모드 시작 (${role === 'killer' ? '살인마' : '생존자'})...`);
  net.socket.emit('test:start', { role });
}

function connectSocket() {
  if (!session.token) {
    lobbyMessage('로그인이 필요합니다.');
    return;
  }
  if (net.socket) {
    try {
      net.socket.disconnect();
    } catch {
      // 무시
    }
    net.socket = null;
  }

  setConn(false, '연결 중...');
  // eslint-disable-next-line no-undef
  const socket = io(window.location.origin, {
    auth: { token: session.token },
    transports: ['websocket', 'polling'],
  });
  net.socket = socket;

  socket.on('connect', () => {
    setConn(true, '서버 연결됨');
    lobbyMessage('');
    // 소켓 재연결 시 대기 중이던 테스트 모드 요청을 이어서 처리한다.
    if (net.pendingTestRole) {
      const role = net.pendingTestRole;
      net.pendingTestRole = null;
      setTimeout(() => socket.emit('test:start', { role }), 100);
    }
  });

  socket.on('connect_error', (err) => {
    setConn(false, '연결 실패');
    const message = err?.message || '소켓 연결에 실패했습니다.';
    lobbyMessage(message);
    if (/만료|유효하지|인증|토큰/i.test(message)) {
      toast('인증이 만료되었습니다. 다시 로그인해주세요.');
    }
  });

  socket.on('disconnect', () => {
    setConn(false, '연결 끊김');
    net.inQueue = false;
    updateQueueUI();
  });

  socket.on('connected', (data) => {
    net.socketId = data.socketId;
  });

  socket.on('error:message', (data) => {
    toast(data?.message || '오류가 발생했습니다.');
  });

  socket.on('queue:joined', (snapshot) => {
    net.inQueue = true;
    updateQueueUI(snapshot);
  });

  socket.on('queue:update', (snapshot) => {
    if (net.inQueue) updateQueueUI(snapshot);
  });

  socket.on('queue:left', (snapshot) => {
    net.inQueue = false;
    updateQueueUI(snapshot);
  });

  // --- 매치 성사: 역할/발전기/게이트 스냅샷 수신 ---
  socket.on('match:found', (snapshot) => {
    net.inQueue = false;
    startMatch(snapshot);
  });

  // --- 인게임 브로드캐스트 수신 ---
  socket.on('player:moved', onPlayerMoved);
  socket.on('repair:updated', onRepairUpdated);
  socket.on('generator:completed', onGeneratorCompleted);
  socket.on('gates:opened', onGatesOpened);
  socket.on('attack:result', onAttackResult);
  socket.on('killer:skill', onKillerSkill);
  socket.on('skill:result', onSkillResult);
  socket.on('player:effect', onPlayerEffect);
  socket.on('attack:missed', onAttackMissed);
  socket.on('player:damaged', onPlayerDamaged);
  socket.on('player:died', onPlayerDied);
  socket.on('survivor:escaped', onSurvivorEscaped);
  socket.on('player:left', onPlayerLeft);
  socket.on('state:correction', (data) => {
    if (data?.position) {
      view.playerPos.set(data.position.x, view.eyeHeight, data.position.z);
    }
  });
  socket.on('match:end', onMatchEnd);
}

function updateQueueUI(snapshot) {
  const queued = net.inQueue;
  els.btnFindMatch.classList.toggle('hidden', queued);
  els.btnCancelMatch.classList.toggle('hidden', !queued);
  els.queuePanel.classList.toggle('hidden', !queued);
  if (queued) {
    const pos = snapshot?.position ?? '?';
    const size = snapshot?.queueSize ?? '?';
    els.queueStatus.textContent = `매칭 중... 내 순서 ${pos} / 대기 ${size}명 (4명 충원 시 시작)`;
  }
}

els.btnFindMatch.addEventListener('click', () => {
  if (!net.socket) connectSocket();
  net.socket?.emit('queue:join');
});

els.btnCancelMatch.addEventListener('click', () => {
  net.socket?.emit('queue:leave');
});

// 싱글 테스트 모드 버튼.
els.testKillerBtn?.addEventListener('click', () => {
  if (!net.socket) connectSocket();
  startTestMode('killer');
});
els.testSurvivorBtn?.addEventListener('click', () => {
  if (!net.socket) connectSocket();
  startTestMode('survivor');
});

els.btnBackLobby.addEventListener('click', async () => {
  els.matchEnd.classList.add('hidden');
  teardownGame();
  setScreen('lobby');
  await refreshProfile();
});

// ===========================================================================
// 매치 시작 / 종료
// ===========================================================================
function startMatch(snapshot) {
  game.active = true;
  game.match = snapshot;
  game.role = snapshot.yourRole;
  game.mySocketId = snapshot.yourSocketId;
  game.gatesOpen = false;
  game.myHealth = 'healthy';
  game.escaped = false;

  els.killfeed.innerHTML = '';
  els.matchEnd.classList.add('hidden');
  setScreen('game');

  const isKiller = game.role === 'killer';
  els.roleBox.classList.remove('hidden');
  els.roleTitle.textContent = isKiller ? '살인마' : '생존자';
  els.roleTitle.className = isKiller ? 'killer' : 'survivor';
  els.roleTitle.id = 'role-title';
  els.roleDesc.textContent = isKiller
    ? '생존자를 모두 처치하라 (좌클릭 공격) · Q/F/E 스킬'
    : '발전기 3대를 수리하고 탈출하라 (E 수리) · Shift 달리기';
  els.killerVignette.classList.toggle('hidden', !isKiller);
  els.repairWrap.classList.toggle('hidden', isKiller);
  els.cooldownWrap.classList.toggle('hidden', !isKiller);
  els.healthWrap.classList.toggle('hidden', isKiller);
  // 살인마 스킬 UI
  game.skills = snapshot.rules?.skills || [];
  game.skillReadyAt = {};
  game.skillActiveUntil = 0;
  game.chaseUntil = 0;
  game.stunnedUntil = 0;
  game.blindedUntil = 0;
  game.execT = 0;
  view.stamina = view.staminaMax;
  view.chaseUntil = 0;
  view.blindUntil = 0;
  game.isTest = !!snapshot.isTest;
  if (els.skillWrap) els.skillWrap.classList.toggle('hidden', !isKiller);
  if (els.staminaWrap) els.staminaWrap.classList.toggle('hidden', isKiller);
  if (els.healthWrap) els.healthWrap.classList.toggle('hidden', isKiller);
  if (els.execOverlay) els.execOverlay.classList.add('hidden');
  updateHealthBar();
  if (isKiller) buildSkillBar();
  updateObjective();
  updateHealthUI();

  initGame(snapshot);
  toast(isKiller ? '당신은 살인마입니다.' : '당신은 생존자입니다.');
}

// ---------------------------------------------------------------------------
// 살인마 스킬
// ---------------------------------------------------------------------------
function buildSkillBar() {
  if (!els.skillBar) return;
  els.skillBar.innerHTML = '';
  for (const skill of game.skills || []) {
    const item = document.createElement('div');
    item.className = 'skill-item';
    item.dataset.skill = skill.id;
    item.innerHTML =
      `<span class="skill-key">${skill.key}</span>` +
      `<span class="skill-name">${skill.name}</span>` +
      `<span class="skill-desc">${skill.desc}</span>` +
      `<div class="skill-bar"><div class="skill-fill"></div></div>` +
      `<span class="skill-cd">준비</span>`;
    els.skillBar.appendChild(item);
  }
}

function updateSkillUI() {
  if (!els.skillBar) return;
  const now = Date.now();
  for (const item of els.skillBar.querySelectorAll('.skill-item')) {
    const skillId = item.dataset.skill;
    const skill = (game.skills || []).find((x) => x.id === skillId);
    if (!skill) continue;
    const readyAt = game.skillReadyAt[skillId] || 0;
    const remaining = Math.max(0, readyAt - now);
    const total = skill.cooldownMs || 1;
    const fill = item.querySelector('.skill-fill');
    const cd = item.querySelector('.skill-cd');
    if (fill) fill.style.width = `${Math.round((1 - remaining / total) * 100)}%`;
    if (cd) cd.textContent = remaining > 0 ? `${(remaining / 1000).toFixed(1)}초` : '준비';
    item.classList.toggle('cooling', remaining > 0);
  }
}

function useSkill(skillId) {
  if (!game.active || game.role !== 'killer') return;
  const skill = (game.skills || []).find((x) => x.id === skillId);
  if (!skill) return;
  const readyAt = game.skillReadyAt[skillId] || 0;
  if (readyAt > Date.now()) {
    toast(`${skill.name} 쿨타임 중`);
    return;
  }
  net.socket?.emit('killer_skill', { skill: skillId });
}

function onKillerSkill(data) {
  if (!data) return;
  if (data.by === game.mySocketId) {
    // 내가 쓴 스킬
    if (data.skill === 'chase') {
      game.chaseUntil = Date.now() + (data.durationMs || 2500);
      view.chaseUntil = game.chaseUntil;
      toast('미궁! 2.5초간 2배속');
      shakeScreen(0.25, 220);
    } else if (data.skill === 'terror') {
      toast(`공포! ${data.affected?.length || 0}명 기절`);
    } else if (data.skill === 'dark') {
      toast(`암전! ${data.affected?.length || 0}명 시야 차단`);
    }
  } else {
    // 상대 살인마가 쓴 스킬
    if (data.skill === 'terror' || data.skill === 'dark') {
      toast(`살인마가 ${data.name}을(를) 사용했다!`);
    }
  }
}

function onSkillResult(data) {
  if (!data) return;
  if (data.ok === false && data.reason === 'cooldown' && data.retryAfterMs) {
    const skill = (game.skills || []).find((x) => x.id === data.skill);
    if (skill) game.skillReadyAt[skill.id] = Date.now() + data.retryAfterMs;
  }
}

function onPlayerEffect(data) {
  if (!data) return;
  if (data.socketId !== game.mySocketId) return;
  if (data.effect === 'stun') {
    game.stunnedUntil = data.until || Date.now() + 1500;
    toast('기절! 움직일 수 없다');
    shakeScreen(0.5, 420);
  } else if (data.effect === 'blind') {
    game.blindedUntil = data.until || Date.now() + 4000;
    view.blindUntil = game.blindedUntil;
    toast('암전! 시야가 막혔다');
  }
}

function updateHealthBar() {
  if (!els.healthFill) return;
  const state = game.myHealth;
  const pct = state === 'healthy' ? 100 : state === 'injured' ? 66 : state === 'dying' ? 33 : 0;
  els.healthFill.style.width = `${pct}%`;
  if (els.healthBar) {
    els.healthBar.dataset.state = state;
  }
}

function updateStaminaUI() {
  if (!els.staminaFill) return;
  els.staminaFill.style.width = `${Math.round(view.stamina)}%`;
  if (els.staminaWrap) {
    els.staminaWrap.classList.toggle('empty', view.stamina < 12);
  }
}

function updateEffectUI() {
  const now = Date.now();
  // 암전 오버레이
  const blinded = game.blindedUntil > now;
  if (els.blindOverlay) els.blindOverlay.classList.toggle('hidden', !blinded);
  // 기절 표시
  if (els.stunTag) els.stunTag.classList.toggle('hidden', game.stunnedUntil <= now);
  // 미궁 배속
  const chasing = game.chaseUntil > now;
  if (view.chaseUntil !== game.chaseUntil) view.chaseUntil = game.chaseUntil;
  if (els.chaseTag) els.chaseTag.classList.toggle('hidden', !chasing);
}

function onMatchEnd(data) {
  if (!game.active) return;
  game.active = false;

  const iWon =
    (data.winner === 'survivor' && game.role === 'survivor' && game.escaped) ||
    (data.winner === 'killer' && game.role === 'killer');

  els.endTitle.textContent = data.winner === 'survivor' ? '생존자 승리' : '살인마 승리';
  els.endTitle.className = iWon ? 'win' : 'lose';
  els.endReason.textContent = describeEndReason(data.reason, data.winner);
  els.endPlayers.innerHTML = '';
  for (const p of data.players || []) {
    const li = document.createElement('li');
    const left = document.createElement('span');
    left.textContent = `${p.role === 'killer' ? '🔪' : '🔦'} ${p.nickname || p.email} (${HEALTH_LABEL[p.health] || p.health}${p.escaped ? '·탈출' : ''})`;
    const right = document.createElement('b');
    right.textContent = p.win ? '승리' : '패배';
    li.append(left, right);
    els.endPlayers.append(li);
  }
  els.matchEnd.classList.remove('hidden');
  try {
    view.controls?.unlock();
  } catch {
    // 무시
  }
  cancelAnimationFrame(view.rafId);
}

function describeEndReason(reason, winner) {
  if (reason === 'time_expired') return '제한 시간이 만료되어 살인마가 승리했습니다.';
  if (reason === 'killer_disconnected') return '살인마의 연결이 끊겨 생존자가 승리했습니다.';
  if (reason === 'all_survivors_dead') return '모든 생존자가 처치되었습니다.';
  return winner === 'survivor'
    ? '생존자가 탈출에 성공했습니다.'
    : '모든 생존자가 정리되었습니다.';
}

// ===========================================================================
// Three.js 초기화
// ===========================================================================
function teardownGame() {
  game.active = false;
  game.match = null;
  cancelAnimationFrame(view.rafId);
  window.removeEventListener('resize', onResize);
  document.removeEventListener('keydown', onKeyDown);
  document.removeEventListener('keyup', onKeyUp);
  document.removeEventListener('mousedown', onMouseDown);
  try {
    view.controls?.dispose();
  } catch {
    // 무시
  }
  if (view.renderer) {
    view.renderer.dispose();
    view.renderer.domElement.remove();
  }
  view.renderer = null;
  view.scene = null;
  view.camera = null;
  view.controls = null;
  view.remotes.clear();
  view.generators.clear();
  view.gates = [];
  view.colliders = [];
  view.keys.clear();
  els.gameContainer.innerHTML = '';
}

function initGame(snapshot) {
  teardownGame();
  game.active = true;

  const container = els.gameContainer;
  const width = container.clientWidth || window.innerWidth;
  const height = container.clientHeight || window.innerHeight;

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
  view.renderer = renderer;

  // --- 칠흑 같은 맵 연출: 극도로 낮은 앰비언트 + 지수 안개 ---
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x030304);
  scene.fog = new THREE.FogExp2(0x050505, 0.04);
  scene.add(new THREE.AmbientLight(0xffffff, 0.02));
  view.scene = scene;

  const isKiller = game.role === 'killer';
  view.eyeHeight = isKiller ? 1.9 : 1.7;
  view.baseSpeed = isKiller ? 4.0 * 1.25 : 4.0;

  const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 120);
  view.camera = camera;
  scene.add(camera);

  // 내 스폰 위치 적용.
  const me = snapshot.players.find((p) => p.socketId === game.mySocketId);
  if (me?.position) {
    view.playerPos.set(me.position.x, view.eyeHeight, me.position.z);
  } else {
    view.playerPos.set(0, view.eyeHeight, 20);
  }
  camera.position.copy(view.playerPos);

  // --- 1인칭 제어: 클릭 시 포인터 잠금, WASD 이동, 마우스 시선 회전 ---
  const controls = new PointerLockControls(camera, renderer.domElement);
  view.controls = controls;
  renderer.domElement.addEventListener('click', () => {
    if (game.active && !controls.isLocked) controls.lock();
  });
  controls.addEventListener('lock', () => els.lockHint.classList.add('hidden'));
  controls.addEventListener('unlock', () => {
    if (game.active) els.lockHint.classList.remove('hidden');
  });

  // --- 손전등(생존자) / 안광(살인마): 카메라 정면 SpotLight ---
  if (isKiller) {
    const red = new THREE.SpotLight(0xff1a2b, 60, 30, Math.PI / 5, 0.45, 1.2);
    red.position.set(0, 0.2, 0.2);
    camera.add(red);
    red.target.position.set(0, 0, -12);
    camera.add(red.target);
    view.flashlight = red;
  } else {
    const torch = new THREE.SpotLight(0xfff2d8, 55, 26, Math.PI / 6, 0.5, 1.1);
    torch.position.set(0.15, -0.1, 0.1);
    camera.add(torch);
    torch.target.position.set(0, -0.4, -10);
    camera.add(torch.target);
    torch.castShadow = true;
    torch.shadow.mapSize.set(512, 512);
    view.flashlight = torch;
  }

  buildMap(scene, snapshot);
  spawnRemotes(snapshot);

  view.clock = new THREE.Clock();
  view.moveAccum = 0;
  view.cooldownUntil = 0;

  window.addEventListener('resize', onResize);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  document.addEventListener('mousedown', onMouseDown);
  renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

  view.rafId = requestAnimationFrame(tick);
}

function onResize() {
  if (!view.renderer || !view.camera) return;
  const width = els.gameContainer.clientWidth || window.innerWidth;
  const height = els.gameContainer.clientHeight || window.innerHeight;
  view.camera.aspect = width / height;
  view.camera.updateProjectionMatrix();
  view.renderer.setSize(width, height);
}

// ===========================================================================
// 맵 / 오브젝트 생성
// ===========================================================================
function buildMap(scene, snapshot) {
  view.colliders = [];

  // 서버가 배정한 맵 컨셉(없으면 기본값)
  const concept = getConcept(snapshot.mapConcept);
  game.mapConcept = concept.id;
  game.mapName = concept.name;

  // --- 안개/조명 ---
  scene.background = new THREE.Color(concept.fog);
  scene.fog = new THREE.FogExp2(concept.fog, concept.fogDensity);
  scene.add(new THREE.AmbientLight(concept.ambient, concept.ambientIntensity));
  scene.add(new THREE.HemisphereLight(concept.hemi, 0x0a0a0a, 0.45));

  // --- 바닥 ---
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60),
    new THREE.MeshStandardMaterial({
      color: concept.floor,
      roughness: concept.floorRough,
      metalness: 0.05,
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // 희미한 격자(방향 감각)
  const grid = new THREE.GridHelper(60, 30, 0x1e2028, 0x121419);
  grid.position.y = 0.012;
  grid.material.transparent = true;
  grid.material.opacity = 0.22;
  scene.add(grid);

  // --- 외곽 벽 ---
  const wallMat = new THREE.MeshStandardMaterial({ color: concept.wall, roughness: 0.95 });
  const wallGeoLong = new THREE.BoxGeometry(62, concept.wallHeight, 1);
  const wallGeoSide = new THREE.BoxGeometry(1, concept.wallHeight, 62);
  const walls = [
    { geo: wallGeoLong, pos: [0, concept.wallHeight / 2, -30.5] },
    { geo: wallGeoLong, pos: [0, concept.wallHeight / 2, 30.5] },
    { geo: wallGeoSide, pos: [-30.5, concept.wallHeight / 2, 0] },
    { geo: wallGeoSide, pos: [30.5, concept.wallHeight / 2, 0] },
  ];
  for (const wall of walls) {
    const mesh = new THREE.Mesh(wall.geo, wallMat);
    mesh.position.set(...wall.pos);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // --- 컨셉별 장애물 ---
  const propMat = new THREE.MeshStandardMaterial({ color: concept.propColor, roughness: 0.92 });
  for (const box of concept.obstacles) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(box.w, box.h, box.d), propMat);
    mesh.position.set(box.x, box.h / 2, box.z);
    mesh.rotation.y = box.rot || 0;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    view.colliders.push({ x: box.x, z: box.z, r: Math.max(box.w, box.d) / 2 + 0.35 });
  }

  // --- 컨셉별 소품 ---
  addConceptProps(scene, concept);

  // 발전기/게이트 (서버 스냅샷 좌표)
  for (const gen of snapshot.generators) createGenerator(scene, gen);
  for (const gate of snapshot.gates) createGate(scene, gate);
}

// 컨셉별 장식물(나무/기계/잔해)과 조명
function addConceptProps(scene, concept) {
  const propMat = new THREE.MeshStandardMaterial({ color: concept.propColor, roughness: 0.95 });

  if (concept.prop === 'tree') {
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x241a12, roughness: 1 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x1d3324, roughness: 1 });
    for (let i = 0; i < concept.trees; i += 1) {
      const a = (i / concept.trees) * Math.PI * 2 + 0.4;
      const r = 16 + (i % 5) * 3.2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const h = 4.5 + (i % 3) * 0.8;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.26, h, 7), trunkMat);
      trunk.position.set(x, h / 2, z);
      trunk.castShadow = true;
      scene.add(trunk);
      const crown = new THREE.Mesh(new THREE.ConeGeometry(1.5, 2.6, 8), leafMat);
      crown.position.set(x, h + 1.1, z);
      crown.castShadow = true;
      scene.add(crown);
      view.colliders.push({ x, z, r: 0.5 });
    }
  } else if (concept.prop === 'machine') {
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x3a3430, roughness: 0.55, metalness: 0.55 });
    for (let i = 0; i < 8; i += 1) {
      const a = (i / 8) * Math.PI * 2;
      const r = 20 + (i % 3) * 2.6;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const base = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.1, 1.2), metalMat);
      base.position.set(x, 0.55, z);
      base.castShadow = true;
      base.receiveShadow = true;
      scene.add(base);
      const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 2.6, 8), metalMat);
      stack.position.set(x + 0.4, 2.3, z);
      stack.castShadow = true;
      scene.add(stack);
      view.colliders.push({ x, z, r: 1.0 });
    }
    // 컨베이어 벨트
    for (const cx of [-18, 18]) {
      const belt = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 24), metalMat);
      belt.position.set(cx, 1.4, 0);
      belt.castShadow = true;
      scene.add(belt);
    }
  } else {
    // 폐허: 부서진 벽돌 더미 + 나무 널빤지
    const rubbleMat = new THREE.MeshStandardMaterial({ color: 0x2b2e34, roughness: 1 });
    for (let i = 0; i < 10; i += 1) {
      const a = (i / 10) * Math.PI * 2 + 1.1;
      const r = 18 + (i % 4) * 2.4;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const h = 0.5 + (i % 3) * 0.4;
      const pile = new THREE.Mesh(new THREE.BoxGeometry(2.2, h, 2.0), rubbleMat);
      pile.position.set(x, h / 2, z);
      pile.rotation.y = a;
      pile.castShadow = true;
      pile.receiveShadow = true;
      scene.add(pile);
      view.colliders.push({ x, z, r: 1.2 });
    }
    const plankMat = new THREE.MeshStandardMaterial({ color: 0x3a2c1c, roughness: 1 });
    for (let i = 0; i < 6; i += 1) {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.14, 0.5), plankMat);
      plank.position.set(-24 + i * 9, 0.1, -27);
      plank.rotation.y = (i % 2 ? 0.3 : -0.2);
      plank.receiveShadow = true;
      scene.add(plank);
    }
  }

  // --- 조명(컨셉별 램프) ---
  const lampColor = concept.prop === 'forest' ? 0x9fe08a : concept.prop === 'factory' ? 0xffb35c : 0xbcd0ff;
  for (let i = 0; i < concept.lamps; i += 1) {
    const a = (i / Math.max(1, concept.lamps)) * Math.PI * 2;
    const r = 13;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.09, 3.4, 6),
      new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.8 })
    );
    pole.position.set(x, 1.7, z);
    pole.castShadow = true;
    scene.add(pole);
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 10, 8),
      new THREE.MeshBasicMaterial({ color: lampColor })
    );
    bulb.position.set(x, 3.5, z);
    scene.add(bulb);
    const light = new THREE.PointLight(lampColor, 7, 14, 1.7);
    light.position.set(x, 3.4, z);
    scene.add(light);
  }
}

function createGenerator(scene, gen) {
  const group = new THREE.Group();
  group.position.set(gen.position.x, 0, gen.position.z);

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.7, 1.2, 1.1),
    new THREE.MeshStandardMaterial({ color: 0x23262e, roughness: 0.7, metalness: 0.35 })
  );
  body.position.y = 0.6;
  body.castShadow = true;
  group.add(body);

  // 상단 표시등 (수리 전: 주황 / 완료: 네온 녹색)
  const topMat = new THREE.MeshStandardMaterial({
    color: 0x2a1c08,
    emissive: 0xff9a1f,
    emissiveIntensity: 1.4,
  });
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.28, 0.5), topMat);
  lamp.position.y = 1.34;
  group.add(lamp);

  const light = new THREE.PointLight(0xff9a1f, 6, 9, 1.6);
  light.position.y = 1.8;
  group.add(light);

  const label = makeLabelSprite(`발전기 ${gen.index + 1}`, '#ffb35c');
  label.position.y = 2.3;
  group.add(label);

  scene.add(group);
  view.colliders.push({ x: gen.position.x, z: gen.position.z, r: 1.35 });
  view.generators.set(gen.id, {
    id: gen.id,
    index: gen.index,
    position: new THREE.Vector3(gen.position.x, 0, gen.position.z),
    progress: gen.progress || 0,
    completed: gen.completed || false,
    group,
    topMat,
    light,
    flashUntil: 0,
  });
}

function createGate(scene, gate) {
  const group = new THREE.Group();
  group.position.set(gate.position.x, 0, gate.position.z);

  const pillarGeo = new THREE.BoxGeometry(0.6, 4, 0.6);
  const pillarMat = new THREE.MeshStandardMaterial({
    color: 0x1a0508,
    emissive: 0xff2d3f,
    emissiveIntensity: 0.9,
  });
  const left = new THREE.Mesh(pillarGeo, pillarMat);
  left.position.set(-2, 2, 0);
  const right = new THREE.Mesh(pillarGeo, pillarMat.clone());
  right.position.set(2, 2, 0);
  const top = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.5, 0.6), pillarMat.clone());
  top.position.set(0, 4.1, 0);
  group.add(left, right, top);

  const light = new THREE.PointLight(0xff2d3f, 10, 16, 1.6);
  light.position.y = 3;
  group.add(light);

  const label = makeLabelSprite('탈출구 (닫힘)', '#ff8b95');
  label.position.y = 5;
  group.add(label);

  scene.add(group);
  view.gates.push({ id: gate.id, group, light, mats: [left.material, right.material, top.material], label });
}

function makeLabelSprite(text, color = '#ffffff') {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.font = 'bold 30px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'black';
  ctx.shadowBlur = 8;
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 32);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false })
  );
  sprite.scale.set(3.2, 0.8, 1);
  return sprite;
}

// ===========================================================================
// 원격 플레이어 메시 + 부드러운 보간
// ===========================================================================
function makePlayerMesh(role, nickname) {
  const isKiller = role === 'killer';
  const glowColor = isKiller ? '#ff2d3f' : '#22e6a2';
  // 사실적인 인간형 리그 (rig.js)
  const human = makeHumanoid(role, nickname);
  const group = human.group;

  // 히트 판정용 박스(머리/몸통) — 리그에 맞춰 위치 갱신
  const head = human.rig.head;
  const body = human.rig.torso;

  const label = makeLabelSprite(nickname || (isKiller ? '살인마' : '생존자'), glowColor);
  label.position.y = isKiller ? 2.75 : 2.45;
  group.add(label);

  return { group, body, head, label, human };
}

function spawnRemotes(snapshot) {
  for (const p of snapshot.players) {
    if (p.socketId === game.mySocketId) continue;
    const { group, body, head, human } = makePlayerMesh(p.role, p.nickname || p.email);
    group.position.set(p.position.x, 0, p.position.z);
    group.rotation.y = p.rotation?.y || 0;
    // 히트 판정은 그룹 좌표를 참조한다.
    body.userData.socketId = p.socketId;
    head.userData.socketId = p.socketId;
    view.scene.add(group);
    view.remotes.set(p.socketId, {
      socketId: p.socketId,
      role: p.role,
      nickname: p.nickname,
      health: p.health,
      escaped: p.escaped,
      group,
      body,
      head,
      human,
      speed: 0,
      attackT: 0,
      execT: 0,
      lastPos: new THREE.Vector3(p.position.x, 0, p.position.z),
      targetPos: new THREE.Vector3(p.position.x, 0, p.position.z),
      targetYaw: p.rotation?.y || 0,
    });
  }
}

function lerpAngle(current, target, t) {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + delta * t;
}

function updateRemotes(dt, time) {
  // 뚝뚝 끊기지 않도록 매 프레임 lerp 로 위치/회전 동기화.
  const factor = 1 - Math.exp(-12 * dt);
  for (const remote of view.remotes.values()) {
    const pos = remote.group.position;
    const prevX = pos.x, prevZ = pos.z;
    pos.x = THREE.MathUtils.lerp(pos.x, remote.targetPos.x, factor);
    pos.z = THREE.MathUtils.lerp(pos.z, remote.targetPos.z, factor);
    remote.group.rotation.y = lerpAngle(remote.group.rotation.y, remote.targetYaw, factor);

    // 이동 속도 추정(애니메이션용)
    const moved = Math.hypot(pos.x - prevX, pos.z - prevZ);
    const inst = dt > 0 ? moved / dt : 0;
    remote.speed = remote.speed + (inst - remote.speed) * Math.min(1, dt * 8);

    if (!remote.human) continue;
    const health = remote.health || 'healthy';
    const dead = health === 'dead';
    const down = health === 'dying';
    if (remote.attackT > 0) remote.attackT = Math.max(0, remote.attackT - dt);
    if (remote.execT > 0) remote.execT = Math.max(0, remote.execT - dt);

    if (remote.execT > 0) {
      // 처형(내치기) 연출
      animateExecution(remote.human, dt, time, 1 - remote.execT / 1.1);
    } else {
      animateHumanoid(remote.human, dt, time, {
        speed: remote.speed,
        running: remote.speed > 4.6,
        health,
        dead,
        down,
        attackT: remote.attackT,
      });
    }
  }
}

// ===========================================================================
// 입력 처리
// ===========================================================================
function onKeyDown(e) {
  if (!game.active) return;
  view.keys.add(e.code);
  if (['ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
  if (game.role === 'killer' && !e.repeat) {
    if (e.code === 'KeyQ') useSkill('chase');
    if (e.code === 'KeyF') useSkill('terror');
    if (e.code === 'KeyE') useSkill('dark');
  }
}

function onKeyUp(e) {
  view.keys.delete(e.code);
}

function onMouseDown(e) {
  if (!game.active || game.role !== 'killer') return;
  if (e.button !== 0) return;
  if (!view.controls?.isLocked) return;
  tryAttack();
}

// ===========================================================================
// 메인 루프
// ===========================================================================
function tick() {
  if (!game.active) return;
  view.rafId = requestAnimationFrame(tick);
  const dt = Math.min(view.clock.getDelta(), 0.05);
  const time = performance.now() / 1000;

  updateMovement(dt);
  updateRepair(dt);
  updateCooldownUI();
  updateSkillUI();
  updateEffectUI();
  updateHealthBar();
  updateStaminaUI();
  updateRemotes(dt, time);
  updateGeneratorFx();
  maybeAutoEscape();

  view.renderer.render(view.scene, view.camera);
}

function updateMovement(dt) {
  const keys = view.keys;
  let forwardInput = 0;
  let rightInput = 0;
  const stunned = game.stunnedUntil > Date.now();
  if (stunned) { forwardInput = 0; rightInput = 0; }
  if (keys.has('KeyW') || keys.has('ArrowUp')) forwardInput += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) forwardInput -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) rightInput += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) rightInput -= 1;

  // --- 달리기 (Shift) : 스태미나 소모 ---
  const wantRun = !stunned && (keys.has('ShiftLeft') || keys.has('ShiftRight')) && view.stamina > 1;
  view.sprinting = wantRun && (forwardInput !== 0 || rightInput !== 0);
  if (view.sprinting) view.stamina = Math.max(0, view.stamina - view.staminaDrain * dt);
  else view.stamina = Math.min(view.staminaMax, view.stamina + view.staminaRegen * dt);

  // --- 목표 속도 계산 ---
  const camera = view.camera;
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  forward.normalize();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

  const dir = new THREE.Vector3()
    .addScaledVector(forward, forwardInput)
    .addScaledVector(right, rightInput);
  const hasInput = dir.lengthSq() > 0;
  if (hasInput) dir.normalize();

  const chaseMul = view.chaseUntil > Date.now() ? 2 : 1;
  const target = hasInput
    ? (view.sprinting ? view.runSpeed : view.walkSpeed) * chaseMul
    : 0;
  view.baseSpeed = target;

  // --- 가속/감속 (유동적인 이동) ---
  const accel = hasInput ? 14 : 11;
  const desired = dir.multiplyScalar(target);
  view.velocity.x = THREE.MathUtils.damp(view.velocity.x, desired.x, accel, dt);
  view.velocity.z = THREE.MathUtils.damp(view.velocity.z, desired.z, accel, dt);
  view.playerPos.addScaledVector(view.velocity, dt);

  // 맵 경계 + 장애물 충돌 해소.
  view.playerPos.x = THREE.MathUtils.clamp(view.playerPos.x, -29, 29);
  view.playerPos.z = THREE.MathUtils.clamp(view.playerPos.z, -29, 29);
  for (const collider of view.colliders) {
    const dx = view.playerPos.x - collider.x;
    const dz = view.playerPos.z - collider.z;
    const dist = Math.hypot(dx, dz);
    if (dist < collider.r && dist > 0.0001) {
      const push = (collider.r - dist) / dist;
      view.playerPos.x += dx * push;
      view.playerPos.z += dz * push;
    }
  }

  // --- 헤드밥(걸음 흔들림) ---
  const speed = Math.hypot(view.velocity.x, view.velocity.z);
  view.bobAmount = THREE.MathUtils.damp(view.bobAmount, Math.min(1, speed / view.runSpeed), 8, dt);
  view.bobPhase += dt * (view.sprinting ? 11 : 7) * Math.min(1, speed / 3.2);
  view.playerPos.y = view.eyeHeight;

  // 화면 흔들림(Screen Shake) + 걸음 흔들림(Head Bob)
  let jitter = null;
  if (Date.now() < view.shakeUntil) {
    const amp = view.shakeAmp;
    jitter = new THREE.Vector3(
      (Math.random() - 0.5) * amp,
      (Math.random() - 0.5) * amp * 0.6,
      (Math.random() - 0.5) * amp
    );
    view.camera.position.copy(view.playerPos).add(jitter);
  } else {
    const bob = view.bobAmount;
    const bobX = Math.sin(view.bobPhase) * 0.035 * bob;
    const bobY = Math.abs(Math.cos(view.bobPhase)) * 0.05 * bob;
    view.camera.position.set(
      view.playerPos.x + bobX,
      view.playerPos.y + bobY - 0.02 * bob,
      view.playerPos.z
    );
  }

  // 위치 송신 스로틀링: 정확히 50ms 간격으로 제한.
  view.moveAccum += dt;
  if (view.moveAccum >= 0.05) {
    view.moveAccum = 0;
    net.socket?.emit('move', {
      sprint: view.sprinting,
      position: { x: view.playerPos.x, y: view.playerPos.y, z: view.playerPos.z },
      rotation: {
        x: view.camera.rotation.x,
        y: view.camera.rotation.y,
        z: view.camera.rotation.z,
      },
    });
  }
}

function shakeScreen(amp = 0.25, ms = 300) {
  view.shakeAmp = amp;
  view.shakeUntil = Date.now() + ms;
}

// ===========================================================================
// 발전기 수리 (생존자, E 키, 초당 5%)
// ===========================================================================
function nearestGenerator() {
  let best = null;
  let bestDist = Infinity;
  for (const gen of view.generators.values()) {
    if (gen.completed) continue;
    const dist = Math.hypot(
      view.playerPos.x - gen.position.x,
      view.playerPos.z - gen.position.z
    );
    if (dist < bestDist) {
      bestDist = dist;
      best = gen;
    }
  }
  return { generator: best, distance: bestDist };
}

function updateRepair(dt) {
  if (game.role !== 'survivor' || !game.active) {
    view.repair.active = false;
    return;
  }

  const { generator, distance } = nearestGenerator();
  const inRange = generator && distance <= 3.0;
  const wantRepair = view.keys.has('KeyE') && inRange;

  if (inRange && !generator.completed) {
    els.interactPrompt.classList.remove('hidden');
    els.interactPrompt.textContent =
      game.gatesOpen || generator.completed
        ? '발전기 완료!'
        : `E 키를 눌러 수리 (${Math.floor(generator.progress)}%)`;
  } else {
    els.interactPrompt.classList.add('hidden');
  }

  if (wantRepair) {
    if (view.repair.generatorId !== generator.id) {
      view.repair.generatorId = generator.id;
      view.repair.progress = generator.progress;
    }
    view.repair.active = true;
    // 초당 5%씩 로컬 게이지 상승.
    view.repair.progress = Math.min(100, view.repair.progress + 5 * dt);

    els.repairLabel.textContent = `발전기 ${generator.index + 1} 수리 중`;
    els.repairText.textContent = `${Math.floor(view.repair.progress)}%`;
    els.repairFill.style.width = `${view.repair.progress}%`;

    // 수리 패킷 송신 (200ms 간격으로 추가 스로틀).
    const now = performance.now();
    if (now - view.repair.lastEmit >= 200) {
      view.repair.lastEmit = now;
      net.socket?.emit('repair_progress', {
        generatorId: generator.id,
        progress: Number(view.repair.progress.toFixed(2)),
      });
    }
  } else if (view.repair.active) {
    if (view.repair.generatorId) {
      net.socket?.emit('repair:stop', { generatorId: view.repair.generatorId });
    }
    view.repair.active = false;
    view.repair.generatorId = null;
  }
}

function onRepairUpdated(data) {
  const gen = view.generators.get(data.generatorId);
  if (!gen) return;
  gen.progress = data.progress;
  if (data.by === game.mySocketId) {
    view.repair.progress = data.progress;
    els.repairText.textContent = `${Math.floor(data.progress)}%`;
    els.repairFill.style.width = `${data.progress}%`;
  }
  updateObjective();
  renderGeneratorList();
}

function onGeneratorCompleted(data) {
  const gen = view.generators.get(data.generatorId);
  if (gen) {
    gen.completed = true;
    gen.progress = 100;
    // 100% 달성 시 네온 녹색 번쩍임 연출.
    gen.topMat.emissive.set(0x22e6a2);
    gen.topMat.emissiveIntensity = 3;
    gen.light.color.set(0x22e6a2);
    gen.light.intensity = 18;
    gen.flashUntil = performance.now() + 1200;
    flash(els.eventFlash, 350);
  }
  feed(`⚡ 발전기가 수리 완료되었습니다 (${completedCount()} / 3)`, true);
  updateObjective();
  renderGeneratorList();
}

function completedCount() {
  let count = 0;
  for (const gen of view.generators.values()) {
    if (gen.completed) count += 1;
  }
  return count;
}

function updateGeneratorFx() {
  const now = performance.now();
  for (const gen of view.generators.values()) {
    if (now < gen.flashUntil) {
      gen.light.intensity = 14 + Math.sin(now / 60) * 8;
    } else if (gen.completed) {
      gen.light.intensity = 10;
      gen.topMat.emissiveIntensity = 2;
    }
  }
}

function renderGeneratorList() {
  els.generators.innerHTML = '';
  const sorted = [...view.generators.values()].sort((a, b) => a.index - b.index);
  for (const gen of sorted) {
    const li = document.createElement('li');
    if (gen.completed) li.classList.add('done');
    li.textContent = gen.completed
      ? `발전기 ${gen.index + 1}: 완료 ✓`
      : `발전기 ${gen.index + 1}: ${Math.floor(gen.progress)}%`;
    els.generators.append(li);
  }
}

function updateObjective() {
  if (game.mapName && els.mapTag) {
    els.mapTag.textContent = `🗺 ${game.mapName}`;
    els.mapTag.classList.remove('hidden');
  }
  if (game.gatesOpen) {
    els.objective.textContent = game.role === 'killer'
      ? '탈출을 저지하라!'
      : '탈출구가 열렸다! 탈출구로 이동하라!';
  } else {
    els.objective.textContent = `발전기 수리: ${completedCount()} / 3`;
  }
}

// ===========================================================================
// 살인마 공격 (좌클릭, Raycaster 사거리 4)
// ===========================================================================
function tryAttack() {
  const now = Date.now();
  if (now < view.cooldownUntil) return;

  view.raycaster.setFromCamera({ x: 0, y: 0 }, view.camera);
  view.raycaster.far = 4;

  const targets = [];
  for (const remote of view.remotes.values()) {
    if (remote.role !== 'survivor' || remote.escaped) continue;
    if (remote.health === 'dead') continue;
    targets.push(remote.body, remote.head);
  }
  const hits = view.raycaster.intersectObjects(targets, false);
  // 공격 쿨다운은 휘두를 때마다 적용.
  view.cooldownUntil = now + view.cooldownMs;

  if (hits.length === 0) return;
  const targetId = hits[0].object.userData.socketId;
  if (!targetId) return;

  // 타격 성공: 화면 흔들림 + 히트마커 + 서버 판정 요청.
  shakeScreen(0.3, 320);
  els.hitmarker.classList.remove('hidden');
  setTimeout(() => els.hitmarker.classList.add('hidden'), 220);
  // 살인마 공격 모션 + 대상 처형 연출 시작
  const target = view.remotes.get(targetId);
  if (target) {
    target.attackT = 0.22;
    target.execT = 1.1;
  }
  game.execT = 0.9;
  net.socket?.emit('attack_hit', { targetId });
}

function updateCooldownUI() {
  if (game.role !== 'killer') return;
  const now = Date.now();
  const remaining = Math.max(0, view.cooldownUntil - now);
  const ratio = 1 - remaining / view.cooldownMs;
  els.cooldownFill.style.width = `${Math.round(ratio * 100)}%`;
  els.cooldownWrap.classList.toggle('cooling', remaining > 0);
  els.cooldownText.textContent =
    remaining > 0 ? `${(remaining / 1000).toFixed(1)}초` : '준비 완료';
}

function onAttackResult(data) {
  if (data?.hit === false && data.reason === 'cooldown' && data.retryAfterMs) {
    view.cooldownUntil = Date.now() + data.retryAfterMs;
  }
}

function onAttackMissed(data) {
  if (data?.attackerId === game.mySocketId) {
    toast('공격이 빗나갔다.');
  }
}

function onPlayerDamaged(data) {
  // 원격 플레이어 체력 상태 반영 → 애니메이션(절뚝임/기어긋기/쓰러짐)
  if (data?.targetId) {
    const remote = view.remotes.get(data.targetId);
    if (remote) {
      remote.health = data.health || remote.health;
      if (data.health === 'dying') {
        remote.execT = 0;
        remote.downT = 0;
      }
    }
  }
  const target = view.remotes.get(data.targetId);
  if (target) {
    target.health = data.health;
    if (data.health === 'dead') markRemoteDead(target);
  }
  if (data.targetId === game.mySocketId) {
    game.myHealth = data.health;
    updateHealthUI();
    updateHealthBar();
    flash(els.damageFlash, 280);
    shakeScreen(0.35, 380);
    // 처형 연출 오버레이
    if (els.execOverlay) {
      els.execOverlay.classList.remove('hidden');
      setTimeout(() => els.execOverlay.classList.add('hidden'), 520);
    }
    toast(`살인마에게 공격당했다! (상태: ${HEALTH_LABEL[data.health]})`);
  }
  if (data.attackerId === game.mySocketId) {
    els.hitmarker.classList.remove('hidden');
    setTimeout(() => els.hitmarker.classList.add('hidden'), 220);
    feed(`🔪 생존자를 공격했다 (${HEALTH_LABEL[data.health]})`);
  }
}

function onPlayerDied(data) {
  const target = view.remotes.get(data.socketId);
  if (target) {
    target.health = 'dead';
    target.execT = 0;
    markRemoteDead(target);
  }
  if (data.socketId === game.mySocketId) {
    game.myHealth = 'dead';
    updateHealthUI();
    toast('당신은 처치당했습니다. 관전 모드...');
  } else {
    feed(`💀 생존자 처치 (${target?.nickname || 'unknown'})`);
  }
}

function markRemoteDead(remote) {
  remote.health = 'dead';
  remote.health = 'dead';
  remote.body.material.color.set(0x0a0a0a);
  remote.body.material.emissive.set(0x000000);
  remote.group.rotation.z = Math.PI / 2;
  remote.group.position.y = -0.6;
}

function updateHealthUI() {
  els.healthPips.textContent = `${HEALTH_PIPS[game.myHealth] || ''} ${HEALTH_LABEL[game.myHealth] || ''}`;
}

// ===========================================================================
// 탈출 / 게이트
// ===========================================================================
function onGatesOpened(data) {
  game.gatesOpen = true;
  for (const gateState of data.gates || []) {
    const gate = view.gates.find((g) => g.id === gateState.id);
    if (!gate) continue;
    for (const mat of gate.mats) {
      mat.emissive.set(0x22e6a2);
      mat.emissiveIntensity = 1.6;
    }
    gate.light.color.set(0x22e6a2);
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.font = 'bold 30px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#22e6a2';
    ctx.fillText('탈출구 (개방)', 128, 32);
    gate.label.material.map = new THREE.CanvasTexture(canvas);
    gate.label.material.needsUpdate = true;
  }
  flash(els.eventFlash, 400);
  feed('🚪 모든 발전기 완료! 탈출구가 열렸다.', true);
  updateObjective();
}

function maybeAutoEscape() {
  if (game.role !== 'survivor' || !game.gatesOpen || game.escaped) return;
  if (game.myHealth === 'dead') return;
  const now = Date.now();
  if (now - view.escapeEmitAt < 1000) return;

  const nearGate = (game.match?.gates || []).some((gate) => {
    const dx = view.playerPos.x - gate.position.x;
    const dz = view.playerPos.z - gate.position.z;
    return Math.hypot(dx, dz) <= 3;
  });
  if (nearGate) {
    view.escapeEmitAt = now;
    net.socket?.emit('player:escape');
  }
}

function onSurvivorEscaped(data) {
  if (data.socketId === game.mySocketId) {
    game.escaped = true;
    feed('🏃 당신이 탈출했다!', true);
    toast('탈출 성공! 매치 종료를 기다리는 중...');
  } else {
    const remote = view.remotes.get(data.socketId);
    if (remote) {
      remote.escaped = true;
      remote.group.visible = false;
    }
    feed(`🏃 생존자 탈출 (${data.escapedCount}명)`, true);
  }
}

// ===========================================================================
// 원격 플레이어 수신 핸들러
// ===========================================================================
function onPlayerMoved(data) {
  const remote = view.remotes.get(data.socketId);
  if (!remote || !data.position) return;
  remote.targetPos.set(data.position.x, 0, data.position.z);
  if (typeof data.rotation?.y === 'number') {
    remote.targetYaw = data.rotation.y;
  }
}

function onPlayerLeft(data) {
  const remote = view.remotes.get(data.socketId);
  if (remote) {
    view.scene?.remove(remote.group);
    view.remotes.delete(data.socketId);
  }
  feed(`🚶 ${data.nickname || '플레이어'} 퇴장`);
}

// ===========================================================================
// 부팅
// ===========================================================================
if (session.token && session.user) {
  els.userChip.textContent = session.user.nickname || session.user.email;
  els.userChip.classList.remove('hidden');
  renderProfile(session.user);
  enterLobby();
} else {
  setScreen('auth');
}
