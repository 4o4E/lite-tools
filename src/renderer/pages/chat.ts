import { aioStore } from "@/renderer/modules/aioStore";
import { setupPreventMultipleSelect } from "@/renderer/modules/preventMultipleSelect";
import { createLogger } from "@/renderer/utils/createLogger";
import { configStore } from "@/renderer/modules/configStore";
import { updateTopFuncBar, updateChatFuncBar } from "@/renderer/modules/funcBarManager";
import { setupHandleMessages } from "@/renderer/modules/handleMessages";
import { waitForInstance } from "@/renderer/utils/domWaitFor";
import { wallpaperManager } from "@/renderer/modules/wallpaperManager";
import { setupLocalStickers } from "@/renderer/modules/localStickers";
import { editorManager } from "@/renderer/modules/editorManager";
import { setupMenuHighlight } from "@/renderer/modules/menuHighlight";
import { initNativeStickerEnhancer } from "@/renderer/modules/nativeStickerEnhancer";

const log = createLogger("chat");

async function setupChatPage() {
  log("await init");
  await configStore.ready;
  log("获取到配置", configStore.value);
  await aioStore.ready;
  log("initialized");
  setupPreventMultipleSelect("chat-msg-area");
  setupMenuHighlight();
  initNativeStickerEnhancer();
  setupHandleMessages();
  setupGoBackMainList();
  setupLocalStickers();
  updateTopFuncBar();
  updateChatFuncBar();
  updateRecallConfig(configStore.value);
  updateInterface(configStore.value);
  wallpaperManager.setup();
  editorManager.setup();
  aioStore.onChange(() => {
    updateTopFuncBar();
    updateChatFuncBar();
  });
  configStore.onChange((config) => {
    updateTopFuncBar();
    updateChatFuncBar();
    updateRecallConfig(config);
    updateInterface(config);
  });
}

function updateInterface(config: Config) {
  document.body.classList.toggle("lt-remove-vip-color", config.interface.removeVipColor);
}

function setupGoBackMainList() {
  document.addEventListener("mouseup", async (event) => {
    if (event.button === 3 && configStore.value.interface.goBackMainList) {
      if (!document.querySelector(".recent-contact-list--wrapper")) return;
      const { value: goBackMainList } = await waitForInstance(".recent-contact-list--wrapper", "proxy.goBackMainList");
      event.preventDefault();
      event.stopPropagation();
      goBackMainList();
    }
  });
}

function updateRecallConfig(config: Config) {
  document.body.classList.toggle("lt-custom-recall-color", config.message.preventRecall.customColor);
  document.body.style.setProperty("--lt-recall-color-light", config.message.preventRecall.customTextColor.light);
  document.body.style.setProperty("--lt-recall-color-dark", config.message.preventRecall.customTextColor.dark);
}

export { setupChatPage };
