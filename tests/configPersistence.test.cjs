const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { build } = require("esbuild");

const root = path.resolve(__dirname, "..");
const bundle = build({
  absWorkingDir: root,
  stdin: {
    resolveDir: root,
    contents: `
      export { configManager } from './src/main/modules/configManager';
      export { writeConfigFile } from './src/main/utils/configFile';
      export { stickerPacksManager } from './src/main/modules/localStickers/stickerPacksManager';
      export { recentStickersManager } from './src/main/modules/localStickers/recentStickersManager';
    `,
    loader: "ts",
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  alias: {
    "@/main/utils/pluginPaths": "config-test-paths",
    "@/main/utils/globalBroadcast": "config-test-broadcast",
  },
  external: ["electron", "config-test-paths", "config-test-broadcast"],
}).then((result) => result.outputFiles[0].text);

async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lt-config-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const code = await bundle;
  const load = (configDir = path.join(directory, "configs")) => {
    const faults = { denyBackup: false, denyRead: "" };
    const dialogs = [];
    const broadcasts = [];
    const io = new Proxy(fs, {
      get(target, key) {
        if (key === "copyFileSync") return (...args) => {
          if (faults.denyBackup) throw Object.assign(new Error("Backup denied"), { code: "EACCES" });
          return fs.copyFileSync(...args);
        };
        if (key === "readFileSync") return (...args) => {
          if (args[0] === faults.denyRead) throw Object.assign(new Error("Read denied"), { code: "EACCES" });
          return fs.readFileSync(...args);
        };
        return Reflect.get(target, key);
      },
    });
    const context = {
      module: { exports: {} }, Buffer, structuredClone,
      console: { error() {} },
      require(name) {
        if (name === "node:fs") return io;
        if (name === "config-test-paths") return { CONFIG_DIR: configDir, DATA_DIR: path.join(directory, "data") };
        if (name === "config-test-broadcast") return { globalBroadcast: (...args) => broadcasts.push(args) };
        if (name === "electron") return {
          ipcMain: { on() {}, handle() {} },
          dialog: { showMessageBox: (options) => { dialogs.push(options); return Promise.resolve(); } },
        };
        return require(name);
      },
    };
    vm.runInNewContext(code, context);
    return { ...context.module.exports, faults, dialogs, broadcasts, configDir };
  };
  return { directory, load, ...load() };
}

function put(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof contents === "string" ? contents : JSON.stringify(contents));
}
function backups(file) {
  return fs.readdirSync(path.dirname(file))
    .filter((name) => name.startsWith(path.basename(file) + ".") && name.endsWith(".bak"))
    .map((name) => fs.readFileSync(path.join(path.dirname(file), name), "utf8"));
}
const accountFile = (directory, uid = "u_test") => path.join(directory, "configs", `${uid}.json`);

// The reported failure: portable directory moved, while the newest settings were saved to the fallback.
test("migrates the newer fallback, preserves both originals, and survives another directory move", async (t) => {
  const f = await fixture(t);
  const account = accountFile(f.configDir);
  const registry = path.join(f.configDir, "UserConfigRegistry.json");
  const fallback = path.join(f.configDir, "config.json");
  const old = '{"interface":{"preventSelect":false}}';
  const recent = '{\n  "interface": { "preventSelect": true }, "message": { "nativeNudge": true }\n}';
  put(account, old);
  fs.utimesSync(account, new Date(0), new Date(0));
  put(fallback, recent);
  put(registry, [["u_test", path.join(f.directory, "removed-install", "u_test.json")]]);
  const registryOriginal = fs.readFileSync(registry, "utf8");
  f.configManager.setup("u_test");
  assert.equal(f.configManager.value.interface.preventSelect, true);
  assert.equal(f.configManager.value.message.nativeNudge, true);
  assert.equal(fs.readFileSync(account, "utf8"), recent);
  assert.deepEqual(backups(account), [old]);
  assert.equal(fs.readFileSync(fallback, "utf8"), recent);
  assert.equal(fs.existsSync(registry), false);
  assert.deepEqual(backups(registry), [registryOriginal]);
  assert.equal(f.dialogs.length, 0);

  const moved = path.join(f.directory, "moved-configs");
  fs.renameSync(f.configDir, moved);
  const restarted = f.load(moved);
  restarted.configManager.setup("u_test");
  assert.equal(restarted.configManager.value.message.nativeNudge, true);
  assert.deepEqual(backups(accountFile(moved)), [old]);
  assert.equal(fs.existsSync(path.join(moved, "UserConfigRegistry.json")), false);
  assert.equal(restarted.dialogs.length, 0);
});

