// 특정 사용자의 기록 삭제: npm run db:reset-user -- 이름 [--yes]
// 체크포인트 시도·답변·대화 기록·오개념·하루 LLM 사용량을 지운다. --yes가 없으면 지우기 전에 한 번 묻는다.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { openDatabase } from "./database.js";
import { countUserData, deleteUserData } from "./user-data.js";

const args = process.argv.slice(2);
const yes = args.includes("--yes");
const name = args.find((a) => a !== "--yes")?.normalize("NFC").trim();
if (!name) {
  console.error("사용법: npm run db:reset-user -- 이름 [--yes]");
  process.exit(1);
}

const path = process.env.DB_PATH || join(process.cwd(), "data", "st-rookie.sqlite");
if (!existsSync(path)) {
  console.error(`DB 파일이 없습니다: ${path}`);
  process.exit(1);
}
const db = openDatabase(path);
const before = countUserData(db, name);
if (before.attempts === 0 && before.misconceptions === 0) {
  console.log(`'${name}'의 기록이 없습니다. (${path})`);
  process.exit(0);
}

console.log(`'${name}'의 체크포인트 시도 ${before.attempts}개, 오개념 ${before.misconceptions}개를 지웁니다. (${path})`);
if (!yes) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question("계속할까요? (y/N) ")).trim().toLowerCase();
  rl.close();
  if (answer !== "y") {
    console.log("지우지 않았습니다.");
    process.exit(0);
  }
}
const deleted = deleteUserData(db, name);
console.log(`삭제 완료: 시도 ${deleted.attempts}, 개념 결과 ${deleted.concept_results}, 대화 ${deleted.attempt_messages}, 오개념 ${deleted.misconceptions}, 사용량 ${deleted.llm_usage}`);
