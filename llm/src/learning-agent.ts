// 학습 모드 튜터(Gemini): 근거 조각으로 자유 질문에 답하고, 학습자가 틀린 내용을 단정하면 오개념을 함께 알려 준다.
// 예전 /api/chat(ironmaking-agent.ts, 지금은 삭제)을 대체했다. 설계는 docs/learning-mode.md '흐름'.
// - 호출은 1회(temperature 0.3). responseSchema로 형식을 강제하고, 서버에서 한 번 더 검증해 실패하면 1회 다시 부른다.
// - source_ids는 이번에 검색한 조각 id만, concept_id는 루브릭 개념만 남긴다.
import { z } from "zod";
import { SECTION_NAMES, type Section } from "../../backend/src/checkpoint/types.js";
import type { GlossaryEntry } from "../../backend/src/rubrics.js";
import { escapeDelimited, renderPrompt, type GeminiClient } from "./gemini.js";
import type { Retrieved, Screen } from "./retrieval.js";

const MAX_ATTEMPTS = 2;
const TEMPERATURE = 0.3;
const MAX_OUTPUT_TOKENS = 1200;
const MAX_ANSWER_CHARS = 4000;

/** 근거 없이 grounded라고 답했을 때 대신 보여 줄 답. */
export const UNVERIFIED_ANSWER =
  "수집한 포스코 공개 자료에서 이 질문의 답을 확인할 수 없습니다. 실제 운전 조건이나 작업 절차는 해당 자료와 현장 지침에서 별도로 확인해 주세요.";

export interface LearningInput {
  section: Section;
  question: string;
  screen: Screen & { equipment_name?: string | null };
  /** retrieve() 결과. 비어 있으면 모델은 unverified로 답한다. */
  chunks: Retrieved[];
  /** 같은 세션의 최근 대화(오래된 것부터). */
  history: { question: string; answer: string }[];
  /** 이 섹션의 미해결 오개념 요약(학습자 메모). */
  openMisconceptions: { concept_id: string; summary: string }[];
  /** 오개념을 붙일 수 있는 개념(루브릭). 비어 있으면 오개념을 기록하지 않는다. */
  concepts: { concept_id: string; name: string }[];
  glossary?: GlossaryEntry[];
}

export interface LearningReply {
  answer: string;
  status: "grounded" | "unverified";
  /** 근거로 쓴 조각 id(이번 검색 결과 안에서만). */
  source_ids: string[];
  follow_up: string | null;
  detected_misconception: { concept_id: string; summary: string } | null;
}

/** 라우트가 쓰는 학습 모드 튜터. 테스트는 가짜 구현을 넣는다. */
export interface LearningAgent {
  reply(input: LearningInput): Promise<LearningReply>;
}

/** 두 번 모두 형식에 맞지 않는 응답을 받았을 때. 라우트는 502로 답한다. */
export class LearningFormatError extends Error {}

/** Gemini responseSchema. 고를 수 있는 조각 id·개념 id를 enum으로 묶는다(빈 목록이면 enum을 두지 않는다). */
export function learningResponseSchema(chunkIds: string[], conceptIds: string[]): object {
  const enumOf = (values: string[]) => (values.length ? { enum: values } : {});
  return {
    type: "OBJECT",
    properties: {
      answer: { type: "STRING" },
      status: { type: "STRING", enum: ["grounded", "unverified"] },
      source_ids: { type: "ARRAY", items: { type: "STRING", ...enumOf(chunkIds) } },
      follow_up: { type: "STRING", nullable: true },
      detected_misconception: {
        type: "OBJECT",
        nullable: true,
        properties: { concept_id: { type: "STRING", ...enumOf(conceptIds) }, summary: { type: "STRING" } },
        required: ["concept_id", "summary"],
      },
    },
    required: ["answer", "status", "source_ids", "follow_up", "detected_misconception"],
    propertyOrdering: ["answer", "status", "source_ids", "follow_up", "detected_misconception"],
  };
}

export function learningSystemPrompt(input: Pick<LearningInput, "section" | "concepts" | "glossary">): string {
  return renderPrompt("learning-system", {
    section_name: SECTION_NAMES[input.section],
    concepts: input.concepts.length ? input.concepts.map((c) => `- ${c.concept_id}: ${c.name}`).join("\n") : "(없음: detected_misconception은 항상 null)",
    glossary: input.glossary?.length ? input.glossary.map((g) => `- ${g.term} = ${g.aliases.join(", ")}`).join("\n") : "(없음)",
  });
}

