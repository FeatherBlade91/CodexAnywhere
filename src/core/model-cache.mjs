// A bounded stale-while-revalidate catalog. Explicit refreshes still await the
// server; failed background refreshes retain the last successful catalog.
export function createModelCache(load, { now = Date.now, ttl = 60_000, maxStale = 3_600_000, retryDelay = 10_000, onUpdate } = {}) {
  let cached, pending, generation = 0, retryAt = 0;
  let persistence = Promise.resolve();
  function refresh() {
    if (pending) return pending;
    const epoch = generation;
    const operation = Promise.resolve().then(load).then(value => {
      if (epoch === generation) {
        cached = { value, time: now() }; retryAt = 0;
        const snapshot = cached;
        // UI persistence must never delay inference or turn a disk failure into
        // a generation failure. Serialize writes to avoid older snapshots winning.
        if (onUpdate) persistence = persistence.then(() => {
          if (epoch === generation && cached === snapshot) return onUpdate(snapshot);
        }).catch(() => {});
      }
      return value;
    }).catch(error => {
      if (epoch === generation) retryAt = now() + retryDelay;
      throw error;
    }).finally(() => { if (pending === operation) pending = undefined; });
    pending = operation;
    return operation;
  }
  return {
    clear() { generation++; cached = undefined; pending = undefined; retryAt = 0; },
    async get(force = false) {
      if (!force && cached && now() - cached.time < maxStale) {
        if (now() - cached.time >= ttl && now() >= retryAt) refresh().catch(() => {});
        return cached.value;
      }
      return refresh();
    },
  };
}
