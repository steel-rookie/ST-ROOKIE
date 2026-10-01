// 튜터 질문 표본: 개념마다 질문을 N개 만들어 유출 검사 결과를 마크다운 표로 출력한다(실제 Gemini 사용).
// 실행: npm run eval:questions -- [--count 10] [--gap 6000] [--out 파일.md]
//  - 모든 Gemini 호출(재생성 포함) 사이에 --gap(ms)만큼 쉰다. 무료 등급 분당 한도를 넘지 않게 6000 이상을 권장.
//  - '범위 초과' 열은 비워 둔다. 질문이 핵심 요소만으로 답할 수 있는지는 사람이 판단한다.
import { writeFileSync } from "node:fs";
import { loadFinalRubrics } from "../../backend/src/rubrics.js";
import { GeminiClient } from "../src/gemini.js";
import { findLeaks, hasLeak, type LeakResult } from "../src/question-check.js";
import { GeminiTutor } from "../src/tutor.js";

function option(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1]! : fallback;
}

const count = Number(option("count", "10"));
const gap = Number(option("gap", "6000"));
const out = option("out", "");
const show = (r: LeakResult) => (hasLeak(r) ? [...r.terms, ...r.phrases].join(", ") : "없음");
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

if (!process.env.GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY가 없습니다. .env에 키를 넣고 다시 실행하세요.");
  process.exit(1);
}

let last = 0;
let calls = 0;
const throttled = (async (...args: Parameters<typeof fetch>) => {
  const wait = last + gap - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  calls++;
  return fetch(...args);
}) as typeof fetch;
const tutor = new GeminiTutor(new GeminiClient({ fetch: throttled }));

const lines: string[] = [];
for (const rubric of loadFinalRubrics()) {
  for (const concept of rubric.concepts) {
    lines.push(`\n### ${rubric.section} · ${concept.name} (\`${concept.concept_id}\`)\n`);
    lines.push("| # | 최종 질문 | 처리 | 첫 생성 유출(완화) | 첫 생성 유출(엄격 4글자) | 범위 초과 |", "|---|---|---|---|---|---|");
    for (let i = 1; i <= count; i++) {
      const q = await tutor.questionDetailed({ rubric, concept });
      const first = q.attempts[0]!;
      const handling = q.usedFallback ? "대체 질문" : q.attempts.length > 1 ? "재생성" : "통과";
      const strict = findLeaks(first.text, rubric, concept, { crossWordOnly: false });
      lines.push(`| ${i} | ${cell(q.text)} | ${handling} | ${show(first.leaks)} | ${show(strict)} | |`);
      process.stdout.write(handling === "통과" ? "." : handling === "재생성" ? "r" : "F");
    }
  }
}
const report = `# 튜터 질문 표본 (${new Date().toISOString().slice(0, 10)}, 개념당 ${count}개, Gemini 호출 ${calls}회)\n` + lines.join("\n") + "\n";
process.stdout.write("\n");
if (out) {
  writeFileSync(out, report);
  console.log(`저장: ${out}`);
} else {
  console.log(report);
}
