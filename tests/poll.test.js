"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createPoll } = require("../src/extension/poll");

test("a tick skipped by the engine does not clear a prior warning", async () => {
  const poll = createPoll({ tick: async () => false }, {
    dismissNotification: () => assert.fail("skipped tick is not recovery"), sendNotification: () => assert.fail("unexpected warning"),
  }, () => {});
  await poll();
});

test("busy ticks stay quiet, real errors deduplicate, and recovery clears stale warnings", async () => {
  const notifications = [], dismissed = [], logs = [];
  let error;
  const poll = createPoll({ tick: async () => { if (error) throw error; } }, {
    sendNotification: value => notifications.push(value), dismissNotification: id => dismissed.push(id),
  }, (...args) => logs.push(args));
  error = Object.assign(new Error("busy"), { code: "VDB_LOCK_BUSY" });
  await poll();
  assert.equal(notifications.length, 0);
  assert.equal(dismissed.length, 0);
  error = undefined;
  await poll();
  assert.deepEqual(dismissed, ["vdb-error"]);
  error = new Error("unknown owner");
  await poll(); await poll();
  assert.equal(notifications.length, 1);
  assert.equal(logs.length, 1);
  error = Object.assign(new Error("busy"), { code: "VDB_LOCK_BUSY" });
  await poll();
  assert.equal(dismissed.length, 1);
  error = undefined;
  await poll(); await poll();
  assert.deepEqual(dismissed, ["vdb-error", "vdb-error"]);
});

test("overlapping polls cannot dismiss an error before an actual successful tick", async () => {
  let finish;
  let calls = 0, dismissals = 0;
  const poll = createPoll({ tick: async () => { calls++; await new Promise(resolve => { finish = resolve; }); } }, {
    dismissNotification: () => { dismissals++; }, sendNotification: () => assert.fail("unexpected warning"),
  }, () => {});
  const pending = poll();
  await poll();
  assert.equal(calls, 1);
  assert.equal(dismissals, 0);
  finish(); await pending;
  assert.equal(dismissals, 1);
});
