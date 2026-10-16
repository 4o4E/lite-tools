import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { webContents, ipcMain } from "electron";
import { dispatchIpcEvent } from "@/main/utils/dispatchIpcEvent";
import { configManager } from "@/main/modules/configManager";

type ResolveFn<T> = (value: T | PromiseLike<T>) => void;

const fetchMarketEmoticon = new Map<string, ResolveFn<void>>();
const faceFilePaths = new Map<string, string>();
const awaitIsFileExist = new Map<
  string,
  {
    cb: () => void;
    dynamicFacePath: string;
  }
>();

function convertMarketFaceToPic(msgList: any[], webContentId: number) {
  for (const msgItem of msgList) {
    for (const msgElement of msgItem.elements) {
      if (msgElement?.marketFaceElement) {
        downloadMarketFace(msgElement.marketFaceElement, webContentId);
        msgElement.picElement = replaceMarketFace(msgElement.marketFaceElement);
        msgElement.marketFaceElement = null;
        msgElement.elementType = 2;
        msgItem.msgType = 2;
        msgItem.subMsgType = 4096;
      }
    }
  }
}

function replaceMarketFace(marketFaceElement: any): object {
  const fileName = marketFaceElement.staticFacePath.split("\\").pop();
  const picWidth = marketFaceElement.imageHeight ?? 200;
  const picHeight = marketFaceElement.imageHeight ?? 200;
  const staticFacePath = marketFaceElement.staticFacePath;
  const thumbPath = new Map([
    ["0", staticFacePath],
    ["198", staticFacePath],
    ["720", staticFacePath],
  ]);

  return {
    picSubType: 1,
    fileName,
    fileSize: "142857",
    picWidth,
    picHeight,
    original: true,
    md5HexStr: "",
    sourcePath: staticFacePath,
    thumbPath,
    transferStatus: 2,
    progress: 0,
    picType: 2000,
    invalidState: 0,
    fileUuid: "",
    fileSubId: "",
    thumbFileSize: 0,
    fileBizId: null,
    downloadIndex: null,
    summary: "",
    emojiFrom: null,
    emojiWebUrl: null,
    emojiAd: {
      url: "",
      desc: "",
    },
    emojiMall: {
      packageId: 0,
      emojiId: 0,
    },
    emojiZplan: {
      actionId: 0,
      actionName: "",
      actionType: 0,
      playerNumber: 0,
      peerUid: "0",
      bytesReserveInfo: "",
    },
    originImageMd5: "",
    originImageUrl: "",
    import_rich_media_context: null,
    isFlashPic: null,
    storeID: 1,
  };
}

function downloadMarketFace(marketFaceElement: any, webContentId: number) {
  const { staticFacePath, dynamicFacePath } = marketFaceElement;

  if (existsSync(staticFacePath)) {
    if (existsSync(dynamicFacePath)) {
      decodeQqMarketface(marketFaceElement.dynamicFacePath, staticFacePath);
    }
    // 如果是本地表情发起的下载请求，则需要消费promise
    const resolve = fetchMarketEmoticon.get(staticFacePath);
    if (resolve) {
      resolve();
      fetchMarketEmoticon.delete(staticFacePath);
    }
    return;
  }

  // Register before dispatching so an immediate completion event can be matched.
  faceFilePaths.set(staticFacePath, marketFaceElement.dynamicFacePath);

  dispatchIpcEvent(
    webContentId,
    {
      type: "request",
      eventName: "ntApi",
    },
    {
      cmdName: "nodeIKernelMsgService/fetchMarketEmoticonAioImage",
      cmdType: "invoke",
      payload: [
        {
          marketEmoticonAioImageReq: {
            eId: marketFaceElement.emojiId,
            epId: marketFaceElement.emojiPackageId,
            name: marketFaceElement.faceName,
            width: marketFaceElement.imageHeight,
            height: marketFaceElement.imageHeight,
            jobType: 0,
            encryptKey: marketFaceElement.key,
            filePath: staticFacePath,
            downloadType: 4,
          },
        },
        undefined,
      ],
    },
    true,
  );
}

