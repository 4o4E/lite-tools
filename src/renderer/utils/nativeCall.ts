async function convertMessage(message: any) {
  switch (message.type) {
    case "text":
      return {
        elementType: 1,
        elementId: "",
        textElement: {
          content: message.content,
          atType: 0,
          atUid: "",
          atTinyId: "",
          atNtUid: "",
        },
      };
    case "image": {
      const path = message.path;
      await lite_tools.nativeCall(
        {
          type: "request",
          eventName: "FileApi",
        },
        {
          cmdName: "getFileType",
          cmdType: "invoke",
          payload: [path],
        },
        true,
      );
      const copyFile = (await lite_tools.nativeCall(
        {
          type: "request",
          eventName: "ntApi",
        },
        {
          cmdName: "nodeIKernelMsgService/copyFileWithDelExifInfo",
          cmdType: "invoke",
          payload: [
            {
              sourcePath: path,
              elementSubType: message.picSubType,
            },
            null,
          ],
        },
        true,
      )) as any;
      const fileType = (await lite_tools.nativeCall(
        {
          type: "request",
          eventName: "FileApi",
        },
        {
          cmdName: "getFileType",
          cmdType: "invoke",
          payload: [copyFile.newPath],
        },
        true,
      )) as any;
      const imageSize = (await lite_tools.nativeCall(
        {
          type: "request",
          eventName: "FileApi",
        },
        {
          cmdName: "getImageSizeFromPath",
          cmdType: "invoke",
          payload: [path],
        },
        true,
      )) as any;
      const fileSize = (await lite_tools.nativeCall(
        {
          type: "request",
          eventName: "FileApi",
        },
        {
          cmdName: "getFileSize",
          cmdType: "invoke",
          payload: [path],
        },
        true,
      )) as number;

      const fileName = copyFile.newPath.replace(/\\/g, "/").split("/").pop()!;

      const picElement = {
        md5HexStr: copyFile.md5,
        picWidth: imageSize.width,
        picHeight: imageSize.height,
        fileName,
        fileSize: `${fileSize}`,
        original: true,
        picSubType: message.picSubType,
        sourcePath: copyFile.newPath,
        thumbPath: null,
        picType: fileType.ext === "gif" ? 2000 : 1000,
        fileUuid: "",
        fileSubId: "",
        thumbFileSize: 0,
        summary: message.summary || "",
      };
      const messageChannel = {
        elementType: 2,
        elementId: "",
        picElement,
        extBufForUI: new Uint8Array(),
      };
      return messageChannel;
    }
    default:
      return null;
  }
}

async function sendMessage(peer: Peer, messages: any[]) {
  const msgElements = await Promise.all(messages.map((message) => convertMessage(message)));
  lite_tools.nativeCall(
    {
      eventName: "ntApi",
      type: "request",
    },
    {
      cmdName: "nodeIKernelMsgService/sendMsg",
      cmdType: "invoke",
      payload: [
        {
          msgId: "0",
          peer,
          msgElements,
          msgAttributeInfos: new Map(),
        },
        null,
      ],
    },
  );
}

// QQ records can be Vue proxies; structuredClone cannot clone them directly.
// Preserve IPC data types while detaching the outgoing elements from the received record.
function cloneMessageValue<T>(value: T, seen?: WeakMap<object, unknown>): T;
function cloneMessageValue(value: unknown, seen = new WeakMap<object, unknown>()): unknown {
  if (value === null || typeof value !== "object") return value;
  const cached = seen.get(value);
  if (cached !== undefined) return cached;
  if (value instanceof Uint8Array) {
    const clone = new Uint8Array(value);
    seen.set(value, clone);
    return clone;
  }
  if (value instanceof ArrayBuffer) {
    const clone = value.slice(0);
    seen.set(value, clone);
    return clone;
  }
  if (Array.isArray(value)) {
    const clone: unknown[] = [];
    seen.set(value, clone);
    for (const item of value) clone.push(cloneMessageValue(item, seen));
    return clone;
  }
  if (value instanceof Map) {
    const clone = new Map<unknown, unknown>();
    seen.set(value, clone);
    for (const [key, item] of value) {
      clone.set(cloneMessageValue(key, seen), cloneMessageValue(item, seen));
    }
    return clone;
  }
  const clone: Record<string, unknown> = Object.create(null);
  seen.set(value, clone);
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "function") clone[key] = cloneMessageValue(item, seen);
  }
  return clone;
}

