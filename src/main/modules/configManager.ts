import fs from "node:fs";
import path from "node:path";
import { dialog, ipcMain } from "electron";
import { CONFIG_DIR, DATA_DIR } from "@/main/utils/pluginPaths";
import { migrateUserConfig } from "@/main/modules/migrateUserConfig";
import { readOptionalConfigFile, writeConfigFile } from "@/main/utils/configFile";
import type { ConfigWriteSource } from "@/main/utils/configFile";
import { globalBroadcast } from "@/main/utils/globalBroadcast";
import configTemplate from "@/config/main.template.json";

type ConfigListener = (config: Config) => void;

class ConfigManager {
  private isInitialized = false;
  private config = {} as Config;
  private currentConfigPath = "";
  private userUid = "";
  private updateListeners: Set<ConfigListener> = new Set();
  private readyPromise: Promise<void>;
  private resolveReady: () => void;
  private _lastUpdatedConfigs: ConfigPath[] = [];

  constructor() {
    const { promise, resolve } = Promise.withResolvers<void>();
    this.readyPromise = promise;
    this.resolveReady = resolve;
    this.setupPath();
    this.setupIpcEvent();
  }

  private setupIpcEvent() {
    ipcMain.on("lite_tools.isInitialized", (event) => {
      event.returnValue = this.isInitialized;
    });
    ipcMain.handle("lite_tools.getConfig", () => {
      return this.config;
    });
    ipcMain.on("lite_tools.updateConfig", (_, data, source) => {
      try {
        this.updateConfig(data, source === "user" ? "user" : "automatic");
      } catch (error) {
        this.reportFileError("配置保存失败", error);
      }
    });
  }

  private setupPath() {
    try {
      fs.mkdirSync(path.join(CONFIG_DIR, "configs"), { recursive: true });
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
    } catch (err) {
      dialog.showMessageBox({
        type: "info",
        title: "[轻量工具箱] 路径错误",
        message: "无法访问配置文件路径，请检查路径是否存在，或读写权限是否正确",
        buttons: ["确定"],
      });
      throw err;
    }
  }

  private safeMergeConfig<T>(userConfig: Partial<T>, baseConfig: T): T {
    if (!userConfig || typeof userConfig !== "object") return structuredClone(baseConfig);
    const result: Partial<T> = {};
    for (const key in baseConfig) {
      const k = key as keyof T;
      const baseValue = baseConfig[k];
      const userValue = userConfig[k];
      if (baseValue && typeof baseValue === "object" && baseValue !== null && !Array.isArray(baseValue)) {
        if (!userValue || typeof userValue !== "object") {
          result[k] = structuredClone(baseValue);
        } else {
          result[k] = this.safeMergeConfig(userValue, baseValue);
        }
      } else {
        const matches = Array.isArray(baseValue) ? Array.isArray(userValue) : typeof userValue === typeof baseValue;
        result[k] = matches ? userValue : structuredClone(baseValue);
      }
    }
    return result as T;
  }

  private loadConfig(configPath: string): BaseConfig {
    const content = readOptionalConfigFile(configPath);
    if (content === undefined) {
      writeConfigFile(configPath, JSON.stringify(configTemplate, null, 2));
      return structuredClone(configTemplate);
    }
    let parsed: Partial<BaseConfig>;
    try {
      const value: unknown = JSON.parse(content.toString("utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new SyntaxError("配置文件根节点必须是对象");
      }
      parsed = value;
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      // Only malformed JSON/shape is corruption. I/O and backup failures must not reset settings.
      writeConfigFile(configPath, JSON.stringify(configTemplate, null, 2));
      dialog.showMessageBox({
        type: "warning",
        title: "[轻量工具箱] 配置内容无效",
        message: "原配置已备份，已恢复默认配置",
        detail: `${configPath}\n备份保留在同目录，文件名以 .bak 结尾。\n${String(error)}`,
        buttons: ["确定"],
      });
      return structuredClone(configTemplate);
    }
    return this.safeMergeConfig(parsed, configTemplate);
  }

  private reportFileError(title: string, error: unknown) {
    console.error(`[轻量工具箱] ${title}`, error);
    dialog.showMessageBox({
      type: "error",
      title: `[轻量工具箱] ${title}`,
      message: "操作已停止；请检查文件路径、权限及可用空间。不会因读写失败重置配置。",
      detail: String(error),
      buttons: ["确定"],
    });
  }

  private calculateChangedKeys(oldObj: any, newObj: any, prefix = ""): string[] {
    const changedKeys: string[] = [];

    for (const key in newObj) {
      const oldVal = oldObj ? oldObj[key] : undefined;
      const newVal = newObj[key];
      const currentPath = prefix ? `${prefix}.${key}` : key;

      if (typeof newVal === "object" && newVal !== null && !Array.isArray(newVal)) {
        if (typeof oldVal !== "object" || oldVal === null) {
          changedKeys.push(currentPath);
        } else {
          const nestedChanges = this.calculateChangedKeys(oldVal, newVal, currentPath);
          changedKeys.push(...nestedChanges);
        }
      } else {
        if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
          changedKeys.push(currentPath);
        }
      }
    }

    return changedKeys;
  }

  public setup(uid: string) {
    try {
      const userConfigPath = migrateUserConfig(CONFIG_DIR, uid);
      const config = this.loadConfig(userConfigPath) as Config;
      this.userUid = uid;
      this.config = config;
      this.currentConfigPath = userConfigPath;
      this.isInitialized = true;
      this.resolveReady();
    } catch (error) {
      this.reportFileError("配置加载失败", error);
      throw error;
    }
  }

  public updateConfig(newConfig: Config, source: ConfigWriteSource = "automatic") {
    if (!this.isInitialized) throw new Error("配置尚未初始化，不能保存");
    const nextConfig = { ...this.config, ...newConfig };
    const written = writeConfigFile(this.currentConfigPath, JSON.stringify(nextConfig, null, 2), source);
    this._lastUpdatedConfigs = this.calculateChangedKeys(this.config, nextConfig) as ConfigPath[];
    this.config = nextConfig;
    if (!written && this._lastUpdatedConfigs.length === 0) return;
    for (const listener of this.updateListeners) {
      listener(this.config);
    }
    globalBroadcast("lite_tools.configChanged", this.config);
  }

  public onConfigUpdate(listener: ConfigListener) {
    this.updateListeners.add(listener);
    return () => this.offConfigUpdate(listener);
  }

  public offConfigUpdate(listener: ConfigListener) {
    this.updateListeners.delete(listener);
  }

  get value(): Readonly<Config> {
    return this.config;
  }

  get ready() {
    return this.readyPromise;
  }

  get uid() {
    return this.userUid;
  }

  get lastUpdatedConfigs(): ReadonlyArray<ConfigPath> {
    return this._lastUpdatedConfigs;
  }
}

const configManager = new ConfigManager();
export { configManager };
