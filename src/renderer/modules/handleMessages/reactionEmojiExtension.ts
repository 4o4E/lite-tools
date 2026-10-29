import { aioStore } from "@/renderer/modules/aioStore";
import { configStore } from "@/renderer/modules/configStore";
import { onComponentMount } from "@/renderer/modules/vueComponentTracker";
import { importTextAsset } from "@/renderer/utils/importAsset";

interface EmojiRecord {
  path?: unknown;
  emojiId?: unknown;
  qcid?: unknown;
  type?: unknown;
  emojiType?: unknown;
  [key: string]: unknown;
}

interface EmojiComponent {
  ctx?: {
    panelEmojis?: unknown;
    onClickSticker?: unknown;
  };
  props?: {
    emojis?: unknown;
  };
  subTree?: unknown;
}

const notoEmojiMapPath = "assets";
const notoEmojiMapFile = "notoEmoji.json";

/**
 * 数据约 1 MB（165 张 base64 PNG）。内联进 renderer 会让每个窗口都编译这 1 MB，
 * 而 Noto 表情只在聊天页启用时使用，因此改为按需从 dist/assets 读取。
 */
let notoEmojiMap: Record<string, string> | null = null;
let notoEmojiMapLoading: Promise<void> | null = null;

function loadNotoEmojiMap(): Promise<void> {
  if (notoEmojiMap) return Promise.resolve();
  notoEmojiMapLoading ??= importTextAsset(notoEmojiMapPath, notoEmojiMapFile)
    .then((text) => {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        notoEmojiMap = parsed as Record<string, string>;
      }
    })
    .catch((error) => {
      console.error("[lite-tools] Noto 表情数据加载失败", error);
    })
    .finally(() => {
      notoEmojiMapLoading = null;
    });
  return notoEmojiMapLoading;
}

const NOTO_FONT_URL =
  "https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji@main/2D/fonts/NotoColorEmoji_WindowsCompatible.ttf";
const EMOJI_UNICODE_RANGE =
  "U+1F000-1FAFF,U+2600-27BF,U+2B00-2BFF,U+FE0F,U+200D,U+20E3,U+1F1E6-1F1FF,U+2190-21FF,U+2300-23FF,U+25A0-25FF,U+2900-297F,U+3030,U+303D,U+3297,U+3299";

function isEmojiRecord(value: unknown): value is EmojiRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isEmojiComponent(value: unknown): value is EmojiComponent {
  return !!value && typeof value === "object" && "ctx" in value;
}

function textEmojiSize(element: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(element);
  const rect = range.getBoundingClientRect();
  range.detach();
  const fontSize = parseFloat(getComputedStyle(element).fontSize) || 18;
  return Math.max(rect.width, rect.height) || fontSize;
}

function createNotoEmojiImage(character: string, size?: number) {
  const data = notoEmojiMap?.[character];
  if (!data) return null;
  const image = document.createElement("img");
  image.src = data;
  image.alt = character;
  image.className = "lt-noto-emoji";
  image.style.cssText = size
    ? `width:${size}px;height:${size}px;object-fit:contain;display:block;margin:auto;pointer-events:none;`
    : "width:100%;height:100%;object-fit:contain;display:block;pointer-events:none;";
  return image;
}

