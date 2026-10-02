import assert from "node:assert/strict";
import test from "node:test";
import { getPublicSources, publicSources } from "../../llm/src/ironmaking-sources.js";

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

test("출처 조회는 목록에 있는 id만 중복 없이 돌려준다", () => {
  const id = publicSources[0]!.id;
  assert.deepEqual(getPublicSources([id, "made-up", id]).map((source) => source.id), [id]);
});
