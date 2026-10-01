// 체크포인트 튜터 발화(Gemini): 질문, 부가 설명, 다른 각도의 재확인 질문.
import { LlmUnavailableError, type Tutor } from "../../backend/src/checkpoint/types.js";
import type { RubricConcept } from "../../backend/src/rubrics.js";
import { escapeDelimited, renderPrompt, type GeminiClient } from "./gemini.js";

const keyPoints = (points: RubricConcept["key_points"]) =>
  points.map((k) => `- ${k.point} (근거: "${k.quote}")`).join("\n");

export class GeminiTutor implements Tutor {
  constructor(private readonly gemini: GeminiClient) {}

  private async say(prompt: string, temperature: number, maxOutputTokens: number): Promise<string> {
    const text = (await this.gemini.generate({ system: renderPrompt("tutor-system", {}), prompt, temperature, maxOutputTokens }))
      .trim()
      .replace(/^["“](.*)["”]$/s, "$1");
    if (!text) throw new LlmUnavailableError("튜터 응답이 비어 있습니다.");
    return text;
  }

  question({ concept }: Parameters<Tutor["question"]>[0]): Promise<string> {
    return this.say(renderPrompt("tutor-question", { name: concept.name, key_points: keyPoints(concept.key_points) }), 0.4, 200);
  }

  explanation({ concept, explainFrom, misconception, answer }: Parameters<Tutor["explanation"]>[0]): Promise<string> {
    return this.say(renderPrompt("tutor-explanation", {
      name: concept.name,
      key_points: keyPoints(concept.key_points.slice(explainFrom)),
      misconception: misconception ?? "없음",
      answer: escapeDelimited(answer),
    }), 0.3, 500);
  }

  recheckQuestion({ concept, previousQuestion }: Parameters<Tutor["recheckQuestion"]>[0]): Promise<string> {
    return this.say(renderPrompt("tutor-recheck", {
      name: concept.name,
      key_points: keyPoints(concept.key_points),
      previous_question: previousQuestion,
    }), 0.7, 200);
  }
}
