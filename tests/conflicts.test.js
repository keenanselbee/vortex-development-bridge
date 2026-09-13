"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { planConflictInheritance } = require("../src/extension/conflicts");
const { createAdapter } = require("../src/extension/adapter");

// Deliberately limited fixture matcher. Production uses Vortex's matcher, not
// this substitute; native reference matching remains a manual acceptance gate.
function matches(mod, ref) {
  if (ref.id && mod.id !== ref.id) return false;
  if (ref.logicalFileName && mod.attributes.logicalFileName !== ref.logicalFileName) return false;
  if (ref.versionMatch && ref.versionMatch !== "*" && mod.attributes.version !== ref.versionMatch) return false;
  if (ref.fileMD5 && mod.attributes.fileMD5 !== ref.fileMD5) return false;
  return !!(ref.id || ref.logicalFileName);
}

function fixture() {
  const deploymentRoot = path.resolve(".codex-temp/unused-conflict-output");
  const mods = {
    old: { id: "old", attributes: { logicalFileName: "Main", version: "1.0.0", fileMD5: "old-hash" } },
    next: { id: "next", attributes: { logicalFileName: "Main", version: "1.0.1", fileMD5: "new-hash", vdbConflictInheritance: "pending" } },
    other: { id: "other", attributes: { logicalFileName: "Other" } },
  };
  const profile = { id: "p1", gameId: "game", modState: { old: { enabled: true }, other: { enabled: true } } };
  const state = { persistent: { mods: { game: mods }, profiles: { p1: profile,
    p2: { id: "p2", gameId: "game", modState: { old: { enabled: true }, other: { enabled: true } } } } } };
  const selections = [{ target: "next", siblings: ["old"], files: [{ path: "data.bin" }], deploymentRoot }];
  const history = [], actions = [];
  const api = { getState: () => state, events: new EventEmitter(), store: { dispatch(action) {
    actions.push(action);
    const mod = mods[action.id];
    if (action.kind === "attribute") mod.attributes[action.key] = action.value;
    if (action.kind === "rule") mod.rules = [...(mod.rules || []), structuredClone(action.rule)];
    if (action.kind === "overrides") mod.fileOverrides = [...action.files];
    if (action.kind === "enabled") state.persistent.profiles[action.profileId].modState[action.id] = { enabled: action.enabled };
  } } };
  const vortex = { selectors: { activeGameId: () => "game", activeProfile: () => profile, installPathForGame: () => "unused" },
    actions: { setModAttribute: (game, id, key, value) => ({ kind: "attribute", id, key, value }),
      addModRule: (game, id, rule) => ({ kind: "rule", id, rule }),
      setFileOverride: (game, id, files) => ({ kind: "overrides", id, files }),
      setModEnabled: (profileId, id, enabled) => ({ kind: "enabled", profileId, id, enabled }) },
    util: { testModReference: matches } };
  const adapter = createAdapter(api, vortex);
  return { mods, profile, state, selections, deploymentRoot, api, vortex, adapter, actions, history,
    context: { mods, profile, state }, progress: async step => history.push(structuredClone(step)) };
}

test("first activation inherits outgoing ordering and surviving file overrides without touching other profiles", async () => {
  const f = fixture();
  const override = path.join(f.deploymentRoot, "data.bin"), removed = path.join(f.deploymentRoot, "removed.bin");
  f.mods.old.rules = [{ type: "after", reference: { id: "other" } }, { type: "requires", reference: { id: "dependency" } }];
  f.mods.old.fileOverrides = [override, removed];
  const old = structuredClone(f.mods.old), p2 = structuredClone(f.state.persistent.profiles.p2);
  await f.adapter.inheritConflicts("game", "p1", f.selections, f.progress);
  assert.deepEqual(f.mods.next.rules, [old.rules[0]]);
  assert.deepEqual(f.mods.next.fileOverrides, [override]);
  assert.deepEqual(f.history[0].conflictInheritance[0].omittedOverrides, [removed]);
  await f.adapter.activate("game", "p1", "next", ["old"]);
  assert.deepEqual(f.mods.old, old);
  assert.deepEqual(f.state.persistent.profiles.p2, p2);
  assert.equal(f.mods.next.attributes.vdbConflictInheritance, "initialized");
  assert.equal(f.profile.modState.next.enabled, true);
});

