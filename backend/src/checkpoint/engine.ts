// 체크포인트 상태 머신. 흐름과 상태는 docs/checkpoint-api.md 참고.
// 한 요청 = 한 단계: LLM 호출(평가자·튜터)을 모두 마친 뒤 결과를 하나의 트랜잭션으로 저장한다.
// LLM 연결이 실패하면 아무것도 저장하지 않으므로 같은 메시지를 다시 보내면 된다.
import { randomUUID } from "node:crypto";
import type { Rubric, RubricConcept } from "../rubrics.js";
import {
  applyRetry,
  conceptResult,
  conceptScore,
  conceptsToRetry,
  isUnlocked,
  sectionStatus,
  type ConceptResult,
  type Results,
} from "../scoring.js";
import type { AttemptPatch, AttemptRow, CheckpointRepository, ConceptResultRow } from "./repository.js";
import {
  CheckpointError,
  EvaluationFormatError,
  SECTION_NAMES,
  SECTION_ORDER,
  type CheckpointState,
  type CheckpointView,
  type Evaluation,
  type Evaluator,
  type LearnerNotes,
  type Phase,
  type ResultView,
  type Section,
  type SectionProgressView,
  type Tutor,
  type Utterance,
} from "./types.js";

const PASS_THRESHOLD = 0.8;
const ERROR_TEXT = "답변을 채점하지 못했어요. 잠시 후 다시 시도해 주세요.";

export interface EngineDeps {
  repo: CheckpointRepository;
  evaluator: Evaluator;
  tutor: Tutor;
  rubrics: readonly Rubric[];
  now?: () => string;
  newId?: () => string;
}

/** 선택 파라미터. 학습자 메모는 다음 단계에서 쓴다(CLAUDE.md '다음 단계'). */
export interface EngineOptions {
  notes?: LearnerNotes;
}

type Message = { role: "tutor" | "user"; type: Utterance["type"] | null; text: string };

export class CheckpointEngine {
  private readonly repo: CheckpointRepository;
  private readonly evaluator: Evaluator;
  private readonly tutor: Tutor;
  private readonly rubrics: Map<Section, Rubric>;
  private readonly now: () => string;
  private readonly newId: () => string;
  // 같은 시도(또는 같은 사용자·섹션의 시작)에 요청이 겹치면 순서가 꼬이므로 하나씩만 처리한다.
  private readonly busy = new Set<string>();

  constructor(deps: EngineDeps) {
    this.repo = deps.repo;
    this.evaluator = deps.evaluator;
    this.tutor = deps.tutor;
    this.rubrics = new Map(deps.rubrics.map((r) => [r.section, r]));
    this.now = deps.now ?? (() => new Date().toISOString());
    this.newId = deps.newId ?? randomUUID;
  }

  /** 체크포인트를 시작한다. 진행 중인 시도가 있으면 그 시도를 돌려주고, 이전 시도가 미달이면 재도전 시도를 만든다. */
  async start(userId: string, section: Section, options: EngineOptions = {}): Promise<{ created: boolean; view: CheckpointView }> {
    const rubric = this.rubric(section);
    return this.exclusive(`${userId}:${section}`, async () => {
      const open = this.repo.findOpenAttempt(userId, section);
      if (open) return { created: false, view: this.view(open, [], { history: true }) };
      if (!this.isSectionOpen(userId, section)) throw new CheckpointError(403, "앞 섹션의 체크포인트를 먼저 통과해야 합니다.");

      const ids = conceptIds(rubric);
      const completed = this.repo.listCompletedAttempts(userId, section);
      const merged = this.mergedResults(userId, rubric);
      if (completed.length && isUnlocked(ids, merged)) throw new CheckpointError(409, "이미 통과한 섹션입니다.");

      const kind = completed.length ? "retry" : "first";
      const asked = this.orderConcepts(kind === "first" ? ids : conceptsToRetry(ids, merged), options.notes);
      const name = SECTION_NAMES[section];
      const intro: Utterance = {
        type: "intro",
        text: kind === "first"
          ? `${name} 질문 시작할게요, 준비됐나요?`
          : `${name} 다시 확인해 볼게요. 지난번에 어려웠던 개념 ${asked.length}개만 물어볼게요. 준비됐나요?`,
      };
      const now = this.now();
      const attempt: AttemptRow = {
        id: this.newId(), user_id: userId, section, kind, state: "awaiting_ready", resume_state: null,
        concept_ids: asked, current_index: 0, current_question: null, pending_answer: null,
        understanding: null, unlocked: null, created_at: now, updated_at: now, completed_at: null,
      };
      this.repo.transaction(() => {
        this.repo.createAttempt(attempt);
        this.repo.appendMessages(attempt.id, [{ role: "tutor", ...intro }], now);
      });
      return { created: true, view: this.view(attempt, [intro]) };
    });
  }