interface RepeatEditorComponent {
  parent?: RepeatEditorComponent;
  proxy?: {
    messageSendService?: {
      curAioData: { chatType: number; header?: { uid?: string } };
      msgService: {
        getMsgAttributeInfos(context: Pick<Peer, "chatType">): Promise<Map<number, unknown>>;
      };
    };
  };
}

async function repeatMessageContent(
  peer: Peer,
  msgRecord: Pick<Message, "msgId" | "elements">,
  isCurrent: () => boolean,
) {
  const editor = document.querySelector(".qq-msg-editor") as
    | (Element & {
        __vueParentComponent?: RepeatEditorComponent;
        __VUE__?: RepeatEditorComponent[];
      })
    | null;
  let component = editor?.__vueParentComponent ?? editor?.__VUE__?.[0];
  while (component && !component.proxy?.messageSendService?.msgService?.getMsgAttributeInfos) {
    component = component.parent;
  }
  const service = component?.proxy?.messageSendService;
  if (
    typeof service?.msgService?.getMsgAttributeInfos !== "function" ||
    service.curAioData?.chatType !== peer.chatType ||
    service.curAioData?.header?.uid !== peer.peerUid
  ) {
    throw new Error("无法获取当前会话的 QQ 原生发送属性，已取消复读");
  }
  // Use the current account's native decoration, never the received sender's msgAttrs.
  const attributes = await service.msgService.getMsgAttributeInfos({ chatType: peer.chatType });
  if (!isCurrent()) return;
  if (!(attributes instanceof Map)) {
    throw new Error("QQ 原生发送属性格式异常，已取消复读");
  }
  const seen = new WeakMap<object, unknown>();
  const msgAttributeInfos = cloneMessageValue(attributes, seen);
  const needsOriginalElements = msgRecord.elements.some(
    (element) =>
      element.replyElement ||
      (element.textElement &&
        (Number(element.textElement.atType) > 0 ||
          element.textElement.atUid ||
          element.textElement.atTinyId ||
          element.textElement.atNtUid)),
  );
  if (!needsOriginalElements) {
    forwardMessage(peer, peer, [msgRecord.msgId], msgAttributeInfos);
    return;
  }

  const msgElements: MsgElement[] = [];
  for (const element of msgRecord.elements) {
    if (element.grayTipElement || element.elementType === 8) continue;
    const clone = cloneMessageValue(element, seen);
    // Clear only the received element's own ID, never the nested reply reference IDs.
    clone.elementId = "";
    msgElements.push(clone);
  }
  if (!msgElements.length) return;
  lite_tools.nativeCall(
    { eventName: "ntApi", type: "request" },
    {
      cmdName: "nodeIKernelMsgService/sendMsg",
      cmdType: "invoke",
      payload: [
        { msgId: "0", peer, msgElements, msgAttributeInfos },
        null,
      ],
    },
  );
}

function forwardMessage(srcpeer: Peer, dstpeer: Peer, msgIds: string[], msgAttributeInfos: Map<number, unknown>) {
  lite_tools.nativeCall(
    {
      type: "request",
      eventName: "ntApi",
    },
    {
      cmdName: "nodeIKernelMsgService/forwardMsgWithComment",
      cmdType: "invoke",
      payload: [
        {
          commentElements: [],
          dstContacts: [dstpeer],
          msgAttributeInfos,
          msgIds,
          srcContact: srcpeer,
        },
        null,
      ],
    },
  );
}

