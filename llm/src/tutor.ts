// 체크포인트 튜터 발화(Gemini): 질문, 부가 설명, 다른 각도의 재확인 질문.
// 질문과 재확인 질문은 정답 유출 검사(question-check.ts)를 거친다. 걸리면 1회 다시 만들고,
// 그래도 걸리면 루브릭의 fallback_question(없거나 직전 질문과 같으면 고정 문장)을 쓴다.
import { LlmUnavailableError, type Tutor } from "../../backend/src/checkpoint/types.js";
import type { Rubric, RubricConcept } from "../../backend/src/rubrics.js";
import { escapeDelimited, renderPrompt, type GeminiClient } from "./gemini.js";
import { answerTerms, findLeaks, hasLeak, type LeakResult } from "./question-check.js";

const MAX_QUESTION_ATTEMPTS = 2;

const keyPointsWithQuotes = (points: RubricConcept["key_points"]) =>
  points.map((k) => `- ${k.point} (근거: "${k.quote}")`).join("\n");
// 질문 생성에는 근거 문장을 주지 않는다. 그대로 옮겨 쓰는 일을 줄이기 위해서다.
const keyPointsOnly = (points: RubricConcept["key_points"]) => points.map((k) => `- ${k.point}`).join("\n");

export interface DetailedQuestion {
  text: string;
  /** 시도별 생성 결과와 유출 검사 결과. */
  attempts: { text: string; leaks: LeakResult }[];
  usedFallback: boolean;
}

export function genericQuestion(concept: RubricConcept): string {
  return `처음 배우는 동료에게 '${concept.name}'을 설명한다고 생각하고, 자기 말로 설명해 주세요.`;
}

export class GeminiTutor implements Tutor {
  constructor(private readonly gemini: GeminiClient) {}

  private async say(prompt: string, temperature: number, maxOutputTokens: number): Promise<string> {
    const text = (await this.gemini.generate({ system: renderPrompt("tutor-system", {}), prompt, temperature, maxOutputTokens }))
      .trim()
      .replace(/^["“](.*)["”]$/s, "$1");
    if (!text) throw new LlmUnavailableError("튜터 응답이 비어 있습니다.");
    return text;
  }

  private async checkedQuestion(
    rubric: Rubric,
    concept: RubricConcept,
    prompt: string,
    temperature: number,
    fallback: string,
  ): Promise<DetailedQuestion> {
    const attempts: DetailedQuestion["attempts"] = [];
    for (let i = 0; i < MAX_QUESTION_ATTEMPTS; i++) {
      const last = attempts.at(-1);
      const retryNote = last
        ? `\n\n직전 질문에 정답 표현이 들어 있었습니다: ${[...last.leaks.terms, ...last.leaks.phrases].join(", ")}. 이 표현과 그 일부를 쓰지 말고 다시 만드세요.`
        : "";
      const text = await this.say(prompt + retryNote, temperature, 200);
      const leaks = findLeaks(text, rubric, concept);
      attempts.push({ text, leaks });
      if (!hasLeak(leaks)) return { text, attempts, usedFallback: false };
    }
    return { text: fallback, attempts, usedFallback: true };
  }

  questionDetailed({ rubric, concept }: Parameters<Tutor["question"]>[0]): Promise<DetailedQuestion> {
    const prompt = renderPrompt("tutor-question", {
      name: concept.name,
      key_points: keyPointsOnly(concept.key_points),
      answer_terms: answerTerms(rubric, concept).join(", ") || "(없음)",
    });
    return this.checkedQuestion(rubric, concept, prompt, 0.4, concept.fallback_question ?? genericQuestion(concept));
  }

  recheckQuestionDetailed({ rubric, concept, previousQuestion }: Parameters<Tutor["recheckQuestion"]>[0]): Promise<DetailedQuestion> {
    const prompt = renderPrompt("tutor-recheck", {
      name: concept.name,
      key_points: keyPointsOnly(concept.key_points),
      answer_terms: answerTerms(rubric, concept).join(", ") || "(없음)",
      previous_question: previousQuestion,
    });
    const fallback = concept.fallback_question && concept.fallback_question !== previousQuestion
      ? concept.fallback_question
      : genericQuestion(concept);
    return this.checkedQuestion(rubric, concept, prompt, 0.7, fallback);
  }

  async question(input: Parameters<Tutor["question"]>[0]): Promise<string> {
    return (await this.questionDetailed(input)).text;
  }

  async recheckQuestion(input: Parameters<Tutor["recheckQuestion"]>[0]): Promise<string> {
    return (await this.recheckQuestionDetailed(input)).text;
  }

  explanation({ concept, explainFrom, misconception, answer }: Parameters<Tutor["explanation"]>[0]): Promise<string> {
    return this.say(renderPrompt("tutor-explanation", {
      name: concept.name,
      key_points: keyPointsWithQuotes(concept.key_points.slice(explainFrom)),
      misconception: misconception ?? "없음",
      answer: escapeDelimited(answer),
    }), 0.3, 500);
  }
}
