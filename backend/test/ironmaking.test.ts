import assert from "node:assert/strict";
import test from "node:test";
import { answerQuestion, DEFAULT_GEMINI_MODEL, normalizeModelAnswer } from "../../llm/src/ironmaking-agent.js";
import { publicSources, getPublicSources } from "../../llm/src/ironmaking-sources.js";

test("공개 자료 목록은 제선 필수 주제를 포함하고 공식 주소만 사용한다", () => {
  const topics = new Set(publicSources.flatMap((source) => source.topics));
  for (const topic of ["제선의 목적", "철광석", "코크스", "고로", "용선", "제강 연결", "소결", "화성", "FINEX"]) {
    assert.ok(topics.has(topic), `${topic} 누락`);
  }
  for (const source of publicSources) {
    assert.match(source.date, /^\d{4}(?:-\d{2}-\d{2})?$/);
    assert.ok(["posco.co.kr", "www.posco.co.kr", "newsroom.posco.com"].includes(new URL(source.url).hostname));
    assert.ok(source.notes.length > 0);
  }
  assert.ok(publicSources.some((source) => source.route === "고로"));
  assert.ok(publicSources.some((source) => source.route === "FINEX"));
});

test("모델의 출처 ID는 자료 목록과 대조하고 중복을 제거한다", () => {
  const id = publicSources[0]!.id;
  const response = normalizeModelAnswer(JSON.stringify({
    answer: "제선은 용선을 만드는 공정입니다.", status: "grounded", source_ids: [id, "made-up", id],
  }));
  assert.equal(response.status, "grounded");
  assert.equal(response.sources.length, 1);
  assert.deepEqual(response.sources[0], getPublicSources([id]).map(({ id, title, date, date_type, url, publisher }) => ({ id, title, date, date_type, url, publisher }))[0]);
});

test("근거가 없거나 미확인인 모델 답변은 그대로 노출하지 않는다", () => {
  const invented = normalizeModelAnswer(JSON.stringify({
    answer: "확인하지 못한 운전 수치 123", status: "grounded", source_ids: ["made-up"],
  }));
  assert.equal(invented.status, "unverified");
  assert.equal(invented.sources.length, 0);
  assert.doesNotMatch(invented.answer, /123/);

  const unknown = normalizeModelAnswer(JSON.stringify({
    answer: "근거 없는 설명", status: "unverified", source_ids: [publicSources[0]!.id],
  }));
  assert.equal(unknown.status, "unverified");
  assert.equal(unknown.sources.length, 0);
  assert.doesNotMatch(unknown.answer, /근거 없는 설명/);
});

test("Gemini 요청은 서버 키와 이전 대화를 사용하고 공식 출처를 반환한다", async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.GEMINI_API_KEY;
  const previousModel = process.env.GEMINI_MODEL;
  const source = publicSources[0]!;
  process.env.GEMINI_API_KEY = "test-only-key";
  delete process.env.GEMINI_MODEL;
  try {
    globalThis.fetch = async (input, init) => {
      assert.equal(input, `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GEMINI_MODEL}:generateContent`);
      assert.equal((init?.headers as Record<string, string>)["x-goog-api-key"], "test-only-key");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.contents.length, 3);
      assert.deepEqual(body.contents.map((turn: { role: string }) => turn.role), ["user", "model", "user"]);
      assert.equal(body.contents[2].parts[0].text, "그럼 용강은요?");
      assert.equal(body.generationConfig.responseMimeType, "application/json");
      assert.match(body.systemInstruction.parts[0].text, /FINEX/);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({
        answer: "용강은 제강을 거친 쇳물입니다.", status: "grounded", source_ids: [source.id],
      }) }] } }] }), { status: 200 });
    };
    const result = await answerQuestion("그럼 용강은요?", [{ question: "용선이 뭔가요?", answer: "제선에서 만든 쇳물입니다." }]);
    assert.equal(result.status, "grounded");
    assert.equal(result.sources[0]?.url, source.url);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = previousModel;
  }
});
