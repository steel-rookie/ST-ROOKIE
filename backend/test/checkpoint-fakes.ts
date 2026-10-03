// 체크포인트 흐름 테스트용 가짜 평가자·튜터. LLM 없이 엔진 전체를 돌린다.
import type { Rubric } from "../src/rubrics.js";
import {
  EvaluationFormatError,
  LlmUnavailableError,
  type EvaluateInput,
  type Evaluation,
  type Evaluator,
  type Tutor,
} from "../src/checkpoint/types.js";
import type { Verdict } from "../src/scoring.js";

const concept = (id: string, name: string) => ({
  concept_id: id,
  name,
  key_points: [
    { point: `${name} 핵심 1`, quote: `${name} 근거 1` },
    { point: `${name} 핵심 2`, quote: `${name} 근거 2` },
  ],
  correct: "두 요소 모두",
  partial: "하나만",
  wrong: "틀림",
  source: { file: "test" },
});

export const IRONMAKING: Rubric = {
  section: "ironmaking",
  reviewed: true,
  concepts: [concept("a", "개념A"), concept("b", "개념B"), concept("c", "개념C")],
};

export const STEELMAKING: Rubric = {
  section: "steelmaking",
  reviewed: true,
  concepts: [concept("s1", "개념S1")],
};

/**
 * 답변 문자열로 판정을 정한다.
 * - "correct" | "partial" | "wrong" | "assisted"
 * - "<판정>|<오개념 요약>": 오개념 포함
 * - "<판정>@<explain_from>": explain_from 지정(기본 0). "partial@null|오개념"은 오개념만 교정하는 경우
 */
export class FakeEvaluator implements Evaluator {
  calls: EvaluateInput[] = [];
  /** 다음 n번 호출을 형식 오류로 실패시킨다. */
  failNext = 0;

  async evaluate(input: EvaluateInput): Promise<Evaluation> {
    this.calls.push(input);
    if (this.failNext > 0) {
      this.failNext--;
      throw new EvaluationFormatError("가짜 형식 오류");
    }
    const [head, misconception = null] = input.answer.split("|");
    const [verdict, from] = head!.split("@");
    return {
      verdict: verdict as Verdict,
      misconception,
      explain_from: verdict === "correct" || from === "null" ? null : Number(from ?? 0),
      evidence: input.answer,
    };
  }
}

export class FakeTutor implements Tutor {
  calls: { kind: string; conceptId: string; extra?: unknown }[] = [];
  /** 다음 n번 호출을 LLM 연결 실패로 만든다. */
  failNext = 0;
  /** 응답 지연(ms). 겹친 요청 테스트용. */
  delay = 0;
  /** 호출 직전 훅(사용량 제한 테스트용). */
  beforeCall?: () => void;

  private async step(kind: string, conceptId: string, text: string, extra?: unknown): Promise<string> {
    this.calls.push({ kind, conceptId, extra });
    this.beforeCall?.();
    if (this.delay) await new Promise((r) => setTimeout(r, this.delay));
    if (this.failNext > 0) {
      this.failNext--;
      throw new LlmUnavailableError("가짜 연결 실패");
    }
    return text;
  }

  question({ concept }: Parameters<Tutor["question"]>[0]) {
    return this.step("question", concept.concept_id, `Q:${concept.concept_id}`);
  }

  explanation({ concept, explainFrom, misconception, learnerNotes }: Parameters<Tutor["explanation"]>[0]) {
    return this.step("explanation", concept.concept_id, `EX:${concept.concept_id}:${explainFrom}`, { explainFrom, misconception, learnerNotes });
  }

  recheckQuestion({ concept, previousQuestion }: Parameters<Tutor["recheckQuestion"]>[0]) {
    return this.step("recheck", concept.concept_id, `RQ:${concept.concept_id}`, { previousQuestion });
  }
}
