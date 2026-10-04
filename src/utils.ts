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
  if (ms < 0) {
    return Promise.reject(
      new Error("sleep delay must be a non-negative number")
    );
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}
