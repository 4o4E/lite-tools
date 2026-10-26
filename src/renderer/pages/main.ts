import { aioStore } from "@/renderer/modules/aioStore";
import { setupPreventMultipleSelect } from "@/renderer/modules/preventMultipleSelect";
import { createLogger } from "@/renderer/utils/createLogger";
import { configStore } from "@/renderer/modules/configStore";
import { createComparator } from "@/common/createComparator";
import { updateTopFuncBar, updateChatFuncBar } from "@/renderer/modules/funcBarManager";
import { observeMutations } from "@/renderer/utils/observeMutations";
import { setupHandleMessages } from "@/renderer/modules/handleMessages";
import { onComponentMount } from "@/renderer/modules/vueComponentTracker";
import { waitForInstance } from "@/renderer/utils/domWaitFor";
import { wallpaperManager } from "@/renderer/modules/wallpaperManager";
import { setupLocalStickers } from "@/renderer/modules/localStickers";
import { editorManager } from "@/renderer/modules/editorManager";
import { setupMenuHighlight } from "@/renderer/modules/menuHighlight";
import { initNativeStickerEnhancer } from "@/renderer/modules/nativeStickerEnhancer";

const log = createLogger("main");

async function setupMainPage() {
  log("await init");
  await configStore.ready;
  await aioStore.ready;
  const topSideBarhasChanged = createComparator(configStore.value.sideBar.top);
  setupPreventMultipleSelect("chat-msg-area");
  setupMenuHighlight();
  initNativeStickerEnhancer();
  updateTopSideBar(configStore.value);
  updateBottomSideBar(configStore.value);
  updateInterface(configStore.value);
  updateRecallConfig(configStore.value);
  setupHandleMessages();
  setupIpcToBroadcast();
  setupGoBackMainList();
  setupLocalStickers();
  wallpaperManager.setup();
  editorManager.setup();
  aioStore.onChange(() => {
    updateTopFuncBar();
    updateChatFuncBar();
  });
  configStore.onChange((config) => {
    log("config changed", config);
    if (topSideBarhasChanged(config.sideBar.top)) {
      updateTopSideBar(config);
    }
    updateInterface(config);
    updateBottomSideBar(config);
    updateTopFuncBar();
    updateChatFuncBar();
    updateRecallConfig(config);
  });
  onComponentMount((component) => {
    if (configStore.value.interface.hiddenLockBtn && component?.vnode?.key === "锁定") {
      component.vnode.el.remove();
    }
    if (configStore.value.interface.hiddenLogoutBtn && component?.vnode?.key === "退出账号") {
      component.vnode.el.remove();
    }
    if (configStore.value.interface.hiddenUpdateBtnAndNotice && component?.vnode?.key === "检查更新") {
      component.vnode.el.remove();
    }
  });
  observeMutations(
    document.querySelector(".nav.sidebar__nav")!,
    (mutationsList) => {
      for (const mutation of mutationsList) {
        if (mutation.type === "childList") {
          updateTopSideBar(configStore.value);
          updateBottomSideBar(configStore.value);
        }
      }
    },
    { childList: true, autoDisconnect: 5000 },
  );
  log("initialized");
}

async function setupGoBackMainList() {
  const { value: goBackMainList } = await waitForInstance(
    ".two-col-layout__aside .recent-contact .list-toggler",
    "proxy.goBackMainList",
  );
  document.addEventListener("mouseup", (event) => {
    if (event.button === 3 && configStore.value.interface.goBackMainList) {
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

function updateInterface(config: Config) {
  document
    .querySelector<HTMLElement>(".user-profile-card__widgets .weather-widget")
    ?.style.setProperty("display", config.interface.hiddenWeatherBtn ? "none" : "flex");
  document
    .querySelector<HTMLElement>(".window-control-area .narrow-toggler")
    ?.style.setProperty("display", config.interface.hiddenClassicBtn ? "none" : "flex");
  document.body.classList.toggle("lt-remove-vip-color", config.interface.removeVipColor);
  const controlAreaWidth = document.querySelector<HTMLElement>(".window-control-area")?.offsetWidth;
  if (controlAreaWidth) {
    document
      .querySelector<HTMLElement>(".topbar.container-topbar .topbar-content")
      ?.style.setProperty("padding-right", `${controlAreaWidth - 10}px`);
  }
}

function updateTopSideBar(config: Config) {
  // 更新侧边栏
  const sideBarUpper = document.querySelector<HTMLElement>(".sidebar-wrapper .sidebar__upper")!;
  sideBarUpper.querySelector(".nav.sidebar__nav")?.__VUE__?.[0]?.proxy?.navStore?.loadSideBarConfig();
  // 特殊栏目
  sideBarUpper
    .querySelector<HTMLElement>(`.nav.sidebar__nav .nav-item[aria-label="消息"]`)
    ?.style.setProperty("display", config.sideBar.top[0].enabled ? "flex" : "none");
  sideBarUpper
    .querySelector<HTMLElement>(`.nav.sidebar__nav .nav-item[aria-label="联系人"]`)
    ?.style.setProperty("display", config.sideBar.top[1].enabled ? "flex" : "none");
  sideBarUpper
    .querySelector<HTMLElement>(`.nav.sidebar__nav .nav-item[aria-label="更多"]`)
    ?.style.setProperty("display", config.sideBar.top[config.sideBar.top.length - 1].enabled ? "flex" : "none");
}

function updateBottomSideBar(config: Config) {
  const sideBarLower = document.querySelector<HTMLElement>(".sidebar-wrapper .sidebar__lower")!;
  for (const item of config.sideBar.bottom) {
    sideBarLower
      .querySelector<HTMLElement>(`.func-menu__item_wrap:has([aria-label="${item.name}"])`)
      ?.style.setProperty("display", item.enabled ? "flex" : "none");
  }
}

function setupIpcToBroadcast() {
  lite_tools.onBroadcast((channelName, payload) => {
    const broadcast = new BroadcastChannel(channelName);
    broadcast.postMessage(payload);
    broadcast.close();
  });
}

export { setupMainPage };
