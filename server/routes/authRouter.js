'use strict';

// ===========================================================================
// 인증 REST API 라우터 (/api/auth)
// ---------------------------------------------------------------------------
//  - POST /api/auth/register : 회원가입 (중복 검사 + bcrypt 해싱 + JWT 발급)
//  - POST /api/auth/login    : 로그인 (비밀번호 검증 + JWT 발급)
//  - GET  /api/auth/me       : 내 프로필 조회 (보호됨)
//  - PATCH /api/auth/me      : 닉네임 등 프로필 수정 (보호됨)
// ===========================================================================

const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');

const User = require('../models/User');
const { signToken } = require('../utils/token');
const { protect } = require('../middleware/auth');

const router = express.Router();

// ---------------------------------------------------------------------------
// 인증 엔드포인트 전용 Rate Limiter (무차별 대입/스팸 방지)
// ---------------------------------------------------------------------------
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15분
  max: 50, // IP 당 15분에 50회
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: '너무 많은 인증 요청이 발생했습니다. 잠시 후 다시 시도해주세요.',
    code: 'RATE_LIMITED',
  },
});

// ---------------------------------------------------------------------------
// 공용: 유효성 검사 결과 처리 헬퍼
// ---------------------------------------------------------------------------
function handleValidation(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: '입력값이 올바르지 않습니다.',
      code: 'VALIDATION_ERROR',
      errors: errors.array().map((e) => ({
        field: e.path,
        message: e.msg,
      })),
    });
  }
  return null;
}

// ---------------------------------------------------------------------------
// 공용: 표준 성공 응답 형태
// ---------------------------------------------------------------------------
function authSuccessPayload(user, token) {
  return {
    success: true,
    token,
    tokenType: 'Bearer',
    user: User.toPublicProfile(user),
  };
}

// ===========================================================================
// POST /api/auth/register  — 회원가입
// ===========================================================================
router.post(
  '/register',
  authLimiter,
  [
    body('email')
      .trim()
      .notEmpty()
      .withMessage('이메일을 입력해주세요.')
      .isEmail()
      .withMessage('올바른 이메일 형식이 아닙니다.')
      .normalizeEmail()
      .isLength({ max: 254 })
      .withMessage('이메일이 너무 깁니다.'),
    body('password')
      .notEmpty()
      .withMessage('비밀번호를 입력해주세요.')
      .isLength({ min: 8, max: 72 })
      .withMessage('비밀번호는 8자 이상 72자 이하여야 합니다.')
      .matches(/[A-Za-z]/)
      .withMessage('비밀번호는 영문자를 최소 1자 포함해야 합니다.')
      .matches(/[0-9]/)
      .withMessage('비밀번호는 숫자를 최소 1자 포함해야 합니다.'),
    body('nickname')
      .optional({ nullable: true, checkFalsy: true })
      .trim()
      .isLength({ min: 2, max: 20 })
      .withMessage('닉네임은 2자 이상 20자 이하여야 합니다.'),
  ],
  async (req, res, next) => {
    try {
      // 1) 입력값 유효성 검사
      const validationError = handleValidation(req, res);
      if (validationError) return validationError;

      const email = String(req.body.email).toLowerCase().trim();
      const { password } = req.body;
      const nickname =
        req.body.nickname && req.body.nickname.trim().length > 0
          ? req.body.nickname.trim()
          : null;

      // 2) 이메일 중복 검사 (1차: 빠른 조회)
      const existing = await User.findByEmail(email);
      if (existing) {
        return res.status(409).json({
          success: false,
          message: '이미 가입된 이메일입니다.',
          code: 'EMAIL_ALREADY_EXISTS',
        });
      }

      // 3) 사용자 생성 (모델 내부에서 bcrypt 해싱됨)
      const user = await User.create({ email, password, nickname });

      // 4) JWT 발급 (payload 에 유저 _id 포함)
      const token = signToken(user);

      // 5) 응답 (password 는 toPublicProfile / toJSON 에서 제외됨)
      return res.status(201).json(authSuccessPayload(user, token));
    } catch (err) {
      // unique 제약 경합(동시 요청)으로 인한 중복 키 에러 처리 (Postgres 23505)
      if (err && err.code === '23505') {
        return res.status(409).json({
          success: false,
          message: '이미 가입된 이메일입니다.',
          code: 'EMAIL_ALREADY_EXISTS',
        });
      }

      return next(err);
    }
  }
);

// ===========================================================================
// POST /api/auth/login — 로그인
// ===========================================================================
router.post(
  '/login',
  authLimiter,
  [
    body('email')
      .trim()
      .notEmpty()
      .withMessage('이메일을 입력해주세요.')
      .isEmail()
      .withMessage('올바른 이메일 형식이 아닙니다.')
      .normalizeEmail(),
    body('password')
      .notEmpty()
      .withMessage('비밀번호를 입력해주세요.'),
  ],
  async (req, res, next) => {
    try {
      const validationError = handleValidation(req, res);
      if (validationError) return validationError;

      const email = String(req.body.email).toLowerCase().trim();
      const { password } = req.body;

      // 1) 사용자 조회 (비밀번호 필드 명시적 포함)
      const user = await User.findByEmail(email, true);

      // 2) 사용자 없음 / 비밀번호 불일치 → 동일한 메시지로 정보 노출 최소화
      if (!user) {
        return res.status(401).json({
          success: false,
          message: '이메일 또는 비밀번호가 올바르지 않습니다.',
          code: 'INVALID_CREDENTIALS',
        });
      }

      // 3) 비밀번호 검증
      const isMatch = await User.verifyPassword(user, password);
      if (!isMatch) {
        return res.status(401).json({
          success: false,
          message: '이메일 또는 비밀번호가 올바르지 않습니다.',
          code: 'INVALID_CREDENTIALS',
        });
      }

      // 4) 계정 활성 여부
      if (!user.isActive) {
        return res.status(403).json({
          success: false,
          message: '비활성화된 계정입니다. 관리자에게 문의하세요.',
          code: 'ACCOUNT_DISABLED',
        });
      }

      // 5) 최근 로그인 시각 갱신
      await User.touchLogin(user.id);

      // 6) JWT 발급
      const token = signToken(user);

      return res.status(200).json(authSuccessPayload(user, token));
    } catch (err) {
      return next(err);
    }
  }
);

// ===========================================================================
// GET /api/auth/me — 내 프로필 (보호됨)
// ===========================================================================
router.get('/me', protect, async (req, res, next) => {
  try {
    return res.status(200).json({
      success: true,
      user: User.toPublicProfile(req.user),
    });
  } catch (err) {
    return next(err);
  }
});

// ===========================================================================
// PATCH /api/auth/me — 프로필 수정 (닉네임) (보호됨)
// ===========================================================================
router.patch(
  '/me',
  protect,
  [
    body('nickname')
      .trim()
      .isLength({ min: 2, max: 20 })
      .withMessage('닉네임은 2자 이상 20자 이하여야 합니다.'),
  ],
  async (req, res, next) => {
    try {
      const validationError = handleValidation(req, res);
      if (validationError) return validationError;

      req.user = await User.updateNickname(req.user.id, req.body.nickname.trim());

      return res.status(200).json({
        success: true,
        user: User.toPublicProfile(req.user),
      });
    } catch (err) {
      return next(err);
    }
  }
);

// ===========================================================================
// POST /api/auth/refresh — 토큰 재발급 (선택)
// ===========================================================================
router.post('/refresh', protect, async (req, res) => {
  const token = signToken(req.user);
  return res.status(200).json(authSuccessPayload(req.user, token));
});

module.exports = router;
