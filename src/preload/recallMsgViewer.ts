import { contextBridge, ipcRenderer } from "electron";
import type { RecallChatList } from "@/common/types/preventRecall";

const exposeFunctions = {
  getAllRecallChatList: (): Promise<RecallChatList> => ipcRenderer.invoke("lite_tools.getAllRecallChatList"),
  getRecallMessagesByUid: (uid: string): Promise<ArrayBuffer> =>
    ipcRenderer.invoke("lite_tools.getRecallMessagesByUid", uid),
  sendBroadcast: (channelName: any, payload: any) => ipcRenderer.send("lite_tools.broadcast", channelName, payload),
};

const preloadScope = globalThis as typeof globalThis & { __ltRecallPreloadBound?: boolean };
if (!preloadScope.__ltRecallPreloadBound) {
  preloadScope.__ltRecallPreloadBound = true;
  contextBridge.exposeInMainWorld("lt_showRecallList", exposeFunctions);
}

export type Lt_showRecallList = typeof exposeFunctions;
