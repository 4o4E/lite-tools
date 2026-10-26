import { configStore } from "@/renderer/modules/configStore";
import { styleManager } from "@/renderer/modules/styleManager";

type AnimationEntry = { md5: string; src: string };
type Replacement = { original: string; source: string; onError: () => void };
const replacements = new WeakMap<HTMLImageElement, Replacement>();
const failedSource = new WeakMap<HTMLImageElement, string>();
let animationSources = new Map<string, string>();
let observer: MutationObserver | undefined;
let previewTimer: number | undefined;
let activePreview: HTMLImageElement | undefined;
let loadedAt = 0;
let mapTimer: number | undefined;
let mapLoading = false;
const excluded = ".message,.message-container,.ml-list,.chat-msg-area,.q-context-menu,.aio-right-click-menu,.menu-stickers-wrapper,.menu-stickers,.lite-tools-local-emoticons-main,.lite-tools-local-emoticons-v2,.commonly-emoticons-panel,.lite-tools-sticker-bar,.er-panel,[class^='er-'],[class*=' er-']";
const nativePanelSelector = ".sticker-panel";
const tabImages = '.sticker-panel .tabs[aria-label="表情分类列表"] .tabs-container-item-img img';

function findPanel(img: HTMLImageElement) {
  if (img.closest(excluded)) return null;
  const panel = img.closest(nativePanelSelector);
  if (!panel) return null;
  const rect = panel.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  panel.classList.add("lite-tools-native-sticker-panel");
  return panel;
}
function imageMd5(img: HTMLImageElement) {
  const sources = [img.getAttribute("src"), ...["data-src", "data-original", "data-gif", "data-gif-src", "data-animated-src", "data-dynamic-src", "data-path"].map((key) => img.getAttribute(key)), ...Object.values(img.dataset)];
  for (const source of sources) {
    const match = String(source || "").match(/[a-f0-9]{32}/i);
    if (match) return match[0].toUpperCase();
  }
  return "";
}
function processImage(img: HTMLImageElement) {
  const settings = nativeFavoriteConfig();
  if (!settings?.playAnimation && !settings?.enlargePreview) return;
  const panel = findPanel(img);
  if (!panel) {
    restoreImage(img);
    return;
  }
  if (nativeFavoriteConfig()?.enlargePreview) {
    if (img.matches(tabImages)) {
      img.classList.add("lite-tools-native-sticker-pack-preview");
      img.parentElement?.closest(".tabs-container-item-img")?.classList.add("lite-tools-native-sticker-pack-preview-box");
      img.closest(".tabs-container-item")?.classList.add("lite-tools-native-sticker-pack-preview-item");
    }
  }
  if (!nativeFavoriteConfig()?.playAnimation) return;
  const currentSrc = img.getAttribute("src") || "";
  const previous = replacements.get(img);
  if (previous && previous.source !== currentSrc) {
    img.removeEventListener("error", previous.onError);
    replacements.delete(img);
  }
  const src = animationSources.get(imageMd5(img));
  if (failedSource.get(img) === currentSrc || !src || currentSrc === src) return;
  failedSource.delete(img);
  const onError = () => {
    if (img.getAttribute("src") !== src) return;
    failedSource.set(img, currentSrc);
    restoreImage(img);
  };
  replacements.set(img, { original: currentSrc, source: src, onError });
  img.addEventListener("error", onError);
  img.setAttribute("src", src);
}
function nativeFavoriteConfig() {
  return configStore.value?.message?.nativeFavoriteStickers;
}
function restoreImage(img: HTMLImageElement) {
  const replacement = replacements.get(img);
  if (!replacement) return;
  img.removeEventListener("error", replacement.onError);
  replacements.delete(img);
  if (img.getAttribute("src") === replacement.source) img.setAttribute("src", replacement.original);
}
function restoreImages() {
  document.querySelectorAll<HTMLImageElement>("img").forEach(restoreImage);
}
async function loadAnimationMap() {
  if (!nativeFavoriteConfig()?.playAnimation || mapLoading) return;
  const remaining = 1500 - (Date.now() - loadedAt);
  if (remaining > 0) {
    if (mapTimer === undefined) {
      mapTimer = window.setTimeout(() => {
        mapTimer = undefined;
        void loadAnimationMap();
      }, remaining);
    }
    return;
  }
  window.clearTimeout(mapTimer);
  mapTimer = undefined;
  loadedAt = Date.now();
  mapLoading = true;
  try {
    const entries = await lite_tools.getNativeFavoriteStickerAnimationMap() as AnimationEntry[];
    animationSources = new Map(entries.map(({ md5, src }) => [md5.toUpperCase(), src]));
    document.querySelectorAll<HTMLImageElement>("img").forEach(processImage);
  } catch { /* do not interfere with the native sticker panel */ }
  finally { mapLoading = false; }
}
function initNativeStickerEnhancer() {
  void styleManager.inject("nativeStickerEnhancer");
  if (!document.body || observer) return;
  observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes" && record.target instanceof HTMLImageElement) {
        processImage(record.target);
        const md5 = imageMd5(record.target);
        if (md5 && !animationSources.has(md5) && findPanel(record.target)) void loadAnimationMap();
      }
      record.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        if (node instanceof HTMLImageElement) processImage(node);
        node.querySelectorAll("img").forEach((img) => processImage(img as HTMLImageElement));
        if (node.closest(nativePanelSelector) || node.querySelector(nativePanelSelector)) void loadAnimationMap();
      });
    }
    if (activePreview && (!activePreview.isConnected || !findPanel(activePreview))) hidePackPreview();
  });
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["src", "data-src", "data-original", "data-gif", "data-gif-src", "data-animated-src", "data-dynamic-src", "data-path"] });
  configStore.onChange((config) => {
    const settings = config.message.nativeFavoriteStickers;
    if (settings.playAnimation) { loadedAt = 0; void loadAnimationMap(); }
    else {
      window.clearTimeout(mapTimer);
      mapTimer = undefined;
      restoreImages();
    }
    if (!settings.enlargePreview) {
      hidePackPreview();
      document.querySelectorAll(".lite-tools-native-sticker-pack-preview,.lite-tools-native-sticker-pack-preview-box,.lite-tools-native-sticker-pack-preview-item").forEach((node) => node.classList.remove("lite-tools-native-sticker-pack-preview", "lite-tools-native-sticker-pack-preview-box", "lite-tools-native-sticker-pack-preview-item"));
    } else document.querySelectorAll<HTMLImageElement>(tabImages).forEach(processImage);
  });
  void configStore.ready.then(() => {
    if (nativeFavoriteConfig()?.playAnimation) void loadAnimationMap();
    document.querySelectorAll<HTMLImageElement>("img").forEach(processImage);
  });
  document.addEventListener("mouseover", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLImageElement) || !findPanel(target)) return;
    void loadAnimationMap();
    if (!target.matches(tabImages) || !nativeFavoriteConfig()?.enlargePreview) return;
    activePreview = target;
    window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(() => showPackPreview(target), 260);
  }, true);
  document.addEventListener("mouseout", (event) => {
    if (event.target === activePreview && !activePreview?.contains(event.relatedTarget as Node | null)) hidePackPreview();
  }, true);
  document.addEventListener("pointerdown", hidePackPreview, true);
}

