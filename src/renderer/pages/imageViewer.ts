import { waitForInstance } from "@/renderer/utils/domWaitFor";
import { configStore } from "@/renderer/modules/configStore";
import { setupImageViewerZoom } from "@/renderer/modules/imageViewerZoom";

let initialized = false;

/**
 * 媒体预览增强
 */
async function setupImageViewer() {
  if (initialized) return;
  initialized = true;
  await configStore.ready;
  setupImageViewerZoom();
  // 判断图片是否超过窗口大小
  const { instance: imageInstance } = await waitForInstance(
    ".main-area.main-area--image.vue-component",
    "proxy.isImageAllInViewport"
  );
  let newX = 0;
  let newY = 0;
  let width = 0;
  let height = 0;
  let lastCall = 0;
  const throttle = 0;
  let offset = 3;
  // 仅在有匹配的 pointerdown 后才处理 pointerup，避免窗口刚打开时收到无来源的抬起事件。
  let pointerActive = false;
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (!configStore.value.interface.imageViewerOptimization) return;
      if (event.buttons === 1) {
        pointerActive = true;
        offset = 0;
        newX = window.screenX;
        newY = window.screenY;
        width = window.outerWidth;
        height = window.outerHeight;
      } else {
        pointerActive = false;
        offset = 3;
      }
    },
    true
  );
  document.addEventListener(
    "pointermove",
    (event) => {
      if (!configStore.value.interface.imageViewerOptimization) return;
      if (event.buttons === 1) {
        offset += Math.abs(event.movementX) + Math.abs(event.movementY);
        if (imageInstance.proxy.isImageAllInViewport && !document.querySelector("embed")) {
          const now = new Date().getTime();
          if (now - lastCall > throttle) {
            lastCall = now;
            newX += event.movementX;
            newY += event.movementY;
            window.moveTo(newX, newY);
            if (window.devicePixelRatio !== 1) {
              window.resizeTo(width, height);
            }
          } else {
            newX += event.movementX;
            newY += event.movementY;
          }
          event.preventDefault();
          event.stopPropagation();
        }
      }
    },
    true
  );
  document.addEventListener(
    "pointerup",
    (event) => {
      if (!configStore.value.interface.imageViewerOptimization) return;
      if (event.button !== 0 || !pointerActive) return;
      pointerActive = false;
      const rightMenu = document.querySelector(".q-context-menu");
      const video = document.querySelector("embed");
      if (offset < 2 && !rightMenu && !video) {
        const target = event.target;
        if (!(target instanceof Element) || !target.closest(".main-area__content")) return;
        // 图片本体保留原生交互（双击缩放、拖动）；只有背景、缩略图或滚动条区域才关闭窗口。
        if (target.closest(".main-area__image-wrap")) return;
        document.querySelector<HTMLDivElement>(`div[aria-label="关闭"]`)?.click();
      } else if (offset > 2) {
        window.moveTo(newX, newY);
        if (window.devicePixelRatio !== 1) {
          window.resizeTo(width, height);
        }
      }
    },
    true
  );
  // QQ 自己的 Esc 关闭会先隐藏再销毁查看器窗口；标题栏“关闭”只隐藏窗口，下一次打开可复用。
  // QQ 的 Esc 监听早于渲染进程脚本，因此实际拦截放在 preload（见 setupImageViewerEscape），
  // 这里只同步功能开关状态。
  const updateEscapeFlag = () => {
    document.documentElement.dataset.ltImageViewerEsc = configStore.value.interface.imageViewerOptimization ? "1" : "0";
  };
  updateEscapeFlag();
  configStore.onChange(updateEscapeFlag);
}

export { setupImageViewer };