function emojiFromImageSource(source: string) {
  const match = source.match(/EmojiSystermResource\/([^/]+)\//);
  if (!match) return "";
  try {
    const decoded = decodeURIComponent(match[1]);
    return /^\d+$/.test(decoded) ? "" : decoded;
  } catch {
    return "";
  }
}

function replaceEmojiImage(image: HTMLImageElement) {
  if (image.dataset.ltNoto) return;
  const character = emojiFromImageSource(image.getAttribute("src") || "");
  const data = character ? notoEmojiMap?.[character] : "";
  if (!data) return;
  const replacement = document.createElement("img");
  for (const attribute of Array.from(image.attributes)) {
    if (attribute.name !== "src") replacement.setAttribute(attribute.name, attribute.value);
  }
  replacement.src = data;
  replacement.dataset.ltNoto = "1";
  image.replaceWith(replacement);
}

function replaceTextEmoji(element: HTMLElement) {
  if (element.dataset.ltNoto || element.children.length) return false;
  const character = (element.textContent || "").trim();
  const data = notoEmojiMap?.[character];
  if (!data) return false;
  const size = textEmojiSize(element);
  const image = document.createElement("img");
  image.src = data;
  image.alt = character;
  image.style.cssText = `width:${size}px;height:${size}px;object-fit:contain;display:inline-block;`;
  element.dataset.ltNoto = "1";
  element.replaceChildren(image);
  return true;
}

function decoratePanelItems(panel: Element) {
  for (const item of Array.from(panel.querySelectorAll(".stickers-list-item"))) {
    if (!(item instanceof HTMLElement) || item.dataset.ltNoto) continue;
    const image = item.querySelector("img");
    if (image instanceof HTMLImageElement) {
      replaceEmojiImage(image);
      continue;
    }
    const character = (item.textContent || "").trim();
    if (!notoEmojiMap?.[character]) continue;
    const replacement = createNotoEmojiImage(character, textEmojiSize(item));
    if (!replacement) continue;
    item.dataset.ltEmoji = character;
    item.dataset.ltNoto = "1";
    item.replaceChildren(replacement);
  }
}

function findPanelComponent(): EmojiComponent | null {
  const app = document.querySelector("#app");
  // QQ 的 Vue 根实例挂在 #app._vnode.component 上，DOM 类型声明不包含该私有字段。
  const vnode = (app as (HTMLElement & { _vnode?: unknown }) | null)?._vnode;
  if (!isEmojiRecord(vnode)) return null;
  const root = vnode.component;
  if (!isEmojiComponent(root)) return null;
  const seen = new Set<EmojiComponent>();
  let found: EmojiComponent | null = null;
  const visit = (component: unknown) => {
    try {
      if (!isEmojiComponent(component) || seen.has(component) || found) return;
      seen.add(component);
      if (
        Array.isArray(component.ctx?.panelEmojis) &&
        typeof component.ctx?.onClickSticker === "function"
      ) {
        found = component;
        return;
      }
      const walkVNode = (node: unknown) => {
        if (!isEmojiRecord(node)) return;
        if (node.component) visit(node.component);
        if (Array.isArray(node.children)) node.children.forEach(walkVNode);
        else if (node.children && typeof node.children === "object") walkVNode(node.children);
        if (Array.isArray(node.dynamicChildren)) node.dynamicChildren.forEach(walkVNode);
      };
      walkVNode(component.subTree);
    } catch {
      // 面板打开/关闭过程中组件树可能处于中间状态。
    }
  };
  visit(root);
  return found;
}

/**
 * 原生贴表情面板的 emoji 分区只渲染 ctx.panelEmojis（146 项），
 * 而 props.emojis 是完整协议列表（165 项）。补充缺失项到 DOM，
 * 点击仍调用原生 onClickSticker，不修改面板自身数据。
 */
function decorateStickerPanel(component: EmojiComponent) {
  const context = component.ctx;
  const props = component.props;
  if (!context || !Array.isArray(context.panelEmojis)) return false;
  const panelEmojis = context.panelEmojis;
  const onClickSticker = context.onClickSticker;
  if (typeof onClickSticker !== "function") return false;
  if (!props || !Array.isArray(props.emojis)) return false;
  const panel = document.querySelector(".menu-stickers-panel");
  if (!panel) return false;
  const title = Array.from(panel.querySelectorAll(".title")).find((element) =>
    (element.textContent || "").includes("emoji 表情"),
  );
  const list = title?.nextElementSibling;
  if (!(list instanceof HTMLElement) || !list.classList.contains("stickers-list")) return false;
  const items = Array.from(list.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && child.classList.contains("stickers-list-item"),
  );
  const base = items[0];
  if (!base) return false;
  const baseTextSize = textEmojiSize(base);
  decoratePanelItems(panel);
  const seen = new Set<string>();
  for (const item of items) {
    const character = item.dataset.ltEmoji ?? (item.textContent || "").trim();
    if (character) seen.add(character);
  }
  const panelCharacters = new Set(
    panelEmojis.filter(isEmojiRecord).map((item) => String(item.emojiId ?? "")),
  );
  for (const emoji of props.emojis) {
    if (!isEmojiRecord(emoji)) continue;
    const character = String(emoji.emojiId ?? "");
    if (!character || panelCharacters.has(character) || seen.has(character)) continue;
    const image = createNotoEmojiImage(character, baseTextSize);
    if (!image) continue;
    const item = document.createElement("div");
    item.className = `${base.className} lt-noto-extra`;
    for (const attribute of Array.from(base.attributes)) {
      if (attribute.name.startsWith("data-v-")) item.setAttribute(attribute.name, "");
    }
    item.dataset.ltEmoji = character;
    item.dataset.ltNoto = "1";
    item.style.cssText = "display:flex;align-items:center;justify-content:center;";
    item.appendChild(image);
    item.addEventListener("click", (event) => {
      event.stopPropagation();
      onClickSticker(emoji, "3");
    });
    list.appendChild(item);
    seen.add(character);
  }
  return true;
}

function notoRemoteUrl(character: string) {
  const codepoints = Array.from(character)
    .map((char) => char.codePointAt(0))
    .filter((codepoint): codepoint is number => codepoint !== undefined && codepoint !== 0xfe0f);
  if (!codepoints.length) return "";
  return `https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji@main/2D/png/128/emoji_${codepoints
    .map((codepoint) => `u${codepoint.toString(16)}`)
    .join("_")}.png`;
}

function decorateReactionItems() {
  for (const span of Array.from(document.querySelectorAll(".reaction-item-expression-emoji"))) {
    if (!(span instanceof HTMLElement) || span.dataset.ltNoto) continue;
    const character = (span.textContent || "").trim();
    const source = notoEmojiMap?.[character] || notoRemoteUrl(character);
    if (!source) continue;
    const image = document.createElement("img");
    image.src = source;
    image.alt = character;
    image.className = "lt-noto-reaction";
    image.style.cssText = "width:18px;height:18px;object-fit:contain;display:inline-block;vertical-align:-0.15em;";
    span.dataset.ltNoto = "1";
    span.replaceChildren(image);
  }
}

function decorateGlobalEmojiImages() {
  for (const image of Array.from(document.querySelectorAll('img[src*="EmojiSystermResource/"]'))) {
    if (image instanceof HTMLImageElement) replaceEmojiImage(image);
  }
}

function decoratePopupEmojiText() {
  const roots = document.querySelectorAll(
    ".q-context-menu, .menu-stickers-panel, [class*=reaction], [class*=express]",
  );
  for (const root of Array.from(roots)) {
    for (const element of Array.from(root.querySelectorAll("*"))) {
      if (element instanceof HTMLElement) replaceTextEmoji(element);
    }
  }
}

function decorateMenuEmojiImages() {
  for (const image of Array.from(document.querySelectorAll(".q-context-menu img"))) {
    if (image instanceof HTMLImageElement) replaceEmojiImage(image);
  }
  for (const element of Array.from(document.querySelectorAll(".q-context-menu [class*=emoji]"))) {
    if (element instanceof HTMLElement) replaceTextEmoji(element);
  }
}

function setupNotoEmojiFont() {
  if (document.getElementById("lt-noto-emoji-font")) return;
  const style = document.createElement("style");
  style.id = "lt-noto-emoji-font";
  style.textContent = `@font-face{font-family:"Color Emoji";src:url("${NOTO_FONT_URL}") format("truetype");font-display:swap;unicode-range:${EMOJI_UNICODE_RANGE};}`;
  document.head.appendChild(style);
}

function setupReactionEmojiExtension() {
  if (configStore.value.message.notoEmoji?.enabled !== true) return;
  setupNotoEmojiFont();
  let cachedPanel: EmojiComponent | null = null;
  let decorateScheduled = false;
  const decorate = () => {
    if (decorateScheduled) return;
    decorateScheduled = true;
    requestAnimationFrame(() => {
      decorateScheduled = false;
      // 数据未就绪时不装饰，避免反应面板提前回退到 CDN 并打上 ltNoto 标记。
      if (!notoEmojiMap) return;
      decorateGlobalEmojiImages();
      decoratePopupEmojiText();
      decorateReactionItems();
      decorateMenuEmojiImages();
      if (!document.querySelector(".menu-stickers-panel")) return;
      if (!cachedPanel) cachedPanel = findPanelComponent();
      if (cachedPanel) decorateStickerPanel(cachedPanel);
    });
  };
  const observer = new MutationObserver(decorate);
  observer.observe(document.body, { childList: true, subtree: true });
  onComponentMount((component) => {
    if (isEmojiComponent(component) && Array.isArray(component.ctx?.panelEmojis)) {
      cachedPanel = component;
      decorate();
    }
  });
  aioStore.onChange(() => {
    cachedPanel = null;
    decorate();
  });
  void loadNotoEmojiMap().then(decorate);
}

export { setupReactionEmojiExtension };
