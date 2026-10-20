'use strict';

// ===========================================================================
// 매치메이킹 큐 + 게임 룸 관리자 (서버 권위 게임 로직)
// ---------------------------------------------------------------------------
// 책임 범위:
//   1) 대기 큐 관리: queue:join / queue:leave
//   2) 4인 충족 즉시 방 생성 + 서버 난수로 역할 확정(살인마 1 / 생존자 3)
//   3) 위치(move), 수리(repair_progress), 공격(attack_hit) 패킷 검증 후 브로드캐스트
//   4) 체력 상태머신, 발전기 진행도, 탈출/승패 판정, 전적 DB 반영
// ===========================================================================

const crypto = require('node:crypto');
const User = require('../models/User');
const {
  MATCH_SIZE,
  SURVIVORS_PER_MATCH,
  KILLERS_PER_MATCH,
  ROLES,
  HEALTH_STATES,
  REPAIR_RATE_PER_SEC,
  ATTACK_RANGE,
  ATTACK_COOLDOWN_MS,
  INTERACT_RANGE,
  MAP_HALF_EXTENT,
  MAP_MIN_Y,
  MAP_MAX_Y,
  MATCH_STATES,
  GENERATOR_POSITIONS,
  EXIT_GATE_POSITIONS,
  ESCAPE_RADIUS,
  KILLER_SKILLS,
  KILLER_SKILL_LIST,
  STUN_DURATION_MS,
  BLIND_DURATION_MS,
  CHASE_SPEED_MULTIPLIER,
  TEST_MODE_ROLES,
  TEST_BOT_SPEED,
  TEST_BOT_TICK_MS,
  TEST_SURVIVOR_NAMES,
  TEST_KILLER_NAME,
  MAP_CONCEPT_IDS,
  CONCEPT_LAYOUT,
  SURVIVOR_SPRINT_MAX_SPEED,
} = require('./constants');

// 매치 제한 시간(10분). 초과 시 살인마 승리로 종료한다.
const MATCH_TIME_LIMIT_MS = 10 * 60 * 1000;
// 종료된 방을 메모리에서 제거하기 전 유예 시간.
const ROOM_TEAR_DOWN_DELAY_MS = 5000;
// 비정상 수리 세션으로 간주하는 공백 시간.
const REPAIR_SESSION_GAP_MS = 1500;
// 수리 허용 오차 배율(네트워크 지터 흡수).
const REPAIR_TOLERANCE_MULTIPLIER = 1.25;
// 공격 거리 허용 오차(핑/보간 차이 흡수).
const ATTACK_RANGE_TOLERANCE = 1.5;
// 상호작용 거리 허용 오차.
const INTERACT_RANGE_TOLERANCE = 1.0;
// 이동 검증용 허용 배율 및 기본 여유 거리.
const MOVE_TOLERANCE_MULTIPLIER = 1.8;
const MOVE_BASE_SLACK = 1.5;
// 서버 이동 패킷 최소 간격(ms). 그보다 빠르면 무시한다.
const MOVE_MIN_INTERVAL_MS = 30;

// 역할별 최대 이동 속도(단위/초).
const ROLE_MAX_SPEED = Object.freeze({
  [ROLES.SURVIVOR]: 4.5,
  [ROLES.KILLER]: 4.5 * 1.25,
});
// 현재 시점에 플레이어에게 적용되는 최대 이동 속도(돌진 버프 반영).
function maxSpeedFor(player, now = Date.now(), sprinting = false) {
  const base = ROLE_MAX_SPEED[player.role] || ROLE_MAX_SPEED[ROLES.SURVIVOR];
  if (player.role === ROLES.KILLER && player.chaseUntil && player.chaseUntil > now) {
    return base * CHASE_SPEED_MULTIPLIER;
  }
  if (player.role === ROLES.SURVIVOR && sprinting) {
    return Math.max(base, SURVIVOR_SPRINT_MAX_SPEED);
  }
  return base;
}

// 스폰 좌표: 살인마는 중앙, 생존자는 맵 외곽 3곳.
const KILLER_SPAWN = Object.freeze({ x: 0, y: 0, z: 0 });
const SURVIVOR_SPAWNS = Object.freeze([
  { x: -22, y: 0, z: 22 },
  { x: 22, y: 0, z: 22 },
  { x: 0, y: 0, z: -22 },
]);

// ---------------------------------------------------------------------------
// 숫자/좌표 검증 유틸
// ---------------------------------------------------------------------------
function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function sanitizeCoordinate(value, min, max, fallback = 0) {
  if (!isFiniteNumber(value)) return fallback;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function sanitizePosition(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!isFiniteNumber(raw.x) || !isFiniteNumber(raw.y) || !isFiniteNumber(raw.z)) {
    return null;
  }
  return {
    x: sanitizeCoordinate(raw.x, -MAP_HALF_EXTENT, MAP_HALF_EXTENT),
    y: sanitizeCoordinate(raw.y, MAP_MIN_Y, MAP_MAX_Y),
    z: sanitizeCoordinate(raw.z, -MAP_HALF_EXTENT, MAP_HALF_EXTENT),
  };
}

function sanitizeRotation(raw) {
  if (!raw || typeof raw !== 'object') return { x: 0, y: 0, z: 0 };
  return {
    x: isFiniteNumber(raw.x) ? raw.x : 0,
    y: isFiniteNumber(raw.y) ? raw.y : 0,
    z: isFiniteNumber(raw.z) ? raw.z : 0,
  };
}

