const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { build } = require("esbuild");

const bundle = build({
  absWorkingDir: path.resolve(__dirname, ".."),
  entryPoints: ["src/main/modules/nativeFavoriteStickerCache.ts"],
  bundle: true,
  write: false,
  format: "cjs",
  platform: "node",
  alias: {
    "@/main/modules/configManager": "cache-test-config",
    "@/main/utils/pluginPaths": "cache-test-paths",
    "@/main/utils/createLogger": "cache-test-logger",
  },
  external: ["electron", "cache-test-config", "cache-test-paths", "cache-test-logger"],
}).then((result) => result.outputFiles[0].text);

test("enabling persistence during an animation request retains existing cached pages", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lt-favorite-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "native-favorite-stickers", "u_test", "pages.json");
  const oldRequest = { resId: "next-page", count: 20, backwardFetch: true };
  const oldResponse = { result: 0, totalCnt: 2, emojiInfoList: [{ resId: "last-item", md5: "old" }] };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ version: 1, pages: [{
    key: JSON.stringify(oldRequest), request: oldRequest, response: oldResponse, updatedAt: 1,
  }] }));

  const settings = { cacheEnabled: false, playAnimation: true, mergePages: 10 };
  const timers = new Map();
  const sent = [];
  let nextTimer = 0;
  let receive;
  let send;
  const context = {
    module: { exports: {} }, Buffer,
    setTimeout(fn) { timers.set(++nextTimer, fn); return nextTimer; },
    clearTimeout(id) { timers.delete(id); },
    IpcInterceptor: {
      interceptIpcReceiveEvents(_name, callback) { receive = callback; },
      onIpcSend(callback) { send = callback; },
    },
    require(name) {
      if (name === "cache-test-config") return { configManager: { value: { message: { nativeFavoriteStickers: settings } } } };
      if (name === "cache-test-paths") return { DATA_DIR: directory };
      if (name === "cache-test-logger") return { createLogger: () => () => {} };
      if (name === "electron") return {
        ipcMain: { handle() {} },
        webContents: { fromId: () => ({ send: (...args) => sent.push(args) }) },
      };
      return require(name);
    },
  };
  vm.runInNewContext(await bundle, context);
  context.module.exports.setupNativeFavoriteStickerCache("u_test");
  const request = (callbackId) => receive(null, null, "RM_IPCFROM_RENDERER2", [
    { callbackId, eventName: "ntApi", peerId: 2 },
    { cmdName: "nodeIKernelMsgService/fetchFavEmojiList", payload: [{ resId: "", count: 20, backwardFetch: true }] },
  ]);
  assert.equal(request("inflight"), undefined);
  settings.cacheEnabled = true;
  settings.playAnimation = false;
  send("RM_IPCFROM_MAIN2", { callbackId: "inflight" }, {
    result: 0, totalCnt: 2, emojiInfoList: [{ resId: "next-page", md5: "new" }],
  });
  for (const callback of timers.values()) callback();
  const persisted = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepEqual(persisted.pages.flatMap((page) => page.response.emojiInfoList.map((item) => item.resId)).sort(), ["last-item", "next-page"]);
  assert.equal(request("hit").action, "block");
  assert.deepEqual(Array.from(sent.at(-1)[2].emojiInfoList, (item) => item.resId), ["next-page", "last-item"]);
  assert.equal(sent.at(-1)[2].totalCnt, 2);
});
