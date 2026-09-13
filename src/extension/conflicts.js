"use strict";

const path = require("node:path");
const { isDeepStrictEqual } = require("node:util");

function ordering(rule) {
  return rule && ["before", "after"].includes(rule.type) && !rule.ignored;
}

function transferable(rule) {
  return Object.keys(rule).every(key => ["type", "reference", "ignored"].includes(key));
}

// Only the local instance ID may change. Version, archive and source constraints
// must still match through Vortex's own reference matcher.
function replacementReference(rule, previous, target, matches) {
  const reference = { ...rule.reference };
  if (reference.id === previous.id) reference.id = target.id;
  delete reference.idHint;
  delete reference.md5Hint;
  if (!transferable(rule) || !matches(target, reference)) {
    throw new Error(`Cannot inherit version-specific or custom ordering rule for '${previous.id}'. Review its rules in Vortex before activating '${target.id}'.`);
  }
  return reference;
}

function checkCycles(mods, enabled, matches) {
  const edges = new Map([...enabled].map(id => [id, new Set()]));
  for (const id of enabled) {
    for (const rule of (mods[id].rules || []).filter(ordering)) {
      const targets = [...enabled].filter(other => matches(mods[other], rule.reference));
      if (targets.length > 1) throw new Error(`Ambiguous ordering rule on '${id}'; review conflict rules in Vortex before activation.`);
      for (const other of targets) {
        const [before, after] = rule.type === "before" ? [id, other] : [other, id];
        edges.get(before).add(after);
      }
    }
  }
  const visiting = new Set(), visited = new Set();
  function visit(id) {
    if (visiting.has(id)) throw new Error("Inherited conflict rules would create an ordering cycle; review the rules in Vortex before activation.");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const next of edges.get(id)) visit(next);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of enabled) visit(id);
}

function planConflictInheritance(context, selections, matches) {
  const { mods, profile, state } = context;
  const updates = [];
  const replacements = new Map();
  for (const selection of selections) {
    for (const id of selection.siblings) replacements.set(id, selection.target);
  }
  const enabled = new Set(Object.keys(mods).filter(id => profile.modState?.[id]?.enabled));
  for (const { target, siblings } of selections) {
    siblings.forEach(id => enabled.delete(id));
    enabled.add(target);
  }

  for (const { target, siblings, files, deploymentRoot } of selections) {
    const mod = mods[target];
    const marker = mod.attributes?.vdbConflictInheritance;
    if (marker === "applying") throw new Error(`Interrupted conflict inheritance for '${target}'; inspect its receipt and Vortex rules before recovery.`);
    // Older stages are retained versions, even when they have no rules. An
    // explicit empty list or any profile history also counts as a saved choice.
    if (marker !== "pending") continue;
    const touched = Object.hasOwn(mod, "rules") || Object.hasOwn(mod, "fileOverrides")
      || Object.values(state.persistent?.profiles || {}).some(p => p.gameId === profile.gameId && Object.hasOwn(p.modState || {}, target));
    if (touched) {
      updates.push({ target, disposition: "preserved" });
      continue;
    }
    if (siblings.length > 1) throw new Error(`Multiple enabled versions could supply conflict rules for '${target}'; select one previous version in Vortex first.`);
    const source = siblings[0];
    const rules = [];
    const add = rule => {
      const existing = rules.find(candidate => isDeepStrictEqual(candidate.reference, rule.reference));
      if (existing && existing.type !== rule.type) throw new Error(`Contradictory inherited ordering rules for '${target}'; review them in Vortex before activation.`);
      if (!existing) rules.push(structuredClone(rule));
    };
    if (source) {
      for (const rule of (mods[source].rules || []).filter(ordering)) {
        let inherited = structuredClone(rule);
        const replaced = [...replacements.keys()].filter(id => matches(mods[id], rule.reference));
        if (replaced.length > 1) throw new Error(`Ambiguous ordering rule on '${source}'; review it before activation.`);
        if (replaced.length) {
          const previous = mods[replaced[0]], next = mods[replacements.get(replaced[0])];
          inherited.reference = replacementReference(rule, previous, next, matches);
        }
        add(inherited);
      }
      // Mirror incoming ordering onto the new record instead of rewriting its
      // owner. Older builds and profiles retain their original relationships.
      for (const [ownerId, owner] of Object.entries(mods)) {
        if (ownerId === source || ownerId === target) continue;
        for (const rule of (owner.rules || []).filter(ordering)) {
          if (!matches(mods[source], rule.reference) || matches(mod, rule.reference)) continue;
          replacementReference(rule, mods[source], mod, matches);
          const newOwner = replacements.get(ownerId) || ownerId;
          if (newOwner === target) throw new Error(`Inherited ordering rule would refer to its own package '${target}'.`);
          const type = rule.type === "before" ? "after" : "before";
          if (!rules.some(existing => existing.type === type && matches(mods[newOwner], existing.reference))) {
            add({ type, reference: { id: newOwner } });
          }
        }
      }
    }
    const outputPaths = new Set(files.map(file => path.resolve(deploymentRoot, file.path).toLowerCase()));
    const overrides = mods[source]?.fileOverrides || [];
    if (!Array.isArray(overrides) || overrides.some(file => typeof file !== "string" || !path.isAbsolute(file))) {
      throw new Error(`Unsupported file override paths on '${source}'; review them in Vortex before activation.`);
    }
    const fileOverrides = overrides.filter(file => outputPaths.has(path.resolve(file).toLowerCase()));
    updates.push({ target, source: source || null, disposition: "inherited", rules, fileOverrides,
      omittedOverrides: overrides.filter(file => !fileOverrides.includes(file)) });
  }
  if (updates.some(update => update.rules?.length)) {
    if (typeof matches !== "function") throw new Error("Vortex rule matching API is unavailable");
    const proposed = { ...mods };
    for (const update of updates) if (update.rules) proposed[update.target] = { ...mods[update.target], rules: update.rules };
    checkCycles(proposed, enabled, matches);
  }
  return updates;
}

module.exports = { planConflictInheritance };
