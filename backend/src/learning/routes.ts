// 학습 모드 API: POST /api/chat. 흐름은 docs/learning-mode.md '흐름'.
// 안전 질문 차단 → retrieve() → 최근 대화·미해결 오개념 → 튜터 1회 → 오개념 기록(source=learning) → 대화 저장.
// 예전 /api/chat(ironmaking-agent)의 요청·응답 필드는 유지하고 screen, follow_up을 더했다.
import express from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getPublicSources } from "../../../llm/src/ironmaking-sources.js";
import { LearningFormatError, type LearningAgent } from "../../../llm/src/learning-agent.js";
import type { Retriever } from "../../../llm/src/retrieval.js";
import { LlmUnavailableError, SECTION_ORDER, type Section } from "../checkpoint/types.js";
import { currentUserId } from "../request-user.js";
import type { Rubric } from "../rubrics.js";
import { UsageLimitError } from "../usage.js";
import type { LearningRepository } from "./repository.js";
import { isSafetyQuestion, SAFETY_ANSWER } from "./safety.js";

/** 모델에 넘기는 같은 세션의 최근 대화 수. */
export const HISTORY_TURNS = 6;

const ChatRequest = z.object({
  question: z.string().trim().min(1).max(1000),
  session_id: z.string().uuid().optional(),
  screen: z
    .object({
      process_id: z.enum(SECTION_ORDER as [Section, ...Section[]]).optional().nullable(),
      equipment_id: z.string().regex(/^[a-z0-9_]{1,40}$/).optional().nullable(),
    })
    .optional(),
});

export interface LearningDeps {
  repo: LearningRepository;
  retriever: Retriever;
  agent: LearningAgent;
  rubrics: Rubric[];
  now?: () => string;
}

export function createLearningRouter({ repo, retriever, agent, rubrics, now = () => new Date().toISOString() }: LearningDeps): express.Router {
  const router = express.Router();
  // 같은 세션에서 답변 중에 또 질문하면 막는다(대화 순서가 꼬이지 않게).
  const busy = new Set<string>();

  router.post("/api/chat", async (req, res) => {
    const body = ChatRequest.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "질문은 1~1000자로 입력해 주세요." });
      return;
    }
    const userId = currentUserId();
    const { question } = body.data;
    const section: Section = body.data.screen?.process_id ?? "ironmaking";
    const equipmentId = body.data.screen?.equipment_id ?? null;

    const sessionId = body.data.session_id ?? randomUUID();
    if (body.data.session_id) {
      // 없는 세션이나 다른 사람의 세션은 구분하지 않고 같은 답을 준다.
      if (repo.sessionOwner(sessionId) !== userId) {
        res.status(404).json({ error: "대화를 찾을 수 없습니다. 새로 질문해 주세요." });
        return;
      }
    }
    if (busy.has(sessionId)) {
      res.status(409).json({ error: "이전 질문에 답변하는 중입니다." });
      return;
    }
    busy.add(sessionId);
    try {
      const base = { user_id: userId, session_id: sessionId, section, equipment_id: equipmentId, question };

      if (isSafetyQuestion(question)) {
        repo.saveTurn({ ...base, answer: SAFETY_ANSWER, status: "safety_redirect", source_ids: [] }, now());
        res.json({ answer: SAFETY_ANSWER, status: "safety_redirect", sources: [], follow_up: null, session_id: sessionId });
        return;
      }

      const rubric = rubrics.find((r) => r.section === section);
      const screen = { process_id: section, equipment_id: equipmentId };
      const history = repo.recentTurns(sessionId, HISTORY_TURNS).map((t) => ({ question: t.question, answer: t.answer }));
      // "그럼 그건요?"처럼 가리키는 말만 있는 후속 질문은 검색어가 없으므로, 질문만으로 못 찾으면 직전 대화를 붙여 다시 찾는다.
      let chunks = retriever.retrieve(section, question, screen);
      const last = history.at(-1);
      if (chunks.length === 0 && last) chunks = retriever.retrieve(section, `${question} ${last.question} ${last.answer}`, screen);
      const reply = await agent.reply({
        section,
        question,
        screen,
        chunks,
        history,
        openMisconceptions: repo.openMisconceptions(userId, section).map((m) => ({ concept_id: m.concept_id, summary: m.summary })),
        concepts: rubric?.concepts.map((c) => ({ concept_id: c.concept_id, name: c.name })) ?? [],
        glossary: rubric?.glossary ?? [],
      });

      const at = now();
      if (reply.detected_misconception) {
        repo.recordMisconception({ user_id: userId, section, concept_id: reply.detected_misconception.concept_id, answer_text: question, summary: reply.detected_misconception.summary }, at);
      }
      repo.saveTurn({ ...base, answer: reply.answer, status: reply.status, source_ids: reply.source_ids }, at);

      // 조각 id(자료id#번호) → 자료 id → 화면에 보여 줄 출처.
      const cited = chunks.filter((c) => reply.source_ids.includes(c.id)).flatMap((c) => c.source_ids);
      const sources = getPublicSources(cited).map(({ id, title, date, date_type, url, publisher }) => ({ id, title, date, date_type, url, publisher }));
      res.json({ answer: reply.answer, status: reply.status, sources, follow_up: reply.follow_up, session_id: sessionId });
    } catch (error) {
      if (error instanceof UsageLimitError) {
        res.status(429).json({ error: `오늘 쓸 수 있는 튜터 호출(${error.limit}회)을 다 썼어요.`, code: "USAGE_LIMIT" });
      } else if (error instanceof LlmUnavailableError) {
        console.error(`학습 모드 Gemini 오류: ${error.message}`);
        res.status(error.status).json(
          error.status === 503
            ? { error: "Gemini가 연결되지 않았습니다. 서버에 GEMINI_API_KEY를 설정해 주세요.", code: "LLM_NOT_CONFIGURED" }
            : { error: "Gemini 연결 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." },
        );
      } else if (error instanceof LearningFormatError) {
        console.error(error.message);
        res.status(502).json({ error: "답변을 처리하지 못했습니다. 다시 시도해 주세요." });
      } else {
        console.error(error);
        res.status(500).json({ error: "답변을 처리하지 못했습니다. 다시 시도해 주세요." });
      }
    } finally {
      busy.delete(sessionId);
    }
  });

  return router;
}
