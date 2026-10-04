1. Edit `src/utils.ts` using `replace_with_git_merge_diff` to add the `mapConcurrent` utility function:
```typescript
<<<<<<< SEARCH
export function sleep(ms: number): Promise<void> {
=======
/**
 * Maps an array concurrently with a given bounded concurrency limit.
 */
export async function mapConcurrent<T, R>(
  items: T[],
  mapper: (item: T, index: number) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = [];
  const iterator = items[Symbol.iterator]();
  let index = 0;

  async function worker() {
    for (;;) {
      const { value, done } = iterator.next();
      if (done) break;
      const i = index++;
      results[i] = await mapper(value, i);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

export function sleep(ms: number): Promise<void> {
>>>>>>> REPLACE
```

2. Verify modifications to `src/utils.ts` using `read_file`.

3. Edit `tests/utils.test.ts` using `replace_with_git_merge_diff` to add comprehensive tests for `mapConcurrent`:
```typescript
<<<<<<< SEARCH
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sleep } from "../src/utils.js";

describe("sleep utility", () => {
=======
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sleep, mapConcurrent } from "../src/utils.js";

describe("mapConcurrent utility", () => {
  it("should process items with bounded concurrency", async () => {
    const active = vi.fn();
    let maxConcurrent = 0;
    let currentConcurrent = 0;

    const items = [1, 2, 3, 4, 5];
    const mapper = async (item: number) => {
      currentConcurrent++;
      maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
      active(item);
      await sleep(10);
      currentConcurrent--;
      return item * 2;
    };

    const results = await mapConcurrent(items, mapper, 2);
    expect(results).toEqual([2, 4, 6, 8, 10]);
    expect(maxConcurrent).toBeLessThanOrEqual(2);
    expect(active).toHaveBeenCalledTimes(5);
  });

  it("should handle empty arrays", async () => {
    const results = await mapConcurrent([], async (x) => x, 2);
    expect(results).toEqual([]);
  });

  it("should propagate errors from the mapper", async () => {
    const items = [1, 2, 3];
    const mapper = async (item: number) => {
      if (item === 2) throw new Error("Fail");
      return item;
    };
    await expect(mapConcurrent(items, mapper, 2)).rejects.toThrow("Fail");
  });
});

describe("sleep utility", () => {
>>>>>>> REPLACE
```

4. Verify modifications to `tests/utils.test.ts` using `read_file`.

5. Edit `src/github.ts` using `replace_with_git_merge_diff` to refactor `resolveThreads`:
```typescript
<<<<<<< SEARCH
import { getErrorMessage } from "./errors.js";
=======
import { getErrorMessage } from "./errors.js";
import { mapConcurrent } from "./utils.js";
>>>>>>> REPLACE
<<<<<<< SEARCH
export async function resolveThreads(
  octokit: ReturnType<typeof github.getOctokit>,
  threadIds: string[]
): Promise<void> {
  for (const id of threadIds) {
    try {
      await withRetry(
        () =>
          octokit.graphql(
            `
          mutation($id: ID!) {
            resolveReviewThread(input: {threadId: $id}) {
              thread { isResolved }
            }
          }
        `,
            { id }
          ),
        GITHUB_RETRY_OPTIONS
      );
      core.info(`Resolved thread ${id}`);
    } catch (e) {
      core.warning(`Failed to resolve thread ${id}: ${e}`);
    }
  }
}
=======
export async function resolveThreads(
  octokit: ReturnType<typeof github.getOctokit>,
  threadIds: string[]
): Promise<void> {
  await mapConcurrent(
    threadIds,
    async (id) => {
      try {
        await withRetry(
          () =>
            octokit.graphql(
              `
          mutation($id: ID!) {
            resolveReviewThread(input: {threadId: $id}) {
              thread { isResolved }
            }
          }
        `,
              { id }
            ),
          GITHUB_RETRY_OPTIONS
        );
        core.info(`Resolved thread ${id}`);
      } catch (e) {
        core.warning(`Failed to resolve thread ${id}: ${e}`);
      }
    },
    5
  );
}
>>>>>>> REPLACE
```

6. Verify modifications to `src/github.ts` using `read_file`.

7. Edit `src/pathRules.ts` using `replace_with_git_merge_diff` to refactor `loadPerPathRules`:
```typescript
<<<<<<< SEARCH
import { listFilesInDirectory, loadRulesFromBase } from "./github.js";
=======
import { listFilesInDirectory, loadRulesFromBase } from "./github.js";
import { mapConcurrent } from "./utils.js";
>>>>>>> REPLACE
<<<<<<< SEARCH
  if (matched.length === 0) {
    return [];
  }

  const rules: PathRuleFile[] = [];
  for (const candidate of matched) {
    const content = await loadRulesFromBase(
      octokit,
      owner,
      repo,
      candidate.path,
      baseSha
    );
    if (content === undefined) {
      continue;
    }
    rules.push({ path: candidate.path, glob: candidate.glob, content });
  }

  if (rules.length > 0) {
=======
  if (matched.length === 0) {
    return [];
  }

  const results = await mapConcurrent(
    matched,
    async (candidate) => {
      const content = await loadRulesFromBase(
        octokit,
        owner,
        repo,
        candidate.path,
        baseSha
      );
      if (content === undefined) {
        return undefined;
      }
      return { path: candidate.path, glob: candidate.glob, content };
    },
    5
  );

  const rules: PathRuleFile[] = results.filter((r): r is PathRuleFile => r !== undefined);

  if (rules.length > 0) {
>>>>>>> REPLACE
```

8. Verify modifications to `src/pathRules.ts` using `read_file`.

9. Edit `src/evaluator.ts` using `replace_with_git_merge_diff` to refactor `loadCases`:
```typescript
<<<<<<< SEARCH
import { parseReviewResponse } from "./validation.js";
=======
import { parseReviewResponse } from "./validation.js";
import { mapConcurrent } from "./utils.js";
>>>>>>> REPLACE
<<<<<<< SEARCH
  const cases: EvalCase[] = [];
  for (const file of files) {
    const raw = await fs.readFile(path.join(casesDir, file), "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    cases.push(validateEvalCase(parsed, file));
  }

  return cases;
=======
  const cases = await mapConcurrent(
    files,
    async (file) => {
      const raw = await fs.readFile(path.join(casesDir, file), "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      return validateEvalCase(parsed, file);
    },
    5
  );

  return cases;
>>>>>>> REPLACE
```

10. Verify modifications to `src/evaluator.ts` using `read_file`.

11. Run formatting and verification checks: execute `run_in_bash_session` with `pnpm lint`, `pnpm format`, `pnpm test`, `pnpm coverage`, and `pnpm build`.
12. Complete pre commit steps to ensure proper testing, verification, review, and reflection are done.
13. Submit a Pull Request formatted for Catalyst persona: "🚀 Catalyst: [Enhancement] Add and integrate mapConcurrent utility".
    Description:
    - 🎯 **Purpose**: Add `mapConcurrent` utility for bounded asynchronous mapping to improve performance for operations involving multiple API calls/file I/O.
    - 🔧 **Implementation**: Implemented `mapConcurrent` in `src/utils.ts` and comprehensive test suite in `tests/utils.test.ts`.
    - 🔗 **Integration**: Refactored `resolveThreads` in `src/github.ts`, `loadPerPathRules` in `src/pathRules.ts`, and `loadCases` in `src/evaluator.ts` to utilize it.
    - ✅ **Verification**: Covered with tests, local checks successfully run.