  /**
   * 사용자 응답으로 상태를 한 단계 진행한다.
   * options는 학습자 메모를 받을 자리이고 지금은 쓰지 않는다.
   */
  async respond(userId: string, attemptId: string, text: string, _options: EngineOptions = {}): Promise<CheckpointView> {
    return this.exclusive(attemptId, async () => {
      const attempt = this.ownedAttempt(userId, attemptId);
      const rubric = this.rubric(attempt.section);
      switch (attempt.state) {
        case "awaiting_ready":
          return this.onReady(attempt, rubric, text);
        case "awaiting_answer":
          return this.onAnswer(attempt, rubric, text, "initial", true);
        case "awaiting_recheck":
          return this.onAnswer(attempt, rubric, text, "recheck", true);
        case "completed":
          throw new CheckpointError(409, "이미 끝난 체크포인트입니다.");
        case "error":
          throw new CheckpointError(409, "채점 오류 상태입니다. retry-evaluation으로 다시 채점해 주세요.");
      }
    });
  }

  /** error 상태에서 저장해 둔 마지막 답변을 다시 채점한다. */
  async retryEvaluation(userId: string, attemptId: string): Promise<CheckpointView> {
    return this.exclusive(attemptId, async () => {
      const attempt = this.ownedAttempt(userId, attemptId);
      if (attempt.state !== "error" || !attempt.resume_state || attempt.pending_answer === null) {
        throw new CheckpointError(409, "다시 채점할 답변이 없습니다.");
      }
      const phase: Phase = attempt.resume_state === "awaiting_recheck" ? "recheck" : "initial";
      const resumed = { ...attempt, state: attempt.resume_state };
      return this.onAnswer(resumed, this.rubric(attempt.section), attempt.pending_answer, phase, false);
    });
  }

  get(userId: string, attemptId: string): CheckpointView {
    return this.view(this.ownedAttempt(userId, attemptId), [], { history: true });
  }

  sectionProgress(userId: string, section: Section): SectionProgressView {
    const rubric = this.rubric(section);
    const ids = conceptIds(rubric);
    const completed = this.repo.listCompletedAttempts(userId, section);
    const merged = this.mergedResults(userId, rubric);
    const unlocked = completed.length > 0 && isUnlocked(ids, merged);
    return {
      section,
      open: this.isSectionOpen(userId, section),
      unlocked,
      understanding: completed.length ? sectionStatus(ids, merged).understanding : null,
      retry_concept_ids: completed.length && !unlocked ? conceptsToRetry(ids, merged) : [],
      in_progress_attempt_id: this.repo.findOpenAttempt(userId, section)?.id ?? null,
    };
  }

  // --- 단계 처리 ---

  private async onReady(attempt: AttemptRow, rubric: Rubric, text: string): Promise<CheckpointView> {
    // 어떤 응답이든 시작으로 본다.
    const concept = findConcept(rubric, attempt.concept_ids[0]!);
    const question = await this.tutor.question({ rubric, concept });
    const tutor: Utterance[] = [{ type: "question", text: question }];
    return this.commit(attempt, { state: "awaiting_answer", current_index: 0, current_question: question }, [
      { role: "user", type: null, text },
      ...tutor.map(asTutorMessage),
    ], tutor);
  }

