// 평가자 정확도 평가: 실제 Gemini로 평가 세트를 채점해 일치율, 혼동 표, 형식 재시도, 같은 뜻 쌍 일치율, 틀린 케이스를 출력한다.
// 실행: npm run eval:evaluator -- --set smoke|hard  (기본 smoke, GEMINI_API_KEY 필요, npm test에는 포함하지 않는다)
// 무료 등급 요청 제한을 피하려고 케이스 사이에 EVAL_DELAY_MS(기본 1000ms)만큼 쉰다.
import { LlmUnavailableError } from "../../backend/src/checkpoint/types.js";
import { loadFinalRubrics } from "../../backend/src/rubrics.js";
import { GeminiEvaluator } from "../src/evaluator.js";
import { GeminiClient } from "../src/gemini.js";
import { EVAL_SETS, loadEvalSet, SOURCES, type EvalCase, type EvalSetName } from "./eval-set.js";

const EXPECTED = ["correct", "partial", "wrong", "assisted"] as const;
const PREDICTED = [...EXPECTED, "format_error"] as const;
type Predicted = (typeof PREDICTED)[number];

interface Outcome {
  c: EvalCase;
  got: Predicted;
  evidence: string;
  attempts: number;
  formatProblems: string[];
}

const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : "-");
const hit = (o: Outcome) => o.got === o.c.expected_verdict;
const where = (c: EvalCase) => `${c.file}:${c.line}`;

function parseSet(argv: string[]): EvalSetName {
  const i = argv.findIndex((a) => a === "--set" || a.startsWith("--set="));
  if (i < 0) return "smoke";
  const value = argv[i]!.includes("=") ? argv[i]!.split("=")[1] : argv[i + 1];
  if (!EVAL_SETS.includes(value as EvalSetName)) throw new Error(`--set은 ${EVAL_SETS.join("|")} 중 하나입니다: ${value}`);
  return value as EvalSetName;
}

async function main(): Promise<void> {
  const set = parseSet(process.argv.slice(2));
  if (!process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY가 없습니다. .env에 키를 넣고 다시 실행하세요.");
    process.exitCode = 1;
    return;
  }
  const delayMs = Number(process.env.EVAL_DELAY_MS ?? 1000);
  const evaluator = new GeminiEvaluator(new GeminiClient());
  const outcomes: Outcome[] = [];

  for (const rubric of loadFinalRubrics()) {
    const cases = loadEvalSet(set, rubric.section);
    if (!cases.length) continue;
    console.log(`\n[${set}/${rubric.section}] ${cases.length}개 케이스 (모델: ${process.env.GEMINI_MODEL || "기본값"})`);
    for (const c of cases) {
      const concept = rubric.concepts.find((k) => k.concept_id === c.concept_id);
      if (!concept) throw new Error(`${where(c)} 루브릭에 없는 개념: ${c.concept_id}`);
      try {
        const d = await evaluator.evaluateDetailed({ rubric, concept, question: c.question, answer: c.answer, phase: c.phase });
        outcomes.push({
          c,
          got: d.evaluation?.verdict ?? "format_error",
          evidence: d.evaluation?.evidence ?? d.formatProblems.join(" / "),
          attempts: d.attempts,
          formatProblems: d.formatProblems,
        });
      } catch (error) {
        if (!(error instanceof LlmUnavailableError)) throw error;
        console.error(`\nGemini 호출 실패로 중단합니다(${where(c)}): ${error.message}`);
        console.error("요청 제한이면 EVAL_DELAY_MS를 늘려 다시 실행하세요.");
        process.exitCode = 1;
        return;
      }
      process.stdout.write(hit(outcomes.at(-1)!) ? "." : "x");
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    }
    process.stdout.write("\n");
  }
  report(outcomes);
}

function rate(label: string, subset: Outcome[]): string {
  return `  ${label}: ${subset.filter(hit).length}/${subset.length} (${pct(subset.filter(hit).length, subset.length)})`;
}

function report(outcomes: Outcome[]): void {
  console.log(`\n일치율: ${outcomes.filter(hit).length}/${outcomes.length} (${pct(outcomes.filter(hit).length, outcomes.length)})`);
  for (const phase of ["initial", "recheck"] as const) {
    const subset = outcomes.filter((o) => o.c.phase === phase);
    if (subset.length) console.log(rate(phase, subset));
  }

  console.log("\nsource별 일치율");
  for (const source of SOURCES) {
    const subset = outcomes.filter((o) => o.c.source === source);
    console.log(subset.length ? rate(source, subset) : `  ${source}: 케이스 없음`);
  }
  const types = [...new Set(outcomes.map((o) => o.c.type).filter(Boolean))] as string[];
  if (types.length) {
    console.log("\n유형별 일치율");
    for (const type of types) console.log(rate(type, outcomes.filter((o) => o.c.type === type)));
  }

  for (const source of SOURCES) {
    const subset = outcomes.filter((o) => o.c.source === source);
    if (!subset.length) continue;
    console.log(`\n혼동 표 [${source}] (행: 기대, 열: 판정)`);
    const width = 13;
    console.log(["", ...PREDICTED].map((h) => h.padEnd(width)).join(""));
    for (const expected of EXPECTED) {
      const row = subset.filter((o) => o.c.expected_verdict === expected);
      if (row.length) console.log([expected, ...PREDICTED.map((p) => String(row.filter((o) => o.got === p).length))].map((v) => v.padEnd(width)).join(""));
    }
  }

  const retried = outcomes.filter((o) => o.attempts > 1);
  const retries = outcomes.reduce((sum, o) => sum + o.attempts - 1, 0);
  const calls = outcomes.reduce((sum, o) => sum + o.attempts, 0);
  console.log(`\n평가자 형식 재시도: 케이스 ${retried.length}/${outcomes.length} (${pct(retried.length, outcomes.length)}), 호출 ${retries}/${calls}회 (${pct(retries, calls)})`);
  for (const o of retried) {
    console.log(`- ${where(o.c)} 시도 ${o.attempts}회${o.got === "format_error" ? " (최종 실패)" : ""}: ${o.formatProblems.join(" / ")}`);
  }

  const pairs = new Map<string, Outcome[]>();
  for (const o of outcomes) if (o.c.pair_id) pairs.set(o.c.pair_id, [...(pairs.get(o.c.pair_id) ?? []), o]);
  const groups = [...pairs.entries()].filter(([, members]) => members.length >= 2);
  if (groups.length) {
    const split = groups.filter(([, members]) => new Set(members.map((m) => m.got)).size > 1);
    console.log(`\n같은 뜻 쌍 판정 일치율: ${groups.length - split.length}/${groups.length} (${pct(groups.length - split.length, groups.length)})`);
    for (const [id, members] of split) {
      console.log(`- ${id}: ${members.map((m) => `${where(m.c)}=${m.got}`).join(", ")} (기대 ${members[0]!.c.expected_verdict})`);
    }
  }

  const misses = outcomes.filter((o) => !hit(o));
  console.log(`\n틀린 케이스 ${misses.length}개`);
  for (const { c, got, evidence } of misses) {
    console.log(`- ${where(c)} [${c.concept_id}/${c.phase}/${c.source}${c.type ? `/${c.type}` : ""}] 기대 ${c.expected_verdict} → ${got}`);
    console.log(`    답변: ${c.answer}`);
    console.log(`    근거: ${evidence}`);
    if (c.note) console.log(`    메모: ${c.note}`);
  }
}

await main();
