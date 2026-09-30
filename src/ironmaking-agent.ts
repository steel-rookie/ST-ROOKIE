import { getPublicSources, sourcePrompt, type PublicSource } from "./ironmaking-sources.js";

export type AnswerStatus = "grounded" | "unverified";
export interface ChatTurn { question: string; answer: string }
export interface ChatAnswer {
  answer: string;
  status: AnswerStatus;
  sources: Pick<PublicSource, "id" | "title" | "date" | "date_type" | "url" | "publisher">[];
}

export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";

export class GeminiApiError extends Error {
  constructor(public readonly status: number) {
    super(`Gemini API HTTP ${status}`);
  }
}

const SYSTEM = `당신은 포스코 제철소 신입사원을 위한 한국어 제선 공정 질문형 안내자입니다.
아래는 공개된 포스코 공식 자료를 간추린 교육용 메모입니다. 원문 링크는 서버가 따로 관리합니다.
질문의 답은 메모에 직접 근거한 내용으로만 작성하세요. 메모에 없는 세부사항, 현재 설비 상태, 공장별 운전 조건, 작업 절차, 수치, 안전 지침은 추측하지 마세요.
고로 경로와 FINEX 경로는 별개입니다. 소결광과 코크스를 사용하는 고로의 원리를 FINEX에 적용하지 마세요. 생산 방식과 공장에 따라 다른 것은 해당 경로를 명시하세요.
기본 답변은 신입 수준의 한국어 2~4문장입니다. 전문용어는 처음 사용할 때 짧게 풀이하세요. 사용자가 자세한 설명을 요청하면 더 길게 답하세요. 요청 없이 퀴즈나 순차 교육을 시작하지 마세요.
질문이 자료의 범위를 벗어나거나 근거가 부족하면 status를 unverified로 하고, 공개 자료에서 확인되지 않는다고 짧게 답하세요.
이전 대화는 '그것', '그럼' 같은 후속 질문의 지시 대상을 파악하는 데에만 사용하세요. 근거는 언제나 아래 메모에서 찾으세요.
반드시 JSON 객체 하나만 출력하세요: {"answer":"한국어 답변","status":"grounded 또는 unverified","source_ids":["근거가 되는 자료 ID"]}.
grounded이면 답변의 근거 자료 ID를 최소 하나 제시하세요. 없는 ID를 만들지 마세요. unverified이면 source_ids는 확인된 부분의 근거가 있을 때만 넣으세요.

<public_sources>\n${sourcePrompt()}\n</public_sources>`;

export function normalizeModelAnswer(raw: string): ChatAnswer {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  } catch {
    throw new Error("모델 응답 형식을 확인할 수 없습니다.");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("모델 응답 형식을 확인할 수 없습니다.");
  const value = parsed as Record<string, unknown>;
  if (typeof value.answer !== "string" || !value.answer.trim() || value.answer.length > 4000 ||
      !Array.isArray(value.source_ids)) {
    throw new Error("모델 응답 형식을 확인할 수 없습니다.");
  }
  const ids = value.source_ids.filter((id): id is string => typeof id === "string");
  const sources = getPublicSources(ids).map(({ id, title, date, date_type, url, publisher }) =>
    ({ id, title, date, date_type, url, publisher }));
  if (value.status !== "grounded" || sources.length === 0) {
    return {
      answer: "수집한 포스코 공개 공식 자료에서 이 질문의 답을 확인할 수 없습니다. 실제 운전 조건이나 작업 절차는 해당 자료와 현장 지침에서 별도로 확인해 주세요.",
      status: "unverified",
      sources: [],
    };
  }
  return { answer: value.answer.trim(), status: "grounded", sources };
}

export async function answerQuestion(question: string, history: ChatTurn[]): Promise<ChatAnswer> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("LLM_NOT_CONFIGURED");
  const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const contents = history.slice(-6).flatMap((turn) => [
    { role: "user", parts: [{ text: turn.question }] },
    { role: "model", parts: [{ text: turn.answer }] },
  ]);
  contents.push({ role: "user", parts: [{ text: question }] });

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents,
        generationConfig: { responseMimeType: "application/json", maxOutputTokens: 1200 },
      }),
      signal: AbortSignal.timeout(60_000),
    },
  );
  if (!response.ok) throw new GeminiApiError(response.status);
  const result = await response.json() as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = result.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("\n") ?? "";
  if (!text) throw new Error("모델에서 답변을 받지 못했습니다.");
  return normalizeModelAnswer(text);
}
