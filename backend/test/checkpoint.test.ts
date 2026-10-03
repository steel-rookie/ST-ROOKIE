import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import { CheckpointEngine } from "../src/checkpoint/engine.js";
import { CheckpointRepository } from "../src/checkpoint/repository.js";
import { createCheckpointRouter } from "../src/checkpoint/routes.js";
import { CheckpointError, LlmUnavailableError, type CheckpointView } from "../src/checkpoint/types.js";
import { openDatabase } from "../src/db/database.js";
import { FakeEvaluator, FakeTutor, IRONMAKING, STEELMAKING } from "./checkpoint-fakes.js";

const USER = "u1";

function setup() {
  const repo = new CheckpointRepository(openDatabase(":memory:"));
  const evaluator = new FakeEvaluator();
  const tutor = new FakeTutor();
  let tick = 0;
  const engine = new CheckpointEngine({
    repo,
    evaluator,
    tutor,
    rubrics: [IRONMAKING, STEELMAKING],
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString(),
  });
  return { repo, evaluator, tutor, engine };
}

/** 시작 → "네" → 답변들. 마지막 응답을 돌려준다. */
async function runCheckpoint(engine: CheckpointEngine, answers: string[], user = USER): Promise<CheckpointView> {
  const { view } = await engine.start(user, "ironmaking");
  let last = await engine.respond(user, view.attempt_id, "네");
  for (const answer of answers) last = await engine.respond(user, view.attempt_id, answer);
  return last;
}

const texts = (view: CheckpointView) => view.tutor.map((u) => `${u.type}:${u.text}`);

test("정답 흐름: 모든 개념이 correct면 완료되고 다음 섹션이 열린다", async () => {
  const { engine, evaluator } = setup();

  const { created, view: started } = await engine.start(USER, "ironmaking");
  assert.ok(created);
  assert.equal(started.state, "awaiting_ready");
  assert.deepEqual(texts(started), ["intro:제선 질문 시작할게요, 준비됐나요?"]);

  const ready = await engine.respond(USER, started.attempt_id, "네");
  assert.equal(ready.state, "awaiting_answer");
  assert.deepEqual(ready.concept, { id: "a", name: "개념A", index: 1, total: 3 });
  assert.deepEqual(texts(ready), ["question:Q:a"]);

  const afterA = await engine.respond(USER, started.attempt_id, "correct");
  assert.deepEqual(texts(afterA), ["feedback:맞아요.", "question:Q:b"]);
  assert.deepEqual(afterA.progress.map((p) => p.status), ["done", "current", "pending"]);
  assert.equal(afterA.result, null);

  await engine.respond(USER, started.attempt_id, "correct");
  const done = await engine.respond(USER, started.attempt_id, "correct");
  assert.equal(done.state, "completed");
  assert.equal(done.concept, null);
  assert.equal(done.result?.understanding, 1);
  assert.equal(done.result?.unlocked, true);
  assert.deepEqual(done.result?.concepts.map((c) => [c.concept_id, c.score, c.final_verdict]), [
    ["a", 1, "correct"], ["b", 1, "correct"], ["c", 1, "correct"],
  ]);
  assert.match(done.tutor.at(-1)!.text, /이해도 100%.*제강 섹션이 열렸어요/);
  assert.deepEqual(evaluator.calls.map((c) => c.phase), ["initial", "initial", "initial"]);

  assert.equal(engine.sectionProgress(USER, "ironmaking").unlocked, true);
  assert.equal(engine.sectionProgress(USER, "steelmaking").open, true);
  await assert.rejects(engine.start(USER, "ironmaking"), (e) => e instanceof CheckpointError && e.status === 409);
});

