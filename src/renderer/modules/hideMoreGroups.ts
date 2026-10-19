import { configStore } from "@/renderer/modules/configStore";
import { createLogger } from "@/renderer/utils/createLogger";

const log = createLogger("hideMoreGroups");
const hiddenClass = "lt-hide-more-groups";
let started = false;
let scheduled = false;

function apply() {
  const enabled = configStore.value.interface.hiddenMoreGroups;
  document.querySelectorAll<HTMLElement>(".sys-notify").forEach((root) => {
    root.classList.toggle(hiddenClass, enabled);
  });
  document.querySelectorAll<HTMLElement>(".sys-notify__scroll-body").forEach((body) => {
    body.classList.toggle(hiddenClass, enabled);
  });
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    apply();
  });
}

async function setupHideMoreGroups() {
  if (started) return;
  started = true;
  await configStore.ready;
  apply();
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  configStore.onChange(schedule);
  log("initialized");
}

export { setupHideMoreGroups };
