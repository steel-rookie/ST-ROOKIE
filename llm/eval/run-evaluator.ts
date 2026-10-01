// 평가자 정확도 평가: 실제 Gemini로 평가 세트를 채점해 일치율, 혼동 표, 틀린 케이스를 출력한다.
// 실행: npm run eval:evaluator  (GEMINI_API_KEY 필요, npm test에는 포함하지 않는다)
// 무료 등급 요청 제한을 피하려고 케이스 사이에 EVAL_DELAY_MS(기본 1000ms)만큼 쉰다.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { EvaluationFormatError, LlmUnavailableError } from "../../backend/src/checkpoint/types.js";
import { loadFinalRubrics } from "../../backend/src/rubrics.js";
import { GeminiEvaluator } from "../src/evaluator.js";
import { GeminiClient } from "../src/gemini.js";
import { EVAL_DIR, loadEvalSet, type EvalCase } from "./eval-set.js";

const EXPECTED = ["correct", "partial", "wrong", "assisted"] as const;
const PREDICTED = [...EXPECTED, "format_error"] as const;
type Predicted = (typeof PREDICTED)[number];

interface Outcome {
  c: EvalCase;
  got: Predicted;
  evidence: string;
}

const delayMs = Number(process.env.EVAL_DELAY_MS ?? 1000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : "-");

async function main(): Promise<void> {
  if (!process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY가 없습니다. .env에 키를 넣고 다시 실행하세요.");
    process.exitCode = 1;
    return;
  }
  const evaluator = new GeminiEvaluator(new GeminiClient());
  const outcomes: Outcome[] = [];

  for (const rubric of loadFinalRubrics()) {
    if (!existsSync(join(EVAL_DIR, `${rubric.section}.jsonl`))) continue;
    const cases = loadEvalSet(rubric.section);
    console.log(`\n[${rubric.section}] ${cases.length}개 케이스 (모델: ${process.env.GEMINI_MODEL || "기본값"})`);
    for (const c of cases) {
      const concept = rubric.concepts.find((k) => k.concept_id === c.concept_id);
      if (!concept) throw new Error(`${rubric.section}.jsonl:${c.line} 루브릭에 없는 개념: ${c.concept_id}`);
      let outcome: Outcome;
      try {
        const e = await evaluator.evaluate({ rubric, concept, question: c.question, answer: c.answer, phase: c.phase });
        outcome = { c, got: e.verdict, evidence: e.evidence };
      } catch (error) {
        if (error instanceof EvaluationFormatError) outcome = { c, got: "format_error", evidence: error.message };
        else if (error instanceof LlmUnavailableError) {
          console.error(`\nGemini 호출 실패로 중단합니다(${c.section}.jsonl:${c.line}): ${error.message}`);
          console.error("요청 제한이면 EVAL_DELAY_MS를 늘려 다시 실행하세요.");
          process.exitCode = 1;
          return;
        } else throw error;
      }
      outcomes.push(outcome);
      process.stdout.write(outcome.got === c.expected_verdict ? "." : "x");
      if (delayMs) await sleep(delayMs);
    }
    process.stdout.write("\n");
  }

  report(outcomes);
}

function report(outcomes: Outcome[]): void {
  const hits = outcomes.filter((o) => o.got === o.c.expected_verdict).length;
  console.log(`\n일치율: ${hits}/${outcomes.length} (${pct(hits, outcomes.length)})`);
  for (const phase of ["initial", "recheck"] as const) {
    const subset = outcomes.filter((o) => o.c.phase === phase);
    const ok = subset.filter((o) => o.got === o.c.expected_verdict).length;
    console.log(`  ${phase}: ${ok}/${subset.length} (${pct(ok, subset.length)})`);
  }

  console.log("\n혼동 표 (행: 기대, 열: 판정)");
  const width = 13;
  console.log(["", ...PREDICTED].map((h) => h.padEnd(width)).join(""));
  for (const expected of EXPECTED) {
    const row = outcomes.filter((o) => o.c.expected_verdict === expected);
    if (!row.length) continue;
    console.log([expected, ...PREDICTED.map((p) => String(row.filter((o) => o.got === p).length))].map((v) => v.padEnd(width)).join(""));
  }

  const misses = outcomes.filter((o) => o.got !== o.c.expected_verdict);
  console.log(`\n틀린 케이스 ${misses.length}개`);
  for (const { c, got, evidence } of misses) {
    console.log(`- ${c.section}.jsonl:${c.line} [${c.concept_id}/${c.phase}] 기대 ${c.expected_verdict} → ${got}`);
    console.log(`    답변: ${c.answer}`);
    console.log(`    근거: ${evidence}`);
  }
}

await main();
