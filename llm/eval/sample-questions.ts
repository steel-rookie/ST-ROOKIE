// 튜터 질문 표본: 개념마다 질문을 N개 만들어 유출 검사 결과를 마크다운 표로 출력한다(실제 Gemini 사용).
// 실행: npm run eval:questions -- [--count 10] [--gap 6000] [--out 파일.md] [--resume] [--records 파일.jsonl]
//  - 모든 Gemini 호출(재생성·연결 재시도 포함) 사이에 --gap(ms)만큼 쉰다. 무료 등급 분당 한도를 넘지 않게 6000 이상을 권장.
//  - 질문마다 결과(시도별 질문 문장과 걸린 표현)를 --records(기본 llm/eval/results/questions.jsonl)에 바로 기록한다.
//    --resume이면 같은 모델·프롬프트·루브릭으로 끝난 질문을 건너뛰고, 보고서는 파일의 기록 전체로 만든다.
//  - 429·시간 초과·연결 실패는 EVAL_RETRY_BASE_MS(기본 10000ms)부터 2배씩 늘려 최대 3회 다시 호출한다.
//    그래도 실패하면 infra_error로 기록하고 처리 비율에서 뺀다. 연속 3개면 멈춘다.
//  - 빈 응답은 형식 오류(format_error)로 따로 센다.
//  - '범위 초과' 열은 비워 둔다. 질문이 핵심 요소만으로 답할 수 있는지는 사람이 판단한다.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LlmUnavailableError } from "../../backend/src/checkpoint/types.js";
import { loadFinalRubrics } from "../../backend/src/rubrics.js";
import { DEFAULT_GEMINI_MODEL } from "../src/ironmaking-agent.js";
import { answerTermsInName, findLeaks, hasLeak, type LeakResult } from "../src/question-check.js";
import { GeminiTutor } from "../src/tutor.js";
import { fingerprint, flag, InfraStreak, isInfraError, MAX_CONSECUTIVE_INFRA, option, openRecordFile, RESULTS_DIR, RetryingGeminiClient, type RunRecord } from "./run-log.js";

type Handling = "통과" | "재생성" | "대체 질문";

interface QuestionRecord extends RunRecord {
  model: string;
  section: string;
  concept_id: string;
  index: number;
  status: "ok" | "format_error" | "infra_error";
  handling: Handling | null;
  final: string | null;
  /** 시도별 생성 문장과 유출 검사 결과(완화: 실제 검사, 엄격: 단어 경계 무시 4글자). */
  attempts: { text: string; leaks: LeakResult; strict: LeakResult }[];
  /** 이 질문에 쓴 Gemini 호출 수(재생성·연결 재시도 포함). */
  calls: number;
  infra_retries: string[];
  error?: string;
  at: string;
}

const count = Number(option("count", "10"));
const gap = Number(option("gap", "6000"));
const out = option("out", "");
const show = (r: LeakResult) => (hasLeak(r) ? [...r.terms, ...r.phrases].join(", ") : "없음");
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : "-");

if (!process.env.GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY가 없습니다. .env에 키를 넣고 다시 실행하세요.");
  process.exit(1);
}

const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
const records = openRecordFile<QuestionRecord>(option("records", join(RESULTS_DIR, "questions.jsonl")), flag("resume"));
const promptFiles = ["tutor-system", "tutor-question"].map((n) => readFileSync(join(process.cwd(), "llm", "prompts", `${n}.md`), "utf8"));

let last = 0;
let calls = 0;
const throttled = (async (...args: Parameters<typeof fetch>) => {
  const wait = last + gap - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  calls++;
  return fetch(...args);
}) as typeof fetch;
const client = new RetryingGeminiClient({ fetch: throttled });
const tutor = new GeminiTutor(client);
const streak = new InfraStreak();