test("partial → 부가 설명과 다른 각도 재확인 → 재확인 판정이 최종 점수", async () => {
  const { engine, evaluator, tutor } = setup();
  const { view } = await engine.start(USER, "ironmaking");
  await engine.respond(USER, view.attempt_id, "네");

  const partial = await engine.respond(USER, view.attempt_id, "partial@1");
  assert.equal(partial.state, "awaiting_recheck");
  assert.deepEqual(texts(partial), ["explanation:EX:a:1", "recheck_question:RQ:a"]);
  assert.deepEqual(tutor.calls.find((c) => c.kind === "recheck")?.extra, { previousQuestion: "Q:a" });

  const rechecked = await engine.respond(USER, view.attempt_id, "correct");
  assert.deepEqual(texts(rechecked), ["feedback:맞아요, 이번에는 정확해요.", "question:Q:b"]);
  assert.equal(evaluator.calls.at(-1)?.question, "RQ:a"); // 재확인 질문으로 채점

  await engine.respond(USER, view.attempt_id, "partial");
  const keyPoints = await engine.respond(USER, view.attempt_id, "partial");
  assert.equal(keyPoints.tutor[0]!.type, "key_points");
  assert.match(keyPoints.tutor[0]!.text, /개념B 핵심 1\n- 개념B 핵심 2/);

  const done = await engine.respond(USER, view.attempt_id, "correct");
  assert.deepEqual(done.result?.concepts.map((c) => c.score), [1, 0.5, 1]);
  assert.equal(done.result?.unlocked, true); // 2.5 / 3 ≥ 80%
  assert.deepEqual(evaluator.calls.map((c) => c.phase), ["initial", "recheck", "initial", "recheck", "initial"]);
});

test("핵심 요소를 모두 맞혔지만 사실 오류로 partial이면 explain_from null로 오개념만 교정한 뒤 재확인한다", async () => {
  const { engine, tutor } = setup();
  const { view } = await engine.start(USER, "ironmaking");
  await engine.respond(USER, view.attempt_id, "네");

  const partial = await engine.respond(USER, view.attempt_id, "partial@null|불순물 제거를 잘못 앎");
  assert.equal(partial.state, "awaiting_recheck");
  assert.deepEqual(texts(partial), ["explanation:EX:a:null", "recheck_question:RQ:a"]);
  assert.deepEqual(tutor.calls.find((c) => c.kind === "explanation")?.extra, { explainFrom: null, misconception: "불순물 제거를 잘못 앎", learnerNotes: null });
});

test("explain_from null인데 오개념이 없거나 partial이 아니면 채점 오류로 본다", async () => {
  for (const answer of ["partial@null", "wrong@null|x"]) {
    const { engine } = setup();
    const { view } = await engine.start(USER, "ironmaking");
    await engine.respond(USER, view.attempt_id, "네");
    assert.equal((await engine.respond(USER, view.attempt_id, answer)).state, "error", answer);
  }
});

test("assisted → 부가 설명 후 재확인 correct면 1점", async () => {
  const { engine, repo } = setup();
  const done = await runCheckpoint(engine, ["assisted", "correct", "correct", "correct"]);
  assert.equal(done.state, "completed");
  assert.equal(done.result?.concepts[0]!.score, 1);
  const row = repo.listResults(done.attempt_id).find((r) => r.concept_id === "a")!;
  assert.equal(row.verdict, "assisted");
  assert.equal(row.recheck_verdict, "correct");
  assert.equal(row.recheck_question, "RQ:a");
});

test("재확인 단계에서 평가자가 assisted를 내면 계약 위반으로 error 상태가 된다", async () => {
  const { engine } = setup();
  const view = await runCheckpoint(engine, ["wrong", "assisted"]);
  assert.equal(view.state, "error");
  assert.equal(view.tutor[0]!.type, "error");
});

