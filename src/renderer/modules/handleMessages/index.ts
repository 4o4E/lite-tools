import { onComponentMount, onComponentUnmount } from "@/renderer/modules/vueComponentTracker";
import { createComparator } from "@/common/createComparator";
import { createLogger } from "@/renderer/utils/createLogger";
import { configStore } from "@/renderer/modules/configStore";

import { initRecallMessageListener, insertRecallTag } from "./messageRecall";
import { setupRevealMask, revealMask } from "./revealMask";
import { insertSlot } from "./messageSlot";
import { insertTime } from "./insertTime";
import {
  canRepeatMessage,
  insertRepeatBtn,
  isHoverRepeatEnabled,
  removeEmptySlots,
  removeRepeatBtn,
} from "./insertRepeatBtn";
import { setupRepeatMenu } from "./repeatMenu";
import { setupCopyToInputMenu } from "./copyToInputMenu";
import { setupReactionEmojiExtension } from "./reactionEmojiExtension";
import { bindUserNameAt } from "./nameAt";
import { setupNudgeDoubleClick } from "./nudgeDoubleClick";
import { setupNudgeMenu } from "./nudgeMenu";
import { chatObserverManager } from "./chatObserverManager";

import type { MessageElement, SlotElement } from "./type";

interface MessageComponent {
  vnode: { el: MessageElement };
  props: { msgRecord: Message };
}

const log = createLogger("handleMessages");
const processedInstances = new WeakMap<MessageComponent, string>();
const messageComponents = new WeakMap<MessageElement, MessageComponent>();
const pendingSlots = new WeakSet<MessageElement>();
const positioningSlots = new WeakMap<MessageElement, SlotElement>();

function isMessageComponent(value: unknown): value is MessageComponent {
  if (!value || typeof value !== "object" || !("vnode" in value) || !("props" in value)) return false;
  const vnode = value.vnode;
  const props = value.props;
  if (
    !vnode ||
    typeof vnode !== "object" ||
    !("el" in vnode) ||
    !(vnode.el instanceof HTMLElement) ||
    !vnode.el.classList.contains("message") ||
    !props ||
    typeof props !== "object" ||
    !("msgRecord" in props)
  ) {
    return false;
  }
  const record = props.msgRecord;
  return (
    !!record &&
    typeof record === "object" &&
    "msgId" in record &&
    typeof record.msgId === "string" &&
    "chatType" in record &&
    typeof record.chatType === "number" &&
    [1, 2, 100].includes(record.chatType) &&
    "peerUid" in record &&
    typeof record.peerUid === "string" &&
    "elements" in record &&
    Array.isArray(record.elements)
  );
}

function getMessageComponent(messageEl: MessageElement) {
  const component = messageEl.__VUE__?.find(
    (candidate: unknown) => isMessageComponent(candidate) && candidate.vnode.el === messageEl,
  );
  const tracked = isMessageComponent(component) ? component : messageComponents.get(messageEl);
  if (
    tracked &&
    !("isUnmounted" in tracked && tracked.isUnmounted) &&
    tracked.vnode.el === messageEl &&
    tracked.props.msgRecord.msgId === messageEl.closest(".ml-item")?.id
  ) {
    return tracked;
  }
}

function getMessageRecord(messageEl: MessageElement) {
  return getMessageComponent(messageEl)?.props.msgRecord;
}

async function setupHandleMessages() {
  await configStore.ready;
  log("注册事件");
  const clearRepeatMenu = setupRepeatMenu(getMessageRecord);
  const clearCopyMenu = setupCopyToInputMenu(getMessageRecord);
  setupReactionEmojiExtension();
  setupNudgeDoubleClick(getMessageRecord);
  setupNudgeMenu(getMessageRecord);
  const messageConfigChanged = createComparator(configStore.value.message);

  // 开启任一复读模式时，都隐藏 QQ 自带的 +1，避免出现第二个入口。
  document.body.classList.toggle("repeat-message", configStore.value.message.repeatMessage.enabled);
  configStore.onChange((config) => {
    document.body.classList.toggle("repeat-message", config.message.repeatMessage.enabled);
    if (!messageConfigChanged(config.message)) return;
    clearRepeatMenu();
    clearCopyMenu();
    document.querySelectorAll<MessageElement>(".message").forEach((messageEl) => {
      pendingSlots.delete(messageEl);
      removeRepeatBtn(messageEl);
      messageEl.querySelectorAll(".lt-time,.lt-recall,.lt-slot").forEach((element) => element.remove());
      removeEmptySlots(messageEl);
      const component = getMessageComponent(messageEl);
      bindUserNameAt(messageEl, component?.props.msgRecord);
      if (component) enhanceMessage(component);
    });
  });

  chatObserverManager.addTask({
    name: "HandleMessageComponents",
    selector: ".message",
    handler: (elements) => elements.forEach(discoverMessageElements),
  });
  chatObserverManager.start();
  setupRevealMask();
  onComponentMount(handleMessages);
  onComponentUnmount((component: unknown) => {
    if (!isMessageComponent(component)) return;
    const messageEl = component.vnode.el;
    if (messageComponents.get(messageEl) === component) {
      messageComponents.delete(messageEl);
      pendingSlots.delete(messageEl);
    }
  });
  initRecallMessageListener(enhanceMessage);

  // 当前 QQ 的消息可能先挂 DOM 再暴露 __VUE__，同时补发现已挂载消息和延迟出现的昵称。
  let discoveryTimer: number | undefined;
  const scheduleDiscovery = () => {
    if (discoveryTimer !== undefined) return;
    discoveryTimer = window.setTimeout(() => {
      discoveryTimer = undefined;
      discoverMessageElements(document);
    }, 50);
  };
  new MutationObserver(scheduleDiscovery).observe(document.body, { childList: true, subtree: true });
  discoverMessageElements(document);
  setTimeout(scheduleDiscovery, 100);
}

