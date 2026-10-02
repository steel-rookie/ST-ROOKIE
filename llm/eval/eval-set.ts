// 평가자 정확도 평가 세트 로더. 실행(run-evaluator)과 형식 테스트가 함께 쓴다.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Phase } from "../../backend/src/checkpoint/types.js";
import type { Verdict } from "../../backend/src/scoring.js";

export interface EvalCase {
  line: number;
  section: string;
  concept_id: string;
  phase: Phase;
  question: string;
  answer: string;
  expected_verdict: Verdict;
}

export const EVAL_DIR = join(process.cwd(), "llm", "eval");

/** llm/eval/{section}.jsonl을 읽는다. */
export function loadEvalSet(section: string): EvalCase[] {
  return readFileSync(join(EVAL_DIR, `${section}.jsonl`), "utf8")
    .split("\n")
    .map((text, i) => ({ text: text.trim(), line: i + 1 }))
    .filter(({ text }) => text)
    .map(({ text, line }) => ({ line, section, ...(JSON.parse(text) as Omit<EvalCase, "line" | "section">) }));
}
