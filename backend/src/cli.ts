// 프론트엔드 없이 터미널에서 에이전트를 시험하는 도구.
// 화면 동작은 모두 성공했다고 가정하고 다음 턴에 결과를 돌려준다.
import { createInterface } from "node:readline/promises";
import { runTurn, ScreenInput } from "../../llm/src/agent.js";
import { createSession } from "./session.js";

const HELP = `명령어:
  /screen <process_id|none> [equipment_id]   화면 상태 변경 (예: /screen ironmaking blast_furnace)
  /mode <guided|free_question|quiz>          학습 모드 변경
  /step <id> <학습 목표>                     가이드 학습 단계 설정
  /records                                   학습 기록 보기
  /quit                                      종료`;

const session = createSession("cli-learner");
let screen: ScreenInput = {
  process_id: "ironmaking",
  equipment_id: null,
  learning_mode: "free_question",
  learning_step: null,
  last_scene_action_results: [],
};

const rl = createInterface({ input: process.stdin, output: process.stdout });
console.log(HELP);

while (true) {
  const line = (await rl.question(`\n[${screen.process_id ?? "공정 지도"}/${screen.equipment_id ?? "-"}/${screen.learning_mode}] > `)).trim();
  if (!line) continue;

  if (line.startsWith("/")) {
    const [command, ...args] = line.split(/\s+/);
    try {
      if (command === "/quit") break;
      else if (command === "/screen") {
        screen = ScreenInput.parse({
          ...screen,
          process_id: args[0] === "none" ? null : args[0],
          equipment_id: args[1] ?? null,
        });
      } else if (command === "/mode") {
        screen = ScreenInput.parse({ ...screen, learning_mode: args[0] });
      } else if (command === "/step") {
        screen = { ...screen, learning_step: { id: args[0]!, objective: args.slice(1).join(" ") } };
      } else if (command === "/records") {
        console.log(JSON.stringify(session.learningRecords, null, 2));
      } else console.log(HELP);
    } catch (error) {
      console.log(`입력 오류: ${(error as Error).message}`);
    }
    continue;
  }

  try {
    const { response, dropped, usage } = await runTurn(session, line, screen);
    console.log(`\n${response.answer}`);
    if (response.follow_up_question) console.log(`\n❓ ${response.follow_up_question}`);
    if (response.citations.length) {
      console.log(`\n📄 ${response.citations.map((c) => `${c.title}${c.page ? ` p.${c.page}` : ""}`).join(", ")}`);
    }
    if (response.scene_actions.length) {
      console.log(`🎬 ${response.scene_actions.map((a) => `${a.type}:${a.target_id}`).join(", ")}`);
    }
    console.log(
      `   (mode=${response.mode}, evidence=${response.evidence_status}, clarify=${response.needs_clarification}, ` +
        `in=${usage.input_tokens} cached=${usage.cache_read_input_tokens} out=${usage.output_tokens})`,
    );
    if (dropped.citations.length || dropped.scene_actions.length) {
      console.log(`   ⚠ 걸러냄: ${JSON.stringify(dropped)}`);
    }
    screen = {
      ...screen,
      last_scene_action_results: response.scene_actions.map((a) => ({ ...a, status: "succeeded" as const })),
    };
    const goto = response.scene_actions.findLast((a) => a.type === "goto_process");
    if (goto) screen = { ...screen, process_id: goto.target_id, equipment_id: null };
  } catch (error) {
    console.log(`오류: ${(error as Error).message}`);
  }
}

rl.close();
