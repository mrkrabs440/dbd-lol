'use strict';

// ===========================================================================
// 개발용 시드 스크립트 (npm run seed)
// ---------------------------------------------------------------------------
// 데모 계정 4개를 생성하여 4인 매칭 테스트를 바로 시작할 수 있게 합니다.
// 이미 존재하는 이메일은 건너뜁니다.
// ===========================================================================

require('dotenv').config();

const { connectDB, disconnectDB } = require('../config/db');
const User = require('../models/User');

const DEMO_USERS = [
  { email: 'killer@example.com', nickname: '살인마데모', password: 'Demo1234' },
  { email: 'survivor1@example.com', nickname: '생존자1', password: 'Demo1234' },
  { email: 'survivor2@example.com', nickname: '생존자2', password: 'Demo1234' },
  { email: 'survivor3@example.com', nickname: '생존자3', password: 'Demo1234' },
];

async function seed() {
  await connectDB();
  for (const demo of DEMO_USERS) {
    const existing = await User.findOne({ email: demo.email }).lean();
    if (existing) {
      console.log(`[Seed] 존재함 → 건너뜀: ${demo.email}`);
      continue;
    }
    await User.create(demo);
    console.log(`[Seed] 생성됨: ${demo.email} / ${demo.password}`);
  }
  await disconnectDB();
  console.log('[Seed] 완료.');
}

seed().catch((err) => {
  console.error('[Seed] 실패:', err.message);
  process.exit(1);
});
