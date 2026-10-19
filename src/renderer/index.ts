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
  if (hash.startsWith("#/main/")) {
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
    case "#/image-viewer":
      setupImageViewer();
      break;
    case "#/setting/settings/common":
      break;
    default:
      console.warn(`Unknown Path: ${hash}`);
  }
}