import { getHash } from "@/renderer/utils/getHash";
import { createLogger } from "@/renderer/utils/createLogger";
import { styleManager } from "@/renderer/modules/styleManager";
import { toastManager } from "@/renderer/modules/toastManager";

// pages
import { setupHideMoreGroups } from "@/renderer/modules/hideMoreGroups";
import { setupMainPage } from "@/renderer/pages/main";
import { setupChatPage } from "@/renderer/pages/chat";
import { setupImageViewer } from "@/renderer/pages/imageViewer";

const log = createLogger("renderer");

log("start");

export async function main() {
  styleManager.inject("global");
  const hash = await getHash();
  log("hash Update", hash);
  if (typeof hash === "string" && hash.startsWith("#/main/")) {
    await setupHideMoreGroups();
  }
  switch (hash) {
    case "#/main/message":
      await toastManager.setup();
      setupMainPage();
      break;
    case "#/chat":
      await toastManager.setup();
      setupChatPage();
      break;
    case "#/forward":
      break;
    case "#/blank":
    case "#/":
      // QQ 的图片查看器窗口来自池化的 #/blank 窗口：先以 #/blank 加载、随后原地导航到
      // #/image-viewer，getHash 已在 #/blank 解析完成，需要在查看器 DOM 出现后再初始化。
      setupImageViewer();
      break;
    case "#/image-viewer":
      setupImageViewer();
      break;
    case "#/setting/settings/common":
      break;
    default:
      console.warn(`Unknown Path: ${hash}`);
  }
}