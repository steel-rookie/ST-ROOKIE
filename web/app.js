const messages = document.getElementById("messages");
const emptyState = document.getElementById("empty-state");
const form = document.getElementById("question-form");
const questionInput = document.getElementById("question");
const sendButton = document.getElementById("send");
const connection = document.getElementById("connection");
const formNote = document.getElementById("form-note");
const examples = [...document.querySelectorAll("[data-question]")];
let sessionId = null;
let connected = false;
let pending = false;

function setControls() {
  const disabled = !connected || pending;
  questionInput.disabled = disabled;
  sendButton.disabled = disabled;
  examples.forEach((button) => { button.disabled = disabled; });
}

function setConnection(state, model = "Gemini Lite") {
  connected = state === "connected";
  connection.className = `connection ${state}`;
  connection.innerHTML = '<span class="connection-dot"></span>';
  connection.append(document.createTextNode(state === "connected" ? `${model} 설정됨` : state === "disconnected" ? "Gemini 미연결" : "연결 오류"));
  formNote.textContent = state === "connected"
    ? "답변에는 확인된 공개 자료만 출처로 표시됩니다."
    : state === "disconnected"
      ? "서버에 GEMINI_API_KEY가 설정되지 않았습니다. 현재는 답변을 생성할 수 없습니다."
      : "서버 연결을 확인하지 못했습니다. 페이지를 새로고침해 주세요.";
  setControls();
}

function createMessage(role, text, status, sources = []) {
  if (emptyState.isConnected) emptyState.remove();
  const article = document.createElement("article");
  article.className = `message ${role}`;
  const label = document.createElement("span");
  label.className = "message-label";
  label.textContent = role === "user" ? "나의 질문" : "제선 안내";
  const content = document.createElement("p");
  content.textContent = text;
  article.append(label, content);

  if (role === "assistant") {
    if (status === "unverified") {
      const badge = document.createElement("span");
      badge.className = "unverified-badge";
      badge.textContent = "자료에서 확인되지 않음";
      article.append(badge);
    }
    if (sources.length) {
      const sourceBlock = document.createElement("div");
      sourceBlock.className = "source-block";
      const sourceLabel = document.createElement("span");
      sourceLabel.className = "source-label";
      sourceLabel.textContent = "답변 근거 · 포스코 공개 공식 자료";
      sourceBlock.append(sourceLabel);
      const list = document.createElement("ul");
      for (const source of sources) {
        const item = document.createElement("li");
        const link = document.createElement("a");
        link.href = source.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = source.title;
        const meta = document.createElement("small");
        meta.textContent = `${source.publisher} · ${source.date_type} ${source.date}`;
        item.append(link, meta);
        list.append(item);
      }
      sourceBlock.append(list);
      article.append(sourceBlock);
    }
  }
  messages.append(article);
  messages.scrollTop = messages.scrollHeight;
  return article;
}

async function ask(question) {
  const trimmed = question.trim();
  if (!trimmed || !connected || pending) return;
  pending = true;
  setControls();
  createMessage("user", trimmed);
  questionInput.value = "";
  const loading = createMessage("assistant", "자료를 확인하며 답변을 작성하고 있습니다…");
  loading.classList.add("loading");
  formNote.textContent = "답변을 생성하는 중입니다.";

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: trimmed, ...(sessionId ? { session_id: sessionId } : {}) }),
    });
    const data = await response.json();
    loading.remove();
    if (!response.ok) {
      if (data.code === "LLM_NOT_CONFIGURED") setConnection("disconnected");
      if (response.status === 404) sessionId = null;
      createMessage("assistant", data.error || "답변 중 오류가 발생했습니다. 다시 시도해 주세요.", "unverified");
      return;
    }
    sessionId = data.session_id;
    createMessage("assistant", data.answer, data.status, data.sources || []);
  } catch {
    loading.remove();
    createMessage("assistant", "서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.", "unverified");
  } finally {
    pending = false;
    setControls();
    if (connected) {
      formNote.textContent = "답변에는 확인된 공개 자료만 출처로 표시됩니다.";
      questionInput.focus();
    }
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  ask(questionInput.value);
});
examples.forEach((button) => button.addEventListener("click", () => ask(button.dataset.question)));

fetch("/api/status")
  .then((response) => { if (!response.ok) throw new Error("status"); return response.json(); })
  .then((data) => setConnection(data.connected ? "connected" : "disconnected", data.model))
  .catch(() => setConnection("error"));
