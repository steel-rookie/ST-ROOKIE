// 메인 페이지 체크포인트 채팅(frontend/3d-demo/checkpoint-chat.js)과 공용 요청(api-client.js).
// 브라우저 없이 가짜 fetch·저장소·페이지 컴포넌트로 돌리고 vals() 값만 확인한다.
import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const load = (file: string) => import(pathToFileURL(join(process.cwd(), "frontend", "3d-demo", file)).href);
const { createCheckpointChat } = await load("checkpoint-chat.js");
const { createApiClient, ApiError } = await load("api-client.js");
const { TEXT } = await load("tutor-text.js");

type Json = Record<string, unknown>;
type Reply = { status?: number; body?: unknown } | ((body: Json | undefined) => { status?: number; body?: unknown });

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    has: (k: string) => map.has(k),
  };
}

/** "METHOD /path" → 응답(배열이면 차례대로). 받은 요청을 calls에 남긴다. */
function fakeFetch(routes: Record<string, Reply | Reply[]>) {
  const calls: { key: string; headers: Record<string, string>; body: Json | undefined }[] = [];
  const queues = new Map(Object.entries(routes).map(([k, v]) => [k, Array.isArray(v) ? [...v] : v]));
  const fetch = async (path: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    const key = `${init.method} ${path}`;
    const body = init.body ? (JSON.parse(init.body) as Json) : undefined;
    calls.push({ key, headers: init.headers, body });
    const entry = queues.get(key);
    if (entry === undefined) throw new Error(`예상하지 않은 요청: ${key}`);
    const next = Array.isArray(entry) ? entry.shift() : entry;
    if (next === undefined) throw new Error(`응답을 다 썼음: ${key}`);
    const reply = typeof next === "function" ? next(body) : next;
    const status = reply.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => reply.body ?? {} };
  };
  return { fetch, calls, keys: () => calls.map((c) => c.key) };
}

/** 페이지 컴포넌트 흉내: state를 바로 합친다(함수 갱신 포함). v2처럼 체크포인트 키(cp...)를 미리 적지 않는다. */
function fakePage(processId: string) {
  const c = {
    state: { processId } as Json & { processId: string },
    setState(update: Json | ((s: Json) => Json)) {
      c.state = { ...c.state, ...(typeof update === "function" ? update(c.state) : update) };
    },
    data: { findProcess: (id: string) => ({ ironmaking: { name: "제선" }, steelmaking: { name: "제강" } } as Record<string, { name: string }>)[id] },
  };
  return c;
}

function setup(routes: Record<string, Reply | Reply[]>, { processId = "ironmaking", token = "tok", passcode = "" } = {}) {
  const local = memoryStorage({ ...(token ? { "st-rookie-token": token } : {}), ...(passcode ? { "st-rookie:passcode": passcode } : {}) });
  const session = memoryStorage();
  const net = fakeFetch(routes);
  const api = createApiClient({ fetch: net.fetch, local, session });
  const page = fakePage(processId);
  const chat = createCheckpointChat(page, { api });
  return { chat, page, net, local, vals: () => chat.vals() };
}

const progress = (section: string, extra: Json = {}) => ({
  body: { section, open: true, unlocked: false, understanding: null, retry_concept_ids: [], unconfirmed_concept_ids: [], in_progress_attempt_id: null, ...extra },
});
const notFound = { status: 404, body: { error: "루브릭이 없는 섹션입니다" } };
const otherSections = {
  "GET /api/sections/steelmaking/progress": notFound,
  "GET /api/sections/continuous_casting/progress": notFound,
  "GET /api/sections/rolling/progress": notFound,
};
const progressList = (statuses: string[]) => statuses.map((status, i) => ({ concept_id: `c${i + 1}`, status }));
const view = (state: string, extra: Json = {}) => ({
  attempt_id: "a1", section: "ironmaking", kind: "first", state, concept: null, tutor: [], progress: progressList(["pending", "pending", "pending"]), result: null, ...extra,
});
const concept = (index: number, name = `개념${index}`) => ({ id: `c${index}`, name, index, total: 3 });

