// 요청한 사용자 구분.
// [임시] 로그인 전까지 X-User-Id 헤더(프론트가 URL의 ?user=이름을 encodeURIComponent로 보냄)로 사용자를 구분한다.
// 로그인(JWT)이 붙으면 userIdOf()가 토큰에서 사용자를 꺼내도록 바꾸고 헤더 방식은 지운다.
import { AsyncLocalStorage } from "node:async_hooks";
import type { NextFunction, Request, Response } from "express";
import { CheckpointError } from "./checkpoint/types.js";

export const DEFAULT_USER_ID = "demo-user";
const USER_ID = /^[\p{L}\p{N}_-]{1,32}$/u;

export function userIdOf(req: Request): string {
  const raw = req.get("x-user-id");
  if (raw === undefined || raw === "") return DEFAULT_USER_ID;
  let name: string;
  try {
    name = decodeURIComponent(raw).normalize("NFC").trim();
  } catch {
    throw new CheckpointError(400, "사용자 이름을 읽지 못했어요.");
  }
  if (!USER_ID.test(name)) throw new CheckpointError(400, "사용자 이름은 한글·영문·숫자·_·-로 32자 이하만 쓸 수 있어요.");
  return name;
}

/** 요청 처리 중 어디서든(예: LLM 호출 직전) 현재 사용자를 알 수 있게 한다. */
const store = new AsyncLocalStorage<{ userId: string }>();

export function withRequestUser(req: Request, res: Response, next: NextFunction): void {
  let userId: string;
  try {
    userId = userIdOf(req);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
    return;
  }
  store.run({ userId }, next);
}

export const currentUserId = (): string => store.getStore()?.userId ?? DEFAULT_USER_ID;
