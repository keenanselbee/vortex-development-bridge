"use strict";

// Vortex is injected so the same contracts can be exercised without a live game.
function createAdapter(api, vortex) {
  function context(gameId, profileId) {
    const state = api.getState();
    if (vortex.selectors.activeGameId(state) !== gameId) throw new Error(`Activate game '${gameId}' in Vortex first`);
    const profile = vortex.selectors.activeProfile(state);
    if (profileId && (profile?.id !== profileId || profile.gameId !== gameId)) throw new Error("The requested profile is not active; no profile was switched");
    const stagingRoot = vortex.selectors.installPathForGame(state, gameId);
    if (!stagingRoot) throw new Error("Vortex has no staging directory for this game");
    return { state, profile, stagingRoot, mods: state.persistent?.mods?.[gameId] || {} };
  }
  function callbackEvent(name, args, timeout = 30000, callbackFirst = false) {
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = error => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (error) reject(new Error(`${name}: ${error.message || error}`)); else resolve();
      };
      const timer = setTimeout(() => finish(new Error("Timed out; operation outcome may be unknown. Inspect Vortex before retrying.")), timeout);
      try {
        const emitted = callbackFirst ? api.events.emit(name, finish, ...args) : api.events.emit(name, ...args, finish);
        if (emitted === false) finish(new Error("No Vortex handler is available"));
      } catch (error) { finish(error); }
    });
  }
  async function attributes(gameId, id, values) {
    for (const [key, value] of Object.entries(values)) api.store.dispatch(vortex.actions.setModAttribute(gameId, id, key, value));
    const deadline = Date.now() + 5000;
    do {
      const actual = api.getState().persistent?.mods?.[gameId]?.[id]?.attributes || {};
      if (Object.entries(values).every(([key, value]) => JSON.stringify(actual[key]) === JSON.stringify(value))) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    } while (Date.now() < deadline);
    throw new Error("Vortex did not retain the requested attributes");
  }
  return {
    context,
    async register(gameId, mod) {
      await callbackEvent("create-mod", [gameId, mod]);
      if (!api.getState().persistent?.mods?.[gameId]?.[mod.id]) throw new Error("Vortex did not retain the staged mod entry");
    },
    attributes,
    async activate(gameId, profileId, target, siblings) {
      context(gameId, profileId);
      if (typeof vortex.actions.setModEnabled !== "function") throw new Error("Vortex profile activation action is unavailable");
      const options = { allowAutoDeploy: false, reason: "version_update" };
      for (const id of siblings) api.store.dispatch(vortex.actions.setModEnabled(profileId, id, false));
      if (siblings.length) api.events.emit("mods-enabled", siblings, false, gameId, options);
      api.store.dispatch(vortex.actions.setModEnabled(profileId, target, true));
      api.events.emit("mods-enabled", [target], true, gameId, options);
      const { profile } = context(gameId, profileId);
      if (!profile.modState?.[target]?.enabled || siblings.some(id => profile.modState?.[id]?.enabled)) throw new Error("Profile activation did not settle as requested");
    },
    async deploy(gameId, profileId) {
      context(gameId, profileId);
      // Verified against mod_management/index.ts: callback precedes profileId.
      await callbackEvent("deploy-mods", [profileId, undefined, { manual: true }], 600000, true);
      context(gameId, profileId);
    },
    deploymentRoot(gameId, modType) {
      const { state } = context(gameId);
      const discovery = state.settings?.gameMode?.discovered?.[gameId];
      const game = vortex.util.getGame(gameId);
      const target = discovery?.path && game?.getModPaths(discovery.path)?.[modType || ""];
      if (!target) throw new Error(`No deployment path for mod type '${modType || "default"}'`);
      return target;
    },
    snapshot() {
      const state = api.getState();
      const profile = vortex.selectors.activeProfile(state);
      const gameId = vortex.selectors.activeGameId(state);
      return { activeGameId: gameId, activeProfileId: profile?.id,
        profiles: Object.values(state.persistent?.profiles || {}).map(p => ({ id: p.id, gameId: p.gameId, name: p.name })),
        games: Object.keys(state.settings?.gameMode?.discovered || {}),
        managed: Object.entries(state.persistent?.mods || {}).flatMap(([game, mods]) => Object.entries(mods)
          .filter(([, mod]) => mod.attributes?.vdbProjectId)
          .map(([id, mod]) => ({ gameId: game, id, type: mod.type, ...mod.attributes, enabled: game === gameId && !!profile?.modState?.[id]?.enabled }))),
      };
    },
  };
}

module.exports = { createAdapter };