function discoverMessageElements(root: ParentNode) {
  if (root instanceof HTMLElement && root.matches(".message")) {
    const component = getMessageComponent(root as MessageElement);
    if (component) handleMessages(component);
  }
  root.querySelectorAll<MessageElement>(".message").forEach((messageEl) => {
    const component = getMessageComponent(messageEl);
    if (component) handleMessages(component);
  });
}

function enabledSlot(msgRecord: Message) {
  const config = configStore.value.message;
  return (
    (config.showSendTime.enabled && !config.showSendTime.toSenderName) ||
    config.preventRecall.enabled ||
    (isHoverRepeatEnabled() && canRepeatMessage(msgRecord))
  );
}

function handleMessages(component: unknown) {
  if (!isMessageComponent(component)) return;
  const messageEl = component.vnode.el;
  const msgRecord = component.props.msgRecord;
  if (!messageEl.isConnected || messageEl.closest(".ml-item")?.id !== msgRecord.msgId) return;
  messageComponents.set(messageEl, component);
  try {
    bindUserNameAt(messageEl, msgRecord);
  } catch (error) {
    log("昵称 @ 绑定失败", error);
  }

  if (processedInstances.get(component) === msgRecord.msgId) {
    const config = configStore.value.message;
    if (
      pendingSlots.has(messageEl) ||
      (isHoverRepeatEnabled() && canRepeatMessage(msgRecord) && !messageEl.querySelector(".lt-repeat")) ||
      (config.showSendTime.enabled && !config.showSendTime.toSenderName && !messageEl.querySelector(".lt-slot .lt-time")) ||
      (config.preventRecall.enabled && msgRecord.lt_recall && !messageEl.querySelector(".lt-recall"))
    ) {
      enhanceMessage(component);
    } else if (
      configStore.value.message.showSendTime.enabled &&
      configStore.value.message.showSendTime.toSenderName &&
      messageEl.querySelector(".user-name") &&
      !messageEl.querySelector(".user-name > .lt-time-in-name")
    ) {
      insertTime(messageEl, msgRecord);
    }
    return;
  }
  processedInstances.set(component, msgRecord.msgId);
  // 复用组件切换到另一条消息时，不保留原消息的按钮、时间或撤回标记。
  removeRepeatBtn(messageEl);
  messageEl.querySelectorAll(".lt-time,.lt-recall,.lt-slot").forEach((element) => element.remove());
  removeEmptySlots(messageEl);
  enhanceMessage(component);
  if (configStore.value.message.revealMask.enabled) {
    revealMask(component, !!messageEl.querySelector(".message-native"));
  }
}

function enhanceMessage(component: unknown) {
  if (!isMessageComponent(component)) return;
  const messageEl = component.vnode.el;
  const msgRecord = component.props.msgRecord;
  if (!messageEl.isConnected || getMessageRecord(messageEl)?.msgId !== msgRecord.msgId) return;
  const config = configStore.value.message;
  if (config.showSendTime.enabled && config.showSendTime.toSenderName) {
    insertTime(messageEl, msgRecord);
  }
  if (!enabledSlot(msgRecord)) {
    pendingSlots.delete(messageEl);
    return;
  }

  const slot = insertSlot(messageEl, msgRecord);
  if (slot === false) {
    pendingSlots.add(messageEl);
    return;
  }
  pendingSlots.delete(messageEl);
  if (!slot) return;
  if (config.showSendTime.enabled && !config.showSendTime.toSenderName) {
    insertTime(messageEl, msgRecord, slot);
  }
  if (config.preventRecall.enabled) {
    insertRecallTag(slot, msgRecord);
  }
  if (positioningSlots.get(messageEl) === slot) return;
  positioningSlots.set(messageEl, slot);
  Promise.resolve(slot.updatePosition?.())
    .then(() => {
      if (
        slot.isConnected &&
        isHoverRepeatEnabled() &&
        getMessageRecord(messageEl)?.msgId === msgRecord.msgId
      ) {
        insertRepeatBtn(slot, msgRecord, messageEl, getMessageRecord);
      }
    })
    .catch((error: unknown) => log("消息插槽定位失败", error))
    .finally(() => {
      if (positioningSlots.get(messageEl) === slot) positioningSlots.delete(messageEl);
    });
}

export { setupHandleMessages };
