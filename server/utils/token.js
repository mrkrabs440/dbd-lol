'use strict';

// ===========================================================================
// JWT(JSON Web Token) 유틸리티 모듈
// ---------------------------------------------------------------------------
// - REST API(authRouter) 와 Socket.io 핸드셰이크 인증에서 공통으로 사용됩니다.
// - 발급(sign)과 검증(verify)을 단일 진입점으로 관리하여 시크릿/옵션의 일관성을
//   보장합니다.
// ===========================================================================

const jwt = require('jsonwebtoken');
const crypto = require('node:crypto');

// 환경 변수에서 시크릿/만료/발급자를 읽습니다.
const JWT_SECRET =
  process.env.JWT_SECRET || 'dbd_clone_dev_secret_please_change_me_32chars';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const JWT_ISSUER = process.env.JWT_ISSUER || 'dbd-clone-server';

// 운영 환경에서 약한 시크릿을 사용하면 즉시 경고합니다.
if (
  process.env.NODE_ENV === 'production' &&
  JWT_SECRET.length < 32
) {
  console.warn(
    '[JWT] ⚠ 경고: 운영 환경에서 JWT_SECRET 이 너무 짧습니다. 32자 이상의 무작위 값을 사용하세요.'
  );
}

/**
 * 사용자 객체 기반으로 JWT 토큰을 발급합니다.
 * @param {{ id: any, email: string, nickname?: string }} user
 * @param {object} [options] 추가 옵션 (expiresIn 등)
 * @returns {string} 서명된 JWT
 */
function signToken(user, options = {}) {
  // 페이로드에는 최소한의 식별 정보만 담습니다(비밀번호 등 절대 포함 금지).
  const payload = {
    sub: String(user.id || user._id), // subject = 유저 고유 id
    email: user.email,
    nickname: user.nickname || null,
  };

  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
    issuer: JWT_ISSUER,
    ...options,
  });
}

/**
 * JWT 토큰을 검증하고 디코딩된 페이로드를 반환합니다.
 * 실패 시 예외를 던집니다.
 * @param {string} token
 * @returns {object} 디코딩된 페이로드
 * @throws {jwt.JsonWebTokenError | jwt.TokenExpiredError}
 */
function verifyToken(token) {
  if (!token || typeof token !== 'string') {
    throw new jwt.JsonWebTokenError('토큰이 제공되지 않았습니다.');
  }
  return jwt.verify(token, JWT_SECRET, {
    issuer: JWT_ISSUER,
  });
}

/**
 * Authorization 헤더("Bearer <token>") 또는 raw 토큰 문자열에서 토큰만 추출합니다.
 * @param {string} raw
 * @returns {string|null}
 */
function extractBearerToken(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const parts = raw.trim().split(/\s+/);
  if (parts.length === 2 && /^Bearer$/i.test(parts[0])) {
    return parts[1];
  }
  // Bearer 접두사가 없어도 토큰 형태면 그대로 반환 (Socket.io 용)
  return parts.length === 1 ? parts[0] : null;
}

/**
 * 게스트(테스트 모드)용 임시 토큰 발급.
 * DB 계정 없이도 싱글 테스트 모드에 진입할 수 있게 한다.
 * guest:true 플래그가 있으면 소켓 인증에서 DB 조회를 건너뛴다.
 */
function signGuestToken(nickname) {
  const payload = {
    sub: `guest_${crypto.randomUUID()}`,
    email: null,
    nickname: nickname || '게스트',
    guest: true,
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '2h', issuer: JWT_ISSUER });
}

module.exports = {
  signToken,
  signGuestToken,
  verifyToken,
  extractBearerToken,
  JWT_SECRET,
  JWT_EXPIRES_IN,
  JWT_ISSUER,
};
