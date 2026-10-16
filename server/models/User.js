'use strict';

// ===========================================================================
// User 모델 (Mongoose 스키마)
// ---------------------------------------------------------------------------
// 요구 명세:
//   - email, password, gameStats: { wins, losses }
//   - bcryptjs 를 사용한 비밀번호 솔팅/해시화
//   - 이메일 중복 방지(unique 인덱스) 및 형식 검증
//
// 보안 설계 포인트:
//   1) password 필드는 `select: false` 로 설정하여 일반 조회 시 자동 제외합니다.
//      (로그인 시에만 명시적으로 .select('+password') 로 가져옵니다.)
//   2) pre('save') 훅에서 비밀번호가 변경(isModified)된 경우에만 해시하여
//      중복 해싱을 방지합니다.
//   3) comparePassword 인스턴스 메서드로 안전한 상수 시간 비교를 제공합니다.
//   4) toJSON 변환 시 password 를 제거하여 응답 유출을 원천 차단합니다.
// ===========================================================================

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const { Schema, model } = mongoose;

// bcrypt 해싱 라운드 (환경 변수로 조정 가능, 기본 12)
const SALT_ROUNDS = Number.parseInt(process.env.BCRYPT_SALT_ROUNDS, 10) || 12;

// ---------------------------------------------------------------------------
// gameStats 서브 스키마
// ---------------------------------------------------------------------------
const GameStatsSchema = new Schema(
  {
    wins: {
      type: Number,
      default: 0,
      min: [0, '승리 횟수는 0 이상이어야 합니다.'],
    },
    losses: {
      type: Number,
      default: 0,
      min: [0, '패배 횟수는 0 이상이어야 합니다.'],
    },
    // 확장 통계(선택): 킬/생존/발전기 수리 등 세부 지표
    matchesPlayed: {
      type: Number,
      default: 0,
      min: 0,
    },
    generatorsRepaired: {
      type: Number,
      default: 0,
      min: 0,
    },
    survivorsSacrificed: {
      type: Number,
      default: 0,
      min: 0,
    },
    escapes: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { _id: false }
);

// ---------------------------------------------------------------------------
// User 스키마 정의
// ---------------------------------------------------------------------------
const UserSchema = new Schema(
  {
    email: {
      type: String,
      required: [true, '이메일은 필수 입력 항목입니다.'],
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
      match: [
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        '올바른 이메일 형식이 아닙니다.',
      ],
      maxlength: [254, '이메일이 너무 깁니다.'],
    },

    password: {
      type: String,
      required: [true, '비밀번호는 필수 입력 항목입니다.'],
      minlength: [8, '비밀번호는 최소 8자 이상이어야 합니다.'],
      maxlength: [72, '비밀번호는 최대 72자까지 가능합니다.'], // bcrypt 입력 한계
      select: false, // 기본 조회 시 제외
    },

    // 표시용 닉네임 (선택). 미입력 시 이메일 앞부분으로 자동 생성됩니다.
    nickname: {
      type: String,
      trim: true,
      maxlength: [20, '닉네임은 최대 20자까지 가능합니다.'],
      default: null,
    },

    gameStats: {
      type: GameStatsSchema,
      default: () => ({}),
    },

    // 계정 상태 관리
    isActive: {
      type: Boolean,
      default: true,
    },

    lastLoginAt: {
      type: Date,
      default: null,
    },
  },
  {
    // createdAt / updatedAt 자동 생성
    timestamps: true,
    // toJSON / toObject 시 가상 필드 포함
    toJSON: { virtuals: true, transform: transformUser },
    toObject: { virtuals: true, transform: transformUser },
  }
);

// ---------------------------------------------------------------------------
// 인덱스
// ---------------------------------------------------------------------------
// email 유일 인덱스 (unique: true 와 중복이지만 명시적으로 보강)
UserSchema.index({ email: 1 }, { unique: true });

// ---------------------------------------------------------------------------
// 가상 필드: 승률
// ---------------------------------------------------------------------------
UserSchema.virtual('winRate').get(function () {
  const total = (this.gameStats?.wins || 0) + (this.gameStats?.losses || 0);
  if (total === 0) return 0;
  return Number(((this.gameStats.wins / total) * 100).toFixed(2));
});

// ---------------------------------------------------------------------------
// toJSON / toObject 변환 함수: 민감 정보 제거
// ---------------------------------------------------------------------------
function transformUser(_doc, ret) {
  delete ret.password;
  delete ret.__v;
  return ret;
}

// ---------------------------------------------------------------------------
// 미들웨어: 비밀번호 해싱 (save 이전)
// ---------------------------------------------------------------------------
UserSchema.pre('save', async function hashPassword(next) {
  try {
    // 비밀번호가 변경되지 않았으면 그대로 진행 (중복 해싱 방지)
    if (!this.isModified('password')) {
      return next();
    }

    // bcryptjs: 자동으로 랜덤 솔트를 생성하여 해시 (내장 salt)
    const salt = await bcrypt.genSalt(SALT_ROUNDS);
    this.password = await bcrypt.hash(this.password, salt);

    return next();
  } catch (err) {
    return next(err);
  }
});

// 닉네임 자동 생성: 저장 직전에 비어 있으면 이메일 로컬 파트 사용
UserSchema.pre('save', function assignNickname(next) {
  if (!this.nickname && this.email) {
    this.nickname = this.email.split('@')[0].slice(0, 20);
  }
  next();
});

// ---------------------------------------------------------------------------
// 인스턴스 메서드: 비밀번호 비교
// ---------------------------------------------------------------------------
UserSchema.methods.comparePassword = async function comparePassword(
  candidatePassword
) {
  // this.password 는 로그인 시 .select('+password') 로 로드되어 있어야 합니다.
  if (!this.password) {
    throw new Error(
      '비밀번호 필드가 로드되지 않았습니다. .select("+password") 를 사용하세요.'
    );
  }
  return bcrypt.compare(candidatePassword, this.password);
};

// ---------------------------------------------------------------------------
// 인스턴스 메서드: 공개 프로필 반환
// ---------------------------------------------------------------------------
UserSchema.methods.toPublicProfile = function toPublicProfile() {
  return {
    id: this._id,
    email: this.email,
    nickname: this.nickname,
    gameStats: {
      wins: this.gameStats?.wins || 0,
      losses: this.gameStats?.losses || 0,
      matchesPlayed: this.gameStats?.matchesPlayed || 0,
      generatorsRepaired: this.gameStats?.generatorsRepaired || 0,
      survivorsSacrificed: this.gameStats?.survivorsSacrificed || 0,
      escapes: this.gameStats?.escapes || 0,
    },
    winRate: this.winRate,
    createdAt: this.createdAt,
    lastLoginAt: this.lastLoginAt,
  };
};

// ---------------------------------------------------------------------------
// 정적 메서드: 이메일로 사용자 조회 (비밀번호 포함 옵션)
// ---------------------------------------------------------------------------
UserSchema.statics.findByEmail = function findByEmail(email, withPassword = false) {
  const query = this.findOne({ email: String(email).toLowerCase().trim() });
  if (withPassword) {
    query.select('+password');
  }
  return query.exec();
};

// ---------------------------------------------------------------------------
// 정적 메서드: 전적 업데이트
// ---------------------------------------------------------------------------
UserSchema.statics.recordMatchResult = function recordMatchResult(
  userId,
  { win, generatorsRepaired = 0, survivorsSacrificed = 0, escaped = false }
) {
  const inc = { 'gameStats.matchesPlayed': 1 };
  inc[win ? 'gameStats.wins' : 'gameStats.losses'] = 1;
  if (generatorsRepaired) {
    inc['gameStats.generatorsRepaired'] = generatorsRepaired;
  }
  if (survivorsSacrificed) {
    inc['gameStats.survivorsSacrificed'] = survivorsSacrificed;
  }
  if (escaped) {
    inc['gameStats.escapes'] = 1;
  }

  return this.findByIdAndUpdate(
    userId,
    { $inc: inc },
    { new: true, runValidators: true }
  ).exec();
};

// ---------------------------------------------------------------------------
// 모델 생성 및 내보내기
// ---------------------------------------------------------------------------
const User = mongoose.models.User || model('User', UserSchema);

module.exports = User;
module.exports.SALT_ROUNDS = SALT_ROUNDS;
