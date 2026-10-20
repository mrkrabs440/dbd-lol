'use strict';

// ===========================================================================
// DBD Clone 백엔드 서버 진입점
// ---------------------------------------------------------------------------
//   HTTP: Express REST API(/api/auth) + 정적 클라이언트 서빙(public/ 또는 dist/)
//   WS:   Socket.io 실시간 세션/매치메이킹/인게임 패킷 라우팅
// ===========================================================================

require('dotenv').config();

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');

const { connectDB, getDBStatus } = require('./config/db');
const authRouter = require('./routes/authRouter');
const { socketAuthMiddleware } = require('./middleware/socketAuth');
const { signGuestToken } = require('./utils/token');
const { RoomManager } = require('./game/roomManager');

const NODE_ENV = process.env.NODE_ENV || 'development';
const PORT = Number.parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const CLIENT_ORIGIN = (process.env.CLIENT_ORIGIN || '*')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

// ===========================================================================
// Express 앱 구성
// ===========================================================================
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);
app.use(
  cors({
    origin: CLIENT_ORIGIN.includes('*') ? true : CLIENT_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);
app.use(compression());
app.use(morgan(NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: true, limit: '256kb' }));

// 전역 API 레이트 리밋(인증 라우터에는 별도 리밋이 적용됨).
app.use(
  '/api/',
  rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      message: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.',
      code: 'RATE_LIMITED',
    },
  })
);

// ---------------------------------------------------------------------------
// 정적 클라이언트 서빙: dist(프로덕션 빌드) 우선, 없으면 public(개발)
// ---------------------------------------------------------------------------
const distDir = path.join(__dirname, '..', 'dist');
const publicDir = path.join(__dirname, '..', 'public');
const staticDir = fs.existsSync(path.join(distDir, 'index.html')) ? distDir : publicDir;
app.use(express.static(staticDir, { maxAge: NODE_ENV === 'production' ? '1h' : 0 }));

// ---------------------------------------------------------------------------
// 상태 점검 엔드포인트
// ---------------------------------------------------------------------------
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    service: 'dbd-clone-server',
    env: NODE_ENV,
    uptimeSec: Math.floor(process.uptime()),
    db: getDBStatus(),
  });
});

let roomManager = null;
app.get('/api/status', (req, res) => {
  res.status(200).json({
    success: true,
    db: getDBStatus(),
    matchmaking: roomManager ? roomManager.getStatus() : null,
    time: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// REST API 라우터
// ---------------------------------------------------------------------------
app.use('/api/auth', authRouter);

// 게스트 세션(싱글 테스트 모드용). DB 없이도 발급된다.
app.post('/api/guest', (req, res) => {
  const nickname = String(req.body?.nickname || '게스트').slice(0, 16);
  const token = signGuestToken(nickname);
  res.status(200).json({
    success: true,
    token,
    user: { id: `guest_${Date.now()}`, nickname, isGuest: true },
  });
});

// SPA 폴백: API가 아닌 모든 GET 요청은 index.html 반환.
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io/')) {
    return next();
  }
  const indexFile = path.join(staticDir, 'index.html');
  if (fs.existsSync(indexFile)) return res.sendFile(indexFile);
  return res.status(404).json({ success: false, message: '클라이언트 빌드를 찾을 수 없습니다.', code: 'NO_CLIENT' });
});

// API 404 처리.
app.use('/api', (req, res) => {
  res.status(404).json({
    success: false,
    message: `API 경로를 찾을 수 없습니다: ${req.method} ${req.originalUrl}`,
    code: 'API_NOT_FOUND',
  });
});

// 전역 오류 처리.
app.use((err, req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  if (NODE_ENV !== 'test') {
    console.error(`[HTTP] ${req.method} ${req.originalUrl} → ${status}:`, err.message);
  }
  res.status(status).json({
    success: false,
    message: status >= 500 ? '서버 내부 오류가 발생했습니다.' : err.message,
    code: err.code || (status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR'),
  });
});

// ===========================================================================
// HTTP + Socket.io 서버 구성
// ===========================================================================
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: CLIENT_ORIGIN.includes('*') ? true : CLIENT_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST'],
  },
  transports: ['websocket', 'polling'],
  pingInterval: 20000,
  pingTimeout: 15000,
  maxHttpBufferSize: 256 * 1024,
});

roomManager = new RoomManager(io);

// ---------------------------------------------------------------------------
// 소켓 인증 미들웨어: 핸드셰이크 단계에서 JWT 가로채 검증
// ---------------------------------------------------------------------------
io.use(socketAuthMiddleware);

