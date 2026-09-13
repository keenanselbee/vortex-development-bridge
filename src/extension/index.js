"use strict";
const path = require("node:path");
const vortex = require("vortex-api");
const { Engine } = require("./engine");
const { createAdapter } = require("./adapter");
const { BridgePage } = require("./page");
const { createPoll } = require("./poll");

function main(context) {
  let root;
  let engine;
  context.registerMainPage("workshop", "Development Bridge", BridgePage, {
    id: "vortex-development-bridge", group: "global", props: () => ({ root, engine }),
  });
  context.once(() => {
    const resolver = context.api.getVortexPath || vortex.util.getVortexPath;
    if (typeof resolver !== "function") throw new Error("Vortex does not expose its user-data directory");
    root = path.join(resolver.call(context.api, "userData"), "vortex-development-bridge");
    engine = new Engine(root, createAdapter(context.api, vortex));
    const tick = createPoll(engine, context.api, vortex.log);
    void tick();
    const timer = setInterval(tick, 5000);
    timer.unref?.();
  });
  return true;
}
module.exports = { default: main };
