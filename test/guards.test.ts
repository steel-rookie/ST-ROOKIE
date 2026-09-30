// API를 호출하지 않고 서버 측 안전장치만 검사한다.
import assert from "node:assert/strict";
import { test } from "node:test";
import { allowedSceneActions } from "../src/data.js";
import { sanitizeResponse } from "../src/output.js";
import { createSession } from "../src/session.js";
import { executeTool, searchMaterials } from "../src/tools.js";

const ctx = (latestUserText: string) => ({ latestUserText });

function baseResponse(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    answer: "테스트",
    mode: "free_question",
    evidence_status: "grounded",
    citations: [],
    scene_actions: [],
    follow_up_question: null,
    needs_clarification: false,
    ...overrides,
  });
}

test("검색은 관련 자료를 찾고 인용 가능한 자료로 기록한다", () => {
  const session = createSession("t");
  const results = searchMaterials("고로에서 코크스 역할", null);
  assert.ok(results.length > 0);
  assert.equal(results[0]!.document_id, "SAMPLE-IRON-001");

  executeTool("search_education_materials", { query: "전로 산소", process_id: "steelmaking" }, session, ctx(""));
  assert.ok(session.retrievedDocuments.has("SAMPLE-STEEL-001"));
});

test("get_quiz는 정답과 해설을 모델에게 보내지 않는다", () => {
  const session = createSession("t");
  const result = executeTool("get_quiz", { process_id: "ironmaking", learning_step_id: null }, session, ctx(""));
  const body = JSON.parse(result.content);
  assert.equal(body.quiz.quiz_id, "Q-IRON-01");
  assert.ok(!("answer" in body.quiz));
  assert.ok(!result.content.includes("explanation"));
  assert.ok(!result.content.includes("misconception"));
});

test("출제하지 않은 문항은 채점할 수 없다", () => {
  const session = createSession("t");
  const result = executeTool("grade_quiz_answer", { quiz_id: "Q-IRON-01", learner_answer: "B" }, session, ctx("B"));
  assert.equal(result.isError, true);
  assert.equal(session.learningRecords.length, 0);
});

test("학습자가 보내지 않은 답은 채점하지 않는다", () => {
  const session = createSession("t");
  executeTool("get_quiz", { process_id: "ironmaking", learning_step_id: null }, session, ctx(""));
  const result = executeTool("grade_quiz_answer", { quiz_id: "Q-IRON-01", learner_answer: "B" }, session, ctx("잘 모르겠어요"));
  assert.equal(result.isError, true);
  assert.equal(session.learningRecords.length, 0);
});

test("오답이면 오개념을 기록한다", () => {
  const session = createSession("t");
  executeTool("get_quiz", { process_id: "ironmaking", learning_step_id: null }, session, ctx(""));
  const result = executeTool("grade_quiz_answer", { quiz_id: "Q-IRON-01", learner_answer: "A" }, session, ctx("A번이요"));
  const body = JSON.parse(result.content);
  assert.equal(body.correct, false);
  assert.equal(body.answer, "B");
  assert.equal(session.learningRecords[0]!.correct, false);
  assert.match(session.learningRecords[0]!.misconception!, /제강/);
});

test("서술형은 공식 점수 없이 학습자 원문을 기록한다", () => {
  const session = createSession("t");
  executeTool("get_quiz", { process_id: "continuous_casting", learning_step_id: null }, session, ctx(""));
  const answer = "용강을 고르게 나눠주고 불순물이 떠오르게 합니다";
  executeTool("grade_quiz_answer", { quiz_id: "Q-CC-01", learner_answer: "요약된 답" }, session, ctx(answer));
  assert.equal(session.learningRecords[0]!.correct, null);
  assert.equal(session.learningRecords[0]!.learner_answer, answer);
});

test("조회하지 않은 자료의 인용과 없는 페이지는 걸러낸다", () => {
  const session = createSession("t");
  executeTool("get_process_info", { process_id: "ironmaking" }, session, ctx(""));
  const { response, dropped } = sanitizeResponse(
    baseResponse({
      citations: [
        { document_id: "SAMPLE-IRON-001", title: "모델이 바꾼 제목", page: 99, version: null },
        { document_id: "POSCO-FAKE-777", title: "지어낸 문서", page: 1, version: "v9" },
      ],
    }),
    session,
    allowedSceneActions("ironmaking"),
  );
  assert.deepEqual(response.citations, [
    { document_id: "SAMPLE-IRON-001", title: "[샘플] 제선 공정 개요", page: null, version: "sample-0.1" },
  ]);
  assert.equal(dropped.citations[0]!.document_id, "POSCO-FAKE-777");
});

test("허용되지 않은 화면 동작은 걸러낸다", () => {
  const session = createSession("t");
  const { response, dropped } = sanitizeResponse(
    baseResponse({
      scene_actions: [
        { type: "highlight", target_id: "blast_furnace" },
        { type: "highlight", target_id: "bof_converter" }, // 다른 공정의 설비
        { type: "goto_process", target_id: "ironmaking" }, // 현재 화면으로 이동
        { type: "goto_process", target_id: "rolling" },
      ],
    }),
    session,
    allowedSceneActions("ironmaking"),
  );
  assert.deepEqual(
    response.scene_actions.map((a) => a.target_id),
    ["blast_furnace", "rolling"],
  );
  assert.equal(dropped.scene_actions.length, 2);
});

test("3D 모델이 없는 공정은 공정 이동만 허용한다", () => {
  assert.ok(allowedSceneActions("rolling").every((a) => a.type === "goto_process"));
});
