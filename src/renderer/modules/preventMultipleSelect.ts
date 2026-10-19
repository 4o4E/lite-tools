import { configStore } from "@/renderer/modules/configStore";

let listenTarget = false;
let interception = false;

// 只拦截单独按住左键的拖动；中键、侧键及侧键组合交给 QQ。
const leftMouseButton = 1;

function setupPreventMutipleSelect(className: string) {
  const app = document.querySelector<HTMLElement>("#app")!;
  app.addEventListener("pointerdown", (event) => {
    if (configStore.value.interface.preventSelect && event.buttons === leftMouseButton) {
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
    if (configStore.value.interface.preventSelect) {
      if (event.buttons === 0) {
        interception = false;
      }
    }
  });

  app.addEventListener("mousemove", (event) => {
    if (!listenTarget && document.querySelector(`.${className}`)) {
      (document.querySelector(`.${className}`) as HTMLElement).addEventListener("pointerdown", (event) => {
        if (configStore.value.interface.preventSelect && event.buttons === leftMouseButton) {
          document.querySelector(".q-context-menu")?.remove();
        }
      });
      listenTarget = true;
    }
    if (configStore.value.interface.preventSelect && event.buttons === leftMouseButton) {
      if (interception) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
  });
}

export { setupPreventMutipleSelect };
