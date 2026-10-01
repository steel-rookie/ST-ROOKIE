// 튜터 질문 정답 유출 검사와 재생성·대체 질문.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type { Rubric } from "../src/rubrics.js";
import { GeminiClient } from "../../llm/src/gemini.js";
import { answerTerms, findLeaks, hasLeak } from "../../llm/src/question-check.js";
import { genericQuestion, GeminiTutor } from "../../llm/src/tutor.js";

const rubric = JSON.parse(readFileSync(join(process.cwd(), "content", "rubrics", "final", "01_제선.json"), "utf8")) as Rubric;
const concept = (id: string) => rubric.concepts.find((c) => c.concept_id === id)!;
const coke = concept("coke_reduction");

test("정답 용어: answer_terms와 용어집 동의어를 막고, 개념 이름의 말은 허용한다", () => {
  assert.deepEqual(answerTerms(rubric, coke).sort(), ["CO", "일산화탄소", "환원"].sort());
  assert.deepEqual(findLeaks("코크스가 만드는 CO는 무슨 일을 하나요?", rubric, coke).terms, ["CO"]);
  assert.deepEqual(findLeaks("COKE를 영어로 뭐라고 하나요?", rubric, coke).terms, []);
  assert.deepEqual(findLeaks("일산화 탄소는 어디서 생기나요?", rubric, coke).terms, ["일산화탄소"]); // 띄어 써도 잡는다
  assert.ok(!hasLeak(findLeaks("고로에서 코크스는 어떤 역할을 하나요?", rubric, coke)));
});

test("근거 문장: 두 단어 이상에 걸친 4글자 이상 구는 막고, 한 단어 안의 겹침은 허용한다", () => {
  const leaked = findLeaks("코크스가 철광석에서 산소를 떼어내는 과정을 설명해 주세요.", rubric, coke);
  assert.ok(leaked.phrases.length > 0);
  // "철광석을", "고로에서"는 quote와 4글자가 겹치지만 한 단어 안이라 허용(엄격 모드에서는 걸린다)
  const sinter = concept("sinter_purpose");
  const natural = "철광석을 가루 그대로 고로에 넣지 않는 이유는 무엇인가요?";
  assert.ok(!hasLeak(findLeaks(natural, rubric, sinter)));
  assert.ok(hasLeak(findLeaks(natural, rubric, sinter, { crossWordOnly: false })));
});

test("모든 fallback_question은 유출 검사를 통과한다", () => {
  for (const c of rubric.concepts) {
    assert.ok(c.fallback_question, `${c.concept_id}: fallback_question 없음`);
    const leaks = findLeaks(c.fallback_question!, rubric, c);
    assert.ok(!hasLeak(leaks), `${c.concept_id}: ${JSON.stringify(leaks)}`);
    assert.ok(!hasLeak(findLeaks(genericQuestion(c), rubric, c)), `${c.concept_id}: 고정 문장 유출`);
  }
});

function fakeTutor(replies: string[]) {
  const prompts: string[] = [];
  const client = new GeminiClient({
    apiKey: "test",
    fetch: (async (_url: string, init: RequestInit) => {
      prompts.push((JSON.parse(String(init.body)) as { contents: { parts: { text: string }[] }[] }).contents[0]!.parts[0]!.text);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: replies.shift() ?? "" }] } }] }));
    }) as typeof fetch,
  });
  return { prompts, tutor: new GeminiTutor(client) };
}

test("질문이 유출 검사에 걸리면 걸린 표현을 알려 주고 1회 다시 만든다", async () => {
  const { prompts, tutor } = fakeTutor(["코크스가 만드는 일산화탄소는 무슨 일을 하나요?", "고로에서 코크스가 하는 일을 설명해 주세요."]);
  const q = await tutor.questionDetailed({ rubric, concept: coke });
  assert.equal(q.text, "고로에서 코크스가 하는 일을 설명해 주세요.");
  assert.equal(q.attempts.length, 2);
  assert.equal(q.usedFallback, false);
  assert.match(prompts[1]!, /직전 질문에 정답 표현이 들어 있었습니다: 일산화탄소/);
  assert.match(prompts[0]!, /정답 용어와 그 동의어를 질문에 쓰지 마세요: .*일산화탄소/);
  assert.doesNotMatch(prompts[0]!, /근거:/); // 질문 생성에는 근거 문장을 주지 않는다
});

test("두 번 모두 걸리면 fallback_question을, 재확인에서 직전 질문과 같으면 고정 문장을 쓴다", async () => {
  const leaky = ["CO가 어디서 생기나요?", "환원은 무엇인가요?"];
  const first = await fakeTutor([...leaky]).tutor.questionDetailed({ rubric, concept: coke });
  assert.equal(first.usedFallback, true);
  assert.equal(first.text, coke.fallback_question);

  const recheck = await fakeTutor([...leaky]).tutor.recheckQuestionDetailed({ rubric, concept: coke, previousQuestion: coke.fallback_question! });
  assert.equal(recheck.text, genericQuestion(coke));
});
