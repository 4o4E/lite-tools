import { aioStore } from "@/renderer/modules/aioStore";
import { configStore } from "@/renderer/modules/configStore";
import { onComponentMount } from "@/renderer/modules/vueComponentTracker";
import type { GetMessageRecord } from "./insertRepeatBtn";
import type { MessageElement } from "./type";

interface ProseMirrorEditor {
  view: {
    state: {
      selection: { to: number };
      tr: { insertText: (text: string, from: number, to: number) => unknown };
    };
    dispatch: (transaction: unknown) => void;
    focus: () => void;
  };
}

interface CkeditorWriter {
  createText: (text: string) => unknown;
  setSelection: (position: unknown) => void;
}

interface CkeditorModel {
  document: { selection: { getLastPosition: () => unknown } };
  change: (callback: (writer: CkeditorWriter) => void) => void;
  insertContent: (node: unknown, position: unknown) => { end: unknown };
}

interface CkeditorInstance {
  model: CkeditorModel;
  editing?: { view?: { focus?: () => void } };
}

interface VueEditorElement extends HTMLElement {
  __VUE__?: Array<{ ctx?: { getEditor?: () => { editor?: ProseMirrorEditor } } }>;
}

interface CkeditorElement extends HTMLElement {
  ckeditorInstance?: CkeditorInstance;
}

type MessageRecord = Message | undefined;

interface CopyContext {
  messageEl: MessageElement;
  msgId: string;
  peer: Peer;
  text: string;
}

interface MenuRequest {
  generation: number;
  context: CopyContext;
  previousMenus: Set<HTMLElement>;
  x: number;
  y: number;
  menu?: HTMLElement;
}

let teardown: (() => void) | undefined;

function getMessageText(msgRecord: MessageRecord, messageEl: MessageElement) {
  if (Array.isArray(msgRecord?.elements)) {
    const text = msgRecord.elements.map((element) => element?.textElement?.content || "").join("").replace(/\r\n/g, "\n").trim();
    if (text) return text;
  }
  const content = messageEl.querySelector<HTMLElement>(".msg-content-container,.message-content__wrapper");
  if (!content) return "";
  const clone = content.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".lt-tools-slot,.lt-slot,.lt-tools-time,.lt-time,.message-content-replace").forEach((item) => item.remove());
  Object.assign(clone.style, {
    position: "fixed",
    left: "-10000px",
    top: "0",
    opacity: "0",
    pointerEvents: "none",
  });
  document.body.appendChild(clone);
  const text = (clone.innerText || "").replace(/\n{3,}/g, "\n\n").trim();
  clone.remove();
  return text;
}
function isCurrent(context: CopyContext, getMessageRecord: GetMessageRecord) {
  const peer = aioStore.getPeer();
  const record = getMessageRecord(context.messageEl);
  return (
    configStore.value.message.copyToChatInput.enabled &&
    context.messageEl.isConnected &&
    context.messageEl.closest(".ml-item")?.id === context.msgId &&
    !!record && record.msgId === context.msgId &&
    record.peerUid === context.peer.peerUid && record.chatType === context.peer.chatType &&
    peer.peerUid === context.peer.peerUid && peer.chatType === context.peer.chatType
  );
}

function insertText(text: string) {
  if (!text) return false;
  const pmElement = document.querySelector<VueEditorElement>(".qq-msg-editor");
  const pm = pmElement?.__VUE__?.[0]?.ctx?.getEditor?.()?.editor;
  if (pm?.view?.state) {
    const view = pm.view;
    const position = view.state.selection.to;
    const tr = view.state.tr.insertText(text, position, position);
    view.dispatch(tr);
    view.focus();
    return true;
  }
  const ckElement = document.querySelector<CkeditorElement>(".ck.ck-content.ck-editor__editable");
  const ckeditor = ckElement?.ckeditorInstance;
  if (!ckeditor?.model || !ckElement) return false;
  ckeditor.editing?.view?.focus?.();
  ckElement.focus();
  const position = ckeditor.model.document.selection.getLastPosition();
  if (!position) return false;
  ckeditor.model.change((writer) => {
    const textNode = writer.createText(text);
    const inserted = ckeditor.model.insertContent(textNode, position);
    writer.setSelection(inserted.end);
  });
  return true;
}

