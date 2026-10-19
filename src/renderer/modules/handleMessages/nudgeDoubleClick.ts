import { createNudgeContext, isNudgeContextCurrent, sendNativeNudge } from "./nativeNudge";

import type { GetMessageRecord } from "./insertRepeatBtn";

let activeCleanup: (() => void) | undefined;

function setupNudgeDoubleClick(getMessageRecord: GetMessageRecord): () => void {
  activeCleanup?.();

  const handleDoubleClick = (event: MouseEvent) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    ) {
      return;
    }

    const context = createNudgeContext(event.target, getMessageRecord);
    if (!context || !isNudgeContextCurrent(context, getMessageRecord)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    void sendNativeNudge(context, getMessageRecord);
  };

  window.addEventListener("dblclick", handleDoubleClick, true);

  const cleanup = () => {
    window.removeEventListener("dblclick", handleDoubleClick, true);
    if (activeCleanup === cleanup) activeCleanup = undefined;
  };
  activeCleanup = cleanup;
  return cleanup;
}

export { setupNudgeDoubleClick };
