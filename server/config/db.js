'use strict';

// ===========================================================================
// Supabase (Postgres) 연결 모듈
// ---------------------------------------------------------------------------
// - SUPABASE_URL + SUPABASE_SERVICE_KEY 로 supabase-js 클라이언트를 생성합니다.
//   (서버 전용 service_role 키 사용. anon 키가 아님에 주의)
// - 연결 이벤트/재시도 로그는 기존 Mongo 모듈과 동일한 메시지를 유지합니다.
// - getDBStatus()/connectDB()/disconnectDB() 인터페이스를 그대로 제공합니다.
// ===========================================================================

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

let supabase = null;
let connected = false;

function getClient() {
  if (!supabase) {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY 환경 변수가 필요합니다.');
    }
    // 지연 로딩: 패키지 미설치 상태에서도 메시지가 명확하도록
    let createClient;
    try {
      ({ createClient } = require('@supabase/supabase-js'));
    } catch {
      throw new Error('@supabase/supabase-js 패키지가 필요합니다. npm install 실행.');
    }
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return supabase;
}

// 재시도 최대 횟수 및 기본 지연
const MAX_RETRY_ATTEMPTS = 5;
const BASE_RETRY_DELAY_MS = 2000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// 메인 연결 함수 (지수 백오프 재시도 포함)
// Supabase는 HTTP 기반이라 실제론 users 테이블 ping 으로 정상 여부를 확인합니다.
// ---------------------------------------------------------------------------
async function connectDB() {
  if (connected) {
    console.log('[DB] 이미 연결된 Supabase 클라이언트를 재사용합니다.');
    return getClient();
  }

  let attempt = 0;
  while (attempt < MAX_RETRY_ATTEMPTS) {
    attempt += 1;
    try {
      console.log(`[DB] Supabase 연결 시도 ${attempt}/${MAX_RETRY_ATTEMPTS} ...`);
      const client = getClient();
      const { error } = await client.from('users').select('id', { count: 'exact', head: true });
      if (error) throw error;
      connected = true;
      console.log('[DB] Supabase 연결 성공');
      return client;
    } catch (err) {
      console.error(`[DB] 연결 실패 (${attempt}/${MAX_RETRY_ATTEMPTS}): ${err.message}`);
      if (attempt >= MAX_RETRY_ATTEMPTS) {
        console.error('[DB] 최대 재시도 횟수를 초과했습니다. 프로세스를 종료합니다.');
        throw err;
      }
      const delay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
      console.warn(`[DB] ${delay}ms 후 재시도합니다...`);
      await sleep(delay);
    }
  }
  return getClient();
}

// ---------------------------------------------------------------------------
// 연결 해제 함수
// ---------------------------------------------------------------------------
async function disconnectDB() {
  supabase = null;
  connected = false;
  console.log('[DB] Supabase 클라이언트를 정리했습니다.');
}

// ---------------------------------------------------------------------------
// 연결 상태 조회 헬퍼 (/health, /api/status 에서 사용)
// ---------------------------------------------------------------------------
function getDBStatus() {
  let host = null;
  try {
    if (SUPABASE_URL) host = new URL(SUPABASE_URL).host;
  } catch {
    host = null;
  }
  return {
    readyState: connected ? 1 : 0,
    status: connected ? 'connected' : 'disconnected',
    host,
    name: 'postgres',
  };
}

module.exports = {
  connectDB,
  disconnectDB,
  getDBStatus,
  getClient,
};