function setupCopyToInputMenu(getMessageRecord: GetMessageRecord) {
  if (teardown) return teardown;
  let generation = 0;
  let request: MenuRequest | undefined;
  let observer: MutationObserver | undefined;
  let expiryTimer: number | undefined;
  const menuOwners = new WeakMap<HTMLElement, MenuRequest>();
  const scheduledMenus = new WeakSet<HTMLElement>();

  const clear = () => {
    generation++;
    request = undefined;
    observer?.disconnect();
    observer = undefined;
    window.clearTimeout(expiryTimer);
    expiryTimer = undefined;
    document.querySelectorAll(".lt-copy-to-input-menu-item").forEach((item) => item.remove());
  };

  const insertMenuItem = (captured: MenuRequest, menu: HTMLElement) => {
    if (
      request !== captured ||
      generation !== captured.generation ||
      !isCurrent(captured.context, getMessageRecord) ||
      !menu.isConnected ||
      captured.previousMenus.has(menu) ||
      menuOwners.get(menu) !== captured ||
      (captured.menu && captured.menu !== menu)
    ) return;
    if (menu.parentElement?.closest(".q-context-menu")) return;
    const rect = menu.getBoundingClientRect();
    if (
      !rect.width ||
      !rect.height ||
      captured.x < rect.left - 24 ||
      captured.x > rect.right + 24 ||
      captured.y < rect.top - 24 ||
      captured.y > rect.bottom + 24
    ) return;
    const nativeItem = Array.from(menu.children).find((child): child is HTMLElement =>
      child instanceof HTMLElement && child.classList.contains("q-context-menu-item"),
    );
    if (!nativeItem || menu.querySelector(".lt-copy-to-input-menu-item")) return;
    captured.menu = menu;
    window.clearTimeout(expiryTimer);
    expiryTimer = undefined;
    const item = document.createElement("div");
    item.className = "q-context-menu-item lt-copy-to-input-menu-item";
    item.setAttribute("role", "menuitem");
    const head = document.createElement("div");
    head.className = "q-context-menu-item__head";
    const icon = document.createElement("i");
    icon.className = "q-context-menu-item__icon q-svg-icon q-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-3"/><path d="M16 3h5v5M10 14 21 3"/></svg>';
    const label = document.createElement("div");
    label.className = "q-context-menu-item__text";
    label.textContent = "复制到聊天框";
    for (const [target, source] of [
      [item, nativeItem],
      [head, nativeItem.querySelector(".q-context-menu-item__head")],
      [icon, nativeItem.querySelector(".q-context-menu-item__icon") ?? nativeItem.querySelector(".q-icon")],
      [label, nativeItem.querySelector(".q-context-menu-item__text")],
    ] as [HTMLElement, Element | null][]) {
      source?.getAttributeNames().forEach((name) => {
        if (/^data-v-[\da-f]+$/i.test(name)) target.setAttribute(name, "");
      });
    }
    head.append(icon);
    item.append(head, label);
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
      item.addEventListener(type, (event) => event.stopImmediatePropagation());
    }
    item.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (request !== captured || generation !== captured.generation || !menu.isConnected || !isCurrent(captured.context, getMessageRecord)) return;
      try {
        insertText(captured.context.text);
      } catch (error) {
        console.error("[Lite Tools] 复制到聊天框失败", error);
      }
      clear();
      menu.remove();
    });
    menu.insertBefore(item, menu.firstChild);
  };

  configStore.onChange(clear);
  const scheduleMenu = (captured: MenuRequest, menu: HTMLElement) => {
    if (request !== captured || captured.previousMenus.has(menu)) return;
    const owner = menuOwners.get(menu);
    if (owner && owner !== captured) return;
    menuOwners.set(menu, captured);
    if (scheduledMenus.has(menu)) return;
    scheduledMenus.add(menu);
    requestAnimationFrame(() => { scheduledMenus.delete(menu); insertMenuItem(captured, menu); });
  };

  onComponentMount((component: unknown) => {
    const captured = request;
    if (!captured || !component || typeof component !== "object" || !("vnode" in component)) return;
    const vnode = component.vnode;
    if (!vnode || typeof vnode !== "object" || !("el" in vnode) || !(vnode.el instanceof HTMLElement)) return;
    const menu = vnode.el.closest<HTMLElement>(".q-context-menu");
    if (menu) scheduleMenu(captured, menu);
  });

  document.addEventListener("mousedown", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (event.button === 2 || !target?.closest(".q-context-menu")) clear();
  }, true);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") clear(); }, true);
  aioStore.onChange(clear);
  document.addEventListener("contextmenu", (event) => {
    clear();
    if (!configStore.value.message.copyToChatInput.enabled) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest(".avatar-span,.avatar,.user-name,.lt-at-user-name,.lt-time-in-name,.lt-slot,.q-context-menu")) return;
    const messageEl = target.closest<MessageElement>(".message");
    const content = target.closest(".message-content__wrapper,.msg-content-container");
    if (!messageEl || !messageEl.closest(".chat-msg-area__vlist") || !content || content.closest(".message") !== messageEl) return;
    const record = getMessageRecord(messageEl);
    const peer = aioStore.getPeer();
    const text = getMessageText(record, messageEl);
    if (!record?.msgId || !text || !peer.peerUid || record.peerUid !== peer.peerUid || record.chatType !== peer.chatType || messageEl.closest(".ml-item")?.id !== record.msgId) return;
    const context: CopyContext = { messageEl, msgId: record.msgId, peer, text };
    const captured: MenuRequest = {
      generation,
      context,
      previousMenus: new Set(Array.from(document.querySelectorAll<HTMLElement>(".q-context-menu"))),
      x: event.clientX,
      y: event.clientY,
    };
    request = captured;
    observer = new MutationObserver((mutations) => {
      if (request !== captured) return;
      if (captured.menu && !captured.menu.isConnected) { clear(); return; }
      for (const mutation of mutations) {
        if (mutation.target instanceof Element) {
          const menu = mutation.target.closest<HTMLElement>(".q-context-menu");
          if (menu) scheduleMenu(captured, menu);
        }
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.matches(".q-context-menu")) scheduleMenu(captured, node);
          node.querySelectorAll<HTMLElement>(".q-context-menu").forEach((menu) => scheduleMenu(captured, menu));
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    expiryTimer = window.setTimeout(() => { if (request === captured && !captured.menu) clear(); }, 1000);
  }, true);
  teardown = clear;
  return clear;
}

export { setupCopyToInputMenu };
