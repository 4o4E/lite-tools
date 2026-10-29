import path from "node:path";
import type { BrowserWindow } from "electron";
import { createLogger } from "@/main/utils/createLogger";

const log = createLogger("preloadDedupe");

const wrappedPreloadSources = new WeakSet<Function>();
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
  // LiteLoader 每个窗口都会用一个 Proxy 再包一层，而 Proxy 的属性读取会转发到被包裹的函数。
  // 用属性标记判断“已去重”会被 loader 的 Proxy 透传成真，导致从第二个窗口起不再去重，
  // 重复项继续叠加；因此只能按函数身份判断。
  if (wrappedPreloadSources.has(original)) return;
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
  wrappedPreloadSources.add(wrapped);
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

export { installPreloadDedupe };