test("incoming instance ordering is mirrored on the new build and survives another upgrade", async () => {
  const f = fixture();
  f.mods.other.rules = [{ type: "before", reference: { id: "old" } }];
  const other = structuredClone(f.mods.other);
  await f.adapter.inheritConflicts("game", "p1", f.selections, f.progress);
  assert.deepEqual(f.mods.next.rules, [{ type: "after", reference: { id: "other" } }]);
  assert.deepEqual(f.mods.other, other);
  await f.adapter.activate("game", "p1", "next", ["old"]);
  f.mods.third = { id: "third", attributes: { logicalFileName: "Main", vdbConflictInheritance: "pending" } };
  await f.adapter.inheritConflicts("game", "p1", [{ ...f.selections[0], target: "third", siblings: ["next"] }], f.progress);
  assert.deepEqual(f.mods.third.rules, f.mods.next.rules);
  assert.deepEqual(f.mods.other, other);
});

test("stable incoming references are left intact without adding a duplicate", () => {
  const f = fixture();
  f.mods.other.rules = [{ type: "before", reference: { logicalFileName: "Main", versionMatch: "*" } }];
  const plan = planConflictInheritance(f.context, f.selections, matches);
  assert.deepEqual(plan[0].rules, []);
});

test("redundant rules stored on both sides do not overwrite an inherited rule", async () => {
  const f = fixture();
  f.mods.old.rules = [{ type: "after", reference: { id: "other", idHint: "other" }, ignored: false }];
  f.mods.other.rules = [{ type: "before", reference: { id: "old" } }];
  await f.adapter.inheritConflicts("game", "p1", f.selections, f.progress);
  assert.deepEqual(f.mods.next.rules, f.mods.old.rules);
});

test("rollback and intentional empty settings are never overwritten", async () => {
  const f = fixture();
  f.mods.old.rules = [{ type: "after", reference: { id: "other" } }];
  await f.adapter.inheritConflicts("game", "p1", f.selections, f.progress);
  f.mods.next.rules = [];
  f.mods.next.fileOverrides = [];
  const retained = structuredClone(f.mods);
  await f.adapter.inheritConflicts("game", "p1", f.selections, f.progress);
  await f.adapter.inheritConflicts("game", "p1", [{ ...f.selections[0], target: "old", siblings: ["next"] }], f.progress);
  assert.deepEqual(f.mods, retained);
});

for (const saved of ["rules", "fileOverrides", "profile", "legacy"]) {
  test(`preserve ${saved} evidence on a target instead of guessing it is fresh`, async () => {
    const f = fixture();
    f.mods.old.rules = [{ type: "after", reference: { id: "other" } }];
    if (saved === "profile") f.state.persistent.profiles.p2.modState.next = { enabled: false };
    else if (saved === "legacy") delete f.mods.next.attributes.vdbConflictInheritance;
    else f.mods.next[saved] = [];
    await f.adapter.inheritConflicts("game", "p1", f.selections, f.progress);
    assert.deepEqual(f.mods.next.rules || [], []);
    assert.equal(f.actions.some(action => action.kind === "rule" || action.kind === "overrides"), false);
  });
}

for (const reference of [{ id: "old", versionMatch: "1.0.0" }, { id: "old", fileMD5: "old-hash" }]) {
  test(`pinned incoming rule ${JSON.stringify(reference)} rejects before any mutation`, async () => {
    const f = fixture();
    f.mods.other.rules = [{ type: "after", reference }];
    await assert.rejects(f.adapter.inheritConflicts("game", "p1", f.selections, f.progress), /version-specific/);
    assert.deepEqual(f.actions, []);
  });
}

test("contradictions and ambiguous sources reject before any mutation", async () => {
  const f = fixture();
  f.mods.old.rules = [{ type: "after", reference: { id: "other" } }];
  f.mods.other.rules = [{ type: "after", reference: { id: "old" } }];
  await assert.rejects(f.adapter.inheritConflicts("game", "p1", f.selections, f.progress), /Contradictory/);
  assert.deepEqual(f.actions, []);
  await assert.rejects(f.adapter.inheritConflicts("game", "p1", [{ ...f.selections[0], siblings: ["old", "other"] }], f.progress), /Multiple enabled/);
  assert.deepEqual(f.actions, []);
});

