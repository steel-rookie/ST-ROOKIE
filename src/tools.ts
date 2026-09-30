import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import {
  documents,
  equipment,
  processes,
  quizzes,
  type MaterialDocument,
} from "./data.js";
import type { Session } from "./session.js";

// 도구 정의는 이름순으로 고정해 둔다. 순서가 바뀌면 프롬프트 캐시가 깨진다.
export const toolDefinitions: Anthropic.Beta.BetaTool[] = [
  {
    name: "get_equipment_info",
    description:
      "설비 하나의 역할, 소속 공정, 관련 개념, 근거 자료 ID를 조회한다. 학습자가 특정 설비를 묻거나 화면에서 설비를 선택했을 때 쓴다.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        equipment_id: { type: "string", description: "설비 ID (예: blast_furnace)" },
      },
      required: ["equipment_id"],
      additionalProperties: false,
    },
  },
  {
    name: "get_process_info",
    description:
      "공정 하나의 목적, 투입 소재, 산출 소재, 세부 공정, 다음 공정과의 연결, 소속 설비 목록을 조회한다.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        process_id: {
          type: "string",
          enum: processes.map((p) => p.process_id),
          description: "공정 ID",
        },
      },
      required: ["process_id"],
      additionalProperties: false,
    },
  },
  {
    name: "get_quiz",
    description:
      "검토된 이해도 확인 문항을 하나 가져온다. 정답과 해설은 포함되지 않으며, 학습자가 답한 뒤 grade_quiz_answer로 받는다. 이미 출제한 문항은 제외된다.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        process_id: { type: "string", enum: processes.map((p) => p.process_id) },
        learning_step_id: {
          type: ["string", "null"],
          description: "현재 학습 단계 ID. 모르면 null",
        },
      },
      required: ["process_id", "learning_step_id"],
      additionalProperties: false,
    },
  },
  {
    name: "grade_quiz_answer",
    description:
      "get_quiz로 출제한 문항에 대한 학습자의 답을 서버가 채점하고 학습 기록에 저장한다. 객관식은 정답·해설·오개념 설명을, 서술형은 채점 기준을 돌려준다. 학습자가 답을 제출한 뒤에만 호출한다.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        quiz_id: { type: "string" },
        learner_answer: {
          type: "string",
          description: "객관식은 선택지 기호(예: B), 서술형은 학습자가 쓴 답 전체",
        },
      },
      required: ["quiz_id", "learner_answer"],
      additionalProperties: false,
    },
  },
  {
    name: "search_education_materials",
    description:
      "교육자료에서 질문과 관련된 부분을 검색한다. 결과마다 document_id, title, page, version, scope, review_status, applies_to가 붙는다. 사실을 말하기 전에 근거를 찾을 때 쓴다.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "검색어. 핵심 명사 위주로 쓴다" },
        process_id: {
          type: ["string", "null"],
          description: "특정 공정 자료로 좁힐 때 공정 ID, 아니면 null",
        },
      },
      required: ["query", "process_id"],
      additionalProperties: false,
    },
  },
];

const inputSchemas = {
  get_equipment_info: z.object({ equipment_id: z.string() }),
  get_process_info: z.object({ process_id: z.string() }),
  get_quiz: z.object({ process_id: z.string(), learning_step_id: z.string().nullable() }),
  grade_quiz_answer: z.object({ quiz_id: z.string(), learner_answer: z.string() }),
  search_education_materials: z.object({ query: z.string(), process_id: z.string().nullable() }),
};

export interface ToolResult {
  content: string;
  isError: boolean;
}

function ok(value: unknown): ToolResult {
  return { content: JSON.stringify(value), isError: false };
}

function fail(message: string): ToolResult {
  return { content: JSON.stringify({ error: message }), isError: true };
}

function rememberDocuments(session: Session, ids: string[]) {
  for (const id of ids) {
    const doc = documents.find((d) => d.document_id === id);
    if (doc) session.retrievedDocuments.set(id, { title: doc.title, version: doc.version });
  }
}

function documentSummary(ids: string[]) {
  return ids.flatMap((id) => {
    const doc = documents.find((d) => d.document_id === id);
    return doc
      ? [{ document_id: doc.document_id, title: doc.title, version: doc.version, scope: doc.scope, review_status: doc.review_status }]
      : [];
  });
}

/** 공백·문장부호로 나누고, 조사가 붙은 어절은 끝 글자를 뗀 형태도 함께 검색한다. */
function queryTerms(query: string): string[] {
  const words = query.split(/[\s,.?!()·]+/).filter((w) => w.length >= 2);
  const terms = new Set<string>();
  for (const w of words) {
    terms.add(w);
    if (w.length >= 3) terms.add(w.slice(0, -1));
  }
  return [...terms];
}

export function searchMaterials(query: string, processId: string | null) {
  const terms = queryTerms(query);
  const candidates: { doc: MaterialDocument; page: number | null; text: string; score: number }[] = [];
  for (const doc of documents) {
    if (processId && !doc.process_ids.includes(processId)) continue;
    for (const chunk of doc.chunks) {
      const score = terms.filter((t) => chunk.text.includes(t)).length;
      if (score > 0) candidates.push({ doc, ...chunk, score });
    }
  }
  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map(({ doc, page, text }) => ({
      document_id: doc.document_id,
      title: doc.title,
      page,
      version: doc.version,
      scope: doc.scope,
      review_status: doc.review_status,
      applies_to: doc.applies_to,
      text,
    }));
}