io.on('connection', (socket) => {
  console.log(`[Socket] 연결됨 ${socket.id} (${socket.user?.nickname || socket.user?.email})`);

  // 연결 직후 세션 정보 전달.
  socket.emit('connected', {
    socketId: socket.id,
    user: socket.user,
    serverTime: Date.now(),
  });

  // --- 매치메이킹 ------------------------------------------------------------
  socket.on('queue:join', () => roomManager.enqueue(socket));
  socket.on('matchmaking:join', () => roomManager.enqueue(socket));
  socket.on('queue:leave', () => {
    const left = roomManager.dequeue(socket.id);
    socket.emit('queue:left', { left, ...roomManager.getQueueSnapshot(socket.id) });
  });
  socket.on('matchmaking:leave', () => {
    const left = roomManager.dequeue(socket.id);
    socket.emit('queue:left', { left, ...roomManager.getQueueSnapshot(socket.id) });
  });

  // --- 싱글 테스트 모드 (혼자서 즉시 매치) --------------------------------------
  socket.on('test:start', (data) => {
    const role = data?.role === 'survivor' ? 'survivor' : 'killer';
    roomManager.createTestMatch(socket, role);
  });
  socket.on('queue:join_test', (data) => {
    const role = data?.role === 'survivor' ? 'survivor' : 'killer';
    roomManager.createTestMatch(socket, role);
  });

  // --- 인게임 패킷 라우팅 ------------------------------------------------------
  // 요구 명세 이벤트명: move / repair_progress / attack_hit
  socket.on('move', (data) => roomManager.handleMove(socket, data));
  socket.on('player:move', (data) => roomManager.handleMove(socket, data));

  socket.on('repair_progress', (data) => roomManager.handleRepair(socket, data));
  socket.on('repair:stop', (data) => roomManager.handleRepairStop(socket, data));

  socket.on('attack_hit', (data) => roomManager.handleAttack(socket, data));

  // --- 살인마 스킬 --------------------------------------------------------------
  socket.on('killer_skill', (data) => roomManager.handleKillerSkill(socket, data));
  socket.on('skill:use', (data) => roomManager.handleKillerSkill(socket, data));

  // 탈출 요청(모든 발전기 완료 후 게이트 근처에서 전송).
  socket.on('player:escape', () => roomManager.handleEscape(socket));

  socket.on('disconnect', (reason) => {
    console.log(`[Socket] 연결 종료 ${socket.id} (사유=${reason})`);
    roomManager.handleDisconnect(socket);
  });

  socket.on('error', (err) => {
    console.error(`[Socket] 오류 ${socket.id}:`, err?.message || err);
  });
});

// 인증 실패는 클라이언트의 connect_error 로 전달된다.
io.engine.on('connection_error', (err) => {
  console.warn('[Socket] 핸드셰이크 실패:', err.message);
});

// ===========================================================================
// 서버 부팅: 포트를 먼저 열어 Render 포트 감지를 통과시키고,
// DB는 백그라운드에서 연결한다 (DB 없어도 /health 응답 가능)
// ===========================================================================
async function start() {
  httpServer.listen(PORT, HOST, () => {
    console.log('==============================================================');
    console.log('[Server] DBD Clone 백엔드 가동');
    console.log(`[Server] 환경: ${NODE_ENV}`);
    console.log(`[Server] 주소: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
    console.log(`[Server] 정적 디렉토리: ${staticDir}`);
    console.log('==============================================================');
  });

  try {
    await connectDB();
  } catch (err) {
    console.error('[Server] DB 초기 연결 실패, 30초 간격으로 백그라운드 재시도:', err.message);
    const retry = setInterval(async () => {
      try {
        await connectDB();
        console.log('[Server] DB 백그라운드 재연결 성공.');
        clearInterval(retry);
      } catch (e) {
        console.error('[Server] DB 재시도 실패:', e.message);
      }
    }, 30000);
  }
}

// 예기치 않은 오류 로깅.
process.on('unhandledRejection', (reason) => {
  console.error('[Server] 처리되지 않은 Promise 거부:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[Server] 처리되지 않은 예외:', err);
});

// 우아한 종료.
function shutdown(signal) {
  console.log(`[Server] ${signal} 수신 → 종료 중...`);
  httpServer.close(() => {
    console.log('[Server] HTTP 서버 종료 완료.');
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 10000).unref?.();
}
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

if (require.main === module) {
  start();
}

module.exports = { app, httpServer, io, start };
