import { GeminiEvaluator } from "../../llm/src/evaluator.js";
import { GeminiClient } from "../../llm/src/gemini.js";
import { GeminiTutor } from "../../llm/src/tutor.js";
import { createApp } from "./app.js";
import { CheckpointEngine } from "./checkpoint/engine.js";
import { CheckpointRepository } from "./checkpoint/repository.js";
import { openDatabase } from "./db/database.js";
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

const port = Number(process.env.PORT ?? 3000);
// 이 컴퓨터에서만 접속을 받는다. 원격 공유는 cloudflared 터널(npm run tunnel)이 localhost로 넘겨준다.
createApp({ engine, usage }).listen(port, "127.0.0.1", () => {
  console.log(`제선 공정 알아보기: http://localhost:${port}`);
  console.log(`접속 비밀번호: ${passcodeRequired() ? "사용(TEST_PASSCODE)" : "사용 안 함"} · 사용자별 하루 LLM 호출 한도: ${usage.dailyLimit > 0 ? `${usage.dailyLimit}회` : "제한 없음"}`);
});
