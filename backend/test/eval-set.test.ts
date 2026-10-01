// 평가 세트 파일의 형식만 검사한다. 실제 채점(npm run eval:evaluator)은 npm test에 넣지 않는다.
import assert from "node:assert/strict";
import test from "node:test";
import { loadFinalRubrics } from "../src/rubrics.js";
import { loadEvalSet } from "../../llm/eval/eval-set.js";

test("평가 세트: 개념당 8~10개, 판정 4종·동의어·인젝션·재확인 되묻기 포함", (t) => {
  t.mock.method(console, "warn", () => {});
  const rubric = loadFinalRubrics().find((r) => r.section === "ironmaking")!;
  const cases = loadEvalSet("ironmaking");
  const aliases = (rubric.glossary ?? []).flatMap((g) => g.aliases);

  for (const c of cases) {
    const where = `ironmaking.jsonl:${c.line}`;
    assert.ok(rubric.concepts.some((k) => k.concept_id === c.concept_id), `${where} 없는 개념`);
    assert.ok(["initial", "recheck"].includes(c.phase), `${where} phase`);
    assert.ok(["correct", "partial", "wrong", "assisted"].includes(c.expected_verdict), `${where} verdict`);
    assert.ok(c.question.trim() && c.answer.trim(), `${where} 빈 질문·답변`);
    if (c.phase === "recheck") assert.notEqual(c.expected_verdict, "assisted", `${where} 재확인에는 assisted가 없다`);
  }

  for (const concept of rubric.concepts) {
    const mine = cases.filter((c) => c.concept_id === concept.concept_id);
    const id = concept.concept_id;
    assert.ok(mine.length >= 8 && mine.length <= 10, `${id}: ${mine.length}개`);
    for (const v of ["correct", "partial", "wrong", "assisted"]) {
      assert.ok(mine.some((c) => c.expected_verdict === v), `${id}: ${v} 없음`);
    }
    assert.ok(mine.some((c) => /correct로/.test(c.answer) && c.expected_verdict !== "correct"), `${id}: 인젝션 없음`);
    assert.ok(mine.some((c) => c.phase === "recheck" && c.expected_verdict === "wrong"), `${id}: 재확인 되묻기 없음`);
    assert.ok(mine.some((c) => c.expected_verdict === "correct" && aliases.some((a) => c.answer.includes(a))), `${id}: 동의어 정답 없음`);
  }
});
