import { ipcMain, webContents } from "electron";
import fs from "node:fs";
import path from "node:path";
import { configManager } from "@/main/modules/configManager";
import { DATA_DIR } from "@/main/utils/pluginPaths";
import { createLogger } from "@/main/utils/createLogger";

type StickerItem = { md5?: string; emoPath?: string; emoOriginalPath?: string; isAPNG?: boolean; thumbPath?: string; url?: string; resId?: string; uin?: string; emoId?: string };
type FavoriteResponse = { emojiInfoList?: StickerItem[]; result?: number; errMsg?: string; totalCnt?: number; [key: string]: unknown };
type FavoriteRequest = { resId?: string; count?: number; backwardFetch?: boolean; [key: string]: unknown };
type CachedPage = { updatedAt: number; request: FavoriteRequest; response: FavoriteResponse };
type PendingRequest = { key: string; payload: FavoriteRequest; webContentId: number; createdAt: number };
type AnimationEntry = { md5: string; src: string; thumbPath: string; url: string; resId: string };

const log = createLogger("nativeFavoriteStickerCache");
const requestEvent = "nodeIKernelMsgService/fetchFavEmojiList";
const pages = new Map<string, CachedPage>();
const pending = new Map<string, PendingRequest>();
let loadedPath = "";
let accountUid = "";
let saveTimer: NodeJS.Timeout | undefined;
let animationMap: AnimationEntry[] | undefined;
let animationMapBuiltAt = 0;

