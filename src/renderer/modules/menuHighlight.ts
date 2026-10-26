import { configStore } from "@/renderer/modules/configStore";

const actions = {
  复制: "copy", 转发: "forward", 收藏: "collect", 多选: "multiple",
  引用: "quote", 回复: "quote", 设为精华: "essence", 撤回: "revoke", 删除: "delete",
} as const;
type Action = typeof actions[keyof typeof actions];
const actionNames: readonly Action[] = ["copy", "forward", "collect", "multiple", "quote", "essence", "revoke", "delete"];
const attribute = "data-lt-menu-action";
const itemSelector = ".q-context-menu .q-context-menu-item";
let initialized = false;

export function setupMenuHighlight() {
  if (initialized) return;
  initialized = true;
  const style = document.createElement("style");
  style.dataset.ltMenuHighlight = "";

  const updateItem = (item: Element) => {
    const label = item.querySelector(".q-context-menu-item__text")?.textContent?.trim();
    const action = label && Object.hasOwn(actions, label) ? actions[label as keyof typeof actions] : undefined;
    if (action) {
      if (item.getAttribute(attribute) !== action) item.setAttribute(attribute, action);
    } else {
      item.removeAttribute(attribute);
    }
  };
  const scan = (root: Element) => {
    const item = root.closest(itemSelector);
    if (item) updateItem(item);
    root.querySelectorAll(itemSelector).forEach(updateItem);
  };
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "characterData") {
        if (mutation.target.parentElement) scan(mutation.target.parentElement);
      } else {
        if (mutation.target instanceof Element && mutation.target.closest(".q-context-menu")) scan(mutation.target);
        mutation.addedNodes.forEach((node) => {
          if (node instanceof Element) scan(node);
        });
      }
    }
  });
  const update = () => {
    observer.disconnect();
    const config = configStore.value.contextMenu.highlight;
    if (!config.enabled) {
      style.remove();
      document.querySelectorAll(`[${attribute}]`).forEach((item) => item.removeAttribute(attribute));
      return;
    }
    const colors = (theme: "light" | "dark") => {
      const fallback = theme === "light" ? "#000000" : "#ffffff";
      return actionNames.map((action) => {
        const color = config[theme][action];
        return `--lt-menu-${action}:${/^#[\da-f]{6}$/i.test(color) ? color : fallback};`;
      }).join("");
    };
    const light = colors("light");
    const dark = colors("dark");
    // Follow explicit QQ theme first; system preference is only a fallback.
    style.textContent = `:root{${light}}
@media(prefers-color-scheme:dark){:root{${dark}}}
body.q-theme-tokens-light{${light}}
body.q-theme-tokens-dark{${dark}}
${actionNames.map((action) => {
  const selector = `${itemSelector}[${attribute}="${action}"]:not(.disabled):not(.q-context-menu-item--disabled):not([disabled]):not([aria-disabled="true"])`;
  return `${selector},${selector} .q-context-menu-item__text,${selector} .q-context-menu-item__icon{color:var(--lt-menu-${action}) !important}`;
}).join("\n")}`;
    if (!style.isConnected) document.head.append(style);
    scan(document.body);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  };
  configStore.onChange(update);
  update();
}
