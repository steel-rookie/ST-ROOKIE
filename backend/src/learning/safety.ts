// 안전 질문 차단. 설비 조작·비상 대응을 묻는 질문은 LLM을 부르지 않고 고정 문장으로 돌려보낸다.
// 키워드는 화면의 가짜 튜터(frontend/3d-demo/tutor_v2.js의 mockTutor)와 같다. 공백을 지우고 비교한다.
const SAFETY_WORDS = ["밸브", "열어", "닫아", "비상", "정지", "조작", "스위치", "눌러", "작동시", "멈춰", "점검"];

export const SAFETY_ANSWER = "현장 안전 작업표준과 담당자에게 확인하세요.";

export function isSafetyQuestion(question: string): boolean {
  const compact = question.replace(/\s/g, "");
  return SAFETY_WORDS.some((w) => compact.includes(w));
}
