import { repeatMessageContent } from "@/renderer/utils/nativeCall";
import { configStore } from "@/renderer/modules/configStore";
import { aioStore } from "@/renderer/modules/aioStore";

import { ElementType } from "./ElementTypeEnum";
import { createSlot } from "./messageSlot";

import type { MessageElement, SlotElement } from "./type";

const repeatElementType = [
  ElementType.textElement,
  ElementType.picElement,
  ElementType.marketFaceElement,
  ElementType.replyElement,
];

interface RepeatContext {
  messageEl: MessageElement;
  msgId: string;
  peer: Peer;
}

type GetMessageRecord = (messageEl: MessageElement) => Message | undefined;

function isHoverRepeatEnabled() {
  const config = configStore.value.message.repeatMessage;
  return config.enabled && config.position === "hover";
}

function canRepeatMessage(msgRecord: Message | undefined) {
  return (
    !!msgRecord &&
    !msgRecord.lt_recall &&
    Array.isArray(msgRecord.elements) &&
    msgRecord.elements.some((element) => repeatElementType.includes(element.elementType))
  );
}

function createRepeatContext(messageEl: MessageElement, msgRecord: Message | undefined): RepeatContext | null {
  const peer = aioStore.getPeer();
  if (
    !messageEl.isConnected ||
    !msgRecord ||
    ![1, 2, 100].includes(msgRecord.chatType) ||
    !canRepeatMessage(msgRecord) ||
    !msgRecord.msgId ||
    messageEl.closest(".ml-item")?.id !== msgRecord.msgId ||
    !peer.peerUid ||
    peer.chatType !== msgRecord.chatType ||
    peer.peerUid !== msgRecord.peerUid
  ) {
    return null;
  }
  return { messageEl, msgId: msgRecord.msgId, peer };
}

function isRepeatContextCurrent(context: RepeatContext, msgRecord: Message | undefined) {
  const peer = aioStore.getPeer();
  return (
    configStore.value.message.repeatMessage.enabled &&
    context.messageEl.isConnected &&
    context.messageEl.closest(".ml-item")?.id === context.msgId &&
    !!msgRecord &&
    msgRecord.msgId === context.msgId &&
    canRepeatMessage(msgRecord) &&
    msgRecord.chatType === context.peer.chatType &&
    msgRecord.peerUid === context.peer.peerUid &&
    peer.chatType === context.peer.chatType &&
    peer.peerUid === context.peer.peerUid
  );
}

function repeatMessage(context: RepeatContext, getMessageRecord: GetMessageRecord) {
  const msgRecord = getMessageRecord(context.messageEl);
  if (msgRecord && isRepeatContextCurrent(context, msgRecord)) {
    void repeatMessageContent(context.peer, msgRecord, () =>
      isRepeatContextCurrent(context, getMessageRecord(context.messageEl)),
    ).catch(
      (error: unknown) => console.error("[Lite Tools] 复读失败", error),
    );
  }
}

function removeEmptySlots(messageEl: MessageElement) {
  messageEl.querySelectorAll(".lt-slot").forEach((slot) => {
    if (!slot.querySelector(".lt-time,.lt-recall,.lt-repeat")) slot.remove();
  });
  messageEl.querySelectorAll(".content-status.lt-add").forEach((status) => {
    if (!status.childElementCount) status.remove();
  });
}

function removeRepeatBtn(messageEl: MessageElement) {
  messageEl.querySelectorAll(".lt-repeat").forEach((button) => button.remove());
  removeEmptySlots(messageEl);
}

function insertRepeatBtn(
  slot: SlotElement,
  msgRecord: Message,
  messageEl: MessageElement,
  getMessageRecord: GetMessageRecord,
) {
  if (!isHoverRepeatEnabled() || messageEl.querySelector(".lt-repeat")) return;
  const context = createRepeatContext(messageEl, msgRecord);
  if (!context) return;

  let previousClick = 0;
  const btn = document.createElement("span");
  btn.classList.add("lt-repeat");
  btn.textContent = "+1";
  btn.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!isHoverRepeatEnabled()) return;
    if (configStore.value.message.repeatMessage.doubleClick) {
      const now = performance.now();
      if (!previousClick || now - previousClick > 500) {
        previousClick = now;
        return;
      }
      previousClick = 0;
    }
    repeatMessage(context, getMessageRecord);
  });
  if (slot.classList.contains("outside")) {
    slot.querySelector(".lt-float")?.appendChild(btn);
  } else {
    const privateSlot = createSlot();
    privateSlot.classList.add("outside");
    if (!messageEl.querySelector(".content-status.no-copy")) {
      const div = document.createElement("div");
      div.classList.add("content-status", "no-copy", "lt-add");
      messageEl.querySelector(".message-content__wrapper")?.insertAdjacentElement("afterend", div);
    }
    privateSlot.querySelector(".lt-float")?.appendChild(btn);
    messageEl.querySelector(".content-status.no-copy")?.appendChild(privateSlot);
  }
  removeEmptySlots(messageEl);
}

export {
  canRepeatMessage,
  createRepeatContext,
  insertRepeatBtn,
  isHoverRepeatEnabled,
  isRepeatContextCurrent,
  removeEmptySlots,
  removeRepeatBtn,
  repeatMessage,
};
export type { GetMessageRecord, RepeatContext };
