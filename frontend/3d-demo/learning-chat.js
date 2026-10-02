// 학습 모드 채팅(최종 페이지 Steel Academy v2.dc.html 전용).
// 페이지 컴포넌트에서 코드만 옮겼다. 동작은 옮기기 전과 같다.
// - 페이지 컴포넌트(c)의 state·setState와 data, chatRef, scene(), goProcess(), scrollChat()을 그대로 쓴다.
// - 상태(messages, input, pending, lastReq, lastRes, lastResults)는 페이지 컴포넌트 state에 그대로 둔다.
// - 튜터는 학습 모드 API(POST /api/chat, docs/learning-mode.md)다. 응답은 템플릿이 그리는 메시지 형식(mode, evidence, citations, followUp)으로 바꿔 넣는다.
// - [임시] 사용자 구분은 체크포인트 테스트 페이지와 같다: 주소의 ?user=이름 → X-User-Id, 저장된 접속 비밀번호 → X-Test-Passcode.

const SECTIONS = ['ironmaking', 'steelmaking', 'continuous_casting', 'rolling'];
const PASS_KEY = 'st-rookie:passcode';

/** POST /api/chat. 실패하면 서버가 준 문장(없으면 기본 문장)을 담은 Error, 404면 err.status = 404. */
async function postChat(body) {
  const headers = { 'Content-Type': 'application/json' };
  const user = (new URLSearchParams(location.search).get('user') || '').trim();
  if (user) headers['X-User-Id'] = encodeURIComponent(user);
  let passcode = '';
  try { passcode = localStorage.getItem(PASS_KEY) || ''; } catch (e) {}
  if (passcode) headers['X-Test-Passcode'] = encodeURIComponent(passcode);
  let res;
  try {
    res = await fetch('/api/chat', { method: 'POST', headers, body: JSON.stringify(body) });
  } catch (e) {
    throw new Error('서버에 연결하지 못했어요. npm start로 서버를 켠 뒤 http://localhost:3000 에서 열어 주세요.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const err = new Error(data.error || '답변을 받지 못했어요. 다시 질문해 주세요.'); err.status = res.status; err.data = data; throw err; }
  return data;
}

/** 서버 응답 → 템플릿 메시지. 출처는 자료 제목과 id로 보여 준다. */
function toMessage(res) {
  return {
    role: 'assistant', text: res.answer,
    mode: res.status === 'safety_redirect' ? 'safety_redirect' : 'free_question',
    evidence: res.status,
    citations: (res.sources || []).map(s => ({ title: s.title, document_id: s.id, url: s.url })),
    followUp: res.follow_up || null,
  };
}

/** 페이지 컴포넌트에 붙일 학습 채팅을 만든다. componentDidMount에서 한 번 부른다. */
export async function createLearningChat(c) {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  // 같은 페이지에서 이어지는 대화. 서버가 대화를 DB에 저장하고 이 id로 이어 준다.
  let sessionId = null;

  const chat = {
    // 현재 공정·설비를 튜터 요청용으로 만든다.
    screenContext() { return { process_id: c.state.processId, equipment_id: c.state.selectedId, learning_mode: 'free_question', learning_step: null, last_scene_action_results: c.state.lastResults }; },

    // 튜터가 보낸 화면 조작(scene_actions)을 실행하고 결과를 돌려준다.
    async runActions(actions) {
      const results = [];
      for (const a of actions || []) {
        let ok = false;
        try {
          if (a.type === 'goto_process') { ok = !!c.data.findProcess(a.target_id); if (ok) { c.goProcess(a.target_id); await wait(150); } }
          else if (a.type === 'highlight') { ok = !!c.data.findEquipment(c.state.processId, a.target_id); if (ok) c.setState({ selectedId: a.target_id }); }
          else if (a.type === 'focus') { ok = !!c.scene()?.focus(a.target_id); }
          else if (a.type === 'play_animation') { ok = !!c.scene()?.play(c.state.speed); }
        } catch (e) { ok = false; }
        results.push({ type: a.type, target_id: a.target_id, status: ok ? 'succeeded' : 'failed' });
      }
      return results;
    },

    // 질문 → 학습 모드 API → (화면 조작) → 답변 메시지 추가.
    async ask(text) {
      text = (text || '').trim(); if (!text || c.state.pending) return;
      const section = SECTIONS.includes(c.state.processId) ? c.state.processId : null; // 전체 보기('site')면 서버 기본(제선)
      const screen = { process_id: section, equipment_id: section ? c.state.selectedId : null };
      const req = { question: text, session_id: sessionId || undefined, screen };
      c.setState(s => ({ messages: [...s.messages, { role: 'user', text }], input: '', pending: true, lastReq: req, tutorOpen: true, devOpen: false })); c.scrollChat();
      let message, res;
      try {
        try {
          res = await postChat(req);
        } catch (e) {
          // 서버에 없는 대화(예: DB를 지움)면 새 대화로 한 번 다시 묻는다.
          if (e.status !== 404 || !sessionId) throw e;
          sessionId = null;
          res = await postChat({ ...req, session_id: undefined });
        }
        sessionId = res.session_id;
        message = toMessage(res);
      } catch (e) {
        res = { error: e.message, status: e.status ?? null };
        message = { role: 'assistant', text: e.message, mode: 'free_question', evidence: 'error', citations: [], followUp: null };
      }
      // 학습 모드 API는 아직 화면 조작(scene_actions)을 보내지 않는다(다음 단계).
      const results = await chat.runActions(res.scene_actions);
      c.setState(s => ({ pending: false, lastRes: res, lastResults: results, messages: [...s.messages, message] })); c.scrollChat();
    },

    // 튜터 패널 템플릿 값: 메시지, 추천 질문(chips), 입력창.
    vals(D) {
      const S = c.state;
      return {
        messages: S.messages.map(m => ({ ...m, isUser: m.role === 'user', isSafety: m.role === 'assistant' && m.mode === 'safety_redirect', isAssistant: m.role === 'assistant' && m.mode !== 'safety_redirect', hasFollowUp: !!m.followUp, askFollowUp: () => chat.ask(m.followUp) })),
        chatRef: c.chatRef, pending: S.pending, chips: D.SUGGESTED.map(text => ({ text, onClick: () => chat.ask(text) })),
        input: S.input, onInput: e => c.setState({ input: e.target.value }), send: e => { e.preventDefault(); chat.ask(S.input); },
      };
    },
  };
  return chat;
}
