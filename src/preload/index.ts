import { contextBridge, ipcRenderer } from "electron";
import type { RecallMsgId } from "@/common/types/preventRecall";
import type { WallpaperData } from "@/common/types/wallpaper";
import type { Toast } from "@/common/types/toastManager";
import type { StickerStore, Sticker } from "@/common/types/localStickers";

const exposeFunctions = {
  // 配置相关
  updateConfig: (config: Config, source: "user" | "automatic") =>
    ipcRenderer.send("lite_tools.updateConfig", config, source),
  getConfig: async (): Promise<Config> => ipcRenderer.invoke("lite_tools.getConfig"),
  isInitialized: (): boolean => ipcRenderer.sendSync("lite_tools.isInitialized"),
  onConfigChange: (callback: (config: Config) => void) =>
    ipcRenderer.on("lite_tools.configChanged", (_, config: Config) => callback(config)),
  getWebContentId: (): number => ipcRenderer.sendSync("lite_tools.getWebContentId"),
  showOpenDialog: (options: Electron.OpenDialogOptions): Promise<Electron.OpenDialogReturnValue> =>
    ipcRenderer.invoke("lite_tools.showOpenDialog", options),
  openExternal: (url: string) => ipcRenderer.send("lite_tools.openExternal", url),

  // 本地表情相关
  onStickerStoreUpdated: (callback: (stickerStore: StickerStore) => void) => {
    const listener = (_: any, stickerStore: StickerStore) => callback(stickerStore);
    ipcRenderer.on("lite_tools.stickerStore.updated", listener);
    return () => {
      ipcRenderer.removeListener("lite_tools.stickerStore.updated", listener);
    };
  },
  getStickerStore: (): Promise<StickerStore> => ipcRenderer.invoke("lite_tools.stickerStore.get"),
  updateStickerPackConfig: (dirPath: string, key: string, value: string | number) =>
    ipcRenderer.send("lite_tools.stickerPacksManager.updatePackConfig", dirPath, key, value),
  deleteSticker: (stickerPath: string) => ipcRenderer.send("lite_tools.stickerPacksManager.deleteSticker", stickerPath),
  downloadTgSticker: (tgStickerUrl: string) =>
    ipcRenderer.send("lite_tools.stickerPacksManager.downloadTgSticker", tgStickerUrl),
  updateRecentStickers: (sticker: Sticker) => ipcRenderer.send("lite_tools.stickerStore.updateRecentStickers", sticker),
  fetchMarketEmoticon: (marketFaceElement: any) =>
    ipcRenderer.invoke("lite_tools.fetchMarketEmoticon", marketFaceElement),
  getNativeFavoriteStickerAnimationMap: (): Promise<{ md5: string; src: string }[]> =>
    ipcRenderer.invoke("lite_tools.nativeFavoriteStickers.animationMap"),
  clearNativeFavoriteStickerCache: (): Promise<void> =>
    ipcRenderer.invoke("lite_tools.nativeFavoriteStickers.clearCache"),

  // 通用操作接口
  copyFile: (sourceFilePath: string, targetFilePath: string) =>
    ipcRenderer.invoke("lite_tools.copyFile", sourceFilePath, targetFilePath),

  // 背景相关
  onWallpaperChanged: (callback: (wallpaperData: WallpaperData) => void) =>
    ipcRenderer.on("lite_tools.wallpaperChanged", (_, wallpaperData: WallpaperData) => callback(wallpaperData)),
  getWallpaperData: () => ipcRenderer.send("lite_tools.getWallpaperData"),

  // 防撤回相关
  onRecallMessagesFound: (callback: (recallMsgIds: RecallMsgId[]) => void) =>
    ipcRenderer.on("lite_tools.recallMessagesFound", (_, recallMsgIds: RecallMsgId[]) => callback(recallMsgIds)),
  onUpdateRecallCacheSize: (callback: (size: number) => void) =>
    ipcRenderer.on("lite_tools.updateRecallCacheSize", (_, size: number) => callback(size)),
  getRecallCacheSize: (): Promise<number> => ipcRenderer.invoke("lite_tools.getRecallCacheSize"),
  clearRecallCache: () => ipcRenderer.send("lite_tools.clearRecallCache"),
  openRecallMsgList: () => ipcRenderer.send("lite_tools.openRecallMsgList"),
  openRedirectPicPath: () => ipcRenderer.send("lite_tools.openRedirectPicPath"),

  // ipc转broadcast
  onBroadcast: (callback: (channelName: any, payload: any) => void) =>
    ipcRenderer.on("lite_tools.broadcast", (_, channelName, payload) => callback(channelName, payload)),
  sendBroadcast: (channelName: any, payload: any) => ipcRenderer.send("lite_tools.broadcast", channelName, payload),

  // toast 通知
  onToast: (callback: (toast: Toast) => void) =>
    ipcRenderer.on("lite_tools.toast", (_, toast: Toast) => callback(toast)),
  clearToast: (callback: () => void) => ipcRenderer.on("lite_tools.clearToast", callback),

  // 应用代理
  checkProxy: () => ipcRenderer.send("lite_tools.proxy.check"),

  // debug
  openDevWindow: () => ipcRenderer.send("lite_tools.openDevWindow"),
  // 原生接口调用
  nativeCall: (event: any, payload: any, awaitCallback?: boolean | string | string[]) => {
    const callbackId = crypto.randomUUID();
    const webContentId = ipcRenderer.sendSync("lite_tools.getWebContentId");
    let resolve;
    if (awaitCallback) {
      resolve = new Promise((res) => {
        function onEvent(...args: any[]) {
          if (typeof awaitCallback === "boolean") {
            if (args[1]?.callbackId === callbackId) {
              ipcRenderer.off(`RM_IPCFROM_MAIN${webContentId}`, onEvent);
              res(args[2]);
            }
          } else if (Array.isArray(awaitCallback)) {
            if (awaitCallback.includes(args?.[1]?.cmdName)) {
              ipcRenderer.off(`RM_IPCFROM_MAIN${webContentId}`, onEvent);
              res(args[2]);
            }
          } else {
            if (args?.[2]?.cmdName === awaitCallback) {
              ipcRenderer.off(`RM_IPCFROM_MAIN${webContentId}`, onEvent);
              res(args[2]);
            }
          }
        }
        ipcRenderer.on(`RM_IPCFROM_MAIN${webContentId}`, onEvent);
      });
    } else {
      resolve = Promise.resolve(null);
    }
    ipcRenderer.send(
      `RM_IPCFROM_RENDERER${webContentId}`,
      {
        peerId: webContentId,
        callbackId,
        ...event,
      },
      payload,
    );
    return resolve;
  },
};

