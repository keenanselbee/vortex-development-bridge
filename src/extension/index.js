"use strict";
const path = require("node:path");
const vortex = require("vortex-api");
const { Engine } = require("./engine");
const { createAdapter } = require("./adapter");
const { BridgePage } = require("./page");

function main(context) {
  const resolver = context.api.getVortexPath || vortex.util.getVortexPath;
  if (typeof resolver !== "function") throw new Error("Vortex does not expose its user-data directory");
  const root = path.join(resolver.call(context.api, "userData"), "vortex-development-bridge");
  const engine = new Engine(root, createAdapter(context.api, vortex));
  context.registerMainPage("workshop", "Development Bridge", BridgePage, {
    id: "vortex-development-bridge", group: "global", props: () => ({ root, engine }),
  });
  context.once(() => {
    let lastError;
    const tick = async () => {
      try { await engine.tick(); lastError = undefined; }
      catch (error) {
        if (error.message !== lastError) {
          vortex.log("error", "Vortex Development Bridge stopped processing", { error: error.message });
          context.api.sendNotification({ id: "vdb-error", type: "error", title: "Development Bridge needs attention", message: error.message });
        }
        lastError = error.message;
      }
    };
    void tick();
    const timer = setInterval(tick, 5000);
    timer.unref?.();
  });
  return true;
}
module.exports = { default: main };
