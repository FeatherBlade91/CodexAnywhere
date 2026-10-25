import test from 'node:test';
import assert from 'node:assert/strict';
import { createModelCache } from '../src/core/model-cache.mjs';
const tick = () => new Promise(resolve => setImmediate(resolve));
test('cold requests coalesce; stale requests return immediately during refresh', async () => {
  let now = 0, calls = 0, deferred = Promise.withResolvers();
  const cache = createModelCache(() => { calls++; return deferred.promise; }, { now: () => now });
  const a = cache.get(), b = cache.get(); await tick(); assert.equal(calls, 1);
  deferred.resolve(['old']); assert.deepEqual(await a, await b);
  now = 61_000; deferred = Promise.withResolvers();
  assert.deepEqual(await cache.get(), ['old']); await tick(); assert.equal(calls, 2);
  assert.deepEqual(await cache.get(), ['old']);
  const explicit = cache.get(true); deferred.resolve(['new']); await explicit;
  assert.deepEqual(await cache.get(), ['new']); assert.equal(calls, 2);
});
test('background failures retain usable models and back off; explicit failures surface', async () => {
  let now = 0, calls = 0, fail = false;
  const cache = createModelCache(async () => { calls++; if (fail) throw Error('offline'); return ['model']; }, { now: () => now });
  await cache.get(); fail = true; now = 61_000;
  assert.deepEqual(await cache.get(), ['model']); await tick();
  await cache.get(); assert.equal(calls, 2);
  await assert.rejects(cache.get(true), /offline/);
  now = 4_000_000; await assert.rejects(cache.get(), /offline/);
});
test('clearing during refresh cannot repopulate catalog or clobber a newer pending load', async () => {
  const old = Promise.withResolvers(), next = Promise.withResolvers(); let calls = 0;
  const cache = createModelCache(() => (++calls === 1 ? old.promise : next.promise));
  const a = cache.get(); await tick(); cache.clear(); const b = cache.get(); await tick();
  old.resolve(['old-account']); await a;
  const c = cache.get(); next.resolve(['new-account']);
  assert.deepEqual(await b, ['new-account']); assert.deepEqual(await c, ['new-account']);
  assert.equal(calls, 2); assert.deepEqual(await cache.get(), ['new-account']);
});

test('slow or failed UI persistence never blocks inference and newer snapshots win', async () => {
  const gate = Promise.withResolvers(); let loads = 0; const saved = [];
  const cache = createModelCache(async () => [++loads], { onUpdate: async ({ value }) => {
    if (value[0] === 1) await gate.promise;
    saved.push(value[0]);
    if (value[0] === 1) throw Error('disk failure');
  } });
  assert.deepEqual(await cache.get(), [1]);
  assert.deepEqual(await cache.get(true), [2]);
  assert.deepEqual(await cache.get(), [2]);
  assert.deepEqual(saved, []);
  gate.resolve(); await tick();
  assert.deepEqual(saved, [1, 2]);
});

test('clearing a catalog discards queued persistence from the old generation', async () => {
  const gate = Promise.withResolvers(); let loads = 0; const saved = [];
  const cache = createModelCache(async () => [++loads], { onUpdate: async ({ value }) => {
    if (value[0] === 1) await gate.promise;
    saved.push(value[0]);
  } });
  await cache.get(); await cache.get(true); cache.clear(); await cache.get();
  gate.resolve(); await tick();
  assert.deepEqual(saved, [1, 3]);
});