function cachePath() {
  return path.join(DATA_DIR, "native-favorite-stickers", accountUid, "pages.json");
}
function loadCache() {
  const file = cachePath();
  if (loadedPath === file) return;
  loadedPath = file;
  pages.clear();
  animationMap = undefined;
  try {
    const data: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!data || typeof data !== "object" || !("version" in data) || data.version !== 1 || !("pages" in data) || !Array.isArray(data.pages)) return;
    for (const value of data.pages) {
      if (!value || typeof value !== "object" || !("key" in value) || typeof value.key !== "string" || !("response" in value)) continue;
      const entry = value as { key: string; updatedAt?: number; request?: FavoriteRequest; response: FavoriteResponse };
      if (Array.isArray(entry.response?.emojiInfoList)) pages.set(entry.key, { updatedAt: Number(entry.updatedAt) || 0, request: entry.request || {}, response: entry.response });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") log("读取收藏表情缓存失败", error);
  }
}
function keyOf(payload: FavoriteRequest) {
  return JSON.stringify({ resId: payload.resId || "", count: Number(payload.count) || 0, backwardFetch: Boolean(payload.backwardFetch) });
}
function findPage(payload: FavoriteRequest) {
  const direct = pages.get(keyOf(payload));
  if (direct) return direct;
  for (const value of pages.values()) {
    if (
      (value.request.resId || "") === (payload.resId || "") &&
      Boolean(value.request.backwardFetch) === Boolean(payload.backwardFetch)
    ) return value;
  }
}
function mergedResponse(payload: FavoriteRequest): FavoriteResponse | null {
  const limit = Math.max(1, Math.min(50, Math.floor(Number(configManager.value.message.nativeFavoriteStickers.mergePages) || 10)));
  const items: StickerItem[] = [];
  const seenItems = new Set<string>();
  const seenPageKeys = new Set<string>();
  let cursor = payload.resId || "";
  let lastResponse: FavoriteResponse | undefined;
  let totalCnt = 0;
  for (let index = 0; index < limit; index++) {
    const pageKey = keyOf({ ...payload, resId: cursor });
    if (seenPageKeys.has(pageKey)) break;
    seenPageKeys.add(pageKey);
    const page = findPage({ ...payload, resId: cursor });
    const list = page?.response.emojiInfoList;
    if (!page || !Array.isArray(list) || list.length === 0) break;
    lastResponse = page.response;
    totalCnt = Math.max(totalCnt, Number(page.response.totalCnt) || 0);
    for (const item of list) {
      const id = item.resId || item.md5 || item.url || `${item.uin || ""}:${item.emoId || ""}`;
      if (id && !seenItems.has(id)) { seenItems.add(id); items.push(item); }
    }
    cursor = list[list.length - 1]?.resId || "";
    if (!cursor) break;
  }
  return items.length && lastResponse ? { ...lastResponse, emojiInfoList: items, totalCnt: Math.max(totalCnt, items.length) } : null;
}
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    const file = cachePath();
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ version: 1, pages: [...pages].map(([key, value]) => ({ key, ...value })) }));
    } catch (error) { log("写入收藏表情缓存失败", error); }
  }, 500);
}
function requestKey(webContentId: number, callbackId: string) {
  return `${webContentId}:${callbackId}`;
}
function prunePending() {
  const expiry = Date.now() - 30_000;
  for (const [key, request] of pending) if (request.createdAt < expiry) pending.delete(key);
}
function handleNativeFavoriteStickerCache(_event: unknown, _sender: unknown, channel: string, args: unknown[]) {
  if (!channel.startsWith("RM_IPCFROM_RENDERER")) return;
  const event = args[0] as { callbackId?: string; eventName?: string; peerId?: number } | undefined;
  const command = args[1] as { cmdName?: string; payload?: FavoriteRequest[] } | undefined;
  if (command?.cmdName !== requestEvent) return;
  prunePending();
  const payload = command.payload?.[0] || {};
  const callbackId = event?.callbackId;
  if (!callbackId) return;
  const webContentId = Number(channel.split("RM_IPCFROM_RENDERER")[1]);
  const settings = configManager.value.message.nativeFavoriteStickers;
  if (!settings.cacheEnabled && !settings.playAnimation) return;
  const pendingId = requestKey(webContentId, callbackId);
  if (settings.cacheEnabled) {
    loadCache();
    const response = mergedResponse(payload);
    if (response?.emojiInfoList?.length) {
      webContents.fromId(webContentId)?.send(`RM_IPCFROM_MAIN${webContentId}`, {
        callbackId, promiseStatue: "full", type: "response", eventName: event?.eventName || "ntApi", peerId: event?.peerId || webContentId,
      }, { ...response, result: response.result ?? 0, errMsg: response.errMsg || "success", liteToolsCacheHit: "merged" });
      return { action: "block" as const };
    }
  }
  pending.set(pendingId, { key: keyOf(payload), payload, webContentId, createdAt: Date.now() });
}
function recordNativeFavoriteStickerResponse(args: unknown[]) {
  const event = args[1] as { callbackId?: string } | undefined;
  const response = args[2] as FavoriteResponse | undefined;
  const channel = args[0];
  if (typeof channel !== "string" || !channel.startsWith("RM_IPCFROM_MAIN") || !event?.callbackId) return;
  const webContentId = Number(channel.slice("RM_IPCFROM_MAIN".length));
  const id = requestKey(webContentId, event.callbackId);
  const request = pending.get(id);
  if (!request || !Array.isArray(response?.emojiInfoList)) return;
  pending.delete(id);
  const settings = configManager.value.message.nativeFavoriteStickers;
  if (response.result !== 0 || response.emojiInfoList.length === 0 || (!settings.cacheEnabled && !settings.playAnimation)) return;
  if (settings.cacheEnabled) loadCache();
  pages.set(request.key, { updatedAt: Date.now(), request: request.payload, response });
  animationMap = undefined;
  if (settings.cacheEnabled) scheduleSave();
}
function buildAnimationMap(): AnimationEntry[] {
  const result: AnimationEntry[] = [];
  const seen = new Set<string>();
  for (const page of pages.values()) for (const item of page.response.emojiInfoList || []) {
    const md5 = typeof item.md5 === "string" ? item.md5.toUpperCase() : "";
    const file = item.emoPath || item.emoOriginalPath || "";
    if (!md5 || !file || seen.has(md5)) continue;
    let descriptor: number | undefined;
    try {
      descriptor = fs.openSync(file, "r");
      const header = Buffer.alloc(12);
      const bytesRead = fs.readSync(descriptor, header, 0, header.length, 0);
      const animated = header.subarray(0, Math.min(bytesRead, 3)).toString() === "GIF" || (header.subarray(0, 4).toString() === "RIFF" && header.subarray(8, 12).toString() === "WEBP") || Boolean(item.isAPNG);
      if (!animated) continue;
      seen.add(md5);
      result.push({ md5, src: `local:///${file.replace(/\\/g, "//")}`, thumbPath: item.thumbPath || "", url: item.url || "", resId: item.resId || "" });
    } catch (error) { log("读取收藏表情动画资源失败", error); }
    finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
  }
  return result;
}
function setupNativeFavoriteStickerCache(uid: string) {
  if (accountUid !== uid) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = undefined;
    pages.clear();
    pending.clear();
    animationMap = undefined;
    loadedPath = "";
    accountUid = uid;
  }
  IpcInterceptor.interceptIpcReceiveEvents(requestEvent, handleNativeFavoriteStickerCache);
  IpcInterceptor.onIpcSend((...args: unknown[]) => recordNativeFavoriteStickerResponse(args));
  ipcMain.handle("lite_tools.nativeFavoriteStickers.animationMap", () => {
    if (configManager.value.message.nativeFavoriteStickers.cacheEnabled) loadCache();
    if (!animationMap || Date.now() - animationMapBuiltAt > 2500) {
      animationMap = buildAnimationMap();
      animationMapBuiltAt = Date.now();
    }
    return animationMap;
  });
  ipcMain.handle("lite_tools.nativeFavoriteStickers.clearCache", () => {
    pages.clear();
    pending.clear();
    animationMap = undefined;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = undefined;
    try { fs.rmSync(cachePath(), { force: true }); }
    catch (error) {
      log("清除收藏表情缓存失败", error);
      throw error;
    }
  });
}

export { setupNativeFavoriteStickerCache };
