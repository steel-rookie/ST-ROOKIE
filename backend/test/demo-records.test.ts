import assert from "node:assert/strict";
import { test } from "node:test";
import { SECTIONS, traineeStats } from "../src/admin/trainee-stats.js";
import { seedDemoAccounts } from "../src/auth/demo-accounts.js";
import { UserRepository } from "../src/auth/users.js";
import { openDatabase } from "../src/db/database.js";
import { seedDemoRecords, type SectionConcepts } from "../src/db/demo-records.js";

const concepts: SectionConcepts = Object.fromEntries(
  SECTIONS.map((s) => [s, Array.from({ length: 6 }, (_, i) => ({ id: `${s}_${i}`, name: `${s} 설비 ${i}` }))]),
);

async function seeded(seed: number) {
  const db = openDatabase(":memory:");
  const users = new UserRepository(db);
  await seedDemoAccounts(users);
  const outsider = await users.create({ username: "real_user", password: "password123", name: "실사용자", employee_no: "R1" });
  db.prepare("INSERT INTO misconceptions (id, user_id, section, concept_id, source, answer_text, summary, created_at) VALUES ('keep', ?, 'ironmaking', 'x', 'learning', 'a', 's', 'now')").run(outsider.id);
  const counts = seedDemoRecords(db, concepts, seed);
  return { db, counts };
}

test("seeded records follow the unlock order and scoring rules", async () => {
  for (const seed of [1, 2, 3, 42, 777]) {
    const { db } = await seeded(seed);
    const stats = traineeStats(db);
    for (const t of stats.trainees.filter((x) => x.username.startsWith("trainee"))) {
      // 앞 섹션을 통과해야 다음 섹션 기록이 있다.
      SECTIONS.forEach((s, i) => {
        if (i > 0 && t.sections[s]) assert.ok(t.sections[SECTIONS[i - 1]]?.passed, `${seed} ${t.username} ${s} before passing previous`);
        const stat = t.sections[s];
        if (stat) {
          assert.equal(stat.passed, stat.understanding >= 0.8, `${seed} ${t.username} ${s} passed vs understanding`);
          assert.ok(stat.attempts >= 1 && stat.attempts <= 3);
          assert.equal((stat.understanding * 12) % 1, 0); // 개념 6개 × 0.5점 단위
        }
      });
    }
    assert.ok(stats.trainees.find((t) => t.username === "trainee01")!.sections.ironmaking, `${seed} trainee01 has no ironmaking record`);
  }
});

test("the same seed gives the same records and reseeding replaces only demo trainees", async () => {
  const a = await seeded(42);
  const b = await seeded(42);
  const strip = (db: typeof a.db) => traineeStats(db).trainees.map(({ id, created_at, last_activity, ...rest }) => rest);
  assert.deepEqual(a.counts, b.counts);
  assert.deepEqual(strip(a.db), strip(b.db));

  seedDemoRecords(a.db, concepts, 7);
  const attemptsPerUser = a.db.prepare("SELECT COUNT(DISTINCT user_id) AS n FROM attempts").get();
  assert.ok(Number(attemptsPerUser?.n) <= 20);
  assert.ok(a.db.prepare("SELECT 1 FROM misconceptions WHERE id = 'keep'").get(), "other users' records were deleted");
});