test("시작 → 답변 → 재확인 → 결과: 단계 표시, 학습 잠금, 결과 막대, 공정 배지", async () => {
  const { chat, net, vals } = setup({
    "GET /api/sections/ironmaking/progress": [progress("ironmaking"), progress("ironmaking", { unlocked: true, understanding: 1 })],
    ...otherSections,
    "POST /api/checkpoints": { status: 201, body: view("awaiting_ready", { tutor: [{ type: "intro", text: "제선 질문 시작할게요, 준비됐나요?" }] }) },
    "POST /api/checkpoints/a1/messages": [
      { body: view("awaiting_answer", { concept: concept(1, "소결의 목적"), progress: progressList(["current", "pending", "pending"]), tutor: [{ type: "question", text: "Q1" }] }) },
      { body: view("awaiting_recheck", { concept: concept(1, "소결의 목적"), progress: progressList(["current", "pending", "pending"]), tutor: [{ type: "explanation", text: "설명" }, { type: "recheck_question", text: "R1" }] }) },
      { body: view("completed", {
        progress: progressList(["done", "done", "done"]),
        tutor: [{ type: "feedback", text: "맞아요" }, { type: "result", text: "결과" }],
        result: { understanding: 1, unlocked: true, threshold: 0.8, retry_concept_ids: [], concepts: [
          { concept_id: "c1", name: "소결의 목적", score: 1, final_verdict: "correct" },
          { concept_id: "c2", name: "코크스", score: 0.5, final_verdict: "partial" },
          { concept_id: "c3", name: "고로", score: 0, final_verdict: "wrong" },
        ] },
      }) },
    ],
  });

  await chat.refreshAll();
  let v = vals();
  assert.equal(v.cpShowEntry, true);
  assert.equal(v.cpEntryStatus, TEXT.entry.notStarted);
  assert.equal(v.cpCanStart, true);
  assert.equal(v.cpStartLabel, TEXT.buttons.start);
  assert.deepEqual(v.cpSections.map((s: Json) => s.badge), [TEXT.badges.notPassed, null, null, null]);
  assert.equal(v.cpLearningLocked, false);

  await chat.start();
  v = vals();
  assert.equal(v.cpShowRunning, true);
  assert.equal(v.cpStageLabel, TEXT.stage.ready);
  assert.equal(v.cpShowReadyButton, true);
  assert.equal(v.cpLearningLocked, true);
  assert.equal(v.cpLearningLockedText, TEXT.learningLocked);
  assert.equal(v.cpMessages[0].label, TEXT.messageLabels.intro);

  await chat.ready();
  v = vals();
  assert.equal(v.cpStageLabel, "개념 1/3");
  assert.equal(v.cpConceptName, "소결의 목적");
  assert.equal(v.cpIsRecheck, false);
  assert.equal(v.cpShowReadyButton, false);

  v.onCpInput({ target: { value: "  몰라  " } });
  await vals().onCpSend({ preventDefault() {} });
  v = vals();
  assert.equal(v.cpStageLabel, "개념 1/3 · 재확인");
  assert.equal(v.cpIsRecheck, true);
  assert.equal(v.cpInput, "", "보낸 뒤 입력창을 비운다");
  const recheck = v.cpMessages.at(-1);
  assert.equal(recheck.isRecheck, true);
  assert.equal(recheck.label, TEXT.messageLabels.recheck_question);
  assert.deepEqual(v.cpMessages.slice(-3).map((m: Json) => m.isUser), [true, false, false]);
  assert.equal(v.cpMessages.at(-3).text, "몰라", "앞뒤 공백을 지우고 보낸다");

  await chat.send("소결광으로 만든다");
  v = vals();
  assert.equal(v.cpShowRunning, false);
  assert.equal(v.cpShowResult, true);
  assert.equal(v.cpShowComposer, false);
  assert.equal(v.cpLearningLocked, false);
  assert.equal(v.cpStageLabel, TEXT.stage.done);
  assert.equal(v.cpResult.percent, 100);
  assert.equal(v.cpResult.thresholdPercent, 80);
  assert.equal(v.cpResult.passed, true);
  assert.equal(v.cpResult.passLabel, TEXT.result.nextNotReady, "제강 루브릭이 없으면(404) 준비 중");
  assert.deepEqual(v.cpResult.bars.map((b: Json) => [b.verdictLabel, b.widthPercent, b.tone]), [["맞음", 100, "ok"], ["부분", 50, "warn"], ["틀림", 3, "danger"]]);
  assert.equal(v.cpSections[0].badge, TEXT.badges.passed, "끝나면 진입 상태를 다시 읽어 배지를 바꾼다");
  assert.equal(v.cpSections[0].passed, true);

  assert.deepEqual(net.calls.filter((c) => c.key.startsWith("POST")).map((c) => c.body), [
    { section: "ironmaking" }, { text: TEXT.buttons.ready }, { text: "몰라" }, { text: "소결광으로 만든다" },
  ]);

  chat.close();
  v = vals();
  assert.equal(v.cpShowEntry, true);
  assert.equal(v.cpEntryStatus, TEXT.entry.passed(100));
  assert.equal(v.cpCanStart, false, "통과한 섹션은 다시 시작하지 않는다");
});

