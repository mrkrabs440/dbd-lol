'use strict';

// ===========================================================================
// 게임 공용 상수 정의
// ---------------------------------------------------------------------------
// 서버(roomManager)와 클라이언트가 공유하는 규칙값입니다. 클라이언트는 서버가
// match:found 패킷에 담아 보내는 설정을 신뢰 원본(source of truth)으로 사용합니다.
// ===========================================================================

// --- 매치 구성 ---
const MATCH_SIZE = Number.parseInt(process.env.MATCH_SIZE, 10) || 4;
const SURVIVORS_PER_MATCH =
  Number.parseInt(process.env.SURVIVORS_PER_MATCH, 10) || 3;
const KILLERS_PER_MATCH = Number.parseInt(process.env.KILLERS_PER_MATCH, 10) || 1;

// --- 역할 ---
const ROLES = Object.freeze({
  KILLER: 'killer',
  SURVIVOR: 'survivor',
});

// --- 생존자 체력 상태 머신 ---
// healthy(건강) → injured(부상) → dying(빈사) → dead(사망)
// 처치(hit) 1회: healthy → injured
// 처치 2회: injured → dying
// 처치 3회(또는 빈사 상태 추가 타격): dying → dead
const HEALTH_STATES = Object.freeze({
  HEALTHY: 'healthy',
  INJURED: 'injured',
  DYING: 'dying',
  DEAD: 'dead',
});

// --- 발전기 ---
const GENERATORS_PER_MATCH =
  Number.parseInt(process.env.GENERATORS_PER_MATCH, 10) || 3;
const REPAIR_RATE_PER_SEC = 5; // 초당 5% (요구 명세)
const REPAIR_TICK_MS = 100; // 서버 검증 틱 간격

// --- 이동/전투 ---
// ★ 밸런스 패치 v1 (2026-10-21) ★
//   살인마가 너무 강해 생존자가 수리를 못 끝냈음 → 살인마 약화 + 생존자 보강
const SURVIVOR_SPEED = 4; // 클라이언트 기준(단위/초)
const SURVIVOR_RUN_SPEED = 6.0; // 생존자 달리기 속도 (6.4 → 6.0, 스태미나 부담 ↓)
const SURVIVOR_STAMINA_DRAIN = 18; // 초당 스태미나 소모 (22 → 18)
const SURVIVOR_STAMINA_REGEN = 14; // 초당 스태미나 회복 (16 → 14)
const KILLER_SPEED_MULTIPLIER = 1.18; // 살인마 이동 속도 배수 (1.25 → 1.18)
const ATTACK_RANGE = 4.5; // 공격 사거리 (4 → 4.5)
const ATTACK_COOLDOWN_MS = 2800; // 공격 쿨다운 (2500 → 2800)
const INTERACT_RANGE = 3; // 상호작용(수리) 사거리
const REPAIR_RATE_PER_SEC_BALANCE = 6; // 발전기 수리 속도 (5 → 6)
const BLEED_OUT_MS = 45000; // 빈사 상태 방치 시 사망(혈실) 시간

// --- 맵 경계 (서버 측 위치 검증) ---
const MAP_HALF_EXTENT = 30; // -30 ~ +30 (60x60)
const MAP_MIN_Y = -1;
const MAP_MAX_Y = 8;

// --- 매치 상태 ---
const MATCH_STATES = Object.freeze({
  WAITING: 'waiting', // 인원 대기
  COUNTDOWN: 'countdown', // 카운트다운
  PLAYING: 'playing', // 진행 중
  ENDED: 'ended', // 종료
});

// --- 발전기 고정 좌표 (x, z) — 서버가 배치를 결정 ---
const GENERATOR_POSITIONS = [
  { x: -18, y: 0, z: -18 },
  { x: 18, y: 0, z: -18 },
  { x: 0, y: 0, z: 18 },
];

// --- 탈출구(게이트) 좌표. 모든 발전기 완료 시 개방 ---
const EXIT_GATE_POSITIONS = [
  { x: 0, y: 0, z: -28 },
  { x: 0, y: 0, z: 28 },
];
const ESCAPE_RADIUS = 3;

// --- 살인마 스킬 ---
// 살인마만 사용 가능. 서버가 쿨다운·사거리·효과를 모두 검증한다.
const KILLER_SKILLS = Object.freeze({
  chase: Object.freeze({
    id: 'chase',
    name: '미궁',
    key: 'Q',
    cooldownMs: 20000,
    durationMs: 2500,
    range: 0,
    speedMultiplier: 2.0,
    desc: '2.5초간 2배속 돌진',
  }),
  terror: Object.freeze({
    id: 'terror',
    name: '공포',
    key: 'F',
    cooldownMs: 30000,
    durationMs: 1500,
    range: 18,
    speedMultiplier: 1,
    desc: '18m 내 생존자 기절',
  }),
  dark: Object.freeze({
    id: 'dark',
    name: '암전',
    key: 'E',
    cooldownMs: 35000,
    durationMs: 4000,
    range: 12,
    speedMultiplier: 1,
    desc: '12m 내 생존자 시야 차단',
  }),
});
const KILLER_SKILL_LIST = Object.freeze(Object.values(KILLER_SKILLS));
// 기절/암전 지속 시간(밀리초)
const STUN_DURATION_MS = 1500;
const BLIND_DURATION_MS = 4000;
// 미궁(돌진) 중 허용 이동속도 배수
const CHASE_SPEED_MULTIPLIER = 2.0;

