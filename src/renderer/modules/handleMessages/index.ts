import { onComponentMount } from "@/renderer/modules/vueComponentTracker";
import { checkChatType } from "@/common/checkChatType";
import { createLogger } from "@/renderer/utils/createLogger";
import { waitForInstance } from "@/renderer/utils/domWaitFor";
import { configStore } from "@/renderer/modules/configStore";
import { waitForElement } from "@/renderer/utils/domWaitFor";

import { initRecallMessageListener, insertRecallTag } from "./messageRecall";
import { mergeMessage } from "./mergeMessage";
import { setupRevealMask, revealMask } from "./revealMask";
import { insertSlot } from "./messageSlot";
import { insertTime } from "./insertTime";
import { insertRepeatBtn } from "./insertRepeatBtn";
import { bindUserNameAt } from "./nameAt";
import { chatObserverManager } from "./chatObserverManager";

import type { MessageElement, SlotElement } from "./type";

const log = createLogger("handleMessages");

const processedInstances = new WeakSet<any>();

let aioData: any;

async function setupHandleMessages() {
  await configStore.ready;
  log("注册事件");

  // 高版本自带+1按钮，如果启用了复读功能则隐藏自带的按钮
  if (configStore.value.message.repeatMessage.enabled) {
    document.body.classList.add("repeat-message");
  } else {
    document.body.classList.remove("repeat-message");
  }
  configStore.onChange((config) => {
    if (config.message.repeatMessage.enabled) {
      document.body.classList.add("repeat-message");
    } else {
      document.body.classList.remove("repeat-message");
    }
  });

  chatObserverManager.start();

  // observerElement();
  setupRevealMask();
  onComponentMount(handleMessages);
  initRecallMessageListener(enhanceMessage);
  const { instance, value: msgList } = await waitForInstance(
    ".container-content .container .aio .group-chat",
    "proxy.curMsgListData",
  );
  aioData = instance.proxy;

  for (const item of msgList) {
    const el = document.getElementById(item.msgId)?.firstElementChild;
    if (el && el?.__VUE__?.[0]) {
      handleMessages(el.__VUE__[0]);
    }
  }
}

function enabledSlot() {
  return configStore.value.message.showSendTime.enabled || configStore.value.message.preventRecall.enabled;
}

function handleMessages(component: any) {
  if (component?.vnode?.el && component?.props?.msgRecord && !processedInstances.has(component)) {
    if (!checkChatType(component.props.msgRecord) || !component.vnode.el?.classList?.contains?.("message")) return;
    processedInstances.add(component);
    try {
      bindUserNameAt(component.vnode.el, component.props.msgRecord);
    } catch (error) {
      log("昵称 @ 绑定失败", error);
    }
    const isNewVersion = !!component.vnode.el.querySelector(".message-native");
    // 消息合并-有卡顿
    if (0) {
      mergeMessage(aioData, component);
    }
    // 插入插槽
    if (enabledSlot()) {
      if (isNewVersion) {
        enhanceMessageSync(component);
      } else {
        enhanceMessage(component);
      }
    }
    // 图片遮罩
    if (configStore.value.message.revealMask.enabled) {
      revealMask(component, isNewVersion);
    }
  }
}

const awaitInsertSlot = new Map();

async function enhanceMessageSync(component: any) {
  const messageEl = component.vnode.el as MessageElement;
  const msgRecord = component.props.msgRecord;
  let slot = insertSlot(messageEl, msgRecord);

  if (slot === false) {
    const { promise, resolve } = Promise.withResolvers<SlotElement>();
    awaitInsertSlot.set(msgRecord.msgId, { resolve, messageEl, msgRecord });
    slot = await promise;
  }

  if (!slot) {
    return;
  }
  if (configStore.value.message.showSendTime.enabled) {
    insertTime(slot, msgRecord);
  }
  if (configStore.value.message.preventRecall.enabled) {
    insertRecallTag(slot, msgRecord);
  }

  Promise.resolve(slot.updatePosition?.()).then(() => {
    if (configStore.value.message.repeatMessage.enabled) {
      insertRepeatBtn(slot, msgRecord, messageEl);
    }
  });
}

function enhanceMessage(component: any) {
  const messageEl = component.vnode.el as MessageElement;
  const msgRecord = component.props.msgRecord;
  let slot = insertSlot(messageEl, msgRecord);
  if (!slot) {
    return;
  }
  if (configStore.value.message.showSendTime.enabled) {
    insertTime(slot, msgRecord);
    log("插入时间");
  }
  if (configStore.value.message.preventRecall.enabled) {
    insertRecallTag(slot, msgRecord);
  }

  Promise.resolve(slot.updatePosition?.()).then(() => {
    if (configStore.value.message.repeatMessage.enabled) {
      insertRepeatBtn(slot, msgRecord, messageEl);
    }
  });
}

// 处理异步插入插槽
chatObserverManager.addTask({
  name: "InsertSlot",
  selector: ".message",
  handler: (elements) => {
    elements.forEach((mlItem) => {
      const inserted = awaitInsertSlot.get(mlItem.id);
      if (inserted) {
        const slot = insertSlot(inserted.messageEl, inserted.msgRecord);
        if (slot) {
          awaitInsertSlot.delete(inserted.msgRecord.msgId);
          inserted.resolve(slot);
        }
      }
    });
  },
});

export { setupHandleMessages };
