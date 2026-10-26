import path from "node:path";
import fs from "node:fs";
import { readOptionalConfigFile, writeConfigFile, type ConfigWriteSource } from "@/main/utils/configFile";
import type { StickerPack, StickerConfig, InternalStickerPack } from "@/common/types/localStickers";

// 定义支持的图片后缀
const SUPPORTED_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

class StickerPacksManager {
  private stickerPacks: Map<string, InternalStickerPack> = new Map();

  public rootPath!: string;

  constructor() {}

  public onEvent(eventName: string, inputPath: string, stats?: fs.Stats) {
    const filePath = inputPath.replace(/\\/g, "/");
    const fileName = path.basename(filePath);
    const dirPath = path.dirname(filePath);
    const ext = path.extname(filePath).toLowerCase();
    switch (eventName) {
      case "addDir":
        this.ensurePackExists(filePath);
        break;
      case "unlinkDir":
        this.stickerPacks.delete(filePath);
        break;
      case "add":
        if (SUPPORTED_EXTENSIONS.has(ext)) {
          this.addSticker(filePath, stats);
        }
        break;
      case "change":
        if (fileName === "sticker.json") {
          this.syncConfig(dirPath);
        }
        break;
      case "unlink":
        this.deleteSticker(filePath);
        break;
    }
  }