function showPackPreview(img: HTMLImageElement) {
  if (img !== activePreview || !img.isConnected || !nativeFavoriteConfig()?.enlargePreview) return;
  const panel = findPanel(img);
  if (!panel) return;
  const nativeSource = replacements.get(img)?.original || img.getAttribute("src") || img.currentSrc;
  const animation = nativeFavoriteConfig()?.playAnimation && failedSource.get(img) !== nativeSource
    ? animationSources.get(imageMd5(img))
    : undefined;
  const source = animation || img.currentSrc || img.src;
  if (!source) return;
  let preview = document.querySelector<HTMLDivElement>(".lite-tools-native-sticker-preview");
  if (!preview) {
    preview = document.createElement("div");
    preview.className = "lite-tools-native-sticker-preview";
    const image = document.createElement("img");
    image.alt = "";
    preview.append(image);
    document.body.append(preview);
  }
  const previewImage = preview.querySelector("img")!;
  previewImage.onerror = () => {
    if (previewImage.getAttribute("src") !== source) return;
    previewImage.onerror = () => hidePackPreview();
    if (nativeSource && nativeSource !== source) previewImage.src = nativeSource;
    else hidePackPreview();
  };
  previewImage.src = source;
  preview.classList.add("show");
  const bounds = panel.getBoundingClientRect();
  const left = Math.max(8, Math.min(window.innerWidth - preview.offsetWidth - 8, bounds.left + bounds.width / 2 - preview.offsetWidth / 2));
  let top = bounds.top - preview.offsetHeight - 8;
  if (top < 8) top = bounds.top + 8;
  preview.style.left = `${left}px`;
  preview.style.top = `${Math.max(8, Math.min(window.innerHeight - preview.offsetHeight - 8, top))}px`;
}
function hidePackPreview() {
  window.clearTimeout(previewTimer);
  previewTimer = undefined;
  activePreview = undefined;
  document.querySelector(".lite-tools-native-sticker-preview")?.classList.remove("show");
}

export { initNativeStickerEnhancer };
