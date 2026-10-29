const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const vm = require("node:vm");
const { build } = require("esbuild");

const bundle = build({
  absWorkingDir: path.resolve(__dirname, ".."),
  entryPoints: ["src/main/modules/preloadDedupe.ts"],
  bundle: true,
  write: false,
  format: "cjs",
  platform: "node",
  alias: {
    "@/main/utils/createLogger": "dedupe-test-logger",
  },
  external: ["dedupe-test-logger", "electron"],
}).then((result) => result.outputFiles[0].text);

const API = "C:/loader/src/preload/api.js";
const LOADER_MODULE = "C:/loader/src/preload/module.js";
const PLUGIN_PRELOAD = "C:/plugins/example/preload.js";

// 复刻 LiteLoader 1.4.1 proxyPreload 的包装方式：无条件前置自己的 preload，且不改函数名。
function loaderWrap(fn, prefix) {
  return new Proxy(fn, {
    apply(target, thisArg, argArray) {
      return [...prefix, ...Reflect.apply(target, thisArg, argArray)];
    },
  });
}

test("每个新建窗口的 preload 列表都被去重包装覆盖", async () => {
  const context = {
    module: { exports: {} },
    require(name) {
      if (name === "dedupe-test-logger") return { createLogger: () => () => {} };
      if (name === "electron") return {};
      return require(name);
    },
  };
  vm.runInNewContext(await bundle, context);
  const { installPreloadDedupe } = context.module.exports;

  for (let index = 1; index <= 40; index += 1) {
    const session = { getPreloadScripts: () => [{ filePath: PLUGIN_PRELOAD, type: "frame" }] };
    const webContents = { session, _getPreloadPaths: () => [PLUGIN_PRELOAD] };
    session.getPreloadScripts = loaderWrap(session.getPreloadScripts, [
      { filePath: API, type: "frame" },
      { filePath: LOADER_MODULE, type: "frame" },
    ]);
    webContents._getPreloadPaths = loaderWrap(webContents._getPreloadPaths, [API, LOADER_MODULE]);

    const window = { webContents };
    installPreloadDedupe(window);
    // loader 的 qwqnt hook 与模块导出可能对同一窗口各触发一次
    installPreloadDedupe(window);

    assert.deepEqual(Array.from(webContents._getPreloadPaths()), [API, LOADER_MODULE, PLUGIN_PRELOAD], `第 ${index} 个窗口的 _getPreloadPaths 有重复项`);
    assert.deepEqual(
      Array.from(session.getPreloadScripts(), (entry) => ({ filePath: entry.filePath, type: entry.type })),
      [
        { filePath: API, type: "frame" },
        { filePath: LOADER_MODULE, type: "frame" },
        { filePath: PLUGIN_PRELOAD, type: "frame" },
      ],
      `第 ${index} 个窗口的 getPreloadScripts 有重复项`,
    );
    assert.equal(webContents._getPreloadPaths.name, "_getPreloadPaths");
    assert.equal(session.getPreloadScripts.name, "getPreloadScripts");
  }
});