  private async onAnswer(attempt: AttemptRow, rubric: Rubric, answer: string, phase: Phase, logUser: boolean): Promise<CheckpointView> {
    const concept = findConcept(rubric, attempt.concept_ids[attempt.current_index]!);
    const question = attempt.current_question ?? "";
    const userMessages: Message[] = logUser ? [{ role: "user", type: null, text: answer }] : [];

    let evaluation: Evaluation;
    try {
      evaluation = await this.evaluator.evaluate({ rubric, concept, question, answer, phase });
      checkEvaluation(evaluation, concept, phase);
    } catch (error) {
      if (!(error instanceof EvaluationFormatError)) throw error;
      const tutor: Utterance[] = [{ type: "error", text: ERROR_TEXT }];
      return this.commit(attempt, {
        state: "error",
        resume_state: phase === "initial" ? "awaiting_answer" : "awaiting_recheck",
        pending_answer: answer,
      }, [...userMessages, ...tutor.map(asTutorMessage)], tutor);
    }

    const now = this.now();
    const misconception = evaluation.misconception?.trim() || null;
    const recordMisconception = () => {
      if (!misconception) return;
      this.repo.insertMisconception({
        id: this.newId(), user_id: attempt.user_id, section: attempt.section, concept_id: concept.concept_id,
        source: "checkpoint", phase, attempt_id: attempt.id, answer_text: answer, summary: misconception,
      }, now);
    };

    // 첫 판정이 correct가 아니면: explain_from부터 부가 설명 → 다른 각도의 재확인 질문.
    if (phase === "initial" && evaluation.verdict !== "correct") {
      const explanation = await this.tutor.explanation({
        rubric, concept, explainFrom: evaluation.explain_from!, misconception, answer,
      });
      const recheckQuestion = await this.tutor.recheckQuestion({ rubric, concept, previousQuestion: question });
      const tutor: Utterance[] = [
        { type: "explanation", text: explanation },
        { type: "recheck_question", text: recheckQuestion },
      ];
      return this.commit(attempt, {
        state: "awaiting_recheck", current_question: recheckQuestion, resume_state: null, pending_answer: null,
      }, [...userMessages, ...tutor.map(asTutorMessage)], tutor, () => {
        this.repo.insertResult({
          attempt_id: attempt.id, concept_id: concept.concept_id, question, answer,
          verdict: evaluation.verdict, evidence: evaluation.evidence, explain_from: evaluation.explain_from,
        }, now);
        this.repo.updateRecheckQuestion(attempt.id, concept.concept_id, recheckQuestion, now);
        recordMisconception();
      });
    }

    // 여기부터 개념 점수가 확정된다(첫 판정 correct 또는 재확인 판정).
    let final: ConceptResult;
    let feedback: Utterance;
    let write: () => void;
    if (phase === "initial") {
      final = conceptResult(concept.concept_id, "correct");
      feedback = { type: "feedback", text: "맞아요." };
      write = () => this.repo.insertResult({
        attempt_id: attempt.id, concept_id: concept.concept_id, question, answer,
        verdict: "correct", evidence: evaluation.evidence, explain_from: null,
      }, now);
    } else {
      const first = this.repo.getResult(attempt.id, concept.concept_id);
      if (!first) throw new Error(`재확인할 첫 판정이 없다: ${concept.concept_id}`);
      const recheckVerdict = evaluation.verdict as Exclude<Evaluation["verdict"], "assisted">;
      final = conceptResult(concept.concept_id, first.verdict, recheckVerdict);
      feedback = recheckVerdict === "correct"
        ? { type: "feedback", text: "맞아요, 이번에는 정확해요." }
        : { type: "key_points", text: ["핵심만 정리할게요.", ...concept.key_points.map((k) => `- ${k.point}`)].join("\n") };
      write = () => this.repo.updateRecheck(attempt.id, concept.concept_id, {
        recheck_answer: answer, recheck_verdict: recheckVerdict, recheck_evidence: evaluation.evidence,
      }, now);
    }
    const resolve = () => {
      recordMisconception();
      if (conceptScore(final) === 1) this.repo.resolveMisconceptions(attempt.user_id, concept.concept_id, now);
    };

    const nextIndex = attempt.current_index + 1;
    if (nextIndex < attempt.concept_ids.length) {
      const next = findConcept(rubric, attempt.concept_ids[nextIndex]!);
      const nextQuestion = await this.tutor.question({ rubric, concept: next });
      const tutor: Utterance[] = [feedback, { type: "question", text: nextQuestion }];
      return this.commit(attempt, {
        state: "awaiting_answer", current_index: nextIndex, current_question: nextQuestion, resume_state: null, pending_answer: null,
      }, [...userMessages, ...tutor.map(asTutorMessage)], tutor, () => {
        write();
        resolve();
      });
    }

    // 마지막 개념: 이전 시도 결과에 이번 시도 결과를 합쳐 섹션 결과를 계산한다.
    const ids = conceptIds(rubric);
    const thisAttempt = new Map(this.repo.listResults(attempt.id).map((r) => [r.concept_id, toConceptResult(r)]));
    thisAttempt.set(concept.concept_id, final);
    const merged = applyRetry(ids, this.mergedResults(attempt.user_id, rubric), thisAttempt);
    const status = sectionStatus(ids, merged);
    const resultText = resultMessage(attempt.section, rubric, status.understanding, status.unlocked, status.retryConceptIds);
    const tutor: Utterance[] = [feedback, { type: "result", text: resultText }];
    return this.commit(attempt, {
      state: "completed", current_question: null, resume_state: null, pending_answer: null,
      understanding: status.understanding, unlocked: status.unlocked, completed_at: now,
    }, [...userMessages, ...tutor.map(asTutorMessage)], tutor, () => {
      write();
      resolve();
    });
  }

