// 시연 서버 자동 갱신: dev에 새 커밋이 올라오면 받아서 서버에 반영한다. 팀원은 아무것도 하지 않아도 최신 화면을 본다.
// 실행: 시연 서버 폴더(dev)에서 npm start 대신 npm run demo. 공개 주소는 다른 터미널에서 npm run tunnel(서버를 다시 켜도 터널 주소는 그대로).
// DEMO_SYNC_SEC(기본 60)초마다 origin/dev를 확인한다.
// - frontend/만 바뀌면 서버가 그 폴더를 그대로 서빙하므로 받기만 한다(브라우저 새로고침으로 반영).
// - 그 밖(backend·llm·content·package.json 등)이 바뀌면 빌드한 뒤 서버를 다시 켠다. 빌드가 실패하면 기존 서버를 그대로 둔다.
// - 브랜치가 dev가 아니거나 추적 중인 파일에 커밋 안 한 수정이 있으면 받지 않는다(시연 폴더의 작업을 덮지 않게). DB(/data/)와 .env는 추적하지 않아 그대로 남는다.
// 서버를 다시 켜면 .env에 JWT_SECRET이 없을 때 로그인이 풀린다(임시 키). 시연 서버에는 JWT_SECRET을 넣어 둔다.
import { spawn, spawnSync } from 'node:child_process';

const BRANCH = process.env.DEMO_BRANCH || 'dev';
const EVERY = Number(process.env.DEMO_SYNC_SEC || 60) * 1000;

const log = (msg) => console.log(`[demo ${new Date().toTimeString().slice(0, 8)}] ${msg}`);
let lastSkip = '';
const skip = (msg) => { if (msg && msg !== lastSkip) log(msg); lastSkip = msg; }; // 받지 않는 이유는 바뀔 때만 한 번 찍는다(매분 반복하지 않게)
function git(...args) {
  const r = spawnSync('git', args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 실패: ${(r.stderr || '').trim()}`);
  return r.stdout.trim();
}
const npm = (...args) => spawnSync('npm', args, { stdio: 'inherit', shell: process.platform === 'win32' }).status === 0;

let server = null;
function startServer() {
  const child = spawn(process.execPath, ['--env-file-if-exists=.env', '.build/backend/src/ironmaking-server.js'], { stdio: 'inherit' });
  child.on('exit', (code) => { if (server === child) { server = null; log(`서버가 꺼졌습니다(code ${code}). 다음 확인 때 다시 켭니다`); } });
  server = child;
}
function stopServer() {
  const child = server; server = null;
  if (!child || child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => { child.once('exit', resolve); child.kill(); });
}

async function sync() {
  if (git('rev-parse', '--abbrev-ref', 'HEAD') !== BRANCH) return skip(`지금 브랜치가 ${BRANCH}가 아니라 받지 않습니다`);
  git('fetch', '--quiet', 'origin', BRANCH);
  const head = git('rev-parse', 'HEAD'), remote = git('rev-parse', `origin/${BRANCH}`);
  if (head === remote) return skip('');
  if (git('status', '--porcelain', '--untracked-files=no')) return skip('커밋 안 한 수정이 있어 받지 않습니다(git status 확인)');
  lastSkip = '';
  const files = git('diff', '--name-only', head, remote).split('\n').filter(Boolean);
  git('merge', '--ff-only', '--quiet', remote);
  log(`${head.slice(0, 7)} → ${remote.slice(0, 7)} 받음(파일 ${files.length}개)`);
  if (files.some((f) => f === 'package.json' || f === 'package-lock.json') && !npm('install')) log('npm install 실패');
  if (!files.some((f) => !f.startsWith('frontend/'))) return log('화면 파일만 바뀌어 서버는 그대로 둡니다');
  if (!npm('run', 'build')) return log('빌드 실패: 기존 서버를 그대로 둡니다');
  await stopServer(); startServer(); log('서버를 다시 켰습니다');
}

async function loop() {
  try { await sync(); } catch (e) { log(e.message); }
  if (!server) { startServer(); log('꺼진 서버를 다시 켰습니다'); }
  setTimeout(loop, EVERY);
}

process.on('SIGINT', async () => { await stopServer(); process.exit(0); });
if (!npm('run', 'build')) process.exit(1);
startServer();
log(`${EVERY / 1000}초마다 origin/${BRANCH}를 확인합니다`);
setTimeout(loop, EVERY);