test("새로고침 복원: 진행 중인 시도가 있으면 기록과 함께 이어서 연다", async () => {
  const { chat, vals } = setup({
    "GET /api/sections/ironmaking/progress": progress("ironmaking", { in_progress_attempt_id: "a1" }),
    ...otherSections,
    "GET /api/checkpoints/a1": { body: view("awaiting_recheck", {
      concept: concept(2), progress: progressList(["done", "current", "pending"]),
      history: [
        { role: "tutor", type: "question", text: "Q2" },
        { role: "user", type: null, text: "답" },
        { role: "tutor", type: "recheck_question", text: "R2" },
      ],
    }) },
  }, { processId: "site" });

  await chat.refreshAll();
  const v = vals();
  assert.equal(v.cpShowRunning, true, "전체 보기(site)여도 진행 중인 시도는 연다");
  assert.equal(v.cpStageLabel, "개념 2/3 · 재확인");
  assert.deepEqual(v.cpMessages.map((m: Json) => m.text), ["Q2", "답", "R2"]);
  assert.deepEqual(v.cpDots.map((d: Json) => d.status), ["done", "current", "pending"]);
  assert.equal(v.cpLearningLocked, true);
  assert.equal(v.cpTitle, "이해도 확인 · 제선");
});

test("채점 오류 → 다시 채점하기", async () => {
  const { chat, net, vals } = setup({
    "GET /api/sections/ironmaking/progress": progress("ironmaking", { in_progress_attempt_id: "a1" }),
    "GET /api/checkpoints/a1": { body: view("awaiting_answer", { concept: concept(1), history: [{ role: "tutor", type: "question", text: "Q1" }] }) },
    "POST /api/checkpoints/a1/messages": { body: view("error", { concept: concept(1), tutor: [{ type: "error", text: "채점하지 못했어요" }] }) },
    "POST /api/checkpoints/a1/retry-evaluation": { body: view("awaiting_recheck", { concept: concept(1), tutor: [{ type: "explanation", text: "설명" }, { type: "recheck_question", text: "R1" }] }) },
  });

  await chat.refresh();
  await chat.send("답변");
  let v = vals();
  assert.equal(v.cpState, "error");
  assert.equal(v.cpStageLabel, `개념 1/3 · ${TEXT.stage.error}`);
  assert.equal(v.cpShowRetryButton, true);
  assert.equal(v.cpInputDisabled, true);
  assert.equal(v.cpPlaceholder, TEXT.placeholder.error);
  assert.equal(v.cpMessages.at(-1).isError, true);

  await v.onCpRetry();
  v = vals();
  assert.equal(v.cpState, "awaiting_recheck");
  assert.equal(v.cpShowRetryButton, false);
  assert.equal(net.calls.at(-1)!.key, "POST /api/checkpoints/a1/retry-evaluation");
  assert.deepEqual(net.calls.at(-1)!.body, {});
});

test("401 로그인 만료: 토큰을 지우고 로그인 안내, 입력은 남긴다", async () => {
  const { chat, page, local, vals } = setup({
    "GET /api/sections/ironmaking/progress": progress("ironmaking", { in_progress_attempt_id: "a1" }),
    "GET /api/checkpoints/a1": { body: view("awaiting_answer", { concept: concept(1), history: [] }) },
    "POST /api/checkpoints/a1/messages": { status: 401, body: { error: "만료", code: "TOKEN_INVALID" } },
  });
  await chat.refresh();
  page.setState({ cpInput: "내 답변" });
  await chat.send("내 답변");
  const v = vals();
  assert.equal(v.cpNotice, TEXT.errors.tokenInvalid);
  assert.equal(v.cpHasNotice, true);
  assert.equal(v.cpNeedsLogin, true);
  assert.equal(local.has("st-rookie-token"), false);
  assert.equal(v.cpInput, "내 답변");
  assert.equal(v.cpMessages.length, 0, "실패한 답변은 메시지에 붙이지 않는다");
  assert.equal(v.cpPending, false);
});

test("429 사용량 초과: 통일된 안내, 다시 보낼 수 있다", async () => {
  const { chat, vals } = setup({
    "GET /api/sections/ironmaking/progress": progress("ironmaking", { in_progress_attempt_id: "a1" }),
    "GET /api/checkpoints/a1": { body: view("awaiting_answer", { concept: concept(1), history: [] }) },
    "POST /api/checkpoints/a1/messages": [
      { status: 429, body: { error: "오늘 쓸 수 있는 튜터 호출(150회)을 다 썼어요.", code: "USAGE_LIMIT" } },
      { body: view("awaiting_answer", { concept: concept(2), tutor: [{ type: "feedback", text: "맞아요" }, { type: "question", text: "Q2" }] }) },
    ],
  });
  await chat.refresh();
  await chat.send("답");
  assert.equal(vals().cpNotice, TEXT.errors.usageLimit);
  assert.equal(vals().cpNeedsLogin, false);
  await chat.send("답");
  assert.equal(vals().cpNotice, "");
  assert.equal(vals().cpStageLabel, "개념 2/3");
});

