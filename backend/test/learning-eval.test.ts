// 학습 모드 평가 세트(llm/eval/learning/ironmaking.jsonl)의 형식과 채점 규칙을 검사한다. 실제 Gemini는 호출하지 않는다.
import assert from "node:assert/strict";
import test from "node:test";
import { loadLearningSet, score, type LearningCase } from "../../llm/eval/run-learning.js";
import { loadSceneCatalog } from "../src/learning/scene-catalog.js";
import { isSafetyQuestion } from "../src/learning/safety.js";
import { loadFinalRubrics } from "../src/rubrics.js";

test("평가 세트: 화면 조작은 화면 목록의 id, 오개념은 제선 루브릭 개념, safety 기대는 실제 안전 규칙과 같다", async () => {
  const cases = loadLearningSet();
  assert.ok(cases.length >= 20);
  const scene = await loadSceneCatalog();
  const processes = new Set<string>(scene.processes.map((p) => p.id));
  const equipment = new Set(scene.processes.flatMap((p) => p.equipment.map((e) => e.id)));
  const concepts = new Set(loadFinalRubrics().find((r) => r.section === "ironmaking")!.concepts.map((c) => c.concept_id));
  for (const c of cases) {
    if (c.screen.equipment_id) assert.ok(equipment.has(c.screen.equipment_id), `${c.id} 화면 설비`);
    if (c.expect.scene !== "any") {
      for (const a of c.expect.scene) {
        const ok = a.type === "goto_process" || a.type === "play_animation" ? processes.has(a.target_id) : equipment.has(a.target_id);
        assert.ok(ok, `${c.id} ${a.type}:${a.target_id}`);
      }
    }
    if (c.expect.misconception) assert.ok(concepts.has(c.expect.misconception), `${c.id} 개념`);
    assert.equal(isSafetyQuestion(c.question), c.expect.status === "safety_redirect", `${c.id} 안전 규칙`);
  }
});

test("채점: 기대 조작이 모두 있으면 맞음(더 있어도 됨), []이면 조작이 없어야 하고, any는 보지 않는다", () => {
  const c = (scene: LearningCase["expect"]["scene"], misconception: string | null = null): LearningCase => ({
    id: "x",
    type: "t",
    question: "q",
    screen: { process_id: "ironmaking", equipment_id: null },
    expect: { status: "grounded", scene, misconception },
  });
  const focus = { type: "focus" as const, target_id: "blast_furnace" };
  const highlight = { type: "highlight" as const, target_id: "blast_furnace" };
  const r = (scene_actions = [focus, highlight], status: "grounded" | "unverified" = "grounded", misconception: string | null = null) => ({ status, scene_actions, misconception });
  assert.deepEqual(score(c([focus]), r()), { status: true, scene: true, misconception: true });
  assert.equal(score(c([focus]), r([highlight])).scene, false);
  assert.equal(score(c([]), r()).scene, false);
  assert.equal(score(c([]), r([])).scene, true);
  assert.equal(score(c("any"), r([])).scene, null);
  assert.equal(score(c([focus]), r(undefined, "unverified")).status, false);
  assert.equal(score(c("any", "coke_reduction"), r(undefined, "grounded", null)).misconception, false);
});