test("80% 미달 → 재도전은 만점이 아닌 개념만 묻고, 맞힌 개념 점수와 오개념 해결을 반영한다", async () => {
  const { engine, evaluator, repo } = setup();
  const first = await runCheckpoint(engine, [
    "correct",
    "wrong|코크스가 불순물을 없앤다고 생각함", "wrong|여전히 불순물 제거로 설명함",
    "partial", "partial",
  ]);
  assert.equal(first.state, "completed");
  assert.equal(first.result?.understanding, 0.5);
  assert.equal(first.result?.unlocked, false);
  assert.deepEqual(first.result?.retry_concept_ids, ["b", "c"]);
  assert.match(first.tutor.at(-1)!.text, /이해도 50%.*섹션 처음으로.*개념B, 개념C/);

  // 첫 판정과 재확인에서 나온 오개념을 모두 기록한다.
  const recorded = repo.listMisconceptions(USER);
  assert.deepEqual(recorded.map((m) => [m.concept_id, m.phase, m.answer_text, m.summary, m.resolved]), [
    ["b", "initial", "wrong|코크스가 불순물을 없앤다고 생각함", "코크스가 불순물을 없앤다고 생각함", false],
    ["b", "recheck", "wrong|여전히 불순물 제거로 설명함", "여전히 불순물 제거로 설명함", false],
  ]);

  const progress = engine.sectionProgress(USER, "ironmaking");
  assert.equal(progress.unlocked, false);
  assert.deepEqual(progress.retry_concept_ids, ["b", "c"]);
  assert.equal(engine.sectionProgress(USER, "steelmaking").open, false);

  const { created, view: retry } = await engine.start(USER, "ironmaking");
  assert.ok(created);
  assert.equal(retry.kind, "retry");
  assert.deepEqual(retry.progress.map((p) => p.concept_id), ["b", "c"]);
  assert.match(retry.tutor[0]!.text, /어려웠던 개념 2개만/);

  evaluator.calls = [];
  await engine.respond(USER, retry.attempt_id, "네");
  await engine.respond(USER, retry.attempt_id, "correct");
  const done = await engine.respond(USER, retry.attempt_id, "correct");
  assert.deepEqual(evaluator.calls.map((c) => c.concept.concept_id), ["b", "c"]);
  assert.equal(done.result?.understanding, 1);
  assert.equal(done.result?.unlocked, true);
  assert.equal(done.result?.concepts[0]!.score, 1); // 첫 시도에서 맞힌 a 유지
  assert.ok(repo.listMisconceptions(USER).every((m) => m.resolved));
});

test("평가자 형식 오류 → error 상태 → retry-evaluation으로 같은 답변을 다시 채점", async () => {
  const { engine, evaluator, repo } = setup();
  const { view } = await engine.start(USER, "ironmaking");
  await engine.respond(USER, view.attempt_id, "네");

  evaluator.failNext = 1;
  const failed = await engine.respond(USER, view.attempt_id, "correct");
  assert.equal(failed.state, "error");
  assert.equal(failed.concept?.id, "a");
  await assert.rejects(engine.respond(USER, view.attempt_id, "correct"), (e) => e instanceof CheckpointError && e.status === 409);

  const resumed = await engine.retryEvaluation(USER, view.attempt_id);
  assert.equal(resumed.state, "awaiting_answer");
  assert.equal(resumed.concept?.id, "b");
  assert.equal(repo.listResults(view.attempt_id)[0]?.answer, "correct");
  const userMessages = repo.listMessages(view.attempt_id).filter((m) => m.role === "user").map((m) => m.text);
  assert.deepEqual(userMessages, ["네", "correct"]); // 다시 채점해도 답변은 한 번만 기록
});

test("LLM 연결 실패면 아무것도 저장하지 않아 같은 메시지를 다시 보낼 수 있다", async () => {
  const { engine, tutor, repo } = setup();
  const { view } = await engine.start(USER, "ironmaking");

  tutor.failNext = 1;
  await assert.rejects(engine.respond(USER, view.attempt_id, "네"), LlmUnavailableError);
  assert.equal(engine.get(USER, view.attempt_id).state, "awaiting_ready");
  await engine.respond(USER, view.attempt_id, "네");

  tutor.failNext = 1; // correct 판정 뒤 다음 질문 생성에서 실패
  await assert.rejects(engine.respond(USER, view.attempt_id, "correct"), LlmUnavailableError);
  assert.equal(repo.listResults(view.attempt_id).length, 0);
  const again = await engine.respond(USER, view.attempt_id, "correct");
  assert.equal(again.concept?.id, "b");
});

test("진행 중인 시도를 다시 시작하면 같은 시도를 대화 기록과 함께 돌려준다", async () => {
  const { engine } = setup();
  const { view } = await engine.start(USER, "ironmaking");
  await engine.respond(USER, view.attempt_id, "네");
  const resumed = await engine.start(USER, "ironmaking");
  assert.equal(resumed.created, false);
  assert.equal(resumed.view.attempt_id, view.attempt_id);
  assert.deepEqual(resumed.view.history?.map((m) => m.role), ["tutor", "user", "tutor"]);
});

