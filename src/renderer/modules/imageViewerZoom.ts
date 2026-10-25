import { configStore } from "@/renderer/modules/configStore";
import { onComponentMount, onComponentUnmount } from "@/renderer/modules/vueComponentTracker";
import { waitForInstance } from "@/renderer/utils/domWaitFor";

type ImageViewer = {
  isShowImage: boolean;
  isShowTile: boolean;
  imageOriginSize: { width: number; height: number };
  curScale: number;
  requestResizeFrameId: number;
  resizeImage: (...args: boolean[]) => void;
  showCurScale: () => void;
  updateImageContainerSize: (force: boolean) => void;
  applyImageStyle: () => void;
};

type ImageComponent = { proxy?: ImageViewer; isUnmounted?: boolean };

/** QQ 9.9.36 的 resize 回调会在 RAF 中调用 resizeImage(false, false)，重新适配图片。 */
function bindImageZoom(viewer: ImageViewer) {
  let restore: (() => void) | undefined;
  const update = (fitCurrentImage: boolean) => {
    if (!configStore.value.interface.imageViewerZoom) {
      restore?.();
      restore = undefined;
      return;
    }
    if (restore) return;

    const resizeImage = viewer.resizeImage;
    const showCurScale = viewer.showCurScale;
    const resizeKeepingScale = function (this: ImageViewer, ...args: boolean[]) {
      if (viewer.requestResizeFrameId && args[0] === false && args[1] === false) {
        // handleResize 仍更新容器尺寸及滚动条；只跳过重新计算图片基准尺寸和 tile goHome。
        // 保留 imageViewSize 与 curScale，避免仅保存 curScale 仍造成实际显示尺寸变化。
        viewer.applyImageStyle();
        return;
      }
      return resizeImage.apply(this, args);
    };
    const hideScalePreview = () => {};
    viewer.resizeImage = resizeKeepingScale;
    viewer.showCurScale = hideScalePreview;

    restore = () => {
      if (viewer.resizeImage === resizeKeepingScale) viewer.resizeImage = resizeImage;
      if (viewer.showCurScale === hideScalePreview) viewer.showCurScale = showCurScale;
    };
    // 打开和切换图片由 QQ 在加载流程中适配；显示后再测量会强制布局并重复绘制。
    // 只有用户手动开启功能时，才将已经显示的图片恢复为当前窗口的适配尺寸。
    if (fitCurrentImage && (viewer.isShowImage || viewer.isShowTile) &&
        viewer.imageOriginSize.width > 0 && viewer.imageOriginSize.height > 0) {
      viewer.curScale = 1;
      viewer.updateImageContainerSize(true);
      resizeImage.call(viewer, false, false);
    }
  };
  update(false);
  const unsubscribe = configStore.onChange(() => update(true));
  return () => {
    unsubscribe();
    restore?.();
  };
}

let initialized = false;

async function setupImageViewerZoom() {
  if (initialized) return;
  initialized = true;
  await configStore.ready;
  const bindings = new Map<ImageComponent, () => void>();
  const mount = (component: ImageComponent) => {
    const viewer = component?.proxy;
    if (component.isUnmounted || bindings.has(component) || !viewer) return;
    if (typeof viewer.resizeImage !== "function" || typeof viewer.showCurScale !== "function" ||
        typeof viewer.updateImageContainerSize !== "function" || typeof viewer.applyImageStyle !== "function" ||
        !viewer.imageOriginSize ||
        typeof viewer.requestResizeFrameId !== "number") return;
    bindings.set(component, bindImageZoom(viewer));
  };
  const unmount = (component: ImageComponent) => {
    bindings.get(component)?.();
    bindings.delete(component);
  };
  const offMount = onComponentMount(mount);
  const offUnmount = onComponentUnmount(unmount);
  let disposed = false;
  window.addEventListener("pagehide", () => {
    disposed = true;
    offMount();
    offUnmount();
    for (const dispose of bindings.values()) dispose();
    bindings.clear();
  }, { once: true });

  // 插件可能晚于图片组件挂载；后续图片/视频组件重建则由生命周期回调接管。
  const { instance } = await waitForInstance(
    ".main-area.main-area--image.vue-component", "proxy.isImageAllInViewport",
  );
  if (!disposed) mount(instance);
}

export { setupImageViewerZoom };
