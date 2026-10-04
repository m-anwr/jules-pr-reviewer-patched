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
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should resolve after the specified positive delay", async () => {
    let resolved = false;
    const promise = sleep(100).then(() => {
      resolved = true;
    });

    expect(resolved).toBe(false);

    vi.advanceTimersByTime(50);
    // await a microtask to allow promises to settle
    await Promise.resolve();
    expect(resolved).toBe(false);

    vi.advanceTimersByTime(50);
    await promise;
    expect(resolved).toBe(true);
  });

  it("should resolve immediately when delay is 0", async () => {
    let resolved = false;
    const promise = sleep(0).then(() => {
      resolved = true;
    });

    expect(resolved).toBe(false);

    vi.advanceTimersByTime(0);
    await promise;
    expect(resolved).toBe(true);
  });

  it("should reject when delay is negative", async () => {
    await expect(sleep(-1)).rejects.toThrow(
      "sleep delay must be a non-negative number"
    );
  });
});