function getUserInfo(uid: string) {
  return lite_tools.nativeCall(
    {
      type: "request",
      eventName: "ntApi",
    },
    {
      cmdName: "nodeIKernelProfileService/fetchUserDetailInfo",
      cmdType: "invoke",
      payload: [
        {
          callFrom: "BuddyProfileStore",
          uid,
          bizList: [0],
          source: 0,
        },
        null,
      ],
    },
    ["nodeIKernelProfileListener/onProfileDetailInfoChanged", "nodeIKernelProfileListener/onProfileSimpleChanged"],
  );
}

function getMembersAvatar(uids: string[]) {
  return lite_tools.nativeCall(
    {
      type: "request",
      eventName: "ntApi",
    },
    {
      cmdName: "nodeIKernelAvatarService/getMembersAvatarPath",
      cmdType: "invoke",
      payload: [
        {
          uids,
          clarity: 1,
        },
      ],
    },
    true,
  );
}

function getGroupsAvatar(groupCodes: string[]) {
  return lite_tools.nativeCall(
    {
      type: "request",
      eventName: "ntApi",
    },
    {
      cmdName: "nodeIKernelAvatarService/getConfGroupsAvatarPath",
      cmdType: "invoke",
      payload: [
        {
          groupCodes,
          clarity: 1,
        },
      ],
    },
    true,
  );
}

function goMainWindowScene(sceneData: any) {
  return lite_tools.nativeCall(
    {
      type: "request",
      eventName: "WindowApi",
    },
    {
      cmdName: "nodeIKernelAvatarService/getConfGroupsAvatarPath",
      cmdType: "invoke",
      payload: [
        {
          scene: sceneData.scene,
          sceneParams: {
            peerUid: sceneData.peerUid,
            chatType: sceneData.chatType,
            type: sceneData.type,
            params: {
              msgId: sceneData.msgId,
            },
          },
        },
      ],
    },
  );
}

function getGroupInfo(groupCode: string) {
  return lite_tools.nativeCall(
    {
      type: "request",
      eventName: "ntApi",
    },
    {
      cmdName: "nodeIKernelGroupService/getGroupDetailInfo",
      cmdType: "invoke",
      payload: [
        {
          groupCode,
          source: 4,
        },
        null,
      ],
    },
  );
}

function activeChatAndReturnPreview(peer: Peer) {
  return lite_tools.nativeCall(
    {
      type: "request",
      eventName: "ntApi",
    },
    {
      cmdName: "nodeIKernelMsgService/getAioFirstViewLatestMsgsAndAddActiveChat",
      cmdType: "invoke",
      payload: [
        {
          peer,
          cnt: 10,
        },
        null,
      ],
    },
  );
}

function getLoginList() {
  return lite_tools.nativeCall(
    {
      type: "request",
      eventName: "ntApi",
    },
    {
      cmdName: "nodeIKernelLoginService/getLoginList",
      cmdType: "invoke",
      payload: [null, null],
    },
  );
}

function getAuthData() {
  return lite_tools.nativeCall(
    {
      type: "request",
      eventName: "GlobalDataApi",
    },
    {
      cmdName: "fetchAuthData",
      cmdType: "invoke",
      payload: [],
    },
  );
}

function resetLoginInfo(uin: string) {
  return lite_tools.nativeCall(
    {
      type: "request",
      eventName: "ntApi",
    },
    {
      cmdName: "nodeIKernelLoginService/deleteLoginInfo",
      cmdType: "invoke",
      payload: [
        {
          uin,
        },
        null,
      ],
    },
  );
}

function openFolder(path: string) {
  return lite_tools.nativeCall(
    {
      type: "request",
      eventName: "FileApi",
    },
    {
      cmdName: "openFolder",
      cmdType: "invoke",
      payload: [path],
    },
  );
}

export {
  sendMessage,
  repeatMessageContent,
  goMainWindowScene,
  getUserInfo,
  getMembersAvatar,
  getGroupsAvatar,
  getGroupInfo,
  getAuthData,
  activeChatAndReturnPreview,
  getLoginList,
  resetLoginInfo,
  openFolder,
};