test("전체 보기(site)와 로그인 전에는 시작하지 않고 요청도 보내지 않는다", async () => {
  const site = setup({}, { processId: "site" });
  await site.chat.refresh();
  await site.chat.start();
  assert.equal(site.vals().cpCanStart, false);
  assert.equal(site.vals().cpEntryStatus, TEXT.entry.site);
  assert.equal(site.vals().cpEntrySectionName, "");
  assert.deepEqual(site.net.keys(), []);

  const guest = setup({}, { token: "" });
  await guest.chat.refreshAll();
  await guest.chat.start();
  assert.equal(guest.vals().cpNeedsLogin, true);
  assert.equal(guest.vals().cpCanStart, false);
  assert.equal(guest.vals().cpEntryStatus, TEXT.entry.login);
  assert.deepEqual(guest.net.keys(), []);
});

test("진입 상태: 준비 중(404), 잠김, 재도전, 409는 서버 문장", async () => {
  const s = setup({
    "GET /api/sections/ironmaking/progress": [progress("ironmaking", { retry_concept_ids: ["c2", "c3"] }), progress("ironmaking", { unlocked: true, understanding: 0.83 })],
    "GET /api/sections/steelmaking/progress": progress("steelmaking", { open: false }),
    "GET /api/sections/continuous_casting/progress": notFound,
    "GET /api/sections/rolling/progress": { status: 500, body: {} },
    "POST /api/checkpoints": { status: 409, body: { error: "이미 통과한 섹션입니다." } },
  });
  await s.chat.refreshAll();
  assert.equal(s.vals().cpEntryStatus, TEXT.entry.retry(2));
  assert.equal(s.vals().cpStartLabel, TEXT.buttons.retryAttempt);
  assert.equal(s.chat.tabLocked("steelmaking"), false, "LOCK_PROCESS_TABS 기본값은 꺼짐");
  assert.deepEqual(s.vals().cpSections.map((x: Json) => x.badge), [TEXT.badges.notPassed, TEXT.badges.notPassed, null, null]);

  s.page.setState({ processId: "steelmaking" });
  assert.equal(s.vals().cpEntryStatus, TEXT.entry.locked);
  assert.equal(s.vals().cpCanStart, false);
  s.page.setState({ processId: "continuous_casting" });
  assert.equal(s.vals().cpEntryStatus, TEXT.entry.notReady);
  s.page.setState({ processId: "rolling" });
  assert.equal(s.vals().cpEntryStatus, TEXT.entry.offline);

  s.page.setState({ processId: "ironmaking" });
  await s.chat.start();
  assert.equal(s.vals().cpNotice, "이미 통과한 섹션입니다.");
  assert.equal(s.vals().cpEntryStatus, TEXT.entry.passed(83), "실패하면 진입 상태를 다시 읽는다");
});

test("api-client: 토큰·접속 비밀번호 헤더, X-User-Id 없음, 오류 문장 통일", async () => {
  const net = fakeFetch({
    "GET /ok": { body: { a: 1 } },
    "POST /bad": [{ status: 502, body: { error: "x" } }, { status: 503, body: {} }, { status: 401, body: { code: "PASSCODE_REQUIRED" } }, { status: 401, body: {} }],
  });
  const local = memoryStorage({ "st-rookie:passcode": "비번 1" });
  const session = memoryStorage({ "st-rookie-token": "sess" });
  const api = createApiClient({ fetch: net.fetch, local, session });

  assert.equal(api.hasToken(), true, "sessionStorage 토큰도 읽는다");
  assert.deepEqual(await api.request("GET", "/ok"), { a: 1 });
  assert.deepEqual(net.calls[0]!.headers, { Authorization: "Bearer sess", "X-Test-Passcode": encodeURIComponent("비번 1") });

  const messages = [];
  for (let i = 0; i < 4; i++) {
    const error = await api.request("POST", "/bad", {}).catch((e: Error) => e);
    assert.ok(error instanceof ApiError);
    messages.push(error.message);
  }
  assert.deepEqual(messages, [TEXT.errors.server, TEXT.errors.server, TEXT.errors.passcode, TEXT.errors.loginRequired]);
  assert.equal(net.calls[1]!.headers["Content-Type"], "application/json");
  assert.equal(api.hasToken(), true, "TOKEN_INVALID가 아니면 토큰을 지우지 않는다");

  const offline = createApiClient({ fetch: async () => { throw new TypeError("fetch failed"); }, local: memoryStorage(), session: memoryStorage() });
  const error = await offline.request("GET", "/x").catch((e: Error) => e);
  assert.equal(error.status, 0);
  assert.equal(error.message, TEXT.errors.network);

  api.setPasscode("새 비번");
  assert.equal(local.getItem("st-rookie:passcode"), "새 비번");
  api.setPasscode("");
  assert.equal(local.has("st-rookie:passcode"), false);
});