// --- 싱글 테스트 모드 ---
// 혼자서 즉시 매치를 시작한다. 나머지 인원은 서버 봇이 대신한다.
const TEST_MODE_ROLES = Object.freeze({
  KILLER: 'killer',
  SURVIVOR: 'survivor',
});
const TEST_BOT_SPEED = 2.8;      // 봇 걷기 속도
const TEST_BOT_RUN_SPEED = 4.9;   // 봇 달리기(추격/유인) 속도
const TEST_BOT_TICK_MS = 400;
const TEST_SURVIVOR_NAMES = Object.freeze(['BOT_훈련병', 'BOT_복사본', 'BOT_신병']);
const TEST_KILLER_NAME = 'BOT_살인마';

// --- 맵 컨cept ---
// 방마다 이 중 하나가 배정된다(서버가 랜덤 선택). 발전기/게이트 좌표도 컨셉별 상이.
const MAP_CONCEPTS = Object.freeze([
  { id: 'ruins', name: '폐허 학교' },
  { id: 'forest', name: '월동 숲' },
  { id: 'factory', name: '폐공장' },
]);
const MAP_CONCEPT_IDS = Object.freeze(MAP_CONCEPTS.map((c) => c.id));
const CONCEPT_LAYOUT = Object.freeze({
  ruins: {
    generators: [
      { x: -20, y: 0, z: -20 },
      { x: 20, y: 0, z: -20 },
      { x: 0, y: 0, z: 21 },
    ],
    gates: [
      { x: 0, y: 0, z: -28 },
      { x: 0, y: 0, z: 28 },
    ],
  },
  forest: {
    generators: [
      { x: -22, y: 0, z: -6 },
      { x: 22, y: 0, z: 6 },
      { x: 0, y: 0, z: -24 },
    ],
    gates: [
      { x: -26, y: 0, z: 18 },
      { x: 26, y: 0, z: -18 },
    ],
  },
  factory: {
    generators: [
      { x: -18, y: 0, z: -22 },
      { x: 18, y: 0, z: -22 },
      { x: 0, y: 0, z: 24 },
    ],
    gates: [
      { x: 0, y: 0, z: -28 },
      { x: 26, y: 0, z: 26 },
    ],
  },
});
// 생존자 달리기 최대 속도(서버 검증용). 클라가 sprint 플래그를 보내면 더 허용.
const SURVIVOR_SPRINT_MAX_SPEED = 7.2;

// --- 생존자 교란 아이템 ---
// 살인마를 방해/유인/회복하는 생존자 전용 소모품
const SURVIVOR_ITEMS = Object.freeze({
  flash: Object.freeze({
    id: 'flash', name: '섬광탄', key: '1', count: 2,
    throwRange: 20, effectRange: 10, durationMs: 3000,
    desc: '던지면 10m 내 살인마 3초 실명',
  }),
  decoy: Object.freeze({
    id: 'decoy', name: '소음 유인기', key: '2', count: 1,
    throwRange: 26, effectRange: 0, durationMs: 12000,
    desc: '던지면 12초간 살인마가 그 소리로',
  }),
  medkit: Object.freeze({
    id: 'medkit', name: '응급 키트', key: '3', count: 1,
    throwRange: 0, effectRange: 0, durationMs: 0,
    desc: '즉시 1단계 회복 (빈사→부상→건강)',
  }),
});
const SURVIVOR_ITEM_LIST = Object.freeze(Object.values(SURVIVOR_ITEMS));
const ITEM_USE_COOLDOWN_MS = 800; // 아이템 사용 쿨다운

// --- 승패 판정 ---
// 모든 생존자가 (탈출 또는 사망) 으로 정리되면 매치 종료.
// 탈출자가 1명 이상이면 생존자 승, 아니면 살인마 승.

module.exports = {
  MATCH_SIZE,
  SURVIVORS_PER_MATCH,
  KILLERS_PER_MATCH,
  ROLES,
  HEALTH_STATES,
  GENERATORS_PER_MATCH,
  REPAIR_RATE_PER_SEC,
  REPAIR_TICK_MS,
  SURVIVOR_RUN_SPEED,
  SURVIVOR_STAMINA_DRAIN,
  SURVIVOR_STAMINA_REGEN,
  BLEED_OUT_MS,
  SURVIVOR_ITEMS,
  SURVIVOR_ITEM_LIST,
  ITEM_USE_COOLDOWN_MS,
  SURVIVOR_SPEED,
  KILLER_SPEED_MULTIPLIER,
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
  TEST_BOT_RUN_SPEED,
  TEST_BOT_TICK_MS,
  TEST_SURVIVOR_NAMES,
  TEST_KILLER_NAME,
  MAP_CONCEPTS,
  MAP_CONCEPT_IDS,
  CONCEPT_LAYOUT,
  SURVIVOR_SPRINT_MAX_SPEED,
};
