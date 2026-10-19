import { aioStore } from "@/renderer/modules/aioStore";
import { configStore } from "@/renderer/modules/configStore";
import { onComponentMount } from "@/renderer/modules/vueComponentTracker";
import { createRepeatContext, isRepeatContextCurrent, repeatMessage } from "./insertRepeatBtn";

import type { GetMessageRecord, RepeatContext } from "./insertRepeatBtn";
import type { MessageElement } from "./type";

interface MenuRequest {
  generation: number;
  context: RepeatContext;
  previousMenus: Set<HTMLElement>;
  x: number;
  y: number;
  menu?: HTMLElement;
}

function setupRepeatMenu(getMessageRecord: GetMessageRecord) {
  let generation = 0;
  let request: MenuRequest | undefined;
  let observer: MutationObserver | undefined;
  let expiryTimer: number | undefined;
  const menuOwners = new WeakMap<HTMLElement, MenuRequest>();
  const scheduledMenus = new WeakSet<HTMLElement>();

  const clearRepeatMenu = () => {
    generation++;
    request = undefined;
    observer?.disconnect();
    observer = undefined;
    window.clearTimeout(expiryTimer);
    expiryTimer = undefined;
    document.querySelectorAll(".lt-repeat-menu-item").forEach((item) => item.remove());
  };

  const insertMenuItem = (captured: MenuRequest, menu: HTMLElement) => {
    const config = configStore.value.message.repeatMessage;
    if (
      request !== captured ||
      generation !== captured.generation ||
      !config.enabled ||
      config.position !== "contextMenu" ||
      !menu.isConnected ||
      captured.previousMenus.has(menu) ||
      menuOwners.get(menu) !== captured ||
      (captured.menu && captured.menu !== menu) ||
      !isRepeatContextCurrent(captured.context, getMessageRecord(captured.context.messageEl))
    ) {
      return;
    }
    // 只接纳这次点击位置附近的新根菜单，不向旧菜单、子菜单或其他浮层注入。
    if (menu.parentElement?.closest(".q-context-menu")) return;
    const rect = menu.getBoundingClientRect();
    if (
      !rect.width ||
      !rect.height ||
      captured.x < rect.left - 24 ||
      captured.x > rect.right + 24 ||
      captured.y < rect.top - 24 ||
      captured.y > rect.bottom + 24
    ) {
      return;
    }
    const nativeItem = Array.from(menu.children).find(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && child.classList.contains("q-context-menu-item"),
    );
    if (!nativeItem || menu.querySelector(".lt-repeat-menu-item")) return;
    captured.menu = menu;
    window.clearTimeout(expiryTimer);
    expiryTimer = undefined;

    // 创建纯 DOM 菜单项；不克隆原生节点、Vue 实例或原生点击行为。
    const item = document.createElement("div");
    item.className = "q-context-menu-item lt-repeat-menu-item";
    item.setAttribute("role", "menuitem");
    const head = document.createElement("div");
    head.className = "q-context-menu-item__head";
    const icon = document.createElement("i");
    icon.className = "q-context-menu-item__icon q-svg-icon q-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
    const label = document.createElement("div");
    label.className = "q-context-menu-item__text";
    label.textContent = "+1";
    // 仅沿用 scoped CSS 的标记，不复制事件、业务 data 属性或 Vue 私有字段。
    const styledElements: [HTMLElement, Element | null][] = [
      [item, nativeItem],
      [head, nativeItem.querySelector(".q-context-menu-item__head")],
      [icon, nativeItem.querySelector(".q-context-menu-item__icon") ?? nativeItem.querySelector(".q-icon")],
      [label, nativeItem.querySelector(".q-context-menu-item__text")],
    ];
    for (const [target, source] of styledElements) {
      source?.getAttributeNames().forEach((name) => {
        if (/^data-v-[\da-f]+$/i.test(name)) target.setAttribute(name, "");
      });
    }
    head.appendChild(icon);
    item.append(head, label);
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
      item.addEventListener(type, (event) => event.stopImmediatePropagation());
    }
    item.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (
        request !== captured ||
        generation !== captured.generation ||
        !menu.isConnected ||
        configStore.value.message.repeatMessage.position !== "contextMenu"
      ) {
        return;
      }
      repeatMessage(captured.context, getMessageRecord(captured.context.messageEl));
      clearRepeatMenu();
      menu.remove();
    });
    menu.insertBefore(item, menu.firstChild);
  };

  const scheduleMenu = (captured: MenuRequest, menu: HTMLElement) => {
    if (request !== captured || captured.previousMenus.has(menu)) return;
    const owner = menuOwners.get(menu);
    if (owner && owner !== captured) return;
    menuOwners.set(menu, captured);
    if (scheduledMenus.has(menu)) return;
    scheduledMenus.add(menu);
    requestAnimationFrame(() => {
      scheduledMenus.delete(menu);
      insertMenuItem(captured, menu);
    });
  };

  // Vue tracker 可能先于实际 DOM 挂载触发；回调始终携带当时的请求和菜单节点。
  onComponentMount((component: unknown) => {
    const captured = request;
    if (!captured || !component || typeof component !== "object" || !("vnode" in component)) return;
    const vnode = component.vnode;
    if (!vnode || typeof vnode !== "object" || !("el" in vnode) || !(vnode.el instanceof HTMLElement)) return;
    const menu = vnode.el.closest<HTMLElement>(".q-context-menu");
    if (menu) scheduleMenu(captured, menu);
  });

  document.addEventListener(
    "mousedown",
    (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (event.button === 2 || !target?.closest(".q-context-menu")) clearRepeatMenu();
    },
    true,
  );
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") clearRepeatMenu();
  }, true);
  aioStore.onChange(clearRepeatMenu);

  document.addEventListener(
    "contextmenu",
    (event) => {
      clearRepeatMenu();
      const config = configStore.value.message.repeatMessage;
      if (!config.enabled || config.position !== "contextMenu") return;
      const target = event.target instanceof Element ? event.target : null;
      if (
        !target ||
        target.closest(".avatar-span,.avatar,.user-name,.lt-at-user-name,.lt-time-in-name,.lt-slot,.q-context-menu")
      ) {
        return;
      }
      const messageEl = target.closest<MessageElement>(".message");
      const content = target.closest(".message-content__wrapper");
      if (
        !messageEl ||
        !messageEl.closest(".chat-msg-area__vlist") ||
        !content ||
        content.closest(".message") !== messageEl
      ) {
        return;
      }
      const context = createRepeatContext(messageEl, getMessageRecord(messageEl));
      if (!context) return;
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
        if (captured.menu && !captured.menu.isConnected) {
          clearRepeatMenu();
          return;
        }
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
      // 超时后丢弃未匹配的请求，后续任意菜单不能复用这条消息的上下文。
      expiryTimer = window.setTimeout(() => {
        if (request === captured && !captured.menu) clearRepeatMenu();
      }, 1000);
    },
    true,
  );
  return clearRepeatMenu;
}

export { setupRepeatMenu };
