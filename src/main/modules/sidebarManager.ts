import { configManager } from "@/main/modules/configManager";
import { createLogger } from "@/main/utils/createLogger";

type IpcSidebarStatus = {
  barId: number;
  status: number;
  weight: number;
};

// 侧边栏开启状态枚举
enum SidebarStatus {
  ENABLED = 1,
  DISABLED = 2,
}

// 侧边栏分组 ID 常量
const SIDEBAR_GROUP_ID = "100073";

function setupSideBar() {
  const log = createLogger("sideBar");
  log("load");
  let isPendingInit = false;
  IpcInterceptor.onIpcReceiveEvents("nodeIKernelConfigMgrService/saveSideBarConfig", (meat, _, channel, payload) => {
    const sideBarConfig = payload[1]?.payload?.[0]?.config as IpcSidebarStatus[];
    const currentConfig = configManager.value;
    const top = currentConfig.sideBar.top.map((item) => {
      const status = sideBarConfig?.find(({ barId }) => barId === item.id)?.status;
      return status === undefined ? item : { ...item, enabled: status === SidebarStatus.ENABLED };
    });
    const config = { ...currentConfig, sideBar: { ...currentConfig.sideBar, top } };
    configManager.updateConfig(config, "automatic");
  });

  IpcInterceptor.interceptIpcSendEvents("nodeIKernelConfigMgrListener/onSideBarChanged", (channel, meta, payload) => {
    if (isPendingInit) {
      isPendingInit = false;
      log("初始化侧边栏", payload.payload.config);
      const sideBarConfig = payload.payload.config as IpcSidebarStatus[];
      const currentConfig = configManager.value;
      const top = currentConfig.sideBar.top.map((item) => {
        const status = sideBarConfig.find(({ barId }) => barId === item.id)?.status;
        return status === undefined ? item : { ...item, enabled: status === SidebarStatus.ENABLED };
      });
      configManager.updateConfig(
        { ...currentConfig, sideBar: { ...currentConfig.sideBar, top } },
        "automatic",
      );
    } else {
      log("更新侧边栏", payload.payload.config);
      const sideBarConfig = payload.payload.config as IpcSidebarStatus[];
      const config = configManager.value;
      for (const item of sideBarConfig) {
        const localMatchedItem = config.sideBar.top.find((i) => i.id === item.barId);
        if (localMatchedItem !== undefined) {
          item.status = localMatchedItem.enabled ? SidebarStatus.ENABLED : SidebarStatus.DISABLED;
        }
      }
    }
  });

  const unSubscribe = IpcInterceptor.interceptIpcSend((channel, meta, payload) => {
    if (payload?.configData?.group === SIDEBAR_GROUP_ID) {
      try {
        unSubscribe();
        const remoteSidebarPayload = JSON.parse(payload.configData.content);
        const currentConfig = configManager.value;
        if (remoteSidebarPayload.length !== currentConfig.sideBar.top.length - 3) {
          log("侧边栏数量不匹配，执行初始化", remoteSidebarPayload.length, currentConfig.sideBar.top.length);
          isPendingInit = true;
        }
        for (const item of remoteSidebarPayload) {
          item.isFixed = false;
        }
        const customSidebarItems = remoteSidebarPayload.map((item: any) => {
          return {
            id: item.id,
            name: item.label,
            enabled: currentConfig.sideBar.top.find((i) => i.id === item.id)?.enabled ?? false,
          };
        });
        const top = [
          {
            id: -1,
            name: "消息",
            enabled: currentConfig.sideBar.top[0].enabled,
          },
          {
            id: -1,
            name: "联系人",
            enabled: currentConfig.sideBar.top[1].enabled,
          },
          ...customSidebarItems,
          {
            id: -1,
            name: "更多",
            enabled: currentConfig.sideBar.top[currentConfig.sideBar.top.length - 1].enabled,
          },
        ];
        configManager.updateConfig(
          { ...currentConfig, sideBar: { ...currentConfig.sideBar, top } },
          "automatic",
        );
        payload.configData.content = JSON.stringify(remoteSidebarPayload);
        log("更新侧边栏项目列表", remoteSidebarPayload);
      } catch (err) {
        log("更新侧边栏项目列表出错", err);
      }
    }
  });
}

export { setupSideBar };