console.log(`결과 파일: ${records.path} (모델: ${model})`);
const lines: string[] = [];
const all: QuestionRecord[] = [];
let skipped = 0;
let stopped = false;
for (const rubric of loadFinalRubrics()) {
  for (const concept of rubric.concepts) {
    const inName = answerTermsInName(rubric, concept);
    if (inName.length) console.warn(`\n경고: ${concept.concept_id}의 answer_terms 중 개념 이름에 든 말은 유출 검사에서 빠집니다: ${inName.join(", ")}`);
    // 모델, 튜터 프롬프트 파일, 개념 루브릭, 용어집이 같아야 같은 결과로 본다.
    const fp = fingerprint(model, ...promptFiles, JSON.stringify(concept), JSON.stringify(rubric.glossary ?? []));
    const mine: QuestionRecord[] = [];
    for (let i = 1; i <= count; i++) {
      const key = `${rubric.section}/${concept.concept_id}/${i}`;
      const prior = records.done(key, fp);
      if (prior) {
        mine.push(prior);
        skipped++;
        process.stdout.write("-");
        continue;
      }
      if (stopped) continue;

      client.reset();
      const before = calls;
      const base = { key, fingerprint: fp, model, section: rubric.section, concept_id: concept.concept_id, index: i };
      let record: QuestionRecord;
      try {
        const q = await tutor.questionDetailed({ rubric, concept });
        record = {
          ...base,
          infra_error: false,
          status: "ok",
          handling: q.usedFallback ? "대체 질문" : q.attempts.length > 1 ? "재생성" : "통과",
          final: q.text,
          attempts: q.attempts.map((a) => ({ ...a, strict: findLeaks(a.text, rubric, concept, { crossWordOnly: false }) })),
          calls: calls - before,
          infra_retries: client.retries,
          at: new Date().toISOString(),
        };
      } catch (error) {
        // 연결 오류(GeminiCallError)가 아닌 LlmUnavailableError는 튜터의 빈 응답이다.
        if (!(error instanceof LlmUnavailableError)) throw error;
        const infra = isInfraError(error);
        record = {
          ...base,
          infra_error: infra,
          status: infra ? "infra_error" : "format_error",
          handling: null,
          final: null,
          attempts: [],
          calls: calls - before,
          infra_retries: client.retries,
          error: error.message,
          at: new Date().toISOString(),
        };
      }
      records.append(record);
      mine.push(record);
      process.stdout.write(
        record.status === "infra_error" ? "E" : record.status === "format_error" ? "?" : record.handling === "통과" ? "." : record.handling === "재생성" ? "r" : "F",
      );
      if (streak.push(record.infra_error)) {
        console.error(`\n연결 오류가 ${MAX_CONSECUTIVE_INFRA}개 연속으로 나서 멈춥니다: ${record.error}`);
        console.error("원인(요청 한도·API 키·네트워크)을 확인한 뒤 --resume으로 이어서 실행하세요.");
        process.exitCode = 1;
        stopped = true;
      }
    }
    all.push(...mine);
    lines.push(...conceptSection(`${rubric.section} · ${concept.name} (\`${concept.concept_id}\`)`, mine));
  }
}

function conceptSection(title: string, mine: QuestionRecord[]): string[] {
  const ok = mine.filter((r) => r.status === "ok");
  const section = [`\n### ${title}\n`, summary(mine), ""];
  section.push("| # | 최종 질문 | 처리 | 첫 생성 유출(완화) | 첫 생성 유출(엄격 4글자) | 범위 초과 |", "|---|---|---|---|---|---|");
  for (const r of ok) {
    const first = r.attempts[0]!;
    section.push(`| ${r.index} | ${cell(r.final!)} | ${r.handling} | ${show(first.leaks)} | ${show(first.strict)} | |`);
  }
  // 유출 검사에 걸린 질문 문장과 걸린 표현. 재생성 지시와 대체 질문을 판단한 근거다.
  const caught = ok.flatMap((r) => r.attempts.map((a, n) => ({ r, a, n })).filter(({ a }) => hasLeak(a.leaks)));
  if (caught.length) {
    section.push("", "유출 검사에 걸린 질문", "", "| # | 시도 | 질문 | 정답 용어 | 근거 문장 구 |", "|---|---|---|---|---|");
    for (const { r, a, n } of caught) {
      section.push(`| ${r.index} | ${n + 1} | ${cell(a.text)} | ${a.leaks.terms.join(", ") || "-"} | ${a.leaks.phrases.join(", ") || "-"} |`);
    }
  }
  const failed = mine.filter((r) => r.status !== "ok");
  if (failed.length) {
    section.push("", "실패", "");
    for (const r of failed) section.push(`- #${r.index} ${r.status}: ${r.error}`);
  }
  return section;
}

/** 처리 비율은 연결 오류를 뺀 질문으로 계산한다. */
function summary(rs: QuestionRecord[]): string {
  const infra = rs.filter((r) => r.status === "infra_error").length;
  const format = rs.filter((r) => r.status === "format_error").length;
  const counted = rs.filter((r) => r.status !== "infra_error");
  const n = (h: Handling) => counted.filter((r) => r.handling === h).length;
  return (
    `통과 ${n("통과")}/${counted.length} (${pct(n("통과"), counted.length)}), ` +
    `재생성 ${n("재생성")} (${pct(n("재생성"), counted.length)}), ` +
    `대체 질문 ${n("대체 질문")} (${pct(n("대체 질문"), counted.length)}), ` +
    `형식 오류(빈 응답) ${format} (${pct(format, counted.length)}) · ` +
    `연결 오류 ${infra}개(비율에서 제외)` +
    (rs.length < count ? ` · 미실행 ${count - rs.length}개` : "")
  );
}

const totalCalls = all.reduce((s, r) => s + r.calls, 0);
const reconnects = all.reduce((s, r) => s + r.infra_retries.length, 0);
const report =
  `# 튜터 질문 표본 (${new Date().toISOString().slice(0, 10)}, 모델 ${model}, 개념당 ${count}개, Gemini 호출 ${totalCalls}회, 연결 재시도 ${reconnects}회)\n\n` +
  `전체: ${summary(all).replace(/ · 미실행.*$/, "")}\n` +
  lines.join("\n") +
  "\n";
process.stdout.write("\n");
if (skipped) console.log(`이전 기록 사용: ${skipped}개`);
if (out) {
  writeFileSync(out, report);
  console.log(`저장: ${out}`);
} else {
  console.log(report);
}