IpcInterceptor.interceptIpcSendEvents(
  "nodeIKernelMsgListener/onEmojiDownloadComplete",
  (_channel: string, _event: any, args: any) => {
    if (!configManager.value.message.marketFaceToPicElement && fetchMarketEmoticon.size === 0) {
      return;
    }

    const staticFacePath = args?.payload?.notifyInfo?.path;
    if (!staticFacePath) return;

    const item = awaitIsFileExist.get(staticFacePath);
    const dynamicFacePath = item?.dynamicFacePath ?? faceFilePaths.get(staticFacePath);

    // Ignore download events that were not registered by this module.
    if (!dynamicFacePath) return;

    try {
      if (existsSync(staticFacePath) && existsSync(dynamicFacePath)) {
        decodeQqMarketface(dynamicFacePath, staticFacePath);
      }
    } catch (error) {
      // The downloaded static file remains usable as a fallback.
      console.error("MarketFace decode failed", error);
    } finally {
      // Resume the renderer only after the decode attempt has completed.
      item?.cb();
      awaitIsFileExist.delete(staticFacePath);
      faceFilePaths.delete(staticFacePath);

      // 如果是本地表情发起的下载请求，则需要消费promise
      const resolve = fetchMarketEmoticon.get(staticFacePath);
      if (resolve) {
        resolve();
        fetchMarketEmoticon.delete(staticFacePath);
      }
    }
  },
);

IpcInterceptor.interceptIpcReceiveEvents("isFileExist", (_event: any, _sender: any, channel: string, args: any) => {
  if (configManager.value.message.marketFaceToPicElement) {
    const webContentId = parseInt(channel.split("RM_IPCFROM_RENDERER")[1]) || 2;
    const callbackId = args?.[0]?.callbackId;
    const filePath = args?.[1]?.payload?.[0];

    if (filePath && faceFilePaths.has(filePath)) {
      awaitIsFileExist.set(filePath, {
        cb: () => sendFileIsExist(webContentId, callbackId),
        dynamicFacePath: faceFilePaths.get(filePath)!,
      });
      faceFilePaths.delete(filePath);
      return { action: "block" };
    }
  }
});

function sendFileIsExist(webContentId: number, callbackId: string) {
  const webContent = webContents.fromId(webContentId);

  if (webContent && callbackId) {
    webContent.send(
      `RM_IPCFROM_MAIN${webContentId}`,
      {
        callbackId,
        promiseStatue: "full",
        type: "response",
        eventName: "FileApi",
        peerId: webContentId,
      },
      true,
    );
  }
}

function decodeQqMarketface(inputPath: string, outputPath: string): void {
  const data = readFileSync(inputPath);

  // Avoid applying the reversible XOR transform more than once.
  if (isGif(data)) {
    return;
  }

  for (let blockStart = 0; blockStart < data.length; blockStart += 50) {
    const end = Math.min(blockStart + 20, data.length);

    for (let index = blockStart; index < end; index++) {
      data[index] ^= 0xff;
    }
  }

  // Keep the existing static file when the decoded input is invalid.
  if (!isGif(data)) {
    return;
  }

  writeFileSync(outputPath, data);
}

function isGif(data: Buffer): boolean {
  const header = data.subarray(0, 6).toString("ascii");
  return header === "GIF87a" || header === "GIF89a";
}

// 附加功能，下载本地贴纸试图保存商城表情时如果没有下载原始数据时的处理逻辑
ipcMain.handle("lite_tools.fetchMarketEmoticon", async (event, marketFaceElement) => {
  const { promise, resolve } = Promise.withResolvers();
  const { staticFacePath } = marketFaceElement;
  fetchMarketEmoticon.set(staticFacePath, resolve);
  try {
    downloadMarketFace(marketFaceElement, event.sender.id);
    await promise;
    return true;
  } finally {
    fetchMarketEmoticon.delete(staticFacePath);
  }
});

export { convertMarketFaceToPic };
