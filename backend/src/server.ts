import Anthropic from "@anthropic-ai/sdk";
import express from "express";
import { z } from "zod";
import { runTurn, ScreenInput } from "../../llm/src/agent.js";
import { createSession, getSession } from "./session.js";

const app = express();
app.use(express.json());

const MessageRequest = z.object({
  message: z.string().min(1).max(2000),
  screen_context: ScreenInput,
});

app.post("/sessions", (req, res) => {
  const learnerId = z.object({ learner_id: z.string().min(1) }).safeParse(req.body);
  if (!learnerId.success) {
    res.status(400).json({ error: "learner_id가 필요합니다." });
    return;
  }
  const session = createSession(learnerId.data.learner_id);
  res.status(201).json({ session_id: session.id });
});

// 같은 세션에 요청이 겹치면 대화 기록 순서가 꼬이므로 세션별로 한 번에 하나만 처리한다.
const busy = new Set<string>();

app.post("/sessions/:id/messages", async (req, res) => {
  const session = getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: "세션을 찾을 수 없습니다." });
    return;
  }
  const body = MessageRequest.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "요청 형식이 올바르지 않습니다.", issues: body.error.issues });
    return;
  }
  if (busy.has(session.id)) {
    res.status(409).json({ error: "이전 메시지를 처리하는 중입니다." });
    return;
  }

  busy.add(session.id);
  try {
    const result = await runTurn(session, body.data.message, body.data.screen_context);
    if (result.dropped.citations.length || result.dropped.scene_actions.length) {
      console.warn(`[session ${session.id}] 걸러낸 출력`, JSON.stringify(result.dropped));
    }
    res.json(result.response);
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      res.status(429).json({ error: "요청이 많습니다. 잠시 후 다시 시도해 주세요." });
    } else if (error instanceof Anthropic.APIError) {
      console.error(`Claude API 오류 ${error.status}:`, error.message);
      res.status(502).json({ error: "AI 응답을 받지 못했습니다." });
    } else {
      console.error(error);
      res.status(500).json({ error: "서버 오류가 발생했습니다." });
    }
  } finally {
    busy.delete(session.id);
  }
});

// 학습 기록은 읽기 전용이다. 점수·이수 상태는 grade_quiz_answer 도구를 통해서만 쌓인다.
app.get("/sessions/:id/learning-records", (req, res) => {
  const session = getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: "세션을 찾을 수 없습니다." });
    return;
  }
  res.json({ learner_id: session.learnerId, records: session.learningRecords });
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`교육 에이전트 서버: http://localhost:${port}`));
