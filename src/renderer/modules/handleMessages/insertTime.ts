import { configStore } from "@/renderer/modules/configStore";
import { formatChineseDate } from "@/renderer/modules/handleMessages/formatChineseDate";

import type { MessageElement, SlotElement } from "./type";

const TIME_FORMAT_MAPPING: Record<string, "numeric" | "2-digit"> = {
  "1": "numeric",
  "2": "2-digit",
};

function createTime(msgRecord: Pick<Message, "msgTime">) {
  const time = document.createElement("span");
  time.classList.add("lt-time", "no-copy");
  const timestamp = Number(msgRecord.msgTime) * 1000;
  time.textContent = getSendTime(timestamp);
  time.title = formatChineseDate(new Date(timestamp));
  const config = configStore.value.message.showSendTime;
  time.dataset.msgTime = msgRecord.msgTime;
  time.dataset.timeFormat = config.timeFormat;
  time.dataset.dateFormat = config.dateFormat;
  time.dataset.showTimeZone = config.showTimeZone ? "1" : "0";
  return time;
}

function insertTime(messageEl: MessageElement, msgRecord: Pick<Message, "msgTime">, slot?: SlotElement) {
  const name = messageEl.querySelector(".user-name");

  const config = configStore.value.message.showSendTime;
  if (config.toSenderName) {
    messageEl.querySelectorAll(".lt-slot .lt-time").forEach(time => time.remove());
    if (!name) return;
    const current = name.querySelector<HTMLSpanElement>(":scope > .lt-time-in-name");
    if (
      current?.dataset.msgTime === msgRecord.msgTime &&
      current.dataset.timeFormat === config.timeFormat &&
      current.dataset.dateFormat === config.dateFormat &&
      current.dataset.showTimeZone === (config.showTimeZone ? "1" : "0")
    ) {
      return;
    }
    name.querySelectorAll(":scope > .lt-time").forEach(time => time.remove());
    const time = createTime(msgRecord);
    time.classList.add("lt-time-in-name");
    name.appendChild(time);
    return;
  }
  name?.querySelectorAll(":scope > .lt-time").forEach(time => time.remove());

  if (!slot || slot.querySelector(".lt-time")) return;
  const time = createTime(msgRecord);
  const clone = time.cloneNode(true) as HTMLElement;
  const spacer = slot.children[0] as HTMLElement;
  const float = slot.children[1] as HTMLElement;
  spacer?.insertAdjacentElement("beforeend", time);
  float?.insertAdjacentElement("beforeend", clone);
}

function getSendTime(sendTime: number) {
  const cfg = configStore.value.message.showSendTime;
  return new Intl.DateTimeFormat("zh-CN", {
    year: TIME_FORMAT_MAPPING[cfg.dateFormat[0]],
    month: TIME_FORMAT_MAPPING[cfg.dateFormat[1]],
    day: TIME_FORMAT_MAPPING[cfg.dateFormat[2]],
    hour: TIME_FORMAT_MAPPING[cfg.timeFormat[0]],
    minute: TIME_FORMAT_MAPPING[cfg.timeFormat[1]],
    second: TIME_FORMAT_MAPPING[cfg.timeFormat[2]],
    timeZoneName: cfg.showTimeZone ? "shortOffset" : undefined,
  }).format(new Date(sendTime));
}

export { insertTime };
