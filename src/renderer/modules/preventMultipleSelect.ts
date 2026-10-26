import { configStore } from "@/renderer/modules/configStore";

type MessageSelection = {
  messageEl: HTMLElement;
  contentEl: HTMLElement;
};

let listenTarget = false;
let interception = false;
let messageSelection: MessageSelection | null = null;
let isMessagePointerDown = false;
let lastPointerY = 0;

// 只拦截单独按住左键的拖动；中键、侧键及侧键组合交给 QQ。
const leftMouseButton = 1;

const pluginExtraSelector = [
  ".lt-slot",
  ".lt-time",
  ".lt-time-in-name",
  ".lt-recall",
  ".lt-repeat",
  ".lt-pic-mask",
  ".lt-add",
].join(",");
const selectionModeClass = "lt-single-message-selecting";
const selectionRootClass = "lt-selection-root";
const selectableContentSelector = [
  ".msg-content-container",
  ".message-content",
  ".normal-file.file-element .file-info",
  ".file-info-mask p:last-child",
  ".reply-message__inner",
].join(",");

function getSelectableContent(target: EventTarget | null): MessageSelection | null {
  if (!(target instanceof Element)) return null;
  const messageEl = target.closest<HTMLElement>(".message");
  if (!messageEl) return null;
  const contentEl = target.closest<HTMLElement>(".message-content__wrapper");
  if (!contentEl) return null;
  const selectableEl = target.closest(selectableContentSelector) ?? contentEl.querySelector(selectableContentSelector);
  if (!selectableEl || target.closest(pluginExtraSelector)) return null;
  return { messageEl, contentEl };
}

function clearMessageSelection() {
  messageSelection?.messageEl.classList.remove(selectionRootClass);
  document.body.classList.remove(selectionModeClass);
  messageSelection = null;
  isMessagePointerDown = false;
}

function setMessageSelection(selection: MessageSelection) {
  clearMessageSelection();
  messageSelection = selection;
  isMessagePointerDown = true;
  document.body.classList.add(selectionModeClass);
  selection.messageEl.classList.add(selectionRootClass);
}

function finishMessagePointerSelection() {
  isMessagePointerDown = false;
  window.setTimeout(() => {
    const selection = window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) {
      clearMessageSelection();
      return;
    }
    clampMessageSelection();
  });
}

function getBoundaryTextPosition(root: HTMLElement, toEnd: boolean): { node: Node; offset: number } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
      if (node.parentElement?.closest(pluginExtraSelector)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let first: Text | null = null;
  let last: Text | null = null;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    first ??= node;
    last = node;
  }
  const node = toEnd ? last : first;
  if (!node) {
    return { node: root, offset: toEnd ? root.childNodes.length : 0 };
  }
  return { node, offset: toEnd ? node.nodeValue!.length : 0 };
}

function nodeInSelectionRoot(node: Node | null) {
  if (!messageSelection?.contentEl || !node) return false;
  const target = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return target ? messageSelection.contentEl.contains(target) : false;
}

function clampMessageSelection() {
  if (!messageSelection || !configStore.value.interface.preventSelect) return;
  const selection = window.getSelection();
  if (!selection?.rangeCount || !selection.anchorNode || !selection.focusNode) {
    clearMessageSelection();
    return;
  }
  if (selection.isCollapsed && !isMessagePointerDown) {
    clearMessageSelection();
    return;
  }
  if (!nodeInSelectionRoot(selection.anchorNode)) {
    clearMessageSelection();
    return;
  }
  if (nodeInSelectionRoot(selection.focusNode)) return;

  const rect = messageSelection.contentEl.getBoundingClientRect();
  const toEnd = lastPointerY >= rect.top + rect.height / 2;
  const boundary = getBoundaryTextPosition(messageSelection.contentEl, toEnd);
  try {
    selection.setBaseAndExtent(selection.anchorNode, selection.anchorOffset, boundary.node, boundary.offset);
  } catch {
    // 选区结构被 QQ 替换时忽略，下一次 selectionchange 会重新校正。
  }
}

function cleanSelectedMessageFragment(event: ClipboardEvent) {
  if (!event.clipboardData || !messageSelection || !configStore.value.interface.preventSelect) return;
  // 鼠标拖选跨出消息后，浏览器可能先触发 copy 再触发下一次 selectionchange。
  clampMessageSelection();
  const selection = window.getSelection();
  if (!selection?.rangeCount || !selection.anchorNode || !nodeInSelectionRoot(selection.anchorNode)) return;
  const range = selection.getRangeAt(0);
  const commonTarget =
    range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? (range.commonAncestorContainer as Element)
      : range.commonAncestorContainer.parentElement;
  if (!commonTarget || !messageSelection.messageEl.contains(commonTarget)) return;

  const fragment = range.cloneContents();
  fragment.querySelectorAll(pluginExtraSelector).forEach((element) => element.remove());
  const div = document.createElement("div");
  div.appendChild(fragment);
  // innerText on a detached node falls back to textContent and loses rendered line breaks.
  div.style.cssText = "position:fixed;left:-100000px;top:0;white-space:pre-wrap;opacity:0;pointer-events:none";
  div.setAttribute("aria-hidden", "true");
  document.body.append(div);
  let text: string;
  try {
    text = div.innerText;
  } finally {
    div.remove();
  }
  if (!text) return;
  event.clipboardData.setData("text/plain", text);
  event.preventDefault();
}

function isOutsideMessageSelection(target: EventTarget | null) {
  return !!(
    messageSelection?.contentEl &&
    target instanceof Node &&
    !messageSelection.contentEl.contains(target)
  );
}

function setupPreventMultipleSelect(className: string) {
  const app = document.querySelector<HTMLElement>("#app")!;

  configStore.onChange((config) => {
    if (!config.interface.preventSelect) clearMessageSelection();
  });

  app.addEventListener("pointerdown", (event) => {
    lastPointerY = event.clientY;
    clearMessageSelection();
    if (configStore.value.interface.preventSelect && event.buttons === leftMouseButton) {
      const selectable = getSelectableContent(event.target);
      if (selectable) setMessageSelection(selectable);
      const target = event.target as HTMLElement;
      interception = !!(
        !target.closest(".message-content__wrapper") &&
        target.closest(`.${className}`) &&
        !target.closest(".v-scrollbar-track")
      );
    } else {
      interception = false;
    }
  });

  app.addEventListener("pointerup", (event) => {
    if (!configStore.value.interface.preventSelect) return;
    if (event.buttons === 0) {
      interception = false;
      if (messageSelection) finishMessagePointerSelection();
    }
  });

  app.addEventListener("mousemove", (event) => {
    lastPointerY = event.clientY;
    const dragTarget = document.querySelector<HTMLElement>(`.${className}`);
    if (!listenTarget && dragTarget) {
      dragTarget.addEventListener("pointerdown", (event) => {
        if (configStore.value.interface.preventSelect && event.buttons === leftMouseButton) {
          document.querySelector(".q-context-menu")?.remove();
        }
      });
      listenTarget = true;
    }
    if (configStore.value.interface.preventSelect && event.buttons === leftMouseButton) {
      clampMessageSelection();
      if (interception || isOutsideMessageSelection(event.target)) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
  });

  document.addEventListener("selectionchange", clampMessageSelection);
  document.addEventListener("copy", cleanSelectedMessageFragment);
}

export { setupPreventMultipleSelect };