/**
 * QQ 在 renderer 脚本之前注册 Escape 监听：Esc 会先隐藏再销毁图片查看器窗口，
 * 而标题栏“关闭”只隐藏窗口，下一次打开可复用。必须在 QQ 注册之前拦截，
 * 因此 preload 阶段通过 executeInMainWorld 在主世界安装监听；
 * 渲染进程只负责在“图片查看器优化”开启时设置 dataset 标志。
 */
function setupImageViewerEscape() {
  if (typeof contextBridge.executeInMainWorld !== "function") return;
  contextBridge.executeInMainWorld({
    func: () => {
      const scope = globalThis as typeof globalThis & { __ltViewerEscInstalled?: boolean };
      if (scope.__ltViewerEscInstalled) return;
      scope.__ltViewerEscInstalled = true;
      window.addEventListener(
        "keydown",
        (event) => {
          if (event.key !== "Escape" || event.repeat) return;
          if (document.documentElement.dataset.ltImageViewerEsc !== "1") return;
          if (document.querySelector(".q-context-menu, embed, [contenteditable='true'], .ProseMirror, .ck-editor__editable")) return;
          const closeButton = document.querySelector<HTMLElement>(`div[aria-label="关闭"]`);
          if (!closeButton || typeof closeButton.click !== "function") return;
          event.preventDefault();
          event.stopImmediatePropagation();
          closeButton.click();
        },
        true
      );
    },
    args: [],
  });
}

// LiteLoader（本机 1.4.1）会在同一文档中重复执行插件 preload（新窗口实测单插件 63–77 次），
// 重复 exposeInMainWorld 会抛出 “Cannot bind an API on top of an existing property”。
// 用隔离世界的 globalThis 做幂等保护，只绑定一次。
const preloadScope = globalThis as typeof globalThis & { __liteToolsPreloadBound?: boolean };
if (!preloadScope.__liteToolsPreloadBound) {
  preloadScope.__liteToolsPreloadBound = true;
  setupImageViewerEscape();
  contextBridge.exposeInMainWorld("lite_tools", exposeFunctions);
}

export type LiteTools = typeof exposeFunctions;
