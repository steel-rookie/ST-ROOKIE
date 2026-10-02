// 학습 모드 채팅(최종 페이지 Steel Academy v2.dc.html 전용).
// 페이지 컴포넌트에서 코드만 옮겼다. 동작은 옮기기 전과 같다.
// - 페이지 컴포넌트(c)의 state·setState와 data, chatRef, scene(), goProcess(), scrollChat()을 그대로 쓴다.
// - 상태(messages, input, pending, lastReq, lastRes, lastResults)는 페이지 컴포넌트 state에 그대로 둔다.
// - 튜터는 아직 가짜(tutor_v2.js의 mockTutor)다. 실제 학습 모드 API로 바꿀 때는 ask()의 mockTutor 호출을 바꾼다.

/** 페이지 컴포넌트에 붙일 학습 채팅을 만든다. componentDidMount에서 한 번 부른다. */
export async function createLearningChat(c) {
  const { mockTutor } = await import('./tutor_v2.js');
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

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

    // 질문 → 튜터 호출 → 화면 조작 → 답변 메시지 추가.
    async ask(text) {
      text = (text || '').trim(); if (!text || c.state.pending) return;
      const req = { message: text, screen_context: chat.screenContext() };
      c.setState(s => ({ messages: [...s.messages, { role: 'user', text }], input: '', pending: true, lastReq: req, tutorOpen: true, devOpen: false })); c.scrollChat();
      const res = await mockTutor(req);
      const results = await chat.runActions(res.scene_actions);
      c.setState(s => ({ pending: false, lastRes: res, lastResults: results, messages: [...s.messages, { role: 'assistant', text: res.answer, mode: res.mode, evidence: res.evidence_status, citations: res.citations, followUp: res.follow_up_question }] })); c.scrollChat();
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
