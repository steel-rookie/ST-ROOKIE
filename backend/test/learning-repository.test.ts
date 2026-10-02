import assert from "node:assert/strict";
import test from "node:test";
import { openDatabase } from "../src/db/database.js";
import { countUserData, deleteUserData } from "../src/db/user-data.js";
import { LearningRepository, type NewTurn } from "../src/learning/repository.js";

const turn = (over: Partial<NewTurn> = {}): NewTurn => ({
  user_id: "minsu",
  session_id: "s1",
  section: "ironmaking",
  equipment_id: "blast_furnace",
  question: "고로에 코크스를 왜 넣나요?",
  answer: "열원이면서 환원제이기 때문입니다.",
  status: "grounded",
  source_ids: ["posco-ironmaking-1"],
  ...over,
});

function setup() {
  const db = openDatabase(":memory:");
  return { db, repo: new LearningRepository(db) };
}

test("saveTurn: 세션 안에서 seq가 1부터 이어지고 근거 id 배열이 그대로 돌아온다", () => {
  const { repo } = setup();
  const first = repo.saveTurn(turn(), "2026-10-02T01:00:00Z");
  const second = repo.saveTurn(turn({ question: "소결은 뭔가요?" }), "2026-10-02T01:00:00Z"); // 같은 시각
  const other = repo.saveTurn(turn({ session_id: "s2" }), "2026-10-02T01:00:00Z");
  assert.deepEqual([first.seq, second.seq, other.seq], [1, 2, 1]);

  const recent = repo.recentTurns("s1", 6);
  assert.deepEqual(recent.map((t) => t.question), ["고로에 코크스를 왜 넣나요?", "소결은 뭔가요?"]);
  assert.deepEqual(recent[0].source_ids, ["posco-ironmaking-1"]);
  assert.equal(recent[0].equipment_id, "blast_furnace");
});

test("recentTurns: 최근 limit개만 오래된 것부터 돌려준다", () => {
  const { repo } = setup();
  for (let i = 1; i <= 8; i++) repo.saveTurn(turn({ question: `질문 ${i}` }), `2026-10-02T01:0${i}:00Z`);
  assert.deepEqual(repo.recentTurns("s1", 3).map((t) => t.question), ["질문 6", "질문 7", "질문 8"]);
  assert.deepEqual(repo.recentTurns("없는 세션", 3), []);
});

test("sessionOwner: 세션을 만든 사용자를 알려 주고, 없는 세션은 null", () => {
  const { repo } = setup();
  repo.saveTurn(turn(), "2026-10-02T01:00:00Z");
  assert.equal(repo.sessionOwner("s1"), "minsu");
  assert.equal(repo.sessionOwner("s9"), null);
});

test("status는 grounded·unverified·safety_redirect만 저장된다", () => {
  const { repo } = setup();
  repo.saveTurn(turn({ status: "safety_redirect", source_ids: [] }), "2026-10-02T01:00:00Z");
  assert.throws(() => repo.saveTurn(turn({ status: "maybe" as never }), "2026-10-02T01:00:00Z"));
});

test("recordMisconception·openMisconceptions: 학습 모드 오개념은 source=learning, 해결되지 않은 것만 섹션별로 나온다", () => {
  const { db, repo } = setup();
  repo.recordMisconception({ user_id: "minsu", section: "ironmaking", concept_id: "coke_role", answer_text: "코크스는 연료죠?", summary: "환원제 역할 누락" }, "2026-10-02T01:00:00Z");
  repo.recordMisconception({ user_id: "minsu", section: "steelmaking", concept_id: "bof", answer_text: "산소로 철을 태워요", summary: "산화 대상 오해" }, "2026-10-02T01:01:00Z");
  repo.recordMisconception({ user_id: "jiwoo", section: "ironmaking", concept_id: "coke_role", answer_text: "x", summary: "다른 사람" }, "2026-10-02T01:02:00Z");
  db.prepare("INSERT INTO misconceptions (id, user_id, section, concept_id, source, answer_text, summary, resolved, created_at) VALUES ('done', 'minsu', 'ironmaking', 'sinter', 'checkpoint', 'a', '해결된 것', 1, '2026-10-01')").run();
  db.prepare("INSERT INTO misconceptions (id, user_id, section, concept_id, source, answer_text, summary, created_at) VALUES ('cp', 'minsu', 'ironmaking', 'hot_stove', 'checkpoint', 'a', '열풍로 역할 오해', '2026-10-02T00:00:00Z')").run();

  const open = repo.openMisconceptions("minsu", "ironmaking");
  assert.deepEqual(open.map((m) => [m.concept_id, m.source]), [["hot_stove", "checkpoint"], ["coke_role", "learning"]]);
  const learning = db.prepare("SELECT phase, attempt_id, resolved FROM misconceptions WHERE source = 'learning' AND user_id = 'minsu' AND section = 'ironmaking'").get();
  assert.deepEqual({ ...learning }, { phase: null, attempt_id: null, resolved: 0 });
});

test("deleteUserData: 학습 대화도 그 사용자 것만 지운다", () => {
  const { db, repo } = setup();
  repo.saveTurn(turn(), "2026-10-02T01:00:00Z");
  repo.saveTurn(turn({ user_id: "jiwoo", session_id: "s2" }), "2026-10-02T01:00:00Z");
  assert.equal(countUserData(db, "minsu").learning_turns, 1);
  assert.equal(deleteUserData(db, "minsu").learning_turns, 1);
  assert.equal(countUserData(db, "minsu").learning_turns, 0);
  assert.equal(countUserData(db, "jiwoo").learning_turns, 1);
});