test("imports indexed external files without sharing the fallback with other accounts", async (t) => {
  const f = await fixture(t);
  const external = path.join(f.directory, "external.json");
  put(external, { interface: { preventSelect: true } });
  put(accountFile(f.configDir, "u_other"), { interface: { preventSelect: false } });
  put(path.join(f.configDir, "config.json"), { message: { nativeNudge: true } });
  fs.utimesSync(path.join(f.configDir, "config.json"), new Date(0), new Date(0));
  put(path.join(f.configDir, "UserConfigRegistry.json"), [
    ["u_test", external], ["u_other", path.join(f.directory, "missing", "u_other.json")],
  ]);
  f.configManager.setup("u_test");
  assert.equal(f.configManager.value.interface.preventSelect, true);
  assert.equal(fs.readFileSync(accountFile(f.configDir), "utf8"), fs.readFileSync(external, "utf8"));
  const other = f.load();
  other.configManager.setup("u_other");
  assert.equal(other.configManager.value.interface.preventSelect, false);
  assert.equal(other.configManager.value.message.nativeNudge, false);
});

test("a newer fallback wins after a registered file becomes readable again", async (t) => {
  const f = await fixture(t);
  const registered = path.join(f.directory, "previous-account.json");
  const destination = accountFile(f.configDir);
  const fallback = path.join(f.configDir, "config.json");
  put(registered, { interface: { preventSelect: false } });
  put(destination, { message: { nativeNudge: false } });
  put(fallback, { interface: { preventSelect: true }, message: { nativeNudge: true } });
  fs.utimesSync(registered, new Date(1000), new Date(1000));
  fs.utimesSync(destination, new Date(2000), new Date(2000));
  fs.utimesSync(fallback, new Date(3000), new Date(3000));
  const previous = fs.readFileSync(destination, "utf8");
  put(path.join(f.configDir, "UserConfigRegistry.json"), [["u_test", registered]]);
  f.configManager.setup("u_test");
  assert.equal(f.configManager.value.interface.preventSelect, true);
  assert.equal(f.configManager.value.message.nativeNudge, true);
  assert.equal(fs.readFileSync(destination, "utf8"), fs.readFileSync(fallback, "utf8"));
  assert.deepEqual(backups(destination), [previous]);
  assert.equal(JSON.parse(fs.readFileSync(registered, "utf8")).interface.preventSelect, false);
});

test("automatic replacements retain every previous version, but unchanged and user saves do not back up", async (t) => {
  const f = await fixture(t);
  const file = path.join(f.directory, "settings.json");
  f.writeConfigFile(file, '{"value":1}');
  f.writeConfigFile(file, '{"value":2}');
  f.writeConfigFile(file, '{"value":3}');
  assert.deepEqual(backups(file).sort(), ['{"value":1}', '{"value":2}']);
  assert.equal(f.writeConfigFile(file, '{"value":3}'), false);
  f.writeConfigFile(file, '{"value":4}', "user");
  assert.deepEqual(backups(file).sort(), ['{"value":1}', '{"value":2}']);
  assert.equal(fs.readFileSync(file, "utf8"), '{"value":4}');
});

