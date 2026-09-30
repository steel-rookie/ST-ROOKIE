import { z } from "zod";
import { documents, type SceneAction } from "./data.js";
import type { Session } from "./session.js";

/** API의 structured outputs로 강제하는 최종 응답 스키마. */
export const responseJsonSchema = {
  type: "object",
  properties: {
    answer: { type: "string" },
    mode: { type: "string", enum: ["guided", "free_question", "quiz", "safety_redirect"] },
    evidence_status: {
      type: "string",
      enum: ["grounded", "partial", "not_found", "not_applicable"],
    },
    citations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          document_id: { type: "string" },
          title: { type: "string" },
          page: { type: ["integer", "null"] },
          version: { type: ["string", "null"] },
        },
        required: ["document_id", "title", "page", "version"],
        additionalProperties: false,
      },
    },
    scene_actions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["highlight", "focus", "play_animation", "goto_process"] },
          target_id: { type: "string" },
        },
        required: ["type", "target_id"],
        additionalProperties: false,
      },
    },
    follow_up_question: { type: ["string", "null"] },
    needs_clarification: { type: "boolean" },
  },
  required: [
    "answer",
    "mode",
    "evidence_status",
    "citations",
    "scene_actions",
    "follow_up_question",
    "needs_clarification",
  ],
  additionalProperties: false,
} as const;

const AgentResponse = z.object({
  answer: z.string(),
  mode: z.enum(["guided", "free_question", "quiz", "safety_redirect"]),
  evidence_status: z.enum(["grounded", "partial", "not_found", "not_applicable"]),
  citations: z.array(
    z.object({
      document_id: z.string(),
      title: z.string(),
      page: z.number().int().nullable(),
      version: z.string().nullable(),
    }),
  ),
  scene_actions: z.array(
    z.object({
      type: z.enum(["highlight", "focus", "play_animation", "goto_process"]),
      target_id: z.string(),
    }),
  ),
  follow_up_question: z.string().nullable(),
  needs_clarification: z.boolean(),
});

export type AgentResponse = z.infer<typeof AgentResponse>;

export interface Dropped {
  citations: AgentResponse["citations"];
  scene_actions: SceneAction[];
}

/**
 * 모델 출력을 검증하고 서버 규칙을 강제한다.
 * - 이번 대화에서 도구가 돌려주지 않은 자료의 인용은 버린다.
 * - 제목·버전은 모델이 쓴 값 대신 등록된 값으로 덮어쓰고, 없는 페이지는 null로 바꾼다.
 * - 허용 목록에 없는 화면 동작은 버린다.
 */
export function sanitizeResponse(
  raw: string,
  session: Session,
  allowedActions: SceneAction[],
): { response: AgentResponse; dropped: Dropped } {
  const response = AgentResponse.parse(JSON.parse(raw));
  const dropped: Dropped = { citations: [], scene_actions: [] };

  const seen = new Set<string>();
  response.citations = response.citations.flatMap((c) => {
    const known = session.retrievedDocuments.get(c.document_id);
    if (!known) {
      dropped.citations.push(c);
      return [];
    }
    const pages = documents.find((d) => d.document_id === c.document_id)?.chunks.map((ch) => ch.page) ?? [];
    const page = c.page !== null && pages.includes(c.page) ? c.page : null;
    const key = `${c.document_id}:${page}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ document_id: c.document_id, title: known.title, page, version: known.version }];
  });

  response.scene_actions = response.scene_actions.filter((a) => {
    const allowed = allowedActions.some((x) => x.type === a.type && x.target_id === a.target_id);
    if (!allowed) dropped.scene_actions.push(a);
    return allowed;
  });

  return { response, dropped };
}
