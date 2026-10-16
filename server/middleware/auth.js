'use strict';

// ===========================================================================
// REST API 인증 미들웨어 (JWT 검증)
// ---------------------------------------------------------------------------
// Authorization: Bearer <token> 헤더를 검증하여 req.user 에 사용자 정보를 주입합니다.
// ===========================================================================

const User = require('../models/User');
const { verifyToken, extractBearerToken } = require('../utils/token');

/**
 * 보호된 라우트용 미들웨어.
 * 유효한 JWT 가 없으면 401 을 반환하고, 유효하면 최신 사용자 문서를 조회하여
 * req.user 에 할당한 뒤 next() 를 호출합니다.
 */
async function protect(req, res, next) {
  try {
    const header =
      req.headers.authorization || req.headers.Authorization || null;

    // 쿠키 기반 토큰도 지원 (선택)
    const cookieToken = req.cookies?.token || null;

    const token = extractBearerToken(header) || cookieToken;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: '인증 토큰이 없습니다. 로그인이 필요합니다.',
        code: 'NO_TOKEN',
      });
    }

    let decoded;
    try {
      decoded = verifyToken(token);
    } catch (err) {
      const expired = err.name === 'TokenExpiredError';
      return res.status(401).json({
        success: false,
        message: expired
          ? '인증 토큰이 만료되었습니다. 다시 로그인해주세요.'
          : '유효하지 않은 인증 토큰입니다.',
        code: expired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
      });
    }

    // 토큰의 subject(=유저 _id)로 최신 사용자 조회
    const user = await User.findById(decoded.sub);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: '토큰에 해당하는 사용자를 찾을 수 없습니다.',
        code: 'USER_NOT_FOUND',
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: '비활성화된 계정입니다.',
        code: 'ACCOUNT_DISABLED',
      });
    }

    // 이후 핸들러에서 사용할 수 있도록 주입
    req.user = user;
    req.token = token;
    req.tokenPayload = decoded;

    return next();
  } catch (err) {
    return next(err);
  }
}

/**
 * 선택적 인증 미들웨어.
 * 토큰이 있으면 검증하여 req.user 를 채우고, 없거나 무효하면 그냥 통과시킵니다.
 * (비로그인 사용자도 접근 가능한 라우트에서 사용)
 */
async function optionalAuth(req, res, next) {
  try {
    const header = req.headers.authorization || null;
    const token = extractBearerToken(header);
    if (!token) return next();

    try {
      const decoded = verifyToken(token);
      const user = await User.findById(decoded.sub);
      if (user && user.isActive) {
        req.user = user;
      }
    } catch {
      // 무시하고 진행
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { protect, optionalAuth };
