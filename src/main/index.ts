import { configManager } from "@/main/modules/configManager";
import { createLogger } from "@/main/utils/createLogger";
import { setupMessageRecordInterceptor } from "@/main/modules/messages/messageRecordInterceptor";
import { setupSendMessageInterceptor } from "@/main/modules/messages/sendMessageInterceptor";
import { setupIpcMain } from "@/main/modules/ipcRegistrar";
import { setupSideBar } from "@/main/modules/sidebarManager";
import { trackWindow } from "@/main/utils/windowTracker";
import { setupIpcInterceptor } from "@/main/modules/ipcInterceptor";
import { localStickers } from "@/main/modules/localStickers";
import { wallpaperService } from "@/main/modules/wallpaper";
import { setupDevWindow } from "@/main/modules/devWindow";
import { proxyManager } from "@/main/modules/proxyManager";
import { setupNativeFavoriteStickerCache } from "@/main/modules/nativeFavoriteStickerCache";
import type { BrowserWindow } from "electron";
import path from "node:path";

const log = createLogger("lt_main");

log("插件启动");

// 监听登录成功后读取配置文件
const unSubscribe = IpcInterceptor.onIpcSendEvents("nodeIKernelSessionListener/onSessionInitComplete", (...args) => {
  setupMain(args[2].payload.uid);
  unSubscribe();
});

// 初始化
function setupMain(uid: string) {
  try {
    configManager.setup(uid);
    setupNativeFavoriteStickerCache(uid);
    setupMessageRecordInterceptor();
    setupSendMessageInterceptor();
    setupIpcMain();
    setupSideBar();
    setupIpcInterceptor();
    setupDevWindow();
    wallpaperService.setup();
    localStickers.setup();
    proxyManager.setup();
  } catch (err) {
    log("初始化出错", err);
  }
}

const preloadDedupeMark = Symbol.for("lite-tools.preload-dedupe");
const preloadEntryIds = new WeakMap<object, number>();
let nextPreloadEntryId = 1;

/**
 * LiteLoader 1.4.1 的 proxyPreload 每次调用都会前置自己的 api.js / module.js，
 * 且每个窗口构造都会再包一层共享 session 的方法，导致同一 preload 在同一文档执行 40+ 次
 * （每次都同步 XHR 读取所有插件 preload，新窗口要 2.4–3.0 秒才开始执行 QQ 自己的 JS）。
 * loader 不再更新，因此在插件主进程里把最终列表按路径去重；只影响重复项，不改顺序和类型。
 */
function preloadEntryKey(entry: unknown): string {
  if (typeof entry === "string") return path.normalize(entry).toLowerCase();
  if (entry && typeof entry === "object") {
    const record = entry as { filePath?: unknown; type?: unknown };
    if (typeof record.filePath === "string") {
      return `${path.normalize(record.filePath).toLowerCase()}|${String(record.type ?? "")}`;
    }
    let id = preloadEntryIds.get(record);
    if (id === undefined) {
      id = nextPreloadEntryId++;
      preloadEntryIds.set(record, id);
    }
    return `#${id}`;
  }
  return String(entry);
}

function wrapPreloadSource(target: Record<string, unknown> | undefined, method: string) {
  const original = target?.[method];
  if (typeof original !== "function") return;
  if ((original as unknown as Record<PropertyKey, unknown>)[preloadDedupeMark]) return;
  const wrapped = function (this: unknown, ...args: unknown[]) {
    const list = (original as (...callArgs: unknown[]) => unknown).apply(this, args);
    if (!Array.isArray(list)) return list;
    const seen = new Set<string>();
    const result: unknown[] = [];
    for (const entry of list) {
      const key = preloadEntryKey(entry);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(entry);
    }
    return result;
  };
  Object.defineProperty(wrapped, preloadDedupeMark, { value: true });
  // LiteLoader 下一次包装前会用 func.name 判断方法类型；必须保留原名，否则它会把方法覆盖成 undefined。
  Object.defineProperty(wrapped, "name", { value: method });
  try {
    target![method] = wrapped;
  } catch (err) {
    log("preload 去重包装失败", method, err);
  }
}

function installPreloadDedupe(window: BrowserWindow) {
  wrapPreloadSource(window.webContents as unknown as Record<string, unknown>, "_getPreloadPaths");
  wrapPreloadSource(window.webContents.session as unknown as Record<string, unknown>, "getPreloadScripts");
}

function onBrowserWindowCreated(window: BrowserWindow) {
  trackWindow(window);
  installPreloadDedupe(window);
}

if ("qwqnt" in globalThis) {
  qwqnt.main.hooks.whenBrowserWindowCreated.peek(onBrowserWindowCreated);
}

// 错误处理
process.on("uncaughtException", (e) => {
  log("主进程出错", e, e?.stack);
});

module.exports = { onBrowserWindowCreated };
