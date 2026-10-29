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
import { installPreloadDedupe } from "@/main/modules/preloadDedupe";
import type { BrowserWindow } from "electron";

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
