// 학습자 메모 계약(backend/src/learning/notes.ts): 체크포인트 엔진의 options.notes가 이 타입을 받는다.
import assert from "node:assert/strict";
import test from "node:test";
import { buildLearnerNotes, type LearnerNotes } from "../src/learning/notes.js";
import type { EngineOptions } from "../src/checkpoint/engine.js";

test("buildLearnerNotes: 구현 전에는 빈 메모를 돌려주고, 그 결과를 엔진 options.notes에 그대로 넘길 수 있다", async () => {
  const notes: LearnerNotes = await buildLearnerNotes("demo-user", "ironmaking");
  assert.deepEqual(notes, {});
  const options: EngineOptions = { notes };
  assert.equal(options.notes, notes);
});
