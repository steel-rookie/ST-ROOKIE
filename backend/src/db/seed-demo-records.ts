// npm run db:seed-demo [seed]
// 시연 신입사원(trainee01~04)의 체크포인트 기록을 지우고 무작위로 다시 만든다. seed를 주면 같은 기록이 나온다.
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { seedDemoAccounts } from "../auth/demo-accounts.js";
import { UserRepository } from "../auth/users.js";
import { openDatabase } from "./database.js";
import { seedDemoRecords, type SectionConcepts } from "./demo-records.js";

const seed = process.argv[2] ? Number(process.argv[2]) : Math.floor(Math.random() * 1_000_000);
if (!Number.isInteger(seed)) throw new Error(`seed는 정수여야 합니다: ${process.argv[2]}`);

const data = await import(pathToFileURL(join(process.cwd(), "frontend", "3d-demo", "data_v2.js")).href);
const concepts: SectionConcepts = Object.fromEntries(
  (data.PROCESSES as { id: string; equipment: { id: string; name: string }[] }[]).map((p) => [p.id, p.equipment.map(({ id, name }) => ({ id, name }))]),
);

const db = openDatabase();
await seedDemoAccounts(new UserRepository(db));
const counts = seedDemoRecords(db, concepts, seed);
console.log(`시연 기록을 만들었습니다(seed ${seed}): 체크포인트 ${counts.attempts}회, 오개념 ${counts.misconceptions}개`);
