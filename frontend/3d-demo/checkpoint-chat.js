// 체크포인트(이해도 확인) 채팅(최종 페이지 Steel Academy v3.dc.html, 이전 페이지 v2도 같이 씀). 설계: docs/checkpoint-integration.md
// - checkpoint-test.html의 진행 로직(진입 상태, 시작, 답변, 재채점, 새로고침 복원, 결과)을 화면 코드 없이 옮겼다.
// - learning-chat.js와 같은 방식: 페이지 컴포넌트(c)의 state·setState를 쓰고, 화면 값은 vals()로 돌려준다.
//   DOM은 쓰지 않는다. 상태 키와 vals() 키는 학습 모드와 겹치지 않게 cp로 시작한다.
// - 섹션은 현재 공정(c.state.processId)이다. 전체 보기('site')에서는 시작할 수 없다.
//   시작한 시도는 끝날 때까지 공정을 옮겨도 그대로 보여 준다(3D는 계속 볼 수 있다).
// - 진행 중에는 학습 입력을 막는다: lockLearning()이 학습 모드 값(learning-chat.js의 vals)에서 보내기·추천 질문을 끄고,
//   runLearning()이 페이지의 ask()(설비 패널 '튜터에게 묻기')를 막는다. learning-chat.js는 고치지 않는다.
// - 튜터 패널의 모드 탭(학습 | 이해도 확인)도 여기서 다룬다. 모드는 페이지 state.tutorMode('learning' | 'checkpoint', 없으면 learning).
// - API: docs/checkpoint-api.md. 요청은 api-client.js(로그인 토큰·접속 비밀번호·오류 문장).

import { createApiClient } from './api-client.js';
import { TEXT } from './tutor-text.js';

/** 섹션 순서(backend/src/checkpoint/types.ts의 SECTION_ORDER와 같다). */
export const SECTIONS = ['ironmaking', 'steelmaking', 'continuous_casting', 'rolling'];

/** true면 앞 공정을 통과하지 못한 공정 탭을 잠근다(tabLocked). 기본은 꺼짐: 체크포인트만 잠그고 탭은 배지만 보인다. */
export const LOCK_PROCESS_TABS = false;

/** 체크포인트 상태 키와 초기값. 페이지 state에 없으면 이 값으로 본다(페이지가 미리 적지 않아도 된다). */
export const CHECKPOINT_STATE = {
  cpView: null,      // 서버 CheckpointView(진행 중이거나 막 끝난 시도). null이면 진입 화면
  cpMessages: [],    // { role: 'tutor' | 'user', type, text }
  cpInput: '',
  cpPending: false,
  cpNotice: '',
  cpProgress: {},    // 섹션 → SectionProgressView | { unavailable: true, status }
};

const ANSWERING = ['awaiting_ready', 'awaiting_answer', 'awaiting_recheck'];
const VERDICT_TONE = { correct: 'ok', partial: 'warn', wrong: 'danger' };
// 페이지(v2·v3)에 --ok 변수가 없어서 기본색을 함께 준다.
const TONE_COLOR = { ok: 'var(--ok, #2f9e44)', warn: 'var(--warn, #e8590c)', danger: 'var(--danger)' };
const ACCENT = 'var(--accent)';
const MODES = ['learning', 'checkpoint'];

const percent = (ratio) => Math.round((ratio ?? 0) * 100);
const asMessages = (utterances) => utterances.map((u) => ({ role: 'tutor', type: u.type, text: u.text }));

/**
 * 페이지 컴포넌트에 붙일 체크포인트 채팅을 만든다. componentDidMount에서 한 번 부르고, refreshAll()로 진입 상태를 읽는다.
 * @param c 페이지 컴포넌트: state(processId, tutorMode), setState, data(findProcess). 선택: scrollCheckpoint()(없으면 scrollChat())
 * @param {{ api?: ReturnType<typeof createApiClient> }} [options]
 */
