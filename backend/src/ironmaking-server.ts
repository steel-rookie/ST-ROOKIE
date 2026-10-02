import express from "express";
import { join } from "node:path";
import { GeminiEvaluator } from "../../llm/src/evaluator.js";
import { GeminiClient } from "../../llm/src/gemini.js";
import { GeminiLearningAgent } from "../../llm/src/learning-agent.js";
import { Retriever } from "../../llm/src/retrieval.js";
import { GeminiTutor } from "../../llm/src/tutor.js";
import { createAdminRouter } from "./admin/routes.js";
import { createApp } from "./app.js";
import { seedDemoAccounts } from "./auth/demo-accounts.js";
import { createAuthRouter } from "./auth/routes.js";
import { jwtSecret } from "./auth/tokens.js";
import { UserRepository } from "./auth/users.js";
import { CheckpointEngine } from "./checkpoint/engine.js";
import { CheckpointRepository } from "./checkpoint/repository.js";
import { openDatabase } from "./db/database.js";
import { useLearnerNotesSource } from "./learning/notes.js";
import { LearningRepository } from "./learning/repository.js";
import { createLearningRouter } from "./learning/routes.js";
import { currentUserId } from "./request-user.js";
import { loadFinalRubrics } from "./rubrics.js";
import { passcodeRequired } from "./test-access.js";
import { LlmUsage } from "./usage.js";

// 루브릭 형식이 틀리면 여기서 예외가 나 서버가 시작되지 않는다.
const rubrics = loadFinalRubrics();

const db = openDatabase();
const usage = new LlmUsage(db);
// 체크포인트의 평가자·튜터 호출마다 현재 사용자의 하루 호출 수를 센다.
const gemini = new GeminiClient({ beforeCall: () => usage.consume(currentUserId()) });
const engine = new CheckpointEngine({
  repo: new CheckpointRepository(db),
  evaluator: new GeminiEvaluator(gemini),
  tutor: new GeminiTutor(gemini),
  rubrics,
});

const users = new UserRepository(db);
const seeded = await seedDemoAccounts(users);
if (seeded > 0) console.log(`시연 계정 ${seeded}개를 만들었습니다.`);

// 학습 모드: 같은 GeminiClient를 써서 하루 호출 한도를 체크포인트와 함께 센다.
const learningRepo = new LearningRepository(db);
// 체크포인트에 넘길 학습자 메모(buildLearnerNotes)도 같은 기록을 읽는다.
useLearnerNotesSource(learningRepo);
const learning = createLearningRouter({
  repo: learningRepo,
  retriever: new Retriever({ glossaryFor: (s) => rubrics.find((r) => r.section === s)?.glossary ?? [] }),
  agent: new GeminiLearningAgent(gemini),
  rubrics,
});

const app = createApp({ engine, usage, learning });
// 로그인·관리자 API(docs/auth-api.md). createApp의 /api 접속 비밀번호 검사가 먼저 적용된다.
const auth = { users, secret: jwtSecret() };
app.use(createAuthRouter(auth));
app.use(createAdminRouter(db, auth));
// 로그인·마이페이지(frontend/login_ui)는 ../3d-demo/를 상대 경로로 읽으므로 두 폴더를 같은 깊이에 둔다.
const webRoot = join(process.cwd(), "frontend", "3d-demo");
app.use("/3d-demo", express.static(webRoot));
app.use("/login_ui", express.static(join(process.cwd(), "frontend", "login_ui")));
app.get("/login", (_req, res) => res.redirect("/login_ui/My%20Page.dc.html"));

const port = Number(process.env.PORT ?? 3000);
// 이 컴퓨터에서만 접속을 받는다. 원격 공유는 cloudflared 터널(npm run tunnel)이 localhost로 넘겨준다.
app.listen(port, "127.0.0.1", () => {
  console.log(`제선 공정 알아보기: http://localhost:${port}`);
  console.log(`접속 비밀번호: ${passcodeRequired() ? "사용(TEST_PASSCODE)" : "사용 안 함"} · 사용자별 하루 LLM 호출 한도: ${usage.dailyLimit > 0 ? `${usage.dailyLimit}회` : "제한 없음"}`);
});
