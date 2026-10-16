'use strict';

// ===========================================================================
// Socket.io 인증 미들웨어
// ---------------------------------------------------------------------------
// 소켓 연결(handshake) 단계에서 클라이언트가 전달한 JWT 를 가로채 검증합니다.
// 토큰 전달 경로(우선순위):
//   1) socket.handshake.auth.token          (권장: io(url, { auth: { token } }))
//   2) socket.handshake.headers.authorization ("Bearer xxx")
//   3) socket.handshake.query.token          (레거시 브라우저 폴백)
//
// 검증 성공 시 socket.user / socket.userId 를 주입하고 next() 를 호출합니다.
// 실패 시 Error 를 next() 로 전달하여 연결을 거부합니다.
// ===========================================================================

const User = require('../models/User');
const { verifyToken, extractBearerToken } = require('../utils/token');

function socketAuthMiddleware(req, next) {
  // 비동기 검증을 안전하게 처리하기 위한 즉시실행 함수
  (async () => {
    try {
      const handshake = req.handshake || {};
      const auth = handshake.auth || {};
      const query = handshake.query || {};
      const headers = handshake.headers || {};

      // 1) auth.token → 2) Authorization 헤더 → 3) query.token
      const rawToken =
        (auth && auth.token) ||
        extractBearerToken(headers.authorization) ||
        (query && query.token) ||
        null;

      if (!rawToken) {
        const err = new Error('인증 토큰이 없습니다. 로그인이 필요합니다.');
        err.data = { code: 'NO_TOKEN', status: 401 };
        return next(err);
      }

      let decoded;
      try {
        decoded = verifyToken(rawToken);
      } catch (verifyErr) {
        const expired = verifyErr.name === 'TokenExpiredError';
        const err = new Error(
          expired
            ? '인증 토큰이 만료되었습니다.'
            : '유효하지 않은 인증 토큰입니다.'
        );
        err.data = {
          code: expired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
          status: 401,
        };
        return next(err);
      }

      // DB 에서 최신 사용자 확인
      const user = await User.findById(decoded.sub);
      if (!user) {
        const err = new Error('토큰에 해당하는 사용자를 찾을 수 없습니다.');
        err.data = { code: 'USER_NOT_FOUND', status: 401 };
        return next(err);
      }

      if (user.isActive === false) {
        const err = new Error('비활성화된 계정입니다.');
        err.data = { code: 'ACCOUNT_DISABLED', status: 403 };
        return next(err);
      }

      // 소켓 객체에 인증 정보 주입 (이후 모든 핸들러에서 사용 가능)
      req.user = {
        id: user.id,
        email: user.email,
        nickname: user.nickname,
        gameStats: user.gameStats,
      };
      req.userId = user.id;

      return next();
    } catch (err) {
      // 예기치 못한 오류도 연결 거부로 처리
      err.data = err.data || { code: 'AUTH_ERROR', status: 500 };
      return next(err);
    }
  })();
}

module.exports = { socketAuthMiddleware };
