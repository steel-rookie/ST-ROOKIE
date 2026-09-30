import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";

export interface LearningRecord {
  quiz_id: string;
  attempt: number;
  /** short_answer 문항은 채점 기준만 있고 공식 점수가 없으므로 null */
  correct: boolean | null;
  learner_answer: string;
  misconception: string | null;
  recorded_at: string;
}

export interface Session {
  id: string;
  learnerId: string;
  /** API로 보내는 대화 기록. 추가만 하고 수정·삭제하지 않는다(preserved thinking 유지). */
  messages: Anthropic.Beta.BetaMessageParam[];
  /** 이 대화에서 도구가 실제로 돌려준 자료. 인용 검증에 쓴다. */
  retrievedDocuments: Map<string, { title: string; version: string | null }>;
  /** get_quiz로 출제한 문항. 출제하지 않은 문항은 채점할 수 없다. */
  issuedQuizIds: Set<string>;
  learningRecords: LearningRecord[];
}

const sessions = new Map<string, Session>();

export function createSession(learnerId: string): Session {
  const session: Session = {
    id: randomUUID(),
    learnerId,
    messages: [],
    retrievedDocuments: new Map(),
    issuedQuizIds: new Set(),
    learningRecords: [],
  };
  sessions.set(session.id, session);
  return session;
}

export function getSession(id: string): Session | undefined {
  return sessions.get(id);
}
