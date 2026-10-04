import * as core from "@actions/core";
import { jules, type SessionClient, type SourceInput } from "@google/jules-sdk";
import { ReviewResult } from "./types.js";
import { parseReviewResponse } from "./validation.js";
import {
  getErrorMessage,
  isAuthError,
  isQuotaError,
  AuthError,
  QuotaExceededError,
  QUOTA_HINT,
} from "./errors.js";
import { logStructured } from "./logging.js";
import { sleep } from "./utils.js";

type PollableSession = SessionClient & { hydrate: () => Promise<number> };

const PARSE_FAILURE_REVIEW: ReviewResult = {
  summary:
    "Jules returned an invalid response that could not be parsed. No valid code review comments are present.",
  verdict: "block",
  resolvedCommentIds: [],
  newComments: [],
  unparseable: true,
};

export type SessionOutcome =
  | { kind: "review"; reviewResult: ReviewResult; sessionId: string }
  | { kind: "timeout"; sessionId: string }
  | { kind: "creation_failed"; sessionId: ""; error: unknown };

export interface RunSessionOptions {
  apiKey: string;
  prompt: string;
  source: SourceInput;
  title: string;
  timeoutMinutes: number;
}

export async function runSession(
  options: RunSessionOptions
): Promise<SessionOutcome> {
  const customJules = jules.with({ apiKey: options.apiKey });
  core.info("Creating Jules session…");

  let session: SessionClient;
  try {
    session = await customJules.session({
      prompt: options.prompt,
      source: options.source,
      requireApproval: false,
      title: options.title,
      autoPr: false,
    });
  } catch (err) {
    return {
      kind: "creation_failed",
      sessionId: "",
      error: wrapJulesError(err) ?? err,
    };
  }
  core.info(`Jules session: ${session.id}`);

  try {
    await waitUntilSessionReady(session);

    const reviewMessage = await pollForReview(
      session as PollableSession,
      options.timeoutMinutes * 60 * 1000
    );
    core.info(`Collected review (${reviewMessage.length} chars)`);

    if (!reviewMessage) {
      await archiveSession(session);
      return { kind: "timeout", sessionId: session.id };
    }

    let reviewResult: ReviewResult;
    try {
      reviewResult = parseReviewResponse(reviewMessage);
    } catch (err) {
      const msg = getErrorMessage(err);
      logStructured("review_failed", {
        reason: msg,
        stage: "parse",
        kind: "parse",
      });
      core.error(`Failed to parse Jules response: ${msg}`);
      await archiveSession(session);
      return {
        kind: "review",
        reviewResult: PARSE_FAILURE_REVIEW,
        sessionId: session.id,
      };
    }

    await archiveSession(session);
    return { kind: "review", reviewResult, sessionId: session.id };
  } catch (err) {
    await archiveSession(session);
    throw err;
  }
}

async function waitUntilSessionReady(session: {
  id: string;
  info: () => Promise<unknown>;
}): Promise<void> {
  const maxAttempts = 20;
  let delay = 2000;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await session.info();
      core.info(`Session ${session.id} is ready after ${i + 1} attempt(s).`);
      return;
    } catch (err) {
      const wrapped = wrapJulesError(err);
      if (wrapped) throw wrapped;
      const msg = getErrorMessage(err);
      if (!msg.includes("404")) {
        throw new Error(`Jules session.info() failed: ${msg}`, { cause: err });
      }
      core.info(`Session not yet ready (attempt ${i + 1}/${maxAttempts})…`);
      await sleep(delay);
      delay = Math.min(delay * 1.5, 15000);
    }
  }
  throw new Error("Session did not become ready within timeout.");
}

/**
 * Some Jules sessions finish without emitting an `agentMessaged` activity: the agent writes its
 * output into a workspace file instead, which reaches us as an activity artifact carrying a
 * changeSet git patch. Reconstruct the added lines of every patched file and return the last
 * candidate whose content looks like the review (a verdict-bearing payload), so later revisions
 * win over scratch files and earlier drafts.
 */