test("잠긴 섹션은 403, 없는 시도·다른 사용자의 시도는 404, 겹친 요청은 409", async () => {
  const { engine, tutor } = setup();
  await assert.rejects(engine.start(USER, "steelmaking"), (e) => e instanceof CheckpointError && e.status === 403);
  await assert.rejects(engine.start(USER, "rolling"), (e) => e instanceof CheckpointError && e.status === 404);

  const { view } = await engine.start(USER, "ironmaking");
  assert.throws(() => engine.get("someone-else", view.attempt_id), (e) => e instanceof CheckpointError && e.status === 404);
  assert.throws(() => engine.get(USER, "missing"), (e) => e instanceof CheckpointError && e.status === 404);

  tutor.delay = 20;
  const results = await Promise.allSettled([
    engine.respond(USER, view.attempt_id, "네"),
    engine.respond(USER, view.attempt_id, "네"),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), ["fulfilled", "rejected"]);
  const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
  assert.equal((rejected.reason as CheckpointError).status, 409);
});

test("HTTP: 시작 201·재시작 200, 입력 오류 400, LLM 연결 실패 502", async (t) => {
  const { engine, tutor } = setup();
  const app = express();
  app.use(express.json());
  app.use(createCheckpointRouter(engine));
  const server = app.listen(0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

  const started = await post("/api/checkpoints", { section: "ironmaking" }, { "X-User-Id": "http-user" });
  assert.equal(started.status, 201);
  const view = (await started.json()) as CheckpointView;
  assert.equal((await post("/api/checkpoints", { section: "ironmaking" }, { "X-User-Id": "http-user" })).status, 200);

  assert.equal((await post("/api/checkpoints", { section: "mining" })).status, 400);
  assert.equal((await post("/api/checkpoints", { section: "ironmaking" }, { "X-User-Id": "bad id!" })).status, 400);
  assert.equal((await post(`/api/checkpoints/${view.attempt_id}/messages`, { text: " " }, { "X-User-Id": "http-user" })).status, 400);
  assert.equal((await fetch(`${base}/api/checkpoints/${view.attempt_id}`)).status, 404); // demo-user의 시도가 아님

  tutor.failNext = 1;
  const unavailable = await post(`/api/checkpoints/${view.attempt_id}/messages`, { text: "네" }, { "X-User-Id": "http-user" });
  assert.equal(unavailable.status, 502);
  assert.equal(((await unavailable.json()) as { code: string }).code, "LLM_UNAVAILABLE");

  const progress = await fetch(`${base}/api/sections/ironmaking/progress`, { headers: { "X-User-Id": "http-user" } });
  assert.equal(((await progress.json()) as { in_progress_attempt_id: string }).in_progress_attempt_id, view.attempt_id);
});

test("시연 기록(origin = 'seed')은 진행·해금·재도전·진행 중 시도에 쓰지 않는다", async () => {
  const db = openDatabase(":memory:");
  const engine = new CheckpointEngine({ repo: new CheckpointRepository(db), evaluator: new FakeEvaluator(), tutor: new FakeTutor(), rubrics: [IRONMAKING, STEELMAKING] });

  // 시연 기록: 제선 통과(완료) + 제강 진행 중
  const passed = await runCheckpoint(engine, ["correct", "correct", "correct"]);
  assert.equal(passed.result?.unlocked, true);
  const { view: open } = await engine.start(USER, "steelmaking");
  db.prepare("UPDATE attempts SET origin = 'seed'").run();

  const progress = engine.sectionProgress(USER, "ironmaking");
  assert.equal(progress.unlocked, false);
  assert.equal(progress.understanding, null);
  assert.equal(engine.sectionProgress(USER, "steelmaking").open, false);
  assert.throws(() => engine.get(USER, open.attempt_id), (e: unknown) => e instanceof CheckpointError && e.status === 404);

  // 실제 체크포인트는 409 없이 처음부터 시작한다.
  const { created, view } = await engine.start(USER, "ironmaking");
  assert.ok(created);
  assert.equal(view.kind, "first");
});

test("루브릭 개념 id가 바뀌면: 예전 결과는 버리고, 통과한 섹션은 통과로 두고 새 개념은 미확인", async () => {
  const db = openDatabase(":memory:");
  const repo = new CheckpointRepository(db);
  const before = new CheckpointEngine({ repo, evaluator: new FakeEvaluator(), tutor: new FakeTutor(), rubrics: [IRONMAKING, STEELMAKING] });
  // 통과한 사람(a·b·c 정답)과 미달인 사람(a만 정답)
  await runCheckpoint(before, ["correct", "correct", "correct"], "passed");
  await runCheckpoint(before, ["correct", "wrong", "wrong", "wrong", "wrong"], "failed");

  // 핵심 요소가 바뀌어 b → b2로 새 id
  const changed = { ...IRONMAKING, concepts: IRONMAKING.concepts.map((c) => (c.concept_id === "b" ? { ...c, concept_id: "b2" } : c)) };
  const after = new CheckpointEngine({ repo, evaluator: new FakeEvaluator(), tutor: new FakeTutor(), rubrics: [changed, STEELMAKING] });

  const passed = after.sectionProgress("passed", "ironmaking");
  assert.equal(passed.unlocked, true);
  assert.deepEqual(passed.unconfirmed_concept_ids, ["b2"]);
  assert.deepEqual(passed.retry_concept_ids, []);
  assert.equal(after.sectionProgress("passed", "steelmaking").open, true);
  await assert.rejects(after.start("passed", "ironmaking"), (e: unknown) => e instanceof CheckpointError && e.status === 409);

  // 미달인 사람은 예전 b 결과 없이 재도전: 맞힌 a는 빼고 b2·c를 묻는다.
  const failed = after.sectionProgress("failed", "ironmaking");
  assert.equal(failed.unlocked, false);
  assert.deepEqual(failed.retry_concept_ids, ["b2", "c"]);
  const { view } = await after.start("failed", "ironmaking");
  assert.equal(view.kind, "retry");
  assert.equal(view.concept, null);
  const ready = await after.respond("failed", view.attempt_id, "네");
  assert.equal(ready.concept?.id, "b2");
});

test("학습자 메모: 부가 설명 때만 읽어 튜터에게 넘기고, 평가자에게는 넘기지 않는다", async () => {
  const evaluator = new FakeEvaluator();
  const tutor = new FakeTutor();
  const asked: string[] = [];
  const engine = new CheckpointEngine({
    repo: new CheckpointRepository(openDatabase(":memory:")), evaluator, tutor, rubrics: [IRONMAKING, STEELMAKING],
    learnerNotes: async (userId, section) => {
      asked.push(`${userId}:${section}`);
      return { context: "- b (대화 중 감지됨): 코크스를 연료로만 앎" };
    },
  });

  // a는 correct(부가 설명 없음) → b는 wrong(부가 설명) → 재확인
  await runCheckpoint(engine, ["correct", "wrong", "correct"]);
  assert.deepEqual(asked, [`${USER}:ironmaking`]);
  const explanations = tutor.calls.filter((c) => c.kind === "explanation");
  assert.equal(explanations.length, 1);
  assert.equal((explanations[0]!.extra as { learnerNotes: string }).learnerNotes, "- b (대화 중 감지됨): 코크스를 연료로만 앎");
  assert.doesNotMatch(JSON.stringify(evaluator.calls), /코크스를 연료로만 앎/);

  // options.notes를 주면 그 메모를 쓰고 provider는 부르지 않는다. 빈 메모는 null로 넘긴다.
  const { view } = await engine.start("other", "ironmaking");
  await engine.respond("other", view.attempt_id, "네");
  await engine.respond("other", view.attempt_id, "wrong", { notes: {} });
  assert.deepEqual(asked, [`${USER}:ironmaking`]);
  assert.equal((tutor.calls.filter((c) => c.kind === "explanation").at(-1)!.extra as { learnerNotes: unknown }).learnerNotes, null);
});
