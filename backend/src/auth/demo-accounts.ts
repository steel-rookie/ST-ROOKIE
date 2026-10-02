// 시연용 계정. 로그인 화면의 일반 사용자/관리자 토글이 목록을 받아 아이디·비밀번호 칸을 채운다.
// .env의 DEMO_ACCOUNTS=off면 만들지도, 목록을 내주지도 않는다.
import type { Role, UserRepository } from "./users.js";

export interface DemoAccount {
  username: string;
  role: Role;
  name: string;
  employee_no: string;
}

export const DEMO_ACCOUNTS: DemoAccount[] = [
  { username: "trainee01", role: "trainee", name: "김신입", employee_no: "T2026001" },
  { username: "trainee02", role: "trainee", name: "이신입", employee_no: "T2026002" },
  { username: "trainee03", role: "trainee", name: "박신입", employee_no: "T2026003" },
  { username: "trainee04", role: "trainee", name: "최신입", employee_no: "T2026004" },
  { username: "admin01", role: "admin", name: "관리자", employee_no: "A2026001" },
];

const DEFAULT_DEMO_PASSWORD = "steel-2026-demo";

export const demoAccountsEnabled = () => process.env.DEMO_ACCOUNTS?.trim().toLowerCase() !== "off";
export const demoPassword = () => process.env.DEMO_PASSWORD?.trim() || DEFAULT_DEMO_PASSWORD;

/** 없는 시연 계정만 만든다. 이미 있는 계정의 비밀번호는 바꾸지 않는다. */
export async function seedDemoAccounts(users: UserRepository): Promise<number> {
  if (!demoAccountsEnabled()) return 0;
  let created = 0;
  for (const account of DEMO_ACCOUNTS) {
    if (users.exists(account.username)) continue;
    await users.create({ ...account, password: demoPassword() });
    created++;
  }
  return created;
}
