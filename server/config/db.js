'use strict';

// ===========================================================================
// MongoDB / Mongoose 데이터베이스 연결 모듈
// ---------------------------------------------------------------------------
// - 환경 변수(MONGO_URI) 기반으로 안전하게 Atlas 또는 로컬 Mongo 에 연결합니다.
// - 연결 이벤트(connected / error / disconnected / reconnected)를 모두 로깅하여
//   운영 중 연결 상태 변화를 추적할 수 있도록 합니다.
// - 지수 백오프(backoff) 재시도를 통해 일시적인 네트워크 단절에 견고하게 대응합니다.
// - SIGINT / SIGTERM 시 우아한 종료(graceful shutdown)를 지원합니다.
// ===========================================================================

const mongoose = require('mongoose');

// Mongoose 8 은 strictQuery 기본값이 true 이므로 명시적으로 설정하지 않아도 안전합니다.
mongoose.set('strictQuery', true);

// 디버그 모드에서는 쿼리 로깅을 활성화하여 개발 편의를 높입니다.
if (process.env.NODE_ENV === 'development') {
  mongoose.set('debug', false); // 필요 시 true 로 변경하면 모든 쿼리가 콘솔에 출력됩니다.
}

// ---------------------------------------------------------------------------
// 연결 파라미터
// ---------------------------------------------------------------------------
const MONGO_URI =
  process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/dbd_clone';

// 재연결 정책
const CONNECT_OPTIONS = {
  // 서버 선택 타임아웃(ms): Atlas 무료 티어 지연을 고려해 넉넉히 설정
  serverSelectionTimeoutMS: 10000,
  // 소켓 타임아웃(ms)
  socketTimeoutMS: 45000,
  // 커넥션 풀 크기 (동시 소켓 트래픽을 고려)
  maxPoolSize: 20,
  minPoolSize: 2,
  // 유휴 커넥션 정리 주기
  maxIdleTimeMS: 30000,
  // 자동 인덱스 생성 (개발 편의). 운영에서는 false 로 두고 마이그레이션을 권장합니다.
  autoIndex: process.env.NODE_ENV !== 'production',
  // 버퍼링: 연결 전 쿼리를 잠시 버퍼링하지 않고 즉시 실패시켜 명확한 오류를 반환합니다.
  bufferCommands: false,
};

// 재시도 최대 횟수 및 기본 지연
const MAX_RETRY_ATTEMPTS = 5;
const BASE_RETRY_DELAY_MS = 2000;

// ---------------------------------------------------------------------------
// 내부 유틸: 지정 시간 대기
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// 연결 이벤트 리스너 등록 (최초 1회)
// ---------------------------------------------------------------------------
let listenersRegistered = false;

function registerConnectionListeners() {
  if (listenersRegistered) return;
  listenersRegistered = true;

  const conn = mongoose.connection;

  conn.on('connected', () => {
    console.log(
      `[DB] MongoDB 연결 성공 → host=${conn.host} db=${conn.name}`
    );
  });

  conn.on('error', (err) => {
    console.error('[DB] MongoDB 연결 오류:', err.message);
  });

  conn.on('disconnected', () => {
    console.warn('[DB] MongoDB 연결이 끊어졌습니다. 자동 재연결을 시도합니다...');
  });

  conn.on('reconnected', () => {
    console.log('[DB] MongoDB 재연결 성공.');
  });

  conn.on('close', () => {
    console.warn('[DB] MongoDB 커넥션이 종료되었습니다.');
  });

  // SIGINT(ctrl+c) / SIGTERM 시 우아한 종료
  const gracefulShutdown = async (signal) => {
    try {
      await mongoose.connection.close(false);
      console.log(`[DB] ${signal} 수신 → MongoDB 연결을 정상 종료했습니다.`);
    } catch (err) {
      console.error('[DB] 종료 중 오류:', err.message);
    }
  };

  process.once('SIGINT', () => gracefulShutdown('SIGINT'));
  process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
}

// ---------------------------------------------------------------------------
// 메인 연결 함수 (지수 백오프 재시도 포함)
// ---------------------------------------------------------------------------
async function connectDB() {
  registerConnectionListeners();

  // 이미 연결되어 있으면 재사용
  if (mongoose.connection.readyState === 1) {
    console.log('[DB] 이미 연결된 커넥션을 재사용합니다.');
    return mongoose.connection;
  }

  let attempt = 0;

  // 무한 루프 대신 최대 횟수까지 재시도
  while (attempt < MAX_RETRY_ATTEMPTS) {
    attempt += 1;
    try {
      console.log(
        `[DB] MongoDB 연결 시도 ${attempt}/${MAX_RETRY_ATTEMPTS} ... (${maskUri(
          MONGO_URI
        )})`
      );

      await mongoose.connect(MONGO_URI, CONNECT_OPTIONS);

      return mongoose.connection;
    } catch (err) {
      console.error(
        `[DB] 연결 실패 (${attempt}/${MAX_RETRY_ATTEMPTS}): ${err.message}`
      );

      if (attempt >= MAX_RETRY_ATTEMPTS) {
        console.error('[DB] 최대 재시도 횟수를 초과했습니다. 프로세스를 종료합니다.');
        throw err;
      }

      // 지수 백오프: 2s, 4s, 8s, 16s ...
      const delay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
      console.warn(`[DB] ${delay}ms 후 재시도합니다...`);
      await sleep(delay);
    }
  }

  return mongoose.connection;
}

// ---------------------------------------------------------------------------
// 연결 해제 함수
// ---------------------------------------------------------------------------
async function disconnectDB() {
  if (mongoose.connection.readyState === 0) return;
  await mongoose.connection.close(false);
  console.log('[DB] MongoDB 연결을 수동으로 종료했습니다.');
}

// ---------------------------------------------------------------------------
// 유틸: 연결 문자열 마스킹 (비밀번호 노출 방지)
// ---------------------------------------------------------------------------
function maskUri(uri) {
  try {
    // mongodb(+srv)://user:password@host/... 패턴에서 password 부분을 마스킹
    return uri.replace(/\/\/([^:/@]+):([^@]+)@/, '//$1:****@');
  } catch {
    return '<invalid-uri>';
  }
}

// ---------------------------------------------------------------------------
// 연결 상태 조회 헬퍼
// ---------------------------------------------------------------------------
function getDBStatus() {
  const states = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
  };
  return {
    readyState: mongoose.connection.readyState,
    status: states[mongoose.connection.readyState] || 'unknown',
    host: mongoose.connection.host || null,
    name: mongoose.connection.name || null,
  };
}

module.exports = {
  connectDB,
  disconnectDB,
  getDBStatus,
  mongoose,
};
