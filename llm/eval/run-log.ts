// 긴 실제 Gemini 실행(eval:evaluator, eval:questions)의 공통 코드.
// - 케이스마다 결과를 JSONL 파일에 바로 덧붙인다. 중간에 끊겨도 끝난 케이스는 남는다.
// - --resume이면 같은 설정(fingerprint)으로 끝난 케이스를 건너뛴다. 연결 오류(infra_error)로 끝난 케이스는 다시 한다.
// - 429·시간 초과·연결 실패는 지수 백오프로 최대 3회 다시 호출한다.
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { GeminiCallError, GeminiClient, type GeminiOptions, type GenerateRequest } from "../src/gemini.js";

export const RESULTS_DIR = join(process.cwd(), "llm", "eval", "results");
export const MAX_INFRA_RETRIES = 3;
/** 연결 오류가 이만큼 연달아 나면 멈춘다(일일 한도 소진 등). 나중에 --resume으로 이어서 한다. */
export const MAX_CONSECUTIVE_INFRA = 3;

/** `--name 값` 또는 `--name=값`. */
export function option(name: string, fallback: string): string {
  const argv = process.argv.slice(2);
  const i = argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i < 0) return fallback;
  return argv[i]!.includes("=") ? argv[i]!.slice(argv[i]!.indexOf("=") + 1) : (argv[i + 1] ?? fallback);
}

export const flag = (name: string) => process.argv.slice(2).includes(`--${name}`);

/** 설정 지문: 모델, 프롬프트, 루브릭처럼 결과를 바꾸는 입력이 같으면 같은 값. */
export function fingerprint(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 16);
}

export interface RunRecord {
  key: string;
  fingerprint: string;
  /** 연결 오류로 끝났으면 true. 일치율에서 빼고, --resume 때 다시 실행한다. */
  infra_error: boolean;
}

export class RecordFile<T extends RunRecord> {
  /** 키마다 가장 마지막 기록. */
  readonly latest = new Map<string, T>();

  constructor(readonly path: string, resume: boolean) {
    if (existsSync(path)) {
      if (!resume) {
        throw new Error(`결과 파일이 이미 있습니다: ${path}\n이어서 하려면 --resume, 새로 하려면 파일을 지우거나 --records로 다른 파일을 지정하세요.`);
      }
      const text = readFileSync(path, "utf8");
      // 끊긴 마지막 줄 뒤에 새 기록이 붙지 않게 줄을 바꿔 둔다.
      if (text && !text.endsWith("\n")) appendFileSync(path, "\n");
      const lines = text.split("\n");
      lines.forEach((line, i) => {
        if (!line.trim()) return;
        try {
          const record = JSON.parse(line) as T;
          this.latest.set(record.key, record);
        } catch {
          // 쓰는 도중 끊긴 마지막 줄. 그 케이스는 다시 실행된다.
          console.warn(`${path}:${i + 1} 읽을 수 없는 줄을 건너뜁니다.`);
        }
      });
    }
    mkdirSync(dirname(path), { recursive: true });
  }

  /** 같은 설정으로 끝난(연결 오류가 아닌) 기록. */
  done(key: string, fp: string): T | undefined {
    const r = this.latest.get(key);
    return r && r.fingerprint === fp && !r.infra_error ? r : undefined;
  }

  /** 같은 키의 기록이 있지만 설정이 달라 다시 해야 하는지. */
  stale(key: string, fp: string): boolean {
    const r = this.latest.get(key);
    return !!r && r.fingerprint !== fp;
  }

  append(record: T): void {
    appendFileSync(this.path, JSON.stringify(record) + "\n");
    this.latest.set(record.key, record);
  }
}

/** 스크립트용: 결과 파일을 열고, 열 수 없으면(이미 있는데 --resume이 없으면) 이유만 출력하고 끝낸다. */
export function openRecordFile<T extends RunRecord>(path: string, resume: boolean): RecordFile<T> {
  try {
    return new RecordFile<T>(path, resume);
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}

/** 재시도할 수 있는 연결 오류를 지수 백오프(base, 2×base, 4×base)로 최대 3회 다시 호출한다. */
export class RetryingGeminiClient extends GeminiClient {
  /** 직전 reset() 이후 다시 호출한 횟수와 이유. */
  retries: string[] = [];

  constructor(options: GeminiOptions = {}, private readonly baseDelayMs = Number(process.env.EVAL_RETRY_BASE_MS ?? 10_000)) {
    super(options);
  }

  reset(): void {
    this.retries = [];
  }

  override async generate(req: GenerateRequest): Promise<string> {
    for (let retry = 0; ; retry++) {
      try {
        return await super.generate(req);
      } catch (error) {
        if (!(error instanceof GeminiCallError) || !error.retryable || retry >= MAX_INFRA_RETRIES) throw error;
        const wait = this.baseDelayMs * 2 ** retry;
        this.retries.push(error.message);
        process.stdout.write(`\n  [${error.reason}] ${error.message} → ${wait / 1000}초 뒤 재시도 ${retry + 1}/${MAX_INFRA_RETRIES}\n`);
        await sleep(wait);
      }
    }
  }
}

/** 연결 오류(재시도 후에도 실패, 또는 재시도하지 않는 HTTP 오류). 평가자 형식 오류와 따로 센다. */
export const isInfraError = (error: unknown): error is GeminiCallError => error instanceof GeminiCallError;

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 연결 오류가 연달아 나는지 센다. */
export class InfraStreak {
  private count = 0;

  /** 연결 오류면 true를 넘긴다. 한도에 닿으면 true를 돌려준다(멈춰야 함). */
  push(infra: boolean): boolean {
    this.count = infra ? this.count + 1 : 0;
    return this.count >= MAX_CONSECUTIVE_INFRA;
  }
}
