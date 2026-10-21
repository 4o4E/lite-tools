import { waitForInstance } from "@/renderer/utils/domWaitFor";
import { configStore } from "@/renderer/modules/configStore";
import { setupImageViewerZoom } from "@/renderer/modules/imageViewerZoom";

/**
 * 媒体预览增强
 */
async function setupImageViewer() {
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
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (!configStore.value.interface.imageViewerOptimization) return;
      if (event.buttons === 1) {
        offset = 0;
        newX = window.screenX;
        newY = window.screenY;
        width = window.outerWidth;
        height = window.outerHeight;
      } else {
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
      const rightMenu = document.querySelector(".q-context-menu");
      const video = document.querySelector("embed");
      if (event.button !== 0) {
        return;
      }
      if (offset < 2 && !rightMenu && !video) {
        const target = event.target as HTMLElement;
        if (target.closest(".main-area__content")) {
          document.querySelector<HTMLDivElement>(`div[aria-label="关闭"]`)!.click();
        }
      } else if (offset > 2) {
        window.moveTo(newX, newY);
        if (window.devicePixelRatio !== 1) {
          window.resizeTo(width, height);
        }
      }
    },
    true
  );
}

export { setupImageViewer };
