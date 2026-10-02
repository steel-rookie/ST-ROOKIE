import express from "express";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { answerQuestion, DEFAULT_GEMINI_MODEL, GeminiApiError, type ChatTurn } from "../../llm/src/ironmaking-agent.js";
import { seedDemoAccounts } from "./auth/demo-accounts.js";
import { createAuthRouter } from "./auth/routes.js";
import { jwtSecret } from "./auth/tokens.js";
import { UserRepository } from "./auth/users.js";
import { openDatabase } from "./db/database.js";
import { loadFinalRubrics } from "./rubrics.js";

// 루브릭 형식이 틀리면 여기서 예외가 나 서버가 시작되지 않는다.
loadFinalRubrics();

const db = openDatabase();
const users = new UserRepository(db);
const seeded = await seedDemoAccounts(users);
if (seeded > 0) console.log(`시연 계정 ${seeded}개를 만들었습니다.`);

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));
const auth = { users, secret: jwtSecret() };
app.use(createAuthRouter(auth));

const webRoot = join(process.cwd(), "frontend", "3d-demo");
app.use(express.static(webRoot));

const sessions = new Map<string, { turns: ChatTurn[]; touched: number }>();
const busy = new Set<string>();
const MAX_AGE_MS = 2 * 60 * 60 * 1000;

app.get("/api/status", (_req, res) => {
  res.json({ connected: Boolean(process.env.GEMINI_API_KEY), provider: "Gemini", model: process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL });
});

const ChatRequest = z.object({
  question: z.string().trim().min(1).max(1000),
  session_id: z.string().uuid().optional(),
});

app.post("/api/chat", async (req, res) => {
  const body = ChatRequest.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "질문은 1~1000자로 입력해 주세요." });
    return;
  }
  if (!process.env.GEMINI_API_KEY) {
    res.status(503).json({ error: "Gemini가 연결되지 않았습니다. 서버에 GEMINI_API_KEY를 설정해 주세요.", code: "LLM_NOT_CONFIGURED" });
    return;
  }
  const now = Date.now();
  for (const [id, session] of sessions) if (now - session.touched > MAX_AGE_MS) sessions.delete(id);
  const id = body.data.session_id ?? randomUUID();
  const existing = sessions.get(id);
  if (body.data.session_id && !existing) {
    res.status(404).json({ error: "대화가 만료되었습니다. 다시 질문해 주세요." });
    return;
  }
  if (busy.has(id)) {
    res.status(409).json({ error: "이전 질문에 답변하는 중입니다." });
    return;
  }
  busy.add(id);
  try {
    const answer = await answerQuestion(body.data.question, existing?.turns ?? []);
    const turns = [...(existing?.turns ?? []), { question: body.data.question, answer: answer.answer }].slice(-6);
    sessions.set(id, { turns, touched: Date.now() });
    res.json({ ...answer, session_id: id });
  } catch (error) {
    if (error instanceof GeminiApiError) {
      console.error(`Gemini API error ${error.status}`);
      if (error.status === 429) res.status(429).json({ error: "Gemini 요청이 많습니다. 잠시 후 다시 질문해 주세요." });
      else if (error.status === 400 || error.status === 404) res.status(502).json({ error: "Gemini 모델 ID를 확인해 주세요." });
      else if (error.status === 401 || error.status === 403) res.status(502).json({ error: "Gemini API 키와 모델 사용 권한을 확인해 주세요." });
      else res.status(502).json({ error: "Gemini 연결 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." });
    } else {
      console.error(error);
      res.status(502).json({ error: "답변을 처리하지 못했습니다. 다시 시도해 주세요." });
    }
  } finally {
    busy.delete(id);
  }
});

app.get("/", (_req, res) => res.sendFile(join(webRoot, "Steel Academy.dc.html")));

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`제선 공정 알아보기: http://localhost:${port}`));
