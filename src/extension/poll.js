"use strict";

function createPoll(engine, api, log) {
  let lastError;
  let running = false;
  let recovered = false;
  return async () => {
    if (running) return;
    running = true;
    try {
      if (await engine.tick() === false) return;
      // Also clear notifications retained by Vortex across an extension restart.
      if (!recovered || lastError) api.dismissNotification("vdb-error");
      recovered = true;
      lastError = undefined;
    } catch (error) {
      if (error.code === "VDB_LOCK_BUSY") return;
      if (error.message !== lastError) {
        log("error", "Vortex Development Bridge stopped processing", { error: error.message });
        api.sendNotification({ id: "vdb-error", type: "error", title: "Development Bridge needs attention", message: error.message });
      }
      lastError = error.message;
    } finally { running = false; }
  };
}

module.exports = { createPoll };