  // --- 공통 ---

  /** 시도 상태·대화 기록·추가 쓰기를 하나의 트랜잭션으로 저장하고 응답을 만든다. */
  private commit(
    attempt: AttemptRow,
    patch: AttemptPatch,
    messages: Message[],
    tutor: Utterance[],
    extra?: () => void,
  ): CheckpointView {
    const now = this.now();
    this.repo.transaction(() => {
      extra?.();
      this.repo.updateAttempt(attempt.id, patch, now);
      this.repo.appendMessages(attempt.id, messages, now);
    });
    return this.view(this.repo.getAttempt(attempt.id)!, tutor);
  }

  private view(attempt: AttemptRow, tutor: Utterance[], options: { history?: boolean } = {}): CheckpointView {
    const rubric = this.rubric(attempt.section);
    const active: CheckpointState[] = ["awaiting_answer", "awaiting_recheck", "error"];
    const current = active.includes(attempt.state) ? attempt.current_index : null;
    const conceptId = current === null ? null : attempt.concept_ids[current]!;
    return {
      attempt_id: attempt.id,
      section: attempt.section,
      kind: attempt.kind,
      state: attempt.state,
      concept: conceptId === null ? null : {
        id: conceptId,
        name: findConcept(rubric, conceptId).name,
        index: current! + 1,
        total: attempt.concept_ids.length,
      },
      tutor,
      progress: attempt.concept_ids.map((id, i) => ({
        concept_id: id,
        status: attempt.state === "completed" || (current !== null && i < current) ? "done" : i === current ? "current" : "pending",
      })),
      result: attempt.state === "completed" ? resultView(rubric, this.mergedResults(attempt.user_id, rubric, attempt.id)) : null,
      ...(options.history ? { history: this.repo.listMessages(attempt.id) } : {}),
    };
  }

  /** 완료된 시도 결과를 순서대로 합친다. untilAttemptId를 주면 그 시도까지만 합친다. */
  private mergedResults(userId: string, rubric: Rubric, untilAttemptId?: string): Map<string, ConceptResult> {
    const ids = conceptIds(rubric);
    let merged = new Map<string, ConceptResult>();
    for (const attempt of this.repo.listCompletedAttempts(userId, rubric.section)) {
      const results = new Map(this.repo.listResults(attempt.id).map((r) => [r.concept_id, toConceptResult(r)]));
      merged = applyRetry(ids, merged, results);
      if (attempt.id === untilAttemptId) break;
    }
    return merged;
  }

  private isSectionOpen(userId: string, section: Section): boolean {
    const index = SECTION_ORDER.indexOf(section);
    if (index <= 0) return true;
    const previous = this.rubrics.get(SECTION_ORDER[index - 1]!);
    if (!previous) return false;
    return isUnlocked(conceptIds(previous), this.mergedResults(userId, previous));
  }

