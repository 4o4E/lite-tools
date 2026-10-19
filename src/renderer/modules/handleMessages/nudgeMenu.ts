import { aioStore } from "@/renderer/modules/aioStore";
import { configStore } from "@/renderer/modules/configStore";
import { onComponentMount } from "@/renderer/modules/vueComponentTracker";
import { createNudgeContext, isNudgeContextCurrent, sendNativeNudge } from "./nativeNudge";

import type { GetMessageRecord } from "./insertRepeatBtn";
import type { NudgeContext } from "./nativeNudge";

interface MenuRequest {
  generation: number;
  context: NudgeContext;
  previousMenus: Set<HTMLElement>;
  x: number;
  y: number;
  menu?: HTMLElement;
  clickHandler?: (event: MouseEvent) => void;
}

function isNativeNudgeItem(item: HTMLElement) {
  if (!item.classList.contains("q-context-menu-item")) return false;
  const label = item.querySelector<HTMLElement>(".q-context-menu-item__text");
  return label?.closest(".q-context-menu-item") === item && label.textContent?.trim() === "戳一戳";
}

function setupNudgeMenu(getMessageRecord: GetMessageRecord): () => void {
  let generation = 0;
  let request: MenuRequest | undefined;
  let observer: MutationObserver | undefined;
  let expiryTimer: number | undefined;
  const menuOwners = new WeakMap<HTMLElement, MenuRequest>();
  const scheduledMenus = new WeakSet<HTMLElement>();

  const clearNudgeMenu = () => {
    generation++;
    const previousRequest = request;
    request = undefined;
    observer?.disconnect();
    observer = undefined;
    window.clearTimeout(expiryTimer);
    expiryTimer = undefined;
    if (previousRequest?.menu && previousRequest.clickHandler) {
      window.removeEventListener("click", previousRequest.clickHandler, true);
      previousRequest.clickHandler = undefined;
    }
  };

  const dismissNudgeMenu = () => {
    const menu = request?.menu;
    clearNudgeMenu();
    menu?.remove();
  };

  const insertNudgeAction = (captured: MenuRequest, menu: HTMLElement) => {
    if (
      request !== captured ||
      generation !== captured.generation ||
      !configStore.value.message.nativeNudge ||
      !menu.isConnected ||
      captured.previousMenus.has(menu) ||
      menuOwners.get(menu) !== captured ||
      (captured.menu && captured.menu !== menu) ||
      captured.clickHandler ||
      !isNudgeContextCurrent(captured.context, getMessageRecord)
    ) {
      return;
    }
    // 只接纳本次头像右键位置附近的新根菜单，不向旧菜单、子菜单或其他浮层接管。
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
    const nudgeItems = Array.from(menu.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement && isNativeNudgeItem(child),
    );
    if (nudgeItems.length !== 1) return;

    captured.menu = menu;
    window.clearTimeout(expiryTimer);
    expiryTimer = undefined;

    // 在窗口捕获阶段只接管本次菜单的动作，先于 QQ 的文档和菜单点击处理。
    const clickHandler = (event: MouseEvent) => {
      if (request !== captured || generation !== captured.generation) return;
      const target = event.target instanceof Element ? event.target : null;
      const item = target?.closest<HTMLElement>(".q-context-menu-item");
      if (
        !item ||
        item.parentElement !== menu ||
        !isNativeNudgeItem(item) ||
        item.matches(".disabled,[disabled],[aria-disabled='true']")
      ) return;
      event.preventDefault();
      event.stopImmediatePropagation();

      const canSend =
        configStore.value.message.nativeNudge &&
        menu.isConnected &&
        isNudgeContextCurrent(captured.context, getMessageRecord);
      clearNudgeMenu();
      menu.remove();
      if (canSend) void sendNativeNudge(captured.context, getMessageRecord);
    };
    captured.clickHandler = clickHandler;
    window.addEventListener("click", clickHandler, true);
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
      insertNudgeAction(captured, menu);
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
      if (event.button === 2 || !target?.closest(".q-context-menu")) dismissNudgeMenu();
    },
    true,
  );
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") dismissNudgeMenu();
  }, true);
  aioStore.onChange(dismissNudgeMenu);
  configStore.onChange((config) => {
    if (!config.message.nativeNudge) clearNudgeMenu();
  });

  document.addEventListener(
    "contextmenu",
    (event) => {
      dismissNudgeMenu();
      if (event.button !== 2 || !configStore.value.message.nativeNudge) return;
      const context = createNudgeContext(event.target, getMessageRecord);
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
        if (!isNudgeContextCurrent(captured.context, getMessageRecord)) {
          dismissNudgeMenu();
          return;
        }
        if (captured.menu && !captured.menu.isConnected) {
          clearNudgeMenu();
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
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["id"],
      });
      // 超时后丢弃未匹配的请求，后续任意菜单不能复用这条头像上下文。
      expiryTimer = window.setTimeout(() => {
        if (request === captured && !captured.menu) clearNudgeMenu();
      }, 1000);
    },
    true,
  );
  return clearNudgeMenu;
}

export { setupNudgeMenu };