export interface ToolContext {
  /** 이번 턴에 학습자가 실제로 보낸 메시지. 채점 입력이 학습자 답과 일치하는지 확인한다. */
  latestUserText: string;
}

export function executeTool(
  name: string,
  rawInput: unknown,
  session: Session,
  context: ToolContext,
): ToolResult {
  switch (name) {
    case "search_education_materials": {
      const input = inputSchemas.search_education_materials.parse(rawInput);
      const results = searchMaterials(input.query, input.process_id);
      rememberDocuments(session, results.map((r) => r.document_id));
      return ok(results.length > 0 ? { results } : { results: [], note: "일치하는 자료가 없습니다." });
    }

    case "get_process_info": {
      const input = inputSchemas.get_process_info.parse(rawInput);
      const process = processes.find((p) => p.process_id === input.process_id);
      if (!process) return fail(`등록되지 않은 공정입니다: ${input.process_id}`);
      rememberDocuments(session, process.source_document_ids);
      return ok({
        ...process,
        equipment: equipment
          .filter((e) => process.equipment_ids.includes(e.equipment_id))
          .map(({ equipment_id, name }) => ({ equipment_id, name })),
        sources: documentSummary(process.source_document_ids),
      });
    }

    case "get_equipment_info": {
      const input = inputSchemas.get_equipment_info.parse(rawInput);
      const item = equipment.find((e) => e.equipment_id === input.equipment_id);
      if (!item) return fail(`등록되지 않은 설비입니다: ${input.equipment_id}`);
      rememberDocuments(session, item.source_document_ids);
      return ok({ ...item, sources: documentSummary(item.source_document_ids) });
    }

    case "get_quiz": {
      const input = inputSchemas.get_quiz.parse(rawInput);
      const pool = quizzes.filter(
        (q) => q.process_id === input.process_id && !session.issuedQuizIds.has(q.quiz_id),
      );
      const quiz =
        pool.find((q) => q.learning_step_id === input.learning_step_id) ?? pool[0];
      if (!quiz) return ok({ quiz: null, note: "이 공정에 남은 검토된 문항이 없습니다." });
      session.issuedQuizIds.add(quiz.quiz_id);
      // 정답·해설·오개념은 채점 전에 모델에게 보내지 않는다.
      return ok({
        quiz: {
          quiz_id: quiz.quiz_id,
          type: quiz.type,
          question: quiz.question,
          ...(quiz.type === "multiple_choice" ? { choices: quiz.choices } : {}),
        },
      });
    }

    case "grade_quiz_answer": {
      const input = inputSchemas.grade_quiz_answer.parse(rawInput);
      const quiz = quizzes.find((q) => q.quiz_id === input.quiz_id);
      if (!quiz) return fail(`등록되지 않은 문항입니다: ${input.quiz_id}`);
      if (!session.issuedQuizIds.has(quiz.quiz_id)) {
        return fail("이 대화에서 출제하지 않은 문항은 채점할 수 없습니다. 먼저 get_quiz로 출제하세요.");
      }
      const attempt =
        session.learningRecords.filter((r) => r.quiz_id === quiz.quiz_id).length + 1;
      rememberDocuments(session, quiz.source_document_ids);

      if (quiz.type === "short_answer") {
        session.learningRecords.push({
          quiz_id: quiz.quiz_id,
          attempt,
          correct: null,
          // 모델이 요약한 답이 아니라 학습자가 보낸 원문을 기록한다.
          learner_answer: context.latestUserText,
          misconception: null,
          recorded_at: new Date().toISOString(),
        });
        return ok({
          quiz_id: quiz.quiz_id,
          type: quiz.type,
          rubric: quiz.rubric,
          note: "서술형은 공식 점수를 매기지 않습니다. 채점 기준에 따라 피드백만 제공하세요.",
          sources: documentSummary(quiz.source_document_ids),
        });
      }

      const chosen = input.learner_answer.trim().toUpperCase().charAt(0);
      if (!(chosen in quiz.choices)) {
        return fail(`선택지 기호를 알아볼 수 없습니다. 선택지: ${Object.keys(quiz.choices).join(", ")}`);
      }
      // 모델이 학습자 대신 답을 만들어 채점하지 못하도록, 이번 턴 학습자 메시지에
      // 선택지 기호나 선택지 문구가 있는지 확인한다.
      const userText = context.latestUserText.toUpperCase();
      const choiceText = quiz.choices[chosen]!;
      if (!new RegExp(`(^|[^A-Z])${chosen}([^A-Z]|$)`).test(userText) && !context.latestUserText.includes(choiceText)) {
        return fail("학습자의 이번 메시지에서 이 답을 찾을 수 없습니다. 학습자가 직접 답을 제출한 뒤 채점하세요.");
      }
      const correct = chosen === quiz.answer;
      const misconception = correct ? null : (quiz.misconceptions[chosen] ?? null);
      session.learningRecords.push({
        quiz_id: quiz.quiz_id,
        attempt,
        correct,
        learner_answer: chosen,
        misconception,
        recorded_at: new Date().toISOString(),
      });
      return ok({
        quiz_id: quiz.quiz_id,
        attempt,
        correct,
        learner_answer: chosen,
        answer: quiz.answer,
        explanation: quiz.explanation,
        misconception,
        recorded: true,
        sources: documentSummary(quiz.source_document_ids),
      });
    }

    default:
      return fail(`등록되지 않은 도구입니다: ${name}`);
  }
}