test("a cycle through a third mod rejects before any mutation", async () => {
  const f = fixture();
  f.mods.old.rules = [{ type: "after", reference: { id: "other" } }];
  f.mods.other.rules = [{ type: "after", reference: { id: "middle" } }];
  f.mods.middle = { id: "middle", attributes: {}, rules: [{ type: "after", reference: { id: "old" } }] };
  f.profile.modState.middle = { enabled: true };
  await assert.rejects(f.adapter.inheritConflicts("game", "p1", f.selections, f.progress), /cycle/);
  assert.deepEqual(f.actions, []);
});

test("coordinated main and textures rules refer to the new pair and preserve the old pair", async () => {
  const f = fixture();
  f.mods.textureOld = { id: "textureOld", attributes: { logicalFileName: "Textures" } };
  f.mods.textureNext = { id: "textureNext", attributes: { logicalFileName: "Textures", vdbConflictInheritance: "pending" } };
  f.profile.modState.textureOld = { enabled: true };
  f.mods.old.rules = [{ type: "after", reference: { id: "textureOld" } }];
  f.mods.textureOld.rules = [{ type: "before", reference: { id: "other" } }];
  const old = structuredClone(f.mods.old), textures = structuredClone(f.mods.textureOld);
  const selections = [...f.selections, { ...f.selections[0], target: "textureNext", siblings: ["textureOld"] }];
  await f.adapter.inheritConflicts("game", "p1", selections, f.progress);
  assert.deepEqual(f.mods.next.rules, [{ type: "after", reference: { id: "textureNext" } }]);
  assert.ok(f.mods.textureNext.rules.some(rule => rule.type === "before" && rule.reference.id === "next"));
  assert.deepEqual(f.mods.old, old);
  assert.deepEqual(f.mods.textureOld, textures);
});

test("batch preflight rejects a later invalid selection before changing the first", async () => {
  const f = fixture();
  f.mods.textureOld = { id: "textureOld", attributes: {} };
  f.mods.textureNext = { id: "textureNext", attributes: { vdbConflictInheritance: "applying" } };
  await assert.rejects(f.adapter.inheritConflicts("game", "p1", [...f.selections,
    { ...f.selections[0], target: "textureNext", siblings: ["textureOld"] }], f.progress), /Interrupted/);
  assert.deepEqual(f.actions, []);
});

test("missing Vortex APIs, changed state and interrupted writes cannot enable a new build", async () => {
  const f = fixture();
  f.mods.old.rules = [{ type: "after", reference: { id: "other" } }];
  delete f.vortex.actions.addModRule;
  await assert.rejects(f.adapter.inheritConflicts("game", "p1", f.selections, f.progress), /actions are unavailable/);
  assert.deepEqual(f.actions, []);
  f.vortex.actions.addModRule = (game, id, rule) => ({ kind: "rule", id, rule });
  await assert.rejects(f.adapter.inheritConflicts("game", "p1", f.selections, async () => { f.mods.other.rules = []; }), /changed while planning/);
  assert.deepEqual(f.actions, []);
  f.vortex.actions.setFileOverride = () => { throw new Error("fixture interrupted write"); };
  await assert.rejects(f.adapter.inheritConflicts("game", "p1", f.selections, f.progress), /interrupted write/);
  assert.equal(f.mods.next.attributes.vdbConflictInheritance, "applying");
  assert.equal(f.profile.modState.next, undefined);
  await assert.rejects(f.adapter.inheritConflicts("game", "p1", f.selections, f.progress), /Interrupted/);
});

test("an edit during marker writes is preserved and blocks rule application", async () => {
  const f = fixture();
  f.mods.old.rules = [{ type: "after", reference: { id: "other" } }];
  const dispatch = f.api.store.dispatch;
  f.api.store.dispatch = action => {
    dispatch(action);
    if (action.kind === "attribute" && action.value === "applying") f.mods.next.fileOverrides = [];
  };
  await assert.rejects(f.adapter.inheritConflicts("game", "p1", f.selections, f.progress), /changed while planning or applying/);
  assert.deepEqual(f.mods.next.fileOverrides, []);
  assert.equal(f.actions.some(action => action.kind === "rule"), false);
});
