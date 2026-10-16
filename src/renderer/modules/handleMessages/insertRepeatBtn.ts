import { forwardMessage } from "@/renderer/utils/nativeCall";
import { configStore } from "@/renderer/modules/configStore";
import { aioStore } from "@/renderer/modules/aioStore";

import { ElementType } from "./ElementTypeEnum";
import { createSlot } from "./messageSlot";

import type { MessageElement, SlotElement } from "./type";

const repeatElementType = [ElementType.textElement, ElementType.picElement, ElementType.marketFaceElement];

function insertRepeatBtn(slot: SlotElement, msgRecord: any, messageEl: MessageElement) {
  if (messageEl.querySelector(".lt-repeat")) return;

  if (
    msgRecord.elements.some((element: any) => {
      return repeatElementType.includes(element.elementType);
    })
  ) {
    let doubleClick = false;
    const btn = document.createElement("span");
    const msgId = msgRecord.msgId;
    btn.classList.add("lt-repeat");
    btn.textContent = "+1";
    btn.addEventListener("click", () => {
      const peer = {
        chatType: aioStore.value.chatType,
        guildId: "",
        peerUid: aioStore.value.header.uid,
      };
      if (configStore.value.message.repeatMessage.doubleClick) {
        setTimeout(() => {
          doubleClick = false;
        }, 500);
        if (doubleClick) {
          forwardMessage(peer, peer, [msgId]);
          doubleClick = false;
        }
        doubleClick = true;
      } else {
        forwardMessage(peer, peer, [msgId]);
      }
    });
    if (slot.classList.contains("outside")) {
      const float = slot.children[1] as HTMLElement;
      float?.insertAdjacentElement("beforeend", btn);
    } else {
      const privateSlot = createSlot();
      privateSlot.classList.add("outside");
      if (!messageEl.querySelector(".content-status.no-copy")) {
        const div = document.createElement("div");
        div.classList.add("content-status", "no-copy", "lt-add");
        messageEl.querySelector(".message-content__wrapper")?.insertAdjacentElement("afterend", div);
      }
      privateSlot.querySelector(".lt-float")?.appendChild(btn);
      // log("插入外部插槽");
      messageEl.querySelector(".content-status.no-copy")?.appendChild(privateSlot);
    }
  }
}

export { insertRepeatBtn };
