import { createLogger } from "@/renderer/utils/createLogger";

const log = createLogger("nameAt");

const groupChatType = 2;

interface AtBinding {
  anchor: HTMLElement;
  handler: (event: MouseEvent) => Promise<void>;
}

interface MessageRecordView {
  chatType?: number;
  name: string;
  isSelf: boolean;
}

const bindings = new WeakMap<HTMLElement, AtBinding>();

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readDomName(userNameEl: HTMLElement | null): string {
  const clone = userNameEl?.cloneNode(true);
  if (!(clone instanceof HTMLElement)) return "";
  clone.querySelectorAll(".q-tag,.lt-time,.lite-tools-time").forEach((item) => item.remove());
  return clone.textContent?.trim() ?? "";
}

function readMessageRecord(value: unknown, userNameEl: HTMLElement | null, messageEl: HTMLElement): MessageRecordView {
  const record = isObject(value) ? value : {};
  const anonymous = isObject(record.anonymousExtInfo) ? record.anonymousExtInfo : {};
  const names = [
    record.sendNickName,
    record.senderNickName,
    record.sendNick,
    record.senderNick,
    record.nickName,
    anonymous.anonymousNick,
  ].filter((item): item is string => typeof item === "string" && item.length > 0);
  const name = (names[0] ?? readDomName(userNameEl)).replace(/^@+/, "");
  const selfFlags = [record.isSelf, record.isSelfMsg, record.isSelfSend, record.senderIsSelf, record.fromSelf];
  const isSelf =
    selfFlags.some((flag) => flag === true) ||
    Boolean(messageEl.querySelector(".message-container--self,.user-name--selfRole,.user-name--selfReverse"));

  return {
    chatType: typeof record.chatType === "number" ? record.chatType : undefined,
    name,
    isSelf,
  };
}

function removeAtTarget(targetEl: HTMLElement | null) {
  if (!targetEl) return;
  const binding = bindings.get(targetEl);
  if (binding) {
    targetEl.removeEventListener("click", binding.handler, true);
    bindings.delete(targetEl);
  }
  targetEl.classList.remove("lt-at-user-name");
  if (targetEl.title.startsWith("@")) targetEl.removeAttribute("title");
}

function dispatchRightClick(target: HTMLElement, point: { x: number; y: number }) {
  const eventInit: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    view: window,
    button: 2,
    buttons: 2,
    clientX: point.x,
    clientY: point.y,
    screenX: point.x,
    screenY: point.y,
  };
  ["pointerdown", "mousedown", "contextmenu", "mouseup", "pointerup"].forEach((type) => {
    target.dispatchEvent(new MouseEvent(type, eventInit));
  });
}

function findNativeAtMenuItem(): HTMLElement | null {
  const items = Array.from(
    document.querySelectorAll<HTMLElement>(".q-context-menu .q-context-menu-item,.q-context-menu .q-context-menu-item__text"),
  ).map((item) => item.closest<HTMLElement>(".q-context-menu-item") || item);

  for (const item of items) {
    const text = item.textContent?.replace(/\s+/g, "").trim() || "";
    const useEl = item.querySelector("use");
    const iconHref = useEl?.getAttribute("xlink:href") || useEl?.getAttribute("href") || "";
    if (["@", "TA", "@TA", "@Ta", "@ta", "提及"].includes(text) || iconHref.includes("at_24")) {
      return item;
    }
  }
  return null;
}

async function openNativeAt(messageEl: HTMLElement, anchorEl: HTMLElement | null): Promise<boolean> {
  const target = anchorEl || messageEl;
  document.querySelector(".q-context-menu")?.remove();
  const rect = target.getBoundingClientRect();
  dispatchRightClick(target, {
    x: Math.round(rect.left + rect.width / 2),
    y: Math.round(rect.top + rect.height / 2),
  });

  for (let attempt = 0; attempt < 20; attempt++) {
    const menuItem = findNativeAtMenuItem();
    if (menuItem) {
      menuItem.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true, cancelable: true, view: window }));
      menuItem.click();
      return true;
    }
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 25);
    await promise;
  }

  log("未找到 QQ 原生 @ 菜单项");
  document.querySelector(".q-context-menu")?.remove();
  return false;
}

function bindAtTarget(targetEl: HTMLElement, messageEl: HTMLElement, anchorEl: HTMLElement, name: string) {
  targetEl.title = `@${name}`;
  targetEl.classList.add("lt-at-user-name");

  const existing = bindings.get(targetEl);
  if (existing) {
    existing.anchor = anchorEl;
    return;
  }

  const handler = async (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const anchor = bindings.get(targetEl)?.anchor ?? anchorEl;
    await openNativeAt(messageEl, anchor);
  };

  bindings.set(targetEl, { anchor: anchorEl, handler });
  targetEl.addEventListener("click", handler, true);
}

export function bindUserNameAt(messageEl: Element, msgRecord: unknown) {
  if (!(messageEl instanceof HTMLElement)) return;

  const userNameEl = messageEl.querySelector<HTMLElement>(".user-name");
  const record = readMessageRecord(msgRecord, userNameEl, messageEl);
  if (record.chatType !== groupChatType) return;

  const nameTextEl =
    userNameEl?.querySelector<HTMLElement>(":scope > .text-ellipsis") ??
    Array.from(userNameEl?.children ?? []).find(
      (item): item is HTMLElement =>
        item instanceof HTMLElement &&
        !item.classList.contains("q-tag") &&
        !item.classList.contains("lt-time") &&
        !item.classList.contains("lite-tools-time"),
    ) ??
    null;
  const avatarEl =
    messageEl.querySelector<HTMLElement>(".avatar-span .avatar") ||
    messageEl.querySelector<HTMLElement>(".avatar-span") ||
    messageEl.querySelector<HTMLElement>(".avatar");

  // 头像保留 QQ 原生点击行为；只给昵称挂 @。
  removeAtTarget(avatarEl);
  if (!nameTextEl) return;
  if (record.isSelf) {
    removeAtTarget(nameTextEl);
    return;
  }
  if (!record.name) return;

  bindAtTarget(nameTextEl, messageEl, avatarEl || nameTextEl, record.name);
}