test("a failed backup leaves disk, live settings and subscribers untouched", async (t) => {
  const f = await fixture(t);
  f.configManager.setup("u_test");
  const account = accountFile(f.configDir);
  const original = fs.readFileSync(account, "utf8");
  const value = f.configManager.value;
  f.faults.denyBackup = true;
  assert.throws(() => f.configManager.updateConfig({ ...value, debug: { ...value.debug, console: true } }), /Backup denied/);
  assert.equal(fs.readFileSync(account, "utf8"), original);
  assert.equal(f.configManager.value, value);
  assert.equal(f.configManager.value.debug.console, false);
  assert.equal(f.broadcasts.length, 0);
  assert.deepEqual(backups(account), []);
});

test("read permissions are not treated as corrupt JSON or reset to defaults", async (t) => {
  const f = await fixture(t);
  const account = accountFile(f.configDir);
  const original = '{"interface":{"preventSelect":true}}';
  put(account, original);
  f.faults.denyRead = account;
  assert.throws(() => f.configManager.setup("u_test"), /Read denied/);
  assert.equal(fs.readFileSync(account, "utf8"), original);
  assert.deepEqual(backups(account), []);
  assert.equal(f.dialogs[0].type, "error");
});

test("invalid JSON recovery preserves exact bytes; a denied backup prevents recovery", async (t) => {
  const f = await fixture(t);
  const account = accountFile(f.configDir);
  const original = '{"unfinished":';
  put(account, original);
  f.faults.denyBackup = true;
  assert.throws(() => f.configManager.setup("u_test"), /Backup denied/);
  assert.equal(fs.readFileSync(account, "utf8"), original);
  f.faults.denyBackup = false;
  f.configManager.setup("u_test");
  assert.deepEqual(backups(account), [original]);
  assert.equal(JSON.parse(fs.readFileSync(account, "utf8")).interface.preventSelect, false);
  assert.equal(f.dialogs.at(-1).type, "warning");
});

test("an invalid legacy index cannot replace a valid account configuration", async (t) => {
  const f = await fixture(t);
  const account = accountFile(f.configDir);
  const registry = path.join(f.configDir, "UserConfigRegistry.json");
  put(account, '{"interface":{"preventSelect":true}}');
  put(registry, '{"not":"a registry"}');
  assert.throws(() => f.configManager.setup("u_test"));
  assert.equal(fs.readFileSync(account, "utf8"), '{"interface":{"preventSelect":true}}');
  assert.equal(fs.readFileSync(registry, "utf8"), '{"not":"a registry"}');
  assert.deepEqual(backups(account), []);
});

test("sticker configuration recovery backs up raw bytes and explicit renaming remains a user setting", async (t) => {
  const f = await fixture(t);
  const packPath = path.join(f.directory, "pack").replace(/\\/g, "/");
  const file = path.join(packPath, "sticker.json");
  put(file, "broken sticker configuration");
  f.stickerPacksManager.rootPath = packPath;
  f.faults.denyBackup = true;
  assert.throws(() => f.stickerPacksManager.onEvent("addDir", packPath), /Backup denied/);
  assert.deepEqual(Array.from(f.stickerPacksManager.getPackList()), []);
  assert.equal(fs.readFileSync(file, "utf8"), "broken sticker configuration");
  f.faults.denyBackup = false;
  f.stickerPacksManager.onEvent("addDir", packPath);
  f.stickerPacksManager.updatePackConfig(packPath, "label", "renamed");
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).label, "renamed");
  assert.deepEqual(backups(file), ["broken sticker configuration"]);
});

test("automatic recent-sticker updates back up history and do not commit after a backup failure", async (t) => {
  const f = await fixture(t);
  f.configManager.setup("u_test");
  f.recentStickersManager.setRootPath(f.directory);
  const first = { path: "first.png", label: "first" };
  f.recentStickersManager.updateRecentStickers(first);
  const file = path.join(f.directory, "recentStickers.json");
  assert.deepEqual(backups(file), ["[]"]);
  const original = fs.readFileSync(file, "utf8");
  f.faults.denyBackup = true;
  assert.throws(() => f.recentStickersManager.updateRecentStickers({ path: "second.png", label: "second" }), /Backup denied/);
  assert.equal(fs.readFileSync(file, "utf8"), original);
  assert.equal(f.recentStickersManager.getRecentStickers().stickers[0].path, "first.png");
});