  private ensurePackExists(dirPath: string): InternalStickerPack {
    let pack = this.stickerPacks.get(dirPath);
    if (!pack) {
      const configPath = path.join(dirPath, "sticker.json");
      const configBytes = readOptionalConfigFile(configPath);
      if (configBytes === undefined) {
        pack = {
          label: this.baseName(dirPath),
          index: 0,
          icon: undefined,
          dirPath: dirPath,
          stickerPaths: new Map<string, number | undefined>(),
        };
        this.writeConfig(pack.dirPath, pack);
      } else {
        let config: StickerConfig;
        try {
          const parsed: unknown = JSON.parse(configBytes.toString("utf-8"));
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new SyntaxError("Invalid sticker.json shape");
          }
          config = parsed as StickerConfig;
        } catch (err) {
          pack = {
            label: this.baseName(dirPath),
            index: 0,
            icon: undefined,
            dirPath: dirPath,
            stickerPaths: new Map<string, number | undefined>(),
          };
          this.writeConfig(pack.dirPath, pack, true);
          this.stickerPacks.set(dirPath, pack);
          return pack;
        }
        pack = {
          label: config.label || this.baseName(dirPath),
          index: config.index || 0,
          icon: config.icon || undefined,
          dirPath: dirPath,
          stickerPaths: new Map<string, number | undefined>(),
        };
      }
      this.stickerPacks.set(dirPath, pack);
    }
    return pack;
  }

  private baseName(stickerPath: string) {
    if (stickerPath === this.rootPath) {
      return path.basename(stickerPath);
    }
    return stickerPath.replace(this.rootPath + "/", "");
  }

  private writeConfig(
    dirPath: string,
    pack: StickerConfig,
    rewrite = false,
    source: ConfigWriteSource = "automatic",
  ) {
    const configPath = path.join(dirPath, "sticker.json");
    const configBytes = rewrite ? undefined : readOptionalConfigFile(configPath);
    let currentConfig: Record<string, unknown> = {};
    if (configBytes !== undefined) {
      const parsed: unknown = JSON.parse(configBytes.toString("utf-8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new SyntaxError("Invalid sticker.json shape");
      }
      currentConfig = parsed as Record<string, unknown>;
    }
    writeConfigFile(
      configPath,
      JSON.stringify(
        {
          ...currentConfig,
          label: pack.label,
          index: pack.index,
          icon: pack.icon,
          url: pack.url,
        },
        null,
        2,
      ),
      source,
    );
  }

  private syncConfig(dirPath: string) {
    const pack = this.stickerPacks.get(dirPath);
    if (!pack) return;

    const configPath = path.join(dirPath, "sticker.json");
    const configBytes = readOptionalConfigFile(configPath);
    if (configBytes === undefined) return;

    const parsed: unknown = JSON.parse(configBytes.toString("utf-8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new SyntaxError("Invalid sticker.json shape");
    }
    const config = parsed as StickerConfig;
    this.stickerPacks.set(dirPath, {
      ...pack,
      label: config.label,
      index: config.index,
      icon: config.icon,
    });
  }

  private addSticker(stickerPath: string, stats?: fs.Stats) {
    const dirPath = path.dirname(stickerPath);
    const pack = this.ensurePackExists(dirPath);
    if (!pack.stickerPaths.has(stickerPath)) {
      pack.stickerPaths.set(stickerPath, stats?.birthtimeMs);
    }
  }

  private deleteSticker(stickerPath: string) {
    const dirPath = path.dirname(stickerPath);
    const pack = this.stickerPacks.get(dirPath);
    if (!pack) return;

    const hasSticker = pack.stickerPaths.has(stickerPath);

    try {
      if (fs.existsSync(stickerPath)) {
        fs.unlinkSync(stickerPath);
      }
    } catch (err) {}

    if (!hasSticker) return;

    const baseName = path.basename(stickerPath);
    if (pack.stickerPaths.size === 1 && pack.icon !== undefined) {
      const nextPack = { ...pack, icon: undefined };
      this.writeConfig(pack.dirPath, nextPack);
      pack.icon = undefined;
    } else if (pack.stickerPaths.size > 1 && pack.icon === baseName) {
      let nextIcon: string | undefined;
      for (const candidate of pack.stickerPaths.keys()) {
        if (candidate !== stickerPath) {
          nextIcon = path.basename(candidate);
          break;
        }
      }
      const nextPack = { ...pack, icon: nextIcon };
      this.writeConfig(pack.dirPath, nextPack);
      pack.icon = nextIcon;
    }
    pack.stickerPaths.delete(stickerPath);
  }


  public getPackList(sort: Config["localStickers"]["sort"] = "default"): StickerPack[] {
    return Array.from(this.stickerPacks.values()).map((pack) => {
      const entries = Array.from(pack.stickerPaths);
      switch (sort) {
        case "fileName":
          entries.sort(([a], [b]) => path.basename(a).localeCompare(path.basename(b)));
          break;
        case "fileName-desc":
          entries.sort(([a], [b]) => path.basename(b).localeCompare(path.basename(a)));
          break;
        case "createDate":
          entries.sort(([, a], [, b]) => (a ?? 0) - (b ?? 0));
          break;
        case "createDate-desc":
          entries.sort(([, a], [, b]) => (b ?? 0) - (a ?? 0));
          break;
      }
      const stickers = entries.map(([filePath]) => ({
        label: path.basename(filePath, path.extname(filePath)),
        path: filePath,
      }));

      return {
        label: pack.label,
        dirPath: pack.dirPath,
        index: pack.index,
        icon: (pack.icon ? path.join(pack.dirPath, pack.icon) : pack.stickerPaths.keys().next().value)?.replace(
          /\\/g,
          "/",
        ),
        stickers,
      };
    });
  }

  public updatePackConfig(packPath: string, key: "index" | "label" | "icon" | "url", value: string | number) {
    if (["index", "label", "icon", "url"].includes(key)) {
      const pack = this.stickerPacks.get(packPath);
      if (!pack) return;
      const updatedConfig: StickerConfig = {
        label: pack.label,
        index: pack.index,
        icon: pack.icon,
      };
      if (key === "index") updatedConfig.index = Number(value);
      else if (key === "label") updatedConfig.label = String(value);
      else if (key === "icon") updatedConfig.icon = String(value);
      else updatedConfig.url = String(value);
      this.writeConfig(pack.dirPath, updatedConfig, false, "user");
      Object.assign(pack, { [key]: value });
    }
  }

  public clear() {
    this.stickerPacks.clear();
  }
}

const stickerPacksManager = new StickerPacksManager();

export { stickerPacksManager };