export function createCheckpointChat(c, { api = createApiClient() } = {}) {
  // v2 페이지의 state는 이 모듈을 불러오기 전에 만들어지므로 체크포인트 키가 없을 수 있다.
  const withDefaults = (s) => ({ ...CHECKPOINT_STATE, ...s });
  const S = () => withDefaults(c.state);
  const sectionName = (id) => c.data?.findProcess?.(id)?.name ?? id;
  const scroll = () => (c.scrollCheckpoint ?? c.scrollChat)?.call(c);
  const mode = () => (MODES.includes(c.state.tutorMode) ? c.state.tutorMode : 'learning');
  // 요청 중복을 막는 표시. setState는 바로 반영되지 않을 수 있어서 state(cpPending)와 따로 둔다.
  let busy = false;

  /** 섹션 진입 상태. 루브릭이 없는 섹션은 404(unavailable)다. */
  async function loadProgress(section) {
    let p;
    try {
      p = await api.request('GET', `/api/sections/${section}/progress`);
    } catch (e) {
      p = { unavailable: true, status: e.status ?? 0 };
    }
    c.setState((s) => ({ cpProgress: { ...withDefaults(s).cpProgress, [section]: p } }));
    return p;
  }

  /** 진행 중인 시도가 있으면 이어서 연다(새로고침 복원). 이미 보고 있는 시도가 있으면 그대로 둔다. progresses는 loadProgress 결과. */
  async function resumeOpenAttempt(progresses) {
    const open = progresses.find((p) => p?.in_progress_attempt_id);
    if (!open || busy || S().cpView) return;
    busy = true;
    c.setState({ cpPending: true });
    try {
      const view = await api.request('GET', `/api/checkpoints/${open.in_progress_attempt_id}`);
      enter(view, view.history || []);
      // 새로고침으로 이어서 열면 튜터 패널을 이해도 확인 탭으로 둔다.
      c.setState({ tutorMode: 'checkpoint' });
    } catch (e) {
      c.setState({ cpNotice: e.message });
    } finally {
      busy = false;
      c.setState({ cpPending: false });
    }
  }

  function enter(view, history) {
    c.setState({ cpView: view, cpMessages: history.map((m) => ({ role: m.role, type: m.type, text: m.text })), cpNotice: '', cpInput: '' });
    scroll();
  }

  /** 진입 화면에 보여 줄 섹션 상태와 시작 버튼. */
  function entryFor(section) {
    if (!SECTIONS.includes(section)) return { status: TEXT.entry.site, canStart: false, startLabel: '' };
    if (!api.hasToken()) return { status: TEXT.entry.login, canStart: false, startLabel: '' };
    const p = S().cpProgress[section];
    if (!p) return { status: TEXT.entry.checking, canStart: false, startLabel: '' };
    if (p.unavailable) return { status: p.status === 404 ? TEXT.entry.notReady : TEXT.entry.offline, canStart: false, startLabel: '' };
    if (!p.open) return { status: TEXT.entry.locked, canStart: false, startLabel: '' };
    if (p.unlocked) return { status: TEXT.entry.passed(percent(p.understanding)), canStart: false, startLabel: '', passed: true };
    if (p.in_progress_attempt_id) return { status: TEXT.entry.inProgress, canStart: true, startLabel: TEXT.buttons.resume };
    if (p.retry_concept_ids?.length) return { status: TEXT.entry.retry(p.retry_concept_ids.length), canStart: true, startLabel: TEXT.buttons.retryAttempt };
    return { status: TEXT.entry.notStarted, canStart: true, startLabel: TEXT.buttons.start };
  }

  /** 시도 진행(답변, 재채점). 서버가 저장한 뒤에만 사용자 메시지를 붙인다. 실패하면 입력이 남아 다시 보낼 수 있다. */
  async function call(action, text) {
    const cp = S().cpView;
    if (!cp || busy) return;
    busy = true;
    c.setState({ cpPending: true, cpNotice: '' });
    try {
      const view = await api.request('POST', `/api/checkpoints/${cp.attempt_id}/${action}`, text === undefined ? {} : { text });
      const user = text === undefined ? [] : [{ role: 'user', type: null, text }];
      c.setState((s) => ({
        cpView: view,
        cpMessages: [...withDefaults(s).cpMessages, ...user, ...asMessages(view.tutor)],
        ...(text === undefined ? {} : { cpInput: '' }),
      }));
      scroll();
      if (view.state === 'completed') {
        // 통과 문구에 다음 섹션이 열렸는지(루브릭이 있는지) 반영하려고 다음 섹션도 다시 읽는다.
        const next = SECTIONS[SECTIONS.indexOf(view.section) + 1];
        await Promise.all([loadProgress(view.section), next && loadProgress(next)]);
      }
    } catch (e) {
      c.setState({ cpNotice: e.message });
    } finally {
      busy = false;
      c.setState({ cpPending: false });
    }
  }

  function stageLabel(cp) {
    if (cp.state === 'awaiting_ready') return cp.kind === 'retry' ? TEXT.stage.retryReady : TEXT.stage.ready;
    if (cp.state === 'completed') return TEXT.stage.done;
    if (!cp.concept) return '';
    const concept = TEXT.stage.concept(cp.concept.index, cp.concept.total);
    if (cp.state === 'awaiting_recheck') return `${concept} · ${TEXT.stage.recheck}`;
    if (cp.state === 'error') return `${concept} · ${TEXT.stage.error}`;
    return concept;
  }

  function resultVals(cp) {
    const r = cp.result;
    if (!r) return null;
    const threshold = percent(r.threshold ?? 0.8);
    const next = SECTIONS[SECTIONS.indexOf(cp.section) + 1];
    const nextProgress = next ? S().cpProgress[next] : null;
    const nextReady = !!next && !(nextProgress?.unavailable && nextProgress.status === 404);
    return {
      understandingLabel: TEXT.result.understanding,
      percent: percent(r.understanding),
      thresholdPercent: threshold,
      thresholdLabel: TEXT.result.threshold(threshold),
      passed: r.unlocked,
      tone: r.unlocked ? 'ok' : 'warn',
      color: TONE_COLOR[r.unlocked ? 'ok' : 'warn'],
      passLabel: !r.unlocked ? TEXT.result.failed(threshold)
        : !next ? TEXT.result.allDone
        : nextReady ? TEXT.result.nextOpened(sectionName(next)) : TEXT.result.nextNotReady,
      bars: r.concepts.map((k) => {
        const verdict = k.final_verdict ?? 'wrong';
        const tone = VERDICT_TONE[verdict] ?? 'danger';
        const verdictLabel = TEXT.verdicts[verdict] ?? TEXT.verdicts.wrong;
        return {
          conceptId: k.concept_id, name: k.name, verdict, verdictLabel, score: k.score,
          label: TEXT.result.score(verdictLabel, k.score),
          // 0점도 막대가 보이게 최소 3%.
          widthPercent: Math.max(k.score * 100, 3),
          tone, color: TONE_COLOR[tone],
        };
      }),
    };
  }

  const chat = {
    /** 한 섹션의 진입 상태를 다시 읽고, 진행 중인 시도가 있으면 연다. 공정을 옮길 때 부른다. */
    async refresh(section = S().processId) {
      if (!SECTIONS.includes(section) || !api.hasToken()) return;
      await resumeOpenAttempt([await loadProgress(section)]);
    },

    /** 모든 섹션의 진입 상태(공정 탭 배지)를 읽고, 진행 중인 시도가 있으면 연다. 페이지를 열 때 부른다. */
    async refreshAll() {
      if (!api.hasToken()) return;
      await resumeOpenAttempt(await Promise.all(SECTIONS.map(loadProgress)));
    },

    /** 현재 공정의 이해도 확인을 시작한다(진행 중인 시도가 있으면 서버가 이어서 준다). */
    async start() {
      const section = S().processId;
      if (busy || S().cpView || !entryFor(section).canStart) return;
      busy = true;
      c.setState({ cpPending: true, cpNotice: '' });
      try {
        const view = await api.request('POST', '/api/checkpoints', { section });
        enter(view, view.history || asMessages(view.tutor));
      } catch (e) {
        c.setState({ cpNotice: e.message });
        await loadProgress(section);
      } finally {
        busy = false;
        c.setState({ cpPending: false });
      }
    },

    /** 답변을 보낸다. 준비·답변·재확인 단계에서만 보낸다. */
    send(text) {
      text = (text || '').trim();
      if (text && ANSWERING.includes(S().cpView?.state)) return call('messages', text);
    },

    /** '준비됐어요' 버튼. */
    ready() { return chat.send(TEXT.buttons.ready); },

    /** 채점 오류(state=error) 뒤 같은 답변을 다시 채점한다. */
    retry() { if (S().cpView?.state === 'error') return call('retry-evaluation'); },

    /** 결과 화면을 닫고 진입 화면으로 돌아간다. 끝난 시도만 닫을 수 있다(진행 중에는 학습 입력을 막아 둔다). */
    close() {
      if (S().cpView?.state !== 'completed') return;
      c.setState({ cpView: null, cpMessages: [], cpNotice: '', cpInput: '' });
    },

    /** 진행 중인 시도가 있는지. 있으면 학습 입력을 막는다. */
    isActive() { const cp = S().cpView; return !!cp && cp.state !== 'completed'; },

    /** LOCK_PROCESS_TABS가 켜져 있고 앞 공정을 통과하지 못해 열리지 않은 공정인지. */
    tabLocked(section) {
      const p = S().cpProgress[section];
      return LOCK_PROCESS_TABS && !!p && !p.unavailable && !p.open;
    },

    /** 튜터 패널 모드 탭을 바꾼다. 이해도 확인 탭을 열면 현재 공정의 진입 상태를 다시 읽는다. */
    setMode(next) {
      if (!MODES.includes(next)) return;
      c.setState({ tutorMode: next });
      if (next === 'checkpoint') chat.refresh();
      scroll();
    },

    /** 페이지의 학습 질문(ask)을 감싼다. 체크포인트 진행 중이면 보내지 않고, 아니면 학습 탭으로 바꾼 뒤 보낸다. */
    runLearning(send) {
      if (chat.isActive()) return;
      if (mode() !== 'learning') c.setState({ tutorMode: 'learning' });
      return send();
    },

    /** 학습 모드 템플릿 값(learning-chat.js의 vals)에 잠금을 씌운다. 진행 중이면 보내기·추천 질문·'생각해 보기'를 끈다. */
    lockLearning(learning) {
      if (!chat.isActive()) return learning;
      return {
        ...learning,
        chips: [],
        send: (e) => { e?.preventDefault?.(); },
        messages: (learning.messages ?? []).map((m) => ({ ...m, hasFollowUp: false })),
      };
    },

    /** 공정 탭 배지 값(페이지 steps 항목에 펼친다). 루브릭이 없거나 아직 못 읽은 공정은 배지 없음. */
    sectionBadge(section) {
      const p = S().cpProgress[section];
      const known = !!p && !p.unavailable;
      const passed = known && !!p.unlocked;
      return {
        cpHasBadge: known,
        cpBadge: !known ? '' : passed ? TEXT.badges.passed : TEXT.badges.notPassed,
        cpBadgeColor: passed ? TONE_COLOR.ok : 'var(--muted)',
        cpTabLocked: chat.tabLocked(section),
      };
    },

    /** 튜터 패널(이해도 확인 탭)과 공정 탭 배지 템플릿 값. 키 설명은 docs/checkpoint-integration.md. */
    vals() {
      const st = S();
      const cp = st.cpView;
      const state = cp?.state ?? null;
      const entry = entryFor(st.processId);
      const answering = ANSWERING.includes(state);
      const result = cp && state === 'completed' ? resultVals(cp) : null;
      const current = mode();
      return {
        // 튜터 패널 모드 탭
        cpTabLearningLabel: TEXT.tabs.learning,
        cpTabCheckpointLabel: TEXT.tabs.checkpoint,
        cpTabs: MODES.map((id) => ({
          id, label: TEXT.tabs[id], active: id === current, onClick: () => chat.setMode(id),
          // 선택된 탭 배경: #50 화면의 --chrome3, 없으면 --panel2.
          bg: id === current ? 'var(--chrome3, var(--panel2))' : 'transparent', color: id === current ? 'var(--text)' : 'var(--muted)',
          weight: id === current ? '700' : '500',
        })),
        cpIsLearningTab: current === 'learning',
        cpIsCheckpointTab: current === 'checkpoint',
        cpHeaderMode: TEXT.header[current],

        // 공정 탭 배지
        cpSections: SECTIONS.map((id) => {
          const p = st.cpProgress[id];
          const known = !!p && !p.unavailable;
          return {
            id, name: sectionName(id), passed: known && !!p.unlocked,
            badge: !known ? null : p.unlocked ? TEXT.badges.passed : TEXT.badges.notPassed,
            tabLocked: chat.tabLocked(id),
          };
        }),

        // 화면 구분: 진입(시작 전) / 진행 / 결과
        cpShowEntry: !cp,
        cpShowRunning: !!cp && state !== 'completed',
        cpShowResult: !!result,

        // 진입 화면
        cpNeedsLogin: !api.hasToken(),
        cpLoginLabel: TEXT.buttons.login,
        cpLoginUrl: '/login',
        cpEntrySectionName: SECTIONS.includes(st.processId) ? sectionName(st.processId) : '',
        cpEntryStatus: entry.status,
        cpEntryPassed: !!entry.passed,
        cpCanStart: entry.canStart && !st.cpPending,
        cpStartLabel: entry.startLabel || TEXT.buttons.start,
        // 통과한 공정과 로그인 전에는 시작 버튼을 숨긴다. 전체 보기(site) 등 시작할 수 없는 상태는 비활성 버튼으로 보인다.
        cpShowStartButton: !entry.passed && api.hasToken(),
        cpStartOpacity: entry.canStart && !st.cpPending ? '1' : '.45',
        onCpStart: () => chat.start(),

        // 진행 화면
        cpTitle: cp ? TEXT.title(sectionName(cp.section), cp.kind === 'retry') : '',
        cpSection: cp?.section ?? null,
        cpState: state,
        cpStageLabel: cp ? stageLabel(cp) : '',
        cpIsRecheck: state === 'awaiting_recheck',
        cpStageColor: state === 'awaiting_recheck' ? TONE_COLOR.warn : state === 'error' ? TONE_COLOR.danger : state === 'completed' ? TONE_COLOR.ok : ACCENT,
        cpConceptName: !cp ? ''
          : state === 'awaiting_ready' ? (cp.kind === 'retry' ? TEXT.readyHint.retry : TEXT.readyHint.first)
          : state === 'completed' ? TEXT.doneHint : cp.concept?.name ?? '',
        cpConceptIndex: cp?.concept?.index ?? null,
        cpConceptTotal: cp?.concept?.total ?? cp?.progress.length ?? null,
        cpDots: (cp?.progress ?? []).map((d, i) => ({ conceptId: d.concept_id, index: i + 1, status: d.status, isDone: d.status === 'done', isCurrent: d.status === 'current', color: d.status === 'done' ? ACCENT : d.status === 'current' ? 'var(--text)' : 'var(--line)' })),
        cpMessages: st.cpMessages.map((m, i) => ({
          key: i, text: m.text, type: m.type,
          isUser: m.role === 'user', isTutor: m.role !== 'user',
          label: m.role === 'user' ? '' : TEXT.messageLabels[m.type] ?? TEXT.defaultMessageLabel,
          isRecheck: m.type === 'recheck_question', isError: m.type === 'error',
          // 머리말·왼쪽 선 색: 재확인 질문은 주황, 채점 오류는 빨강.
          color: m.type === 'recheck_question' ? TONE_COLOR.warn : m.type === 'error' ? TONE_COLOR.danger : ACCENT,
        })),
        cpPending: st.cpPending,
        cpShowReadyButton: state === 'awaiting_ready' && !st.cpPending,
        cpReadyLabel: TEXT.buttons.ready,
        onCpReady: () => chat.ready(),
        cpShowRetryButton: state === 'error' && !st.cpPending,
        cpRetryLabel: TEXT.buttons.retryEvaluation,
        onCpRetry: () => chat.retry(),
        cpShowComposer: !!cp && state !== 'completed',
        cpInput: st.cpInput,
        cpInputDisabled: st.cpPending || !answering,
        cpInputOpacity: st.cpPending || !answering ? '.5' : '1',
        cpPlaceholder: state === 'awaiting_ready' ? TEXT.placeholder.ready : state === 'error' ? TEXT.placeholder.error : TEXT.placeholder.answer,
        cpSendLabel: TEXT.buttons.send,
        onCpInput: (e) => c.setState({ cpInput: e.target.value }),
        onCpSend: (e) => { e?.preventDefault?.(); return chat.send(S().cpInput); },

        // 결과 화면(state=completed)
        cpResult: result,
        cpCloseLabel: TEXT.buttons.close,
        onCpClose: () => chat.close(),

        // 안내·오류
        cpNotice: st.cpNotice,
        cpHasNotice: !!st.cpNotice,

        // 학습 탭 잠금
        cpLearningLocked: chat.isActive(),
        cpLearningInputOpacity: chat.isActive() ? '.5' : '1',
        cpLearningLockedText: TEXT.learningLocked,
      };
    },
  };
  return chat;
}