interface PatchArtifact {
  changeSet?: { gitPatch?: { unidiffPatch?: string } };
}

function addedLinesFromPatch(fileSection: string): string[] {
  const added: string[] = [];
  let inHunk = false;
  for (const line of fileSection.split("\n")) {
    if (line.startsWith("@@")) {
      inHunk = true;
    } else if (inHunk && line.startsWith("+") && !line.startsWith("+++")) {
      added.push(line.slice(1));
    }
  }
  return added;
}

function extractReviewFromArtifacts(activities: unknown[]): string {
  let candidate = "";
  for (const activity of activities) {
    const artifacts = (activity as { artifacts?: unknown })?.artifacts;
    if (!Array.isArray(artifacts)) continue;
    for (const artifact of artifacts as PatchArtifact[]) {
      const patch = artifact?.changeSet?.gitPatch?.unidiffPatch;
      if (typeof patch !== "string") continue;
      const sections = patch.split("diff --git ").slice(1);
      for (const fileSection of sections) {
        const text = addedLinesFromPatch(fileSection)
          .join("\n")
          .trim();
        const looksLikeReview =
          text && /"verdict"\s*:\s*"(approve|comment|block)"/i.test(text);
        if (looksLikeReview) {
          candidate = text;
        }
      }
    }
  }
  return candidate;
}

async function pollForReview(
  session: PollableSession,
  timeoutMs: number
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    try {
      await session.hydrate();
      let last = "";
      const activities: unknown[] = [];
      for await (const a of session.history()) {
        activities.push(a);
        if (a.type === "agentMessaged") last = a.message;
      }
      if (last) {
        core.info(`Got agentMessaged on attempt ${attempt}.`);
        return last;
      }
      // Fallback: the session may have completed without ever sending the review as an agent
      // message. If it reached a terminal state, try recovering the review from artifacts and
      // bail out early instead of pointlessly waiting for deadline.
      const info = (await session.info()) as { state?: string } | undefined;
      const state = String(info?.state ?? "").toUpperCase();
      if (state === "COMPLETED" || state === "FAILED") {
        const recovered = extractReviewFromArtifacts(activities);
        if (recovered) {
          core.info(
            `Session ${state.toLowerCase()} with no agentMessaged — using review recovered from artifacts (attempt ${attempt}).`
          );
          return recovered;
        }
        core.info(
          `Session ${state.toLowerCase()} with no agentMessaged and no verdict-bearing artifacts.`
        );
        return "";
      }
      core.info(`No agentMessaged yet (attempt ${attempt})…`);
    } catch (err) {
      const wrapped = wrapJulesError(err);
      if (wrapped) throw wrapped;
      core.info(
        `hydrate/history error (attempt ${attempt}): ${getErrorMessage(err)}`
      );
    }
    await sleep(20_000);
  }
  return "";
}

/** Wrap a Jules API error in an actionable typed error, or return null. */
function wrapJulesError(err: unknown): QuotaExceededError | AuthError | null {
  const msg = getErrorMessage(err);
  if (isQuotaError(msg)) {
    return new QuotaExceededError(quotaMessage(msg), { cause: err });
  }
  if (isAuthError(msg)) {
    return new AuthError(authMessage(msg), { cause: err });
  }
  return null;
}

function quotaMessage(msg: string): string {
  return `Jules API quota or rate limit exceeded (${msg}). ${QUOTA_HINT}`;
}

function authMessage(msg: string): string {
  return `Jules API rejected request (${msg}). Check JULES_API_KEY is valid.`;
}

async function archiveSession(session: {
  id: string;
  archive: () => Promise<void>;
}): Promise<void> {
  try {
    await session.archive();
    core.info(`Archived session ${session.id}.`);
  } catch (err) {
    core.warning(
      `Failed to archive session ${session.id}: ${getErrorMessage(err)}`
    );
  }
}