function distance3D(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function shuffleInPlace(array) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// ===========================================================================
// GameRoom: 단일 매치의 상태 컨테이너
// ===========================================================================
class GameRoom {
  constructor(id) {
    this.id = id;
    this.status = MATCH_STATES.WAITING;
    this.players = new Map();
    this.generators = new Map();
    this.gatesOpen = false;
    this.winner = null;
    this.endReason = null;
    this.createdAt = Date.now();
    this.startedAt = null;
    this.endedAt = null;
    this.timeoutHandle = null;
    // 싱글 테스트 모드 여부(=봇으로 채운 방)
    this.isTest = false;
    this.testRole = null;
    this.botTimer = null;
    // 맵 컨셉 랜덤 배정
    this.mapConcept = MAP_CONCEPT_IDS[Math.floor(Math.random() * MAP_CONCEPT_IDS.length)];
    this.layout = CONCEPT_LAYOUT[this.mapConcept] || CONCEPT_LAYOUT.ruins;

    (this.layout.generators).slice(0, 3).forEach((position, index) => {
      const generatorId = `gen_${index + 1}`;
      this.generators.set(generatorId, {
        id: generatorId,
        index,
        position: { ...position },
        progress: 0,
        completed: false,
        completedBy: null,
        completedAt: null,
      });
    });
  }

  addPlayer(player) {
    this.players.set(player.socketId, player);
  }

  removePlayer(socketId) {
    return this.players.delete(socketId);
  }

  getPlayer(socketId) {
    return this.players.get(socketId) || null;
  }

  survivors() {
    return [...this.players.values()].filter((p) => p.role === ROLES.SURVIVOR);
  }

  killer() {
    return [...this.players.values()].find((p) => p.role === ROLES.KILLER) || null;
  }

  activeSurvivors() {
    return this.survivors().filter((p) => !p.escaped && p.health !== HEALTH_STATES.DEAD);
  }

  escapedSurvivors() {
    return this.survivors().filter((p) => p.escaped);
  }

  deadSurvivors() {
    return this.survivors().filter(
      (p) => !p.escaped && p.health === HEALTH_STATES.DEAD
    );
  }

  allGeneratorsCompleted() {
    if (this.generators.size === 0) return false;
    return [...this.generators.values()].every((g) => g.completed);
  }

  // 클라이언트 초기화에 필요한 전체 스냅샷.
  toMatchSnapshot() {
    return {
      roomId: this.id,
      status: this.status,
      startedAt: this.startedAt,
      timeLimitMs: MATCH_TIME_LIMIT_MS,
      players: [...this.players.values()].map((p) => ({
        socketId: p.socketId,
        userId: p.userId,
        email: p.email,
        nickname: p.nickname,
        role: p.role,
        health: p.health,
        escaped: p.escaped,
        isBot: !!p.isBot,
        position: { ...p.position },
        rotation: { ...p.rotation },
        stunnedUntil: p.stunnedUntil || 0,
        blindedUntil: p.blindedUntil || 0,
        skillCooldowns: { ...(p.skillCooldowns || {}) },
        chaseUntil: p.chaseUntil || 0,
      })),
      generators: [...this.generators.values()].map((g) => ({
        id: g.id,
        index: g.index,
        position: { ...g.position },
        progress: g.progress,
        completed: g.completed,
      })),
      gates: (this.layout.gates).map((position, index) => ({
        id: `gate_${index + 1}`,
        position: { ...position },
        open: this.gatesOpen,
      })),
      mapConcept: this.mapConcept,
      rules: {
        matchSize: MATCH_SIZE,
        survivors: SURVIVORS_PER_MATCH,
        killers: KILLERS_PER_MATCH,
        repairRatePerSec: REPAIR_RATE_PER_SEC,
        attackRange: ATTACK_RANGE,
        attackCooldownMs: ATTACK_COOLDOWN_MS,
        interactRange: INTERACT_RANGE,
        escapeRadius: ESCAPE_RADIUS,
        skills: KILLER_SKILL_LIST,
      },
      isTest: this.isTest,
    };
  }
}

// ===========================================================================
// RoomManager
// ===========================================================================
class RoomManager {
  constructor(io) {
    if (!io) throw new Error('RoomManager requires a socket.io server instance.');
    this.io = io;
    this.queue = [];
    this.rooms = new Map();
    this.socketRoomId = new Map();
    this.socketQueueIndex = new Map();

    // 좀비 방 정리 타이머(60초 간격).
    this.cleanupTimer = setInterval(() => this.cleanupStaleRooms(), 60 * 1000);
    this.cleanupTimer.unref?.();
  }

  // -------------------------------------------------------------------------
  // 큐 진입
  // -------------------------------------------------------------------------
  enqueue(socket) {
    const user = socket.user;
    if (!user) {
      socket.emit('error:message', { code: 'UNAUTHORIZED', message: '인증 정보가 없습니다.' });
      return;
    }

    if (this.socketRoomId.has(socket.id)) {
      socket.emit('error:message', {
        code: 'ALREADY_IN_MATCH',
        message: '이미 진행 중인 매치가 있습니다.',
      });
      return;
    }

    if (this.socketQueueIndex.has(socket.id)) {
      socket.emit('queue:update', this.getQueueSnapshot(socket.id));
      return;
    }

    const entry = {
      socketId: socket.id,
      socket,
      userId: user.id,
      email: user.email,
      nickname: user.nickname,
      enqueuedAt: Date.now(),
    };
    this.queue.push(entry);
    this.socketQueueIndex.set(socket.id, entry);

    socket.emit('queue:joined', this.getQueueSnapshot(socket.id));
    this.broadcastQueueUpdate();
    this.tryCreateMatches();
  }

  // -------------------------------------------------------------------------
  // 큐 이탈
  // -------------------------------------------------------------------------
  dequeue(socketId) {
    const entry = this.socketQueueIndex.get(socketId);
    if (!entry) return false;
    this.queue = this.queue.filter((item) => item.socketId !== socketId);
    this.socketQueueIndex.delete(socketId);
    this.broadcastQueueUpdate();
    return true;
  }

  getQueueSnapshot(socketId) {
    const position = this.queue.findIndex((item) => item.socketId === socketId);
    return {
      inQueue: position !== -1,
      position: position === -1 ? null : position + 1,
      queueSize: this.queue.length,
      needed: Math.max(0, MATCH_SIZE - this.queue.length),
      matchSize: MATCH_SIZE,
    };
  }

  broadcastQueueUpdate() {
    for (const entry of this.queue) {
      try {
        entry.socket.emit('queue:update', this.getQueueSnapshot(entry.socketId));
      } catch {
        // 개별 emit 실패는 무시한다.
      }
    }
  }

  // -------------------------------------------------------------------------
  // 4인 충족 시 즉시 매치 생성
  // -------------------------------------------------------------------------
  tryCreateMatches() {
    while (this.queue.length >= MATCH_SIZE) {
      const members = this.queue.splice(0, MATCH_SIZE);
      for (const member of members) {
        this.socketQueueIndex.delete(member.socketId);
      }
      this.createMatch(members);
    }
    this.broadcastQueueUpdate();
  }

  createMatch(members) {
    const roomId = `room_${crypto.randomUUID()}`;
    const room = new GameRoom(roomId);

    // 서버 측 난수로 순서 섞기 → 선두 1명 살인마, 나머지 생존자.
    const shuffled = shuffleInPlace([...members]);
    const killerEntry = shuffled[0];
    const survivorEntries = shuffled.slice(1, 1 + SURVIVORS_PER_MATCH);

    const ordered = [killerEntry, ...survivorEntries];
    ordered.forEach((entry, index) => {
      const role = index === 0 ? ROLES.KILLER : ROLES.SURVIVOR;
      const spawn = role === ROLES.KILLER
        ? { ...KILLER_SPAWN }
        : { ...SURVIVOR_SPAWNS[(index - 1) % SURVIVOR_SPAWNS.length] };

      room.addPlayer({
        socketId: entry.socketId,
        socket: entry.socket,
        userId: entry.userId,
        email: entry.email,
        nickname: entry.nickname,
        role,
        health: HEALTH_STATES.HEALTHY,
        escaped: false,
        escapedAt: null,
        position: spawn,
        rotation: { x: 0, y: 0, z: 0 },
        joinedAt: Date.now(),
        lastMoveAt: 0,
        lastAttackAt: 0,
        repairsCompleted: 0,
        kills: 0,
        repairSessions: new Map(),
        connected: true,
      });

      this.socketRoomId.set(entry.socketId, roomId);
      try {
        entry.socket.join(roomId);
      } catch {
        // join 실패는 개별 처리하지 않는다.
      }
    });

    room.status = MATCH_STATES.PLAYING;
    room.startedAt = Date.now();
    this.rooms.set(roomId, room);
    this.armMatchTimeout(room);

    const snapshot = room.toMatchSnapshot();
    for (const player of room.players.values()) {
      try {
        player.socket.emit('match:found', {
          ...snapshot,
          yourRole: player.role,
          yourSocketId: player.socketId,
        });
      } catch {
        // 무시
      }
    }

    console.log(
      `[Match] 방 생성 ${roomId} (살인마=${killerEntry.nickname}, 생존자=${survivorEntries.length}명)`
    );
  }

  armMatchTimeout(room) {
    this.clearMatchTimeout(room);
    room.timeoutHandle = setTimeout(() => {
      if (room.status !== MATCH_STATES.PLAYING) return;
      this.endMatch(room, ROLES.KILLER, 'time_expired');
    }, MATCH_TIME_LIMIT_MS);
    room.timeoutHandle.unref?.();
  }

  clearMatchTimeout(room) {
    if (room.timeoutHandle) {
      clearTimeout(room.timeoutHandle);
      room.timeoutHandle = null;
    }
  }

  getRoomBySocket(socketId) {
    const roomId = this.socketRoomId.get(socketId);
    if (!roomId) return null;
    return this.rooms.get(roomId) || null;
  }

  // -------------------------------------------------------------------------
  // 살인마 스킬 사용 (서버 검증)
  // -------------------------------------------------------------------------
  handleKillerSkill(socket, data) {
    const room = this.getRoomBySocket(socket.id);
    if (!room || room.status !== MATCH_STATES.PLAYING) return;
    const player = room.getPlayer(socket.id);
    if (!player || player.role !== ROLES.KILLER) {
      socket.emit('error:message', { code: 'NOT_KILLER', message: '살인마만 사용할 수 있습니다.' });
      return;
    }
    if (player.health === HEALTH_STATES.DEAD) return;

    const skillId = data?.skill;
    const skill = KILLER_SKILLS[skillId];
    if (!skill) {
      socket.emit('error:message', { code: 'UNKNOWN_SKILL', message: '알 수 없는 스킬입니다.' });
      return;
    }

    const now = Date.now();
    player.skillCooldowns = player.skillCooldowns || {};
    const readyAt = player.skillCooldowns[skill.id] || 0;
    if (readyAt > now) {
      socket.emit('skill:result', {
        skill: skill.id,
        ok: false,
        reason: 'cooldown',
        retryAfterMs: readyAt - now,
      });
      return;
    }

    // 효과 적용
    const affected = [];
    if (skill.id === 'chase') {
      player.chaseUntil = now + skill.durationMs;
    } else {
      for (const survivor of room.activeSurvivors()) {
        const dist = distance3D(player.position, survivor.position);
        if (dist > skill.range) continue;
        if (skill.id === 'terror') {
          survivor.stunnedUntil = now + STUN_DURATION_MS;
        } else if (skill.id === 'dark') {
          survivor.blindedUntil = now + BLIND_DURATION_MS;
        }
        affected.push(survivor.socketId);
      }
      if (affected.length === 0) {
        // 효과가 없으면 쿨다운을 소모하지 않는다.
        socket.emit('skill:result', { skill: skill.id, ok: false, reason: 'no_target' });
        return;
      }
    }

    player.skillCooldowns[skill.id] = now + skill.cooldownMs;

    this.io.to(room.id).emit('killer:skill', {
      skill: skill.id,
      name: skill.name,
      by: player.socketId,
      durationMs: skill.durationMs,
      affected,
      at: now,
    });
    for (const survivor of room.activeSurvivors()) {
      if (!affected.includes(survivor.socketId)) continue;
      this.io.to(room.id).emit('player:effect', {
        socketId: survivor.socketId,
        effect: skill.id === 'terror' ? 'stun' : 'blind',
        until: skill.id === 'terror' ? survivor.stunnedUntil : survivor.blindedUntil,
        by: player.socketId,
        at: now,
      });
    }
    socket.emit('skill:result', {
      skill: skill.id,
      ok: true,
      cooldownMs: skill.cooldownMs,
      affected: affected.length,
    });
  }

  // -------------------------------------------------------------------------
  // 싱글 테스트 모드: 봇으로 채운 방 즉시 생성
  // -------------------------------------------------------------------------
  createTestMatch(socket, requestedRole) {
    const user = socket.user;
    if (!user) {
      socket.emit('error:message', { code: 'UNAUTHORIZED', message: '인증 정보가 없습니다.' });
      return;
    }
    if (this.socketRoomId.has(socket.id)) {
      socket.emit('error:message', { code: 'ALREADY_IN_MATCH', message: '이미 진행 중인 매치가 있습니다.' });
      return;
    }
    this.dequeue(socket.id);

    const role = requestedRole === TEST_MODE_ROLES.SURVIVOR
      ? TEST_MODE_ROLES.SURVIVOR
      : TEST_MODE_ROLES.KILLER;

    const roomId = `room_test_${crypto.randomUUID()}`;
    const room = new GameRoom(roomId);
    room.isTest = true;
    room.testRole = role;

    // 플레이어 본인을 먼저 배치.
    const playerRole = role === TEST_MODE_ROLES.KILLER ? ROLES.KILLER : ROLES.SURVIVOR;
    const spawn = playerRole === ROLES.KILLER ? { ...KILLER_SPAWN } : { ...SURVIVOR_SPAWNS[0] };
    room.addPlayer({
      socketId: socket.id,
      socket,
      userId: user.id,
      email: user.email,
      nickname: user.nickname,
      role: playerRole,
      health: HEALTH_STATES.HEALTHY,
      escaped: false,
      escapedAt: null,
      position: spawn,
      rotation: { x: 0, y: 0, z: 0 },
      joinedAt: Date.now(),
      lastMoveAt: 0,
      lastAttackAt: 0,
      repairsCompleted: 0,
      kills: 0,
      repairSessions: new Map(),
      connected: true,
      skillCooldowns: {},
      isBot: false,
    });
    this.socketRoomId.set(socket.id, roomId);
    try {
      socket.join(roomId);
    } catch {
      // 무시
    }

    // 나머지는 봇으로 채운다.
    const botRoles = [];
    if (playerRole === ROLES.KILLER) {
      for (let i = 0; i < SURVIVORS_PER_MATCH; i += 1) botRoles.push(ROLES.SURVIVOR);
    } else {
      botRoles.push(ROLES.KILLER);
      for (let i = 0; i < SURVIVORS_PER_MATCH - 1; i += 1) botRoles.push(ROLES.SURVIVOR);
    }

    botRoles.forEach((botRole, index) => {
      const isBotKiller = botRole === ROLES.KILLER;
      const botSpawn = isBotKiller
        ? { ...KILLER_SPAWN }
        : { ...SURVIVOR_SPAWNS[(index) % SURVIVOR_SPAWNS.length] };
      const botId = `bot_${index + 1}`;
      room.addPlayer({
        socketId: botId,
        socket: null,
        userId: null,
        email: null,
        nickname: isBotKiller ? TEST_KILLER_NAME : TEST_SURVIVOR_NAMES[index % TEST_SURVIVOR_NAMES.length],
        role: botRole,
        health: HEALTH_STATES.HEALTHY,
        escaped: false,
        escapedAt: null,
        position: botSpawn,
        rotation: { x: 0, y: 0, z: 0 },
        joinedAt: Date.now(),
        lastMoveAt: 0,
        lastAttackAt: 0,
        repairsCompleted: 0,
        kills: 0,
        repairSessions: new Map(),
        connected: true,
        skillCooldowns: {},
        isBot: true,
        // 봇 AI용 상태
        wanderTarget: {
          x: (Math.random() - 0.5) * 40,
          y: 0,
          z: (Math.random() - 0.5) * 40,
        },
        repairTargetId: null,
      });
    });

    room.status = MATCH_STATES.PLAYING;
    room.startedAt = Date.now();
    this.rooms.set(roomId, room);
    this.armMatchTimeout(room);
    this.startBotLoop(room);

    const snapshot = room.toMatchSnapshot();
    socket.emit('match:found', {
      ...snapshot,
      yourRole: playerRole,
      yourSocketId: socket.id,
    });
    console.log(`[Test] 테스트 매치 생성 ${roomId} (역할=${playerRole}, 봇=${botRoles.length}명)`);
  }

  // 봇 AI 루프 (테스트 모드 전용)
  startBotLoop(room) {
    if (room.botTimer) return;
    room.botTimer = setInterval(() => this.tickBots(room), TEST_BOT_TICK_MS);
    room.botTimer.unref?.();
  }

  stopBotLoop(room) {
    if (!room.botTimer) return;
    clearInterval(room.botTimer);
    room.botTimer = null;
  }

  tickBots(room) {
    if (!room || room.status !== MATCH_STATES.PLAYING) {
      if (room) this.stopBotLoop(room);
      return;
    }
    const now = Date.now();
    const dt = TEST_BOT_TICK_MS / 1000;

    for (const bot of room.players.values()) {
      if (!bot.isBot || bot.escaped || bot.health === HEALTH_STATES.DEAD) continue;

      let target = null;
      if (bot.role === ROLES.KILLER) {
        // 봇 살인마: 가장 가까운 생존자를 추적한다.
        let bestD = Infinity;
        for (const other of room.players.values()) {
          if (other.role !== ROLES.SURVIVOR || other.escaped || other.health === HEALTH_STATES.DEAD) continue;
          const d = distance3D(bot.position, other.position);
          if (d < bestD) { bestD = d; target = other; }
        }
      } else {
        // 봇 생존자: 발전기를 수리하러 이동한다(가끔).
        if (!bot.repairTargetId || room.generators.get(bot.repairTargetId)?.completed) {
          const pending = [...room.generators.values()].filter((g) => !g.completed);
          bot.repairTargetId = pending.length ? pending[Math.floor(Math.random() * pending.length)].id : null;
        }
        const gen = bot.repairTargetId ? room.generators.get(bot.repairTargetId) : null;
        if (gen) target = { position: gen.position, generator: gen };
      }

      let moveX = 0;
      let moveZ = 0;
      if (target) {
        const dx = target.position.x - bot.position.x;
        const dz = target.position.z - bot.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist > (bot.role === ROLES.KILLER ? 1.2 : 1.6)) {
          moveX = (dx / dist) * TEST_BOT_SPEED * dt;
          moveZ = (dz / dist) * TEST_BOT_SPEED * dt;
        }
        bot.rotation = { x: 0, y: Math.atan2(-dx, -dz), z: 0 };
      } else {
        const dx = bot.wanderTarget.x - bot.position.x;
        const dz = bot.wanderTarget.z - bot.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 1.5) {
          bot.wanderTarget = {
            x: (Math.random() - 0.5) * 50,
            y: 0,
            z: (Math.random() - 0.5) * 50,
          };
        } else {
          moveX = (dx / dist) * TEST_BOT_SPEED * 0.5 * dt;
          moveZ = (dz / dist) * TEST_BOT_SPEED * 0.5 * dt;
          bot.rotation = { x: 0, y: Math.atan2(-dx, -dz), z: 0 };
        }
      }

      bot.position.x = Math.max(-MAP_HALF_EXTENT, Math.min(MAP_HALF_EXTENT, bot.position.x + moveX));
      bot.position.z = Math.max(-MAP_HALF_EXTENT, Math.min(MAP_HALF_EXTENT, bot.position.z + moveZ));

      // 봇 살인마 공격
      if (bot.role === ROLES.KILLER && target) {
        const dist = distance3D(bot.position, target.position);
        if (dist <= ATTACK_RANGE + 0.5 && now - bot.lastAttackAt > ATTACK_COOLDOWN_MS) {
          bot.lastAttackAt = now;
          const nextHealth = this.advanceHealth(target.health);
          target.health = nextHealth;
          target.lastDamagedAt = now;
          if (nextHealth === HEALTH_STATES.DEAD) bot.kills += 1;
          this.io.to(room.id).emit('player:damaged', {
            attackerId: bot.socketId,
            targetId: target.socketId,
            health: target.health,
            kills: bot.kills,
            at: now,
          });
          if (nextHealth === HEALTH_STATES.DEAD) {
            this.io.to(room.id).emit('player:died', {
              socketId: target.socketId,
              by: bot.socketId,
              at: now,
            });
          }
          this.checkMatchEnd(room);
        }
      }

      // 봇 생존자 발전기 수리
      if (bot.role === ROLES.SURVIVOR && target?.generator && !target.generator.completed) {
        const dist = distance3D(bot.position, target.generator.position);
        if (dist <= INTERACT_RANGE) {
          const gen = target.generator;
          gen.progress = Math.min(100, gen.progress + REPAIR_RATE_PER_SEC * dt);
          this.io.to(room.id).emit('repair:updated', {
            generatorId: gen.id,
            progress: Number(gen.progress.toFixed(2)),
            completed: gen.completed,
            by: bot.socketId,
            at: now,
          });
          if (gen.progress >= 100 && !gen.completed) {
            gen.completed = true;
            gen.progress = 100;
            gen.completedBy = bot.socketId;
            gen.completedAt = now;
            bot.repairsCompleted += 1;
            this.io.to(room.id).emit('generator:completed', {
              generatorId: gen.id,
              by: bot.socketId,
              at: now,
            });
            if (room.allGeneratorsCompleted() && !room.gatesOpen) {
              room.gatesOpen = true;
              this.io.to(room.id).emit('gates:opened', {
                gates: EXIT_GATE_POSITIONS.map((position, index) => ({
                  id: `gate_${index + 1}`,
                  position: { ...position },
                  open: true,
                })),
                at: now,
              });
            }
          }
        }
      }
    }

    // 봇 위치 브로드캐스트
    for (const bot of room.players.values()) {
      if (!bot.isBot) continue;
      this.io.to(room.id).emit('player:moved', {
        socketId: bot.socketId,
        role: bot.role,
        position: { ...bot.position },
        rotation: { ...bot.rotation },
        at: now,
      });
    }
  }

  // -------------------------------------------------------------------------
  // 위치 동기화 패킷 처리
  // -------------------------------------------------------------------------
  handleMove(socket, data) {
    const room = this.getRoomBySocket(socket.id);
    if (!room || room.status !== MATCH_STATES.PLAYING) return;
    const player = room.getPlayer(socket.id);
    if (!player || player.health === HEALTH_STATES.DEAD || player.escaped) return;

    const position = sanitizePosition(data?.position);
    if (!position) {
      socket.emit('error:message', { code: 'INVALID_POSITION', message: '위치 형식이 올바르지 않습니다.' });
      return;
    }
    const rotation = sanitizeRotation(data?.rotation);

    const now = Date.now();
    if (now - player.lastMoveAt < MOVE_MIN_INTERVAL_MS) return;

    // 기절 상태에서는 이동 불가.
    if (player.stunnedUntil && player.stunnedUntil > now) {
      socket.emit('state:correction', {
        position: { ...player.position },
        rotation: { ...player.rotation },
        reason: 'stunned',
      });
      return;
    }

    // 순간이동 핵 방지: 역할 최대 속도 기반 허용 거리 계산.
    const elapsedSec = player.lastMoveAt === 0 ? 0 : (now - player.lastMoveAt) / 1000;
    if (elapsedSec > 0) {
      const maxSpeed = maxSpeedFor(player, now, !!data?.sprint);
      const allowed = maxSpeed * elapsedSec * MOVE_TOLERANCE_MULTIPLIER + MOVE_BASE_SLACK;
      const moved = distance3D(player.position, position);
      if (moved > allowed) {
        socket.emit('state:correction', {
          position: { ...player.position },
          rotation: { ...player.rotation },
          reason: 'move_rejected',
        });
        return;
      }
    }

    player.position = position;
    player.rotation = rotation;
    player.lastMoveAt = now;

    socket.to(room.id).emit('player:moved', {
      socketId: player.socketId,
      role: player.role,
      position: { ...position },
      rotation: { ...rotation },
      at: now,
    });
  }

  // -------------------------------------------------------------------------
  // 발전기 수리 패킷 처리 (서버 권위 진행도)
  // -------------------------------------------------------------------------
  handleRepair(socket, data) {
    const room = this.getRoomBySocket(socket.id);
    if (!room || room.status !== MATCH_STATES.PLAYING) return;
    const player = room.getPlayer(socket.id);
    if (!player || player.role !== ROLES.SURVIVOR) return;
    if (player.health === HEALTH_STATES.DEAD || player.escaped) return;

    const generatorId = data?.generatorId;
    const clientProgress = data?.progress;
    const generator = room.generators.get(generatorId);
    if (!generator || generator.completed) return;
    if (!isFiniteNumber(clientProgress)) return;

    // 거리 검증: 발전기 근처에서만 수리 가능.
    // 클라이언트는 자신의 최신 위치를 move 패킷으로 전송하므로 서버 좌표를 기준으로 검증한다.
    const dist = distance3D(player.position, generator.position);
    if (dist > INTERACT_RANGE + INTERACT_RANGE_TOLERANCE) {
      socket.emit('error:message', {
        code: 'TOO_FAR_FROM_GENERATOR',
        message: '발전기에서 너무 멀리 떨어져 있습니다.',
      });
      return;
    }

    const now = Date.now();
    let session = player.repairSessions.get(generatorId);
    if (!session || now - session.lastAt > REPAIR_SESSION_GAP_MS) {
      session = { lastAt: now, accepted: generator.progress };
      player.repairSessions.set(generatorId, session);
    }

    const elapsedSec = Math.max(0, (now - session.lastAt) / 1000);
    const allowed = Math.min(
      100,
      session.accepted + REPAIR_RATE_PER_SEC * elapsedSec * REPAIR_TOLERANCE_MULTIPLIER + 0.5
    );
    const clampedClient = Math.max(0, Math.min(100, clientProgress));
    // 단조 증가만 허용(되돌리기 방지).
    const accepted = Math.max(session.accepted, Math.min(clampedClient, allowed));

    session.accepted = accepted;
    session.lastAt = now;
    generator.progress = Math.max(generator.progress, accepted);

    this.io.to(room.id).emit('repair:updated', {
      generatorId: generator.id,
      progress: Number(generator.progress.toFixed(2)),
      completed: generator.completed,
      by: player.socketId,
      at: now,
    });

    if (generator.progress >= 100 && !generator.completed) {
      generator.completed = true;
      generator.progress = 100;
      generator.completedBy = player.socketId;
      generator.completedAt = now;
      player.repairsCompleted += 1;

      this.io.to(room.id).emit('generator:completed', {
        generatorId: generator.id,
        by: player.socketId,
        at: now,
      });

      if (room.allGeneratorsCompleted() && !room.gatesOpen) {
        room.gatesOpen = true;
        this.io.to(room.id).emit('gates:opened', {
          gates: (room.layout?.gates || EXIT_GATE_POSITIONS).map((position, index) => ({
            id: `gate_${index + 1}`,
            position: { ...position },
            open: true,
          })),
          at: now,
        });
      }
    }
  }

  handleRepairStop(socket, data) {
    const room = this.getRoomBySocket(socket.id);
    if (!room) return;
    const player = room.getPlayer(socket.id);
    if (!player) return;
    if (data?.generatorId) {
      player.repairSessions.delete(data.generatorId);
    } else {
      player.repairSessions.clear();
    }
  }

  // -------------------------------------------------------------------------
  // 살인마 공격 판정 (서버 최종 검증)
  // -------------------------------------------------------------------------
  handleAttack(socket, data) {
    const room = this.getRoomBySocket(socket.id);
    if (!room || room.status !== MATCH_STATES.PLAYING) return;
    const attacker = room.getPlayer(socket.id);
    if (!attacker || attacker.role !== ROLES.KILLER) return;
    if (attacker.health === HEALTH_STATES.DEAD) return;

    const now = Date.now();
    if (now - attacker.lastAttackAt < ATTACK_COOLDOWN_MS) {
      socket.emit('attack:result', {
        hit: false,
        reason: 'cooldown',
        retryAfterMs: ATTACK_COOLDOWN_MS - (now - attacker.lastAttackAt),
      });
      return;
    }

    const targetId = data?.targetId;
    const target = targetId ? room.getPlayer(targetId) : null;
    if (!target || target.role !== ROLES.SURVIVOR) {
      attacker.lastAttackAt = now;
      socket.emit('attack:result', { hit: false, reason: 'no_target' });
      return;
    }
    if (target.health === HEALTH_STATES.DEAD || target.escaped) {
      attacker.lastAttackAt = now;
      socket.emit('attack:result', { hit: false, reason: 'invalid_target' });
      return;
    }

    // 서버에 저장된 좌표 기준으로 사거리 검증.
    const dist = distance3D(attacker.position, target.position);
    attacker.lastAttackAt = now;

    if (dist > ATTACK_RANGE + ATTACK_RANGE_TOLERANCE) {
      this.io.to(room.id).emit('attack:missed', {
        attackerId: attacker.socketId,
        targetId: target.socketId,
        distance: Number(dist.toFixed(2)),
        at: now,
      });
      return;
    }

    const nextHealth = this.advanceHealth(target.health);
    target.health = nextHealth;
    target.lastDamagedAt = now;
    if (nextHealth === HEALTH_STATES.DEAD) {
      attacker.kills += 1;
    }

    this.io.to(room.id).emit('player:damaged', {
      attackerId: attacker.socketId,
      targetId: target.socketId,
      health: target.health,
      kills: attacker.kills,
      at: now,
    });

    if (nextHealth === HEALTH_STATES.DEAD) {
      this.io.to(room.id).emit('player:died', {
        socketId: target.socketId,
        by: attacker.socketId,
        at: now,
      });
    }

    this.checkMatchEnd(room);
  }

  advanceHealth(current) {
    if (current === HEALTH_STATES.HEALTHY) return HEALTH_STATES.INJURED;
    if (current === HEALTH_STATES.INJURED) return HEALTH_STATES.DYING;
    return HEALTH_STATES.DEAD;
  }

  // -------------------------------------------------------------------------
  // 탈출 처리
  // -------------------------------------------------------------------------
  handleEscape(socket) {
    const room = this.getRoomBySocket(socket.id);
    if (!room || room.status !== MATCH_STATES.PLAYING) return;
    const player = room.getPlayer(socket.id);
    if (!player || player.role !== ROLES.SURVIVOR) return;
    if (player.escaped || player.health === HEALTH_STATES.DEAD) return;
    if (!room.gatesOpen) {
      socket.emit('error:message', { code: 'GATES_CLOSED', message: '발전기를 모두 수리해야 탈출할 수 있습니다.' });
      return;
    }

    const nearGate = (room.layout?.gates || EXIT_GATE_POSITIONS).some(
      (gate) => distance3D(player.position, gate) <= ESCAPE_RADIUS
    );
    if (!nearGate) {
      socket.emit('error:message', { code: 'TOO_FAR_FROM_GATE', message: '탈출구 근처에서 시도해주세요.' });
      return;
    }

    player.escaped = true;
    player.escapedAt = Date.now();
    this.io.to(room.id).emit('survivor:escaped', {
      socketId: player.socketId,
      escapedCount: room.escapedSurvivors().length,
      at: player.escapedAt,
    });

    this.checkMatchEnd(room);
  }

  // -------------------------------------------------------------------------
  // 승패 판정
  // -------------------------------------------------------------------------
  checkMatchEnd(room) {
    if (!room || room.status !== MATCH_STATES.PLAYING) return;
    const remaining = room.activeSurvivors();
    if (remaining.length > 0) return;

    const escapedCount = room.escapedSurvivors().length;
    const winner = escapedCount > 0 ? ROLES.SURVIVOR : ROLES.KILLER;
    this.endMatch(room, winner, escapedCount > 0 ? 'all_survivors_resolved' : 'all_survivors_dead');
  }

  endMatch(room, winner, reason) {
    if (!room || room.status === MATCH_STATES.ENDED) return;
    room.status = MATCH_STATES.ENDED;
    room.winner = winner;
    room.endReason = reason;
    room.endedAt = Date.now();
    this.clearMatchTimeout(room);

    const players = [...room.players.values()].map((p) => ({
      socketId: p.socketId,
      userId: p.userId,
      nickname: p.nickname,
      role: p.role,
      health: p.health,
      escaped: p.escaped,
      repairsCompleted: p.repairsCompleted,
      kills: p.kills,
      win:
        (winner === ROLES.SURVIVOR && p.role === ROLES.SURVIVOR && p.escaped) ||
        (winner === ROLES.KILLER && p.role === ROLES.KILLER),
    }));

    this.io.to(room.id).emit('match:end', {
      roomId: room.id,
      winner,
      reason,
      players,
      at: room.endedAt,
    });

    console.log(`[Match] 종료 ${room.id} (승자=${winner}, 사유=${reason})`);

    // 전적 반영은 비동기로 처리하고 게임 종료 응답을 지연시키지 않는다.
    this.persistMatchResults(players).catch((err) => {
      console.error(`[Match] 전적 저장 실패 ${room.id}:`, err.message);
    });

    this.stopBotLoop(room);

    // 잠시 후 소켓 룸 정리.
    setTimeout(() => {
      for (const player of room.players.values()) {
        this.socketRoomId.delete(player.socketId);
        try {
          player.socket.leave(room.id);
        } catch {
          // 무시
        }
      }
      this.rooms.delete(room.id);
    }, ROOM_TEAR_DOWN_DELAY_MS).unref?.();
  }

  async persistMatchResults(players) {
    await Promise.allSettled(
      players.map((p) => {
        if (!p.userId) return Promise.resolve(null);
        // 게스트(테스트 모드)는 전적을 DB에 남기지 않는다.
        if (String(p.userId).startsWith('guest_')) return Promise.resolve(null);
        return User.recordMatchResult(p.userId, {
          win: p.win,
          generatorsRepaired: p.role === ROLES.SURVIVOR ? p.repairsCompleted : 0,
          survivorsSacrificed: p.role === ROLES.KILLER ? p.kills : 0,
          escaped: p.role === ROLES.SURVIVOR && p.escaped,
        });
      })
    );
  }

  // -------------------------------------------------------------------------
  // 연결 종료 처리
  // -------------------------------------------------------------------------
  handleDisconnect(socket) {
    this.dequeue(socket.id);

    const room = this.getRoomBySocket(socket.id);
    if (!room) return;
    const player = room.getPlayer(socket.id);

    this.socketRoomId.delete(socket.id);
    if (player) {
      player.connected = false;
      room.removePlayer(socket.id);
      this.io.to(room.id).emit('player:left', {
        socketId: socket.id,
        userId: player.userId,
        nickname: player.nickname,
        role: player.role,
        at: Date.now(),
      });
    }

    if (room.status === MATCH_STATES.PLAYING) {
      if (room.players.size === 0) {
        this.clearMatchTimeout(room);
        this.stopBotLoop(room);
        this.rooms.delete(room.id);
        return;
      }
      // 살인마 이탈 시 생존자 승리로 즉시 종료.
      if (player && player.role === ROLES.KILLER) {
        this.endMatch(room, ROLES.SURVIVOR, 'killer_disconnected');
        return;
      }
      // 생존자 이탈 시 남은 인원으로 판정 계속.
      this.checkMatchEnd(room);
    } else if (room.players.size === 0) {
      this.rooms.delete(room.id);
    }
  }

  cleanupStaleRooms() {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      const stale =
        (room.status === MATCH_STATES.ENDED && now - (room.endedAt || now) > 60000) ||
        (room.players.size === 0 && now - room.createdAt > 60000);
      if (stale) {
        this.clearMatchTimeout(room);
        this.stopBotLoop(room);
        this.rooms.delete(room.id);
      }
    }
  }

  getStatus() {
    return {
      queueSize: this.queue.length,
      activeRooms: this.rooms.size,
      playersInMatch: this.socketRoomId.size,
    };
  }
}

module.exports = { RoomManager, GameRoom };
