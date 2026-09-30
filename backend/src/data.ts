import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.cwd(), "backend");

function loadJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(join(ROOT, relativePath), "utf8")) as T;
}

export interface Process {
  process_id: string;
  name: string;
  purpose: string;
  inputs: string[];
  outputs: string[];
  sub_processes: string[];
  next_process_id: string | null;
  connection: string;
  equipment_ids: string[];
  source_document_ids: string[];
}

export interface Equipment {
  equipment_id: string;
  process_id: string;
  name: string;
  role: string;
  related_concepts: string[];
  source_document_ids: string[];
}

export interface MaterialDocument {
  document_id: string;
  title: string;
  version: string | null;
  scope: "public_overview" | "site_procedure";
  review_status: "approved" | "draft" | "sample";
  applies_to: { sites: string[]; equipment_ids: string[] };
  process_ids: string[];
  chunks: { page: number | null; text: string }[];
}

interface QuizBase {
  quiz_id: string;
  process_id: string;
  learning_step_id: string;
  question: string;
  source_document_ids: string[];
}

export interface MultipleChoiceQuiz extends QuizBase {
  type: "multiple_choice";
  choices: Record<string, string>;
  answer: string;
  explanation: string;
  misconceptions: Record<string, string>;
}

export interface ShortAnswerQuiz extends QuizBase {
  type: "short_answer";
  rubric: string[];
}

export type Quiz = MultipleChoiceQuiz | ShortAnswerQuiz;

export type SceneActionType = "highlight" | "focus" | "play_animation" | "goto_process";

export interface SceneAction {
  type: SceneActionType;
  target_id: string;
}

interface SceneRegistry {
  processes: Record<string, { has_3d_model: boolean; actions: SceneAction[] }>;
  navigation: string[];
}

export const processes = loadJson<{ processes: Process[] }>("data/processes.json").processes;
export const equipment = loadJson<{ equipment: Equipment[] }>("data/equipment.json").equipment;
export const documents = loadJson<{ documents: MaterialDocument[] }>("data/materials.json").documents;
export const quizzes = loadJson<{ quizzes: Quiz[] }>("data/quizzes.json").quizzes;
const scenes = loadJson<SceneRegistry>("data/scenes.json");

export function hasModel(processId: string | null): boolean {
  return processId !== null && (scenes.processes[processId]?.has_3d_model ?? false);
}

/** 현재 화면에서 요청할 수 있는 동작. 공정 이동은 지금 화면이 아닌 공정으로만 허용한다. */
export function allowedSceneActions(processId: string | null): SceneAction[] {
  const own = processId ? (scenes.processes[processId]?.actions ?? []) : [];
  const navigation = scenes.navigation
    .filter((id) => id !== processId)
    .map((id): SceneAction => ({ type: "goto_process", target_id: id }));
  return [...own, ...navigation];
}

export function isKnownProcess(id: string): boolean {
  return processes.some((p) => p.process_id === id);
}

export function isKnownEquipment(id: string): boolean {
  return equipment.some((e) => e.equipment_id === id);
}
