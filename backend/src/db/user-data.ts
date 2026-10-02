import type { DatabaseSync } from "node:sqlite";

export interface DeletedCounts {
  attempts: number;
  concept_results: number;
  attempt_messages: number;
  misconceptions: number;
  llm_usage: number;
  learning_turns: number;
}

/** 한 사용자의 체크포인트 기록·학습 대화·오개념·LLM 사용량을 모두 지운다(하나의 트랜잭션). */
export function deleteUserData(db: DatabaseSync, userId: string): DeletedCounts {
  const attemptsOf = "SELECT id FROM attempts WHERE user_id = ?";
  db.exec("BEGIN");
  try {
    const counts: DeletedCounts = {
      concept_results: Number(db.prepare(`DELETE FROM concept_results WHERE attempt_id IN (${attemptsOf})`).run(userId).changes),
      attempt_messages: Number(db.prepare(`DELETE FROM attempt_messages WHERE attempt_id IN (${attemptsOf})`).run(userId).changes),
      attempts: Number(db.prepare("DELETE FROM attempts WHERE user_id = ?").run(userId).changes),
      misconceptions: Number(db.prepare("DELETE FROM misconceptions WHERE user_id = ?").run(userId).changes),
      llm_usage: Number(db.prepare("DELETE FROM llm_usage WHERE user_id = ?").run(userId).changes),
      learning_turns: Number(db.prepare("DELETE FROM learning_turns WHERE user_id = ?").run(userId).changes),
    };
    db.exec("COMMIT");
    return counts;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function countUserData(db: DatabaseSync, userId: string): { attempts: number; misconceptions: number; learning_turns: number } {
  const one = (sql: string) => Number(db.prepare(sql).get(userId)?.n ?? 0);
  return {
    attempts: one("SELECT COUNT(*) AS n FROM attempts WHERE user_id = ?"),
    misconceptions: one("SELECT COUNT(*) AS n FROM misconceptions WHERE user_id = ?"),
    learning_turns: one("SELECT COUNT(*) AS n FROM learning_turns WHERE user_id = ?"),
  };
}