/** 사용자 메시지. 학습자에게서 온 글(질문·이전 대화)은 구분자를 닫지 못하게 이스케이프한다. */
export function learningUserPrompt(input: LearningInput): string {
  const screen = input.screen.equipment_id
    ? `공정 ${input.screen.process_id ?? input.section}, 설비 ${input.screen.equipment_id}${input.screen.equipment_name ? ` (${input.screen.equipment_name})` : ""}`
    : `공정 ${input.screen.process_id ?? input.section}, 선택한 설비 없음`;
  const sources = input.chunks.length
    ? input.chunks.map((c) => `[${c.id}] ${c.title}\n${c.text}`).join("\n\n")
    : "(검색된 근거 없음)";
  const history = input.history.length
    ? input.history.map((t) => `학습자: ${escapeDelimited(t.question)}\n튜터: ${escapeDelimited(t.answer)}`).join("\n")
    : "(없음)";
  const notes = input.openMisconceptions.length ? input.openMisconceptions.map((m) => `- ${m.concept_id}: ${m.summary}`).join("\n") : "(없음)";
  return [
    `<screen>${screen}</screen>`,
    `<learner_notes>\n${notes}\n</learner_notes>`,
    `<sources>\n${sources}\n</sources>`,
    `<history>\n${history}\n</history>`,
    `<question>${escapeDelimited(input.question)}</question>`,
  ].join("\n\n");
}

const ReplySchema = z.object({
  answer: z.string().trim().min(1).max(MAX_ANSWER_CHARS),
  status: z.enum(["grounded", "unverified"]),
  source_ids: z.array(z.string()),
  follow_up: z.string().nullable(),
  detected_misconception: z.object({ concept_id: z.string(), summary: z.string() }).nullable(),
});

/** 형식을 검사하고 허용된 id만 남긴다. 형식이 틀리면 이유 문자열. */
export function parseLearningReply(raw: string, input: Pick<LearningInput, "chunks" | "concepts">): LearningReply | string {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return "JSON이 아님";
  }
  const parsed = ReplySchema.safeParse(json);
  if (!parsed.success) return `스키마 불일치: ${parsed.error.issues.map((i) => i.path.join(".") || i.message).join(", ")}`;
  const r = parsed.data;

  const allowedChunks = new Set(input.chunks.map((c) => c.id));
  const source_ids = [...new Set(r.source_ids.filter((id) => allowedChunks.has(id)))];
  const allowedConcepts = new Set(input.concepts.map((c) => c.concept_id));
  const m = r.detected_misconception;
  const detected_misconception = m && allowedConcepts.has(m.concept_id) && m.summary.trim() ? { concept_id: m.concept_id, summary: m.summary.trim() } : null;
  const follow_up = r.follow_up?.trim() || null;

  // grounded라고 했지만 쓸 수 있는 근거가 없으면 답을 믿지 않는다.
  if (r.status === "grounded" && source_ids.length === 0) {
    return { answer: UNVERIFIED_ANSWER, status: "unverified", source_ids: [], follow_up, detected_misconception };
  }
  return { answer: r.answer.trim(), status: r.status, source_ids, follow_up, detected_misconception };
}

export class GeminiLearningAgent implements LearningAgent {
  constructor(private readonly gemini: GeminiClient) {}

  async reply(input: LearningInput): Promise<LearningReply> {
    const request = {
      system: learningSystemPrompt(input),
      prompt: learningUserPrompt(input),
      temperature: TEMPERATURE,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      responseSchema: learningResponseSchema(input.chunks.map((c) => c.id), input.concepts.map((c) => c.concept_id)),
    };
    let problem = "";
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      // 연결·HTTP 오류(LlmUnavailableError)는 그대로 올려 보낸다. 형식 오류만 다시 부른다.
      const result = parseLearningReply(await this.gemini.generate(request), input);
      if (typeof result !== "string") return result;
      problem = result;
    }
    throw new LearningFormatError(`학습 모드 응답 형식 오류(${MAX_ATTEMPTS}회): ${problem}`);
  }
}
