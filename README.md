# DBD Clone — 비대칭 공포 멀티플레이어 (살인마 1 vs 생존자 3)

Node.js + Express + Socket.io + Mongoose 백엔드와 Three.js(Vanilla JS) 클라이언트로 구성된
웹 멀티플레이어 게임이다. 4명이 모이면 서버가 방을 만들고 난수로 역할을 확정한다.

## 디렉토리 구조

```text
dbd-clone/
├── package.json                  # 의존성(express/mongoose/socket.io/jwt/bcrypt/vite/three) + 스크립트
├── vite.config.js                # 선택적 클라이언트 빌드/개발 서버 설정
├── .env.example                  # 환경 변수 템플릿
├── server/
│   ├── server.js                 # Express + Socket.io 진입점 (JWT 소켓 인증, 패킷 라우팅)
│   ├── config/
│   │   └── db.js                 # Mongoose 연결 모듈 (재시도/우아한 종료)
│   ├── models/
│   │   └── User.js               # UserSchema(email/password/gameStats{wins,losses})
│   ├── routes/
│   │   └── authRouter.js         # POST /api/auth/register · /api/auth/login
│   ├── middleware/
│   │   ├── auth.js               # REST JWT 보호 미들웨어
│   │   └── socketAuth.js         # Socket.io 핸드셰이크 JWT 검증
│   ├── game/
│   │   ├── constants.js          # 역할/체력/수리/전투/맵 상수
│   │   └── roomManager.js        # 큐/룸/서버 권위 게임 로직
│   ├── scripts/
│   │   └── seed.js               # 데모 계정 4개 생성
│   ├── utils/
│   │   └── token.js              # JWT 발급/검증 공용 유틸
├── public/
│   ├── index.html                # SPA 3화면 + HUD 마크업
│   ├── css/
│   │   └── style.css             # 공포 테마 + HUD 스타일
│   └── js/
│       └── client.js             # Three.js 1인칭 게임 클라이언트
└── dist/                         # (선택) vite 빌드 산출물
```

## 빠른 시작

```bash
npm install
cp .env.example .env   # SUPABASE_URL / SUPABASE_SERVICE_KEY / JWT_SECRET 설정
# Supabase 대시보드 → SQL Editor에서 server/supabase/schema.sql 실행 (users 테이블 생성)
npm run seed           # (선택) 데모 계정 생성
npm start              # http://localhost:3000
```

개발 모드(자동 재시작):

```bash
npm run dev
```

클라이언트만 Vite HMR로 개발:

```bash
npm run client:dev     # http://localhost:5173 (API/소켓은 3000으로 프록시)
```

## 게임 규칙

- 4인 충원 즉시 매치 시작, 서버 난수로 살인마 1 / 생존자 3 확정
- 생존자: 발전기 3대를 각 100% 수리 → 탈출구 개방 → 게이트 근처에서 탈출
- 살인마: 이동 속도 1.25배, 좌클릭 공격 (사거리 4, 쿨다운 2.5초)
- 체력: 건강 → 부상 → 빈사 → 사망 (3타 처치)
- 제한 시간 10분 초과 시 살인마 승리

## 🩸 살인마 스킬

살인마는 3가지 스킬을 사용할 수 있습니다. **서버가 쿨다운·사거리·효과를 모두 검증**합니다.

| 스킬 | 키 | 효과 | 쿨다운 |
|---|---|---|---|
| 🔥 **미궁** | `Q` | 2.5초간 이동속도 2배 (돌진) | 20초 |
| 😱 **공포** | `F` | 18m 내 생존자 **1.5초 기절** (이동 불가) | 30초 |
| 🌑 **암전** | `E` | 12m 내 생존자 **4초 시야 차단** (암전 오버레이) | 35초 |

- 화면 좌하단에 스킬바(키 · 이름 · 설명 · 쿨다운 바) 표시
- 기절/암전은 **서버가 강제** — 클라이언트 조작으로 해제 불가
- 기절 중에는 이동 패킷이 서버에서 거부되고 위치가 보정됩니다
- 미궁 중에는 서버 이동 속도 검증도 함께 완화됩니다 (2배속 허용)

---

## 🧪 싱글 테스트 모드

혼자서 바로 매치를 시작할 수 있습니다. **나머지 인원은 서버 봇**이 대신합니다.

로비의 매치메이킹 영역에 두 버튼이 생깁니다:
- 🩸 **테스트 (살인마)** — 나만 살인마 + 봇 생존자 3명
- 🔦 **테스트 (생존자)** — 나만 생존자 + 봇 살인마 1명 + 봇 생존자 2명

봇 동작:
- **봇 살인마** — 가장 가까운 생존자를 추격, 사거리 진입 시 자동 공격
- **봇 생존자** — 발전기를 찾아가 수리 (게이트 개방까지 진행)

테스트 매치는 `isTest: true`로 표시되며, 전적 DB 반영은 일반 매치와 동일하게 처리됩니다.

---

## 조작법

| 입력 | 동작 |
| ---- | ---- |
| 클릭 | 포인터 잠금 (1인칭 시작) |
| WASD + 마우스 | 이동 / 시점 |
| E (생존자) | 발전기 근처에서 수리 (초당 5%) |
| 좌클릭 (살인마) | 공격 (사거리 4) |
| ESC | 포인터 잠금 해제 |

## 소켓 프로토콜 요약

클라이언트 → 서버: `queue:join`, `queue:leave`, `move`, `repair_progress`,
`repair:stop`, `attack_hit`, `player:escape`

서버 → 클라이언트: `queue:joined`, `queue:update`, `match:found`,
`player:moved`, `repair:updated`, `generator:completed`, `gates:opened`,
`attack:missed`, `player:damaged`, `player:died`,
`survivor:escaped`, `player:left`, `state:correction`, `match:end`
