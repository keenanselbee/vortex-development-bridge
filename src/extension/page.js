"use strict";
const React = require("react");
const { MainPage } = require("vortex-api");
const client = require("../client/client");
const h = React.createElement;

class BridgePage extends React.Component {
  constructor(props) {
    super(props);
    this.state = { snapshot: {}, message: "", busy: false, configPath: "", project: "", packageId: "", artifact: "", version: "0.1.0" };
  }
  componentDidMount() {
    this.mounted = true;
    void this.refresh();
    this.timer = setInterval(() => this.refresh(), 5000);
  }
  componentWillUnmount() { this.mounted = false; clearInterval(this.timer); }
  async refresh() {
    try {
      const snapshot = await client.status(this.props.root);
      if (this.mounted) this.setState({ snapshot });
    } catch (error) { if (this.mounted) this.setState({ message: error.message }); }
  }
  async run(action) {
    this.setState({ busy: true, message: "Working..." });
    try {
      const result = await action();
      if (this.mounted) this.setState({ message: result.id ? `Request ${result.status || "queued"}: ${result.id}` : `Registered ${result.project}` });
      await this.props.engine.tick();
      await this.refresh();
    } catch (error) { if (this.mounted) this.setState({ message: error.message }); }
    finally { if (this.mounted) this.setState({ busy: false }); }
  }
  field(key, label) {
    return h("label", { key, style: { marginRight: 12, display: "inline-block" } }, label,
      h("input", { className: "form-control", value: this.state[key], onChange: event => this.setState({ [key]: event.target.value }) }));
  }
  render() {
    const s = this.state.snapshot, disabled = this.state.busy;
    const action = (label, callback, extraDisabled = false) => h("button", {
      className: "btn btn-default", style: { marginRight: 8 }, disabled: disabled || extraDisabled,
      onClick: () => this.run(callback),
    }, label);
    const builds = s.managed || [];
    const rows = builds.map(build => h("tr", { key: build.id },
      h("td", null, build.name), h("td", null, build.version), h("td", null, build.vdbPublication || "local"),
      h("td", null, h("code", null, build.vdbBuildId)),
      h("td", null, build.enabled ? "Enabled" : "Staged"),
      h("td", null,
        action("Verify", () => client.submit(this.props.root, build.vdbProjectId, build.vdbPackageId, "verify", { buildId: build.vdbBuildId, profileId: s.activeProfileId }), build.gameId !== s.activeGameId),
        action("Activate and deploy", () => client.submit(this.props.root, build.vdbProjectId, build.vdbPackageId, "deploy", { buildId: build.vdbBuildId, profileId: s.activeProfileId }), build.gameId !== s.activeGameId || !s.activeProfileId),
      )));
    return h(MainPage, null, h(MainPage.Body, null,
      h("h2", null, "Vortex Development Bridge"),
      h("p", null, "Stage mod builds, switch versions and verify deployment. Select a retained build to restore it; build IDs distinguish outputs with the same version."),
      h("p", null, `Active game: ${s.activeGameId || "none"} | Profile: ${s.activeProfileId || "none"}${s.stale ? " | Status is stale" : ""}`),
      h("h3", null, "Register a project"), this.field("configPath", "Project configuration path"),
      action("Register", () => client.register(this.props.root, this.state.configPath)),
      h("h3", null, "Finish a build"),
      ...[["project", "Project ID"], ["packageId", "Package ID"], ["artifact", "Prepared directory"], ["version", "Version"]].map(([key, label]) => this.field(key, label)),
      action("Update all game profiles", () => client.finish(this.props.root, this.state.project,
        [{ packageId: this.state.packageId, artifact: this.state.artifact, version: this.state.version }])),
      action("Update active profile only", () => client.finish(this.props.root, this.state.project,
        [{ packageId: this.state.packageId, artifact: this.state.artifact, version: this.state.version }], s.activeProfileId),
        !s.activeProfileId || s.projects?.find(p => p.id === this.state.project)?.gameId !== s.activeGameId),
      action("Stage only", () => client.finish(this.props.root, this.state.project,
        [{ packageId: this.state.packageId, artifact: this.state.artifact, version: this.state.version }], undefined, true)),
      h("p", null, "Updates preserve each profile's enabled state. Disabled versions update without deployment; enabled versions deploy when that profile is active and the game is closed. Absent mods stay absent. Stage only changes no profiles."),
      h("p", { role: "status" }, this.state.message),
      h("h3", null, "Managed builds"),
      h("table", { className: "table" }, h("thead", null, h("tr", null, ...["Package", "Version", "Publication", "Build ID", "State", "Actions"].map(x => h("th", { key: x }, x)))), h("tbody", null, ...rows)),
      h("h3", null, "Recent operations"),
      h("ul", null, ...(s.receipts || []).sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt))).slice(0, 20).map(r => h("li", { key: r.id },
        `${r.projectId}/${r.packageId}: ${r.operation} - ${r.status}${r.error ? ": " + r.error : ""}`,
        r.operation === "finish" ? ` | Staging: ${r.staging || "pending"} | Deployment: ${r.deployment || "pending"}` : "",
        ...(r.skipped || []).map(item => h("span", { key: item.packageId }, ` | ${item.packageId}: ${item.reason}`)),
        ...(r.profiles || []).map(item => h("span", { key: item.profileId }, ` | Profile ${item.profileId}: ${item.status}${item.reason ? " - " + item.reason : ""}`)),
        r.operation === "finish" && r.status === "pending" && !r.deploymentStarted
          ? action("Cancel", () => require("../protocol/intents").cancel(this.props.root, r.id)) : null,
        (Array.isArray(r.verification) ? r.verification : [r.verification]).some(v => v?.deployed === "differences") ? " (deployed files differ)" : ""))),
    ));
  }
}
module.exports = { BridgePage };