  /** 학습자 메모의 conceptOrder를 적용할 자리(다음 단계). 지금은 받은 순서를 그대로 쓴다. */
  private orderConcepts(ids: string[], _notes?: LearnerNotes): string[] {
    return ids;
  }

  private rubric(section: Section): Rubric {
    const rubric = this.rubrics.get(section);
    if (!rubric) throw new CheckpointError(404, `루브릭이 없는 섹션입니다: ${section}`);
    return rubric;
  }

  private ownedAttempt(userId: string, attemptId: string): AttemptRow {
    const attempt = this.repo.getAttempt(attemptId);
    if (!attempt || attempt.user_id !== userId) throw new CheckpointError(404, "체크포인트를 찾을 수 없습니다.");
    return attempt;
  }

  private async exclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
    if (this.busy.has(key)) throw new CheckpointError(409, "이전 요청을 처리하는 중입니다.");
    this.busy.add(key);
    try {
      return await fn();
    } finally {
      this.busy.delete(key);
    }
  }
}

// --- 도우미 ---

const conceptIds = (rubric: Rubric) => rubric.concepts.map((c) => c.concept_id);
const asTutorMessage = (u: Utterance): Message => ({ role: "tutor", type: u.type, text: u.text });

function findConcept(rubric: Rubric, conceptId: string): RubricConcept {
  const concept = rubric.concepts.find((c) => c.concept_id === conceptId);
  if (!concept) throw new Error(`루브릭에 없는 개념: ${rubric.section}/${conceptId}`);
  return concept;
}

function toConceptResult(row: ConceptResultRow): ConceptResult {
  return conceptResult(row.concept_id, row.verdict, row.recheck_verdict);
}

/** 평가자 구현이 지켜야 할 계약. 어기면 형식 오류로 본다. */
function checkEvaluation(e: Evaluation, concept: RubricConcept, phase: Phase): void {
  const allowed = phase === "recheck" ? ["correct", "partial", "wrong"] : ["correct", "partial", "wrong", "assisted"];
  if (!allowed.includes(e.verdict)) throw new EvaluationFormatError(`${phase} 단계에서 허용되지 않는 판정: ${e.verdict}`);
  if (phase === "initial" && e.verdict !== "correct") {
    const from = e.explain_from;
    if (from === null || !Number.isInteger(from) || from < 0 || from >= concept.key_points.length) {
      throw new EvaluationFormatError(`explain_from 범위 오류: ${from}`);
    }
  }
}

function resultView(rubric: Rubric, merged: Results): ResultView {
  const ids = conceptIds(rubric);
  const status = sectionStatus(ids, merged);
  return {
    understanding: status.understanding,
    unlocked: status.unlocked,
    threshold: PASS_THRESHOLD,
    concepts: rubric.concepts.map((c) => {
      const r = merged.get(c.concept_id);
      return {
        concept_id: c.concept_id,
        name: c.name,
        score: r ? conceptScore(r) : 0,
        final_verdict: r ? r.recheckVerdict ?? (r.verdict === "correct" ? "correct" : null) : null,
      };
    }),
    retry_concept_ids: status.retryConceptIds,
  };
}

function resultMessage(section: Section, rubric: Rubric, understanding: number, unlocked: boolean, retryIds: string[]): string {
  const pct = Math.round(understanding * 100);
  if (unlocked) {
    const next = SECTION_ORDER[SECTION_ORDER.indexOf(section) + 1];
    return next
      ? `이해도 ${pct}%예요. 기준(80%)을 넘어서 ${SECTION_NAMES[next]} 섹션이 열렸어요.`
      : `이해도 ${pct}%예요. 기준(80%)을 넘어서 모든 섹션을 마쳤어요.`;
  }
  const names = retryIds.map((id) => findConcept(rubric, id).name).join(", ");
  return `이해도 ${pct}%예요. 기준(80%)에 못 미쳐서 섹션 처음으로 돌아갈게요. 다시 살펴본 뒤 체크포인트를 다시 시작하면 이 개념만 물어볼게요: ${names}.`;
}
