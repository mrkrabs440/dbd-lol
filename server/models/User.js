'use strict';

// ===========================================================================
// User 스토어 (Supabase Postgres 백엔드)
// ---------------------------------------------------------------------------
// Mongoose 모델을 대체하는 Supabase 기반 저장소입니다.
// 호출부 변경을 최소화하기 위해 DB snake_case 컬럼을 camelCase 객체로 변환해
// 반환합니다 (id/email/nickname/isActive/gameStats/...).
// 비밀번호 해시는 bcryptjs 로 처리합니다.
// ===========================================================================

const bcrypt = require('bcryptjs');
const { getClient } = require('../config/db');

const SALT_ROUNDS = Number.parseInt(process.env.BCRYPT_SALT_ROUNDS, 10) || 12;

// Supabase 행 → camelCase 사용자 객체
function toUser(row, withPassword = false) {
  if (!row) return null;
  const u = {
    id: row.id,
    email: row.email,
    nickname: row.nickname,
    isActive: row.is_active,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    gameStats: {
      wins: row.wins || 0,
      losses: row.losses || 0,
      matchesPlayed: row.matches_played || 0,
      generatorsRepaired: row.generators_repaired || 0,
      survivorsSacrificed: row.survivors_sacrificed || 0,
      escapes: row.escapes || 0,
    },
  };
  if (withPassword) u.passwordHash = row.password_hash;
  return u;
}

function toPublicProfile(u) {
  if (!u) return null;
  const wins = u.gameStats?.wins || 0;
  const losses = u.gameStats?.losses || 0;
  const total = wins + losses;
  return {
    id: u.id,
    email: u.email,
    nickname: u.nickname,
    gameStats: {
      wins,
      losses,
      matchesPlayed: u.gameStats?.matchesPlayed || 0,
      generatorsRepaired: u.gameStats?.generatorsRepaired || 0,
      survivorsSacrificed: u.gameStats?.survivorsSacrificed || 0,
      escapes: u.gameStats?.escapes || 0,
    },
    winRate: total === 0 ? 0 : Number(((wins / total) * 100).toFixed(2)),
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt,
  };
}

async function findByEmail(email, withPassword = false) {
  const cols = withPassword ? '*' : 'id,email,nickname,is_active,last_login_at,created_at,wins,losses,matches_played,generators_repaired,survivors_sacrificed,escapes';
  const { data, error } = await getClient()
    .from('users')
    .select(cols)
    .eq('email', String(email).toLowerCase().trim())
    .maybeSingle();
  if (error) throw error;
  return toUser(data, withPassword);
}

async function findById(id) {
  const { data, error } = await getClient()
    .from('users')
    .select('id,email,nickname,is_active,last_login_at,created_at,wins,losses,matches_played,generators_repaired,survivors_sacrificed,escapes')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return toUser(data, false);
}

async function create({ email, password, nickname }) {
  const cleanEmail = String(email).toLowerCase().trim();
  const hash = await bcrypt.hash(password, await bcrypt.genSalt(SALT_ROUNDS));
  const { data, error } = await getClient()
    .from('users')
    .insert({
      email: cleanEmail,
      password_hash: hash,
      nickname: nickname && nickname.trim() ? nickname.trim() : cleanEmail.split('@')[0].slice(0, 20),
    })
    .select('id,email,nickname,is_active,last_login_at,created_at,wins,losses,matches_played,generators_repaired,survivors_sacrificed,escapes')
    .single();
  if (error) throw error; // 이메일 중복 시 code '23505'
  return toUser(data, false);
}

async function verifyPassword(userWithHash, candidatePassword) {
  if (!userWithHash || !userWithHash.passwordHash) {
    throw new Error('비밀번호 해시가 로드되지 않았습니다.');
  }
  return bcrypt.compare(candidatePassword, userWithHash.passwordHash);
}

async function touchLogin(id) {
  await getClient().from('users').update({ last_login_at: new Date().toISOString() }).eq('id', id);
}

async function updateNickname(id, nickname) {
  const { data, error } = await getClient()
    .from('users')
    .update({ nickname })
    .eq('id', id)
    .select('id,email,nickname,is_active,last_login_at,created_at,wins,losses,matches_played,generators_repaired,survivors_sacrificed,escapes')
    .single();
  if (error) throw error;
  return toUser(data, false);
}

async function recordMatchResult(userId, { win, generatorsRepaired = 0, survivorsSacrificed = 0, escaped = false }) {
  const { data: cur, error: readErr } = await getClient()
    .from('users')
    .select('wins,losses,matches_played,generators_repaired,survivors_sacrificed,escapes')
    .eq('id', userId)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!cur) return null;
  const patch = {
    wins: (cur.wins || 0) + (win ? 1 : 0),
    losses: (cur.losses || 0) + (win ? 0 : 1),
    matches_played: (cur.matches_played || 0) + 1,
    generators_repaired: (cur.generators_repaired || 0) + (generatorsRepaired || 0),
    survivors_sacrificed: (cur.survivors_sacrificed || 0) + (survivorsSacrificed || 0),
    escapes: (cur.escapes || 0) + (escaped ? 1 : 0),
  };
  const { error: upErr } = await getClient().from('users').update(patch).eq('id', userId);
  if (upErr) throw upErr;
  return patch;
}

module.exports = {
  findByEmail,
  findById,
  create,
  verifyPassword,
  touchLogin,
  updateNickname,
  recordMatchResult,
  toPublicProfile,
  SALT_ROUNDS,
};
