import { aioStore } from "@/renderer/modules/aioStore";
import { configStore } from "@/renderer/modules/configStore";
import { toastManager } from "@/renderer/modules/toastManager";

import type { GetMessageRecord } from "./insertRepeatBtn";
import type { MessageElement } from "./type";

interface NudgeContext {
  avatar: HTMLElement;
  messageEl: MessageElement;
  msgId: string;
  peer: Peer;
  targetUid: string;
  targetUin: string;
  chatUin: string;
}

function createNudgeContext(target: EventTarget | null, getMessageRecord: GetMessageRecord): NudgeContext | null {
  if (!configStore.value.message.nativeNudge || !(target instanceof Element)) return null;
  const surface = target.closest<HTMLElement>(".avatar-span,.message-container__avatar");
  const avatar = surface?.closest<HTMLElement>(".avatar-span") ?? surface;
  if (
    !avatar ||
    (avatar.classList.contains("avatar-span") && !avatar.querySelector(".message-container__avatar")) ||
    avatar.closest(".message-content__wrapper")
  ) {
    return null;
  }
  const row = avatar?.closest<HTMLElement>(".ml-item");
  const messageEl = row?.querySelector<MessageElement>(".message");
  if (!avatar || !row?.closest(".chat-msg-area__vlist") || !messageEl) return null;
  const record = getMessageRecord(messageEl);
  const peer = aioStore.getPeer();
  const anonymous: unknown = record?.anonymousExtInfo;
  if (
    !record ||
    ![1, 2].includes(record.chatType) ||
    !record.msgId ||
    row.id !== record.msgId ||
    !avatar.isConnected ||
    !messageEl.isConnected ||
    !record.senderUid ||
    typeof record.senderUin !== "string" ||
    !/^[1-9]\d*$/.test(record.senderUin) ||
    typeof record.peerUin !== "string" ||
    !/^[1-9]\d*$/.test(record.peerUin) ||
    peer.chatType !== record.chatType ||
    peer.peerUid !== record.peerUid ||
    (anonymous !== null &&
      typeof anonymous === "object" &&
      "anonymousNick" in anonymous &&
      Boolean(anonymous.anonymousNick))
  ) {
    return null;
  }
  return {
    avatar,
    messageEl,
    msgId: record.msgId,
    peer,
    targetUid: record.senderUid,
    targetUin: record.senderUin,
    chatUin: record.peerUin,
  };
}

function isNudgeContextCurrent(context: NudgeContext, getMessageRecord: GetMessageRecord): boolean {
  if (!configStore.value.message.nativeNudge) return false;
  const current = createNudgeContext(context.avatar, getMessageRecord);
  return (
    current !== null &&
    current.avatar === context.avatar &&
    current.messageEl === context.messageEl &&
    current.msgId === context.msgId &&
    current.peer.chatType === context.peer.chatType &&
    current.peer.peerUid === context.peer.peerUid &&
    current.targetUid === context.targetUid &&
    current.targetUin === context.targetUin &&
    current.chatUin === context.chatUin
  );
}

async function sendNativeNudge(context: NudgeContext, getMessageRecord: GetMessageRecord): Promise<void> {
  if (!isNudgeContextCurrent(context, getMessageRecord)) return;
  try {
    const response: unknown = await lite_tools.nativeCall(
      { eventName: "ntApi", type: "request" },
      {
        cmdName: "nodeIKernelMsgService/sendNudge",
        cmdType: "invoke",
        payload: [{ peer: context.peer, targetUin: context.targetUin, chatUin: context.chatUin }, null],
      },
      true,
    );
    if (
      response === null ||
      typeof response !== "object" ||
      !("result" in response) ||
      typeof response.result !== "number" ||
      !Number.isFinite(response.result)
    ) {
      throw new Error("QQ 原生戳一戳没有返回有效结果");
    }
    if (response.result !== 0) {
      const message =
        "errMsg" in response && typeof response.errMsg === "string" && response.errMsg
          ? response.errMsg
          : "QQ 内核拒绝了这次请求";
      toastManager.show(`戳一戳失败（${response.result}）：${message}`, "error", 5000);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    toastManager.show(`戳一戳失败：${message}`, "error", 5000);
  }
}

export { createNudgeContext, isNudgeContextCurrent, sendNativeNudge };
export type { NudgeContext };
