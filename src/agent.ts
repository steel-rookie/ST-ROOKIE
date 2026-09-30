import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { allowedSceneActions, hasModel, isKnownEquipment, isKnownProcess } from "./data.js";
import { responseJsonSchema, sanitizeResponse, type AgentResponse, type Dropped } from "./output.js";
import type { Session } from "./session.js";
import { executeTool, toolDefinitions } from "./tools.js";

const MODEL = "claude-opus-5-5";
const MAX_TOOL_ROUNDS = 8;

const SYSTEM_PROMPT = readFileSync(
  join(process.cwd(), "prompts", "system_prompt.md"),
  "utf8",
);

const client = new Anthropic();

/** 프론트엔드가 매 턴 보내는 화면 상태. 허용 동작과 3D 모델 여부는 서버가 채운다. */
export const ScreenInput = z.object({
  process_id: z.string().nullable().refine((id) => id === null || isKnownProcess(id), "unknown process_id"),
  equipment_id: z.string().nullable().refine((id) => id === null || isKnownEquipment(id), "unknown equipment_id"),
  learning_mode: z.enum(["guided", "free_question", "quiz"]),
  learning_step: z.object({ id: z.string(), objective: z.string() }).nullable(),
  last_scene_action_results: z
    .array(
      z.object({
        type: z.string(),
        target_id: z.string(),
        status: z.enum(["succeeded", "failed"]),
      }),
    )
    .default([]),
});
export type ScreenInput = z.infer<typeof ScreenInput>;

export interface TurnResult {
  response: AgentResponse;
  /** 서버가 걸러낸 인용·화면 동작. 로그와 프롬프트 개선에 쓴다. */
  dropped: Dropped;
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number };
}

/** 모델이 응답을 거절했을 때 학습자에게 보여줄 기본 응답. */
function refusalResponse(): AgentResponse {
  return {
    answer:
      "이 질문에는 답변을 드리기 어렵습니다. 공정 학습과 관련된 다른 질문을 해 주시거나, 현장 업무 관련 내용은 담당자에게 문의해 주세요.",
    mode: "free_question",
    evidence_status: "not_applicable",
    citations: [],
    scene_actions: [],
    follow_up_question: null,
    needs_clarification: false,
  };
}

/**
 * 학습자 메시지 하나를 처리한다. 도중에 실패하면 이번 턴에 추가한 대화 기록을 되돌린다.
 * 되돌리지 않으면 짝이 맞지 않는 user/system 메시지가 남아 다음 요청이 400으로 실패한다.
 * 학습 기록은 학습자가 실제로 제출한 답이므로 되돌리지 않는다.
 */
export async function runTurn(
  session: Session,
  userText: string,
  screen: ScreenInput,
): Promise<TurnResult> {
  const messageCount = session.messages.length;
  const retrievedDocuments = new Map(session.retrievedDocuments);
  const issuedQuizIds = new Set(session.issuedQuizIds);
  try {
    return await runTurnUnchecked(session, userText, screen);
  } catch (error) {
    session.messages.length = messageCount;
    session.retrievedDocuments = retrievedDocuments;
    session.issuedQuizIds = issuedQuizIds;
    throw error;
  }
}

async function runTurnUnchecked(
  session: Session,
  userText: string,
  screen: ScreenInput,
): Promise<TurnResult> {
  const allowedActions = allowedSceneActions(screen.process_id);
  const screenContext = {
    ...screen,
    has_3d_model: hasModel(screen.process_id),
    allowed_scene_actions: allowedActions,
  };

  // 화면 상태는 사용자 발화 안이 아니라 system 메시지로 보낸다.
  // 학습자가 입력창에 같은 형식을 흉내 내도 서버 정보로 취급되지 않는다.
  session.messages.push(
    { role: "user", content: userText },
    { role: "system", content: `<screen_context>\n${JSON.stringify(screenContext)}\n</screen_context>` },
  );

  const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 };

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const message = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      cache_control: { type: "ephemeral" },
      system: SYSTEM_PROMPT,
      tools: toolDefinitions,
      messages: session.messages,
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: responseJsonSchema },
      },
    });

    usage.input_tokens += message.usage.input_tokens;
    usage.output_tokens += message.usage.output_tokens;
    usage.cache_read_input_tokens += message.usage.cache_read_input_tokens ?? 0;

    if (message.stop_reason === "refusal") {
      // fallbacks까지 모두 거절한 경우다. 거절된 content 대신 안내 응답을 기록해 다음 턴이 이어지게 한다.
      const response = refusalResponse();
      session.messages.push({ role: "assistant", content: JSON.stringify(response) });
      return { response, dropped: { citations: [], scene_actions: [] }, usage };
    }
    if (message.stop_reason === "max_tokens") {
      throw new Error("응답이 max_tokens에서 잘렸습니다.");
    }

    // preserved thinking을 위해 응답 content를 그대로 추가한다(수정·요약 금지).
    session.messages.push({ role: "assistant", content: message.content });

    if (message.stop_reason === "pause_turn") continue;

    if (message.stop_reason === "tool_use") {
      const toolResults: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const block of message.content) {
        if (block.type !== "tool_use") continue;
        let result;
        try {
          result = executeTool(block.name, block.input, session, { latestUserText: userText });
        } catch (error) {
          result = {
            content: JSON.stringify({ error: `잘못된 도구 입력: ${(error as Error).message}` }),
            isError: true,
          };
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: result.content,
          is_error: result.isError,
        });
      }
      session.messages.push({ role: "user", content: toolResults });
      continue;
    }

    // end_turn: 마지막 text 블록이 스키마를 따르는 JSON 응답이다.
    const text = message.content.findLast(
      (b): b is Anthropic.Beta.BetaTextBlock => b.type === "text",
    );
    if (!text) throw new Error(`응답에 텍스트가 없습니다 (stop_reason: ${message.stop_reason})`);
    const { response, dropped } = sanitizeResponse(text.text, session, allowedActions);
    return { response, dropped, usage };
  }

  throw new Error(`도구 호출이 ${MAX_TOOL_ROUNDS}회를 넘었습니다.`);
}
