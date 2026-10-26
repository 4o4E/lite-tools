import path from "node:path";
import { readOptionalConfigFile, writeConfigFile } from "@/main/utils/configFile";
import { configManager } from "@/main/modules/configManager";

import type { Path, Sticker, Stickers, StickerPack } from "@/common/types/localStickers";

class RecentStickersManager {
  private recentStickers: StickerPack = { label: "常用贴纸", icon: "", index: -1, dirPath: "", stickers: [] };
  private recentStickersPath: string = "";

  private ensureConfigExists(): void {
    const contents = readOptionalConfigFile(this.recentStickersPath);
    if (contents === undefined) {
      this.writeConfig(this.recentStickersPath, []);
      this.recentStickers.stickers = [];
      this.recentStickers.icon = "";
      return;
    }

    let stickers: Stickers;
    try {
      const parsed: unknown = JSON.parse(contents.toString("utf-8"));
      if (
        !Array.isArray(parsed) ||
        parsed.some((sticker: unknown) => {
          if (!sticker || typeof sticker !== "object") return true;
          return (
            !("path" in sticker) ||
            typeof sticker.path !== "string" ||
            !("label" in sticker) ||
            typeof sticker.label !== "string"
          );
        })
      ) {
        throw new SyntaxError("Invalid recentStickers.json shape");
      }
      stickers = parsed as Stickers;
    } catch {
      this.writeConfig(this.recentStickersPath, []);
      this.recentStickers.stickers = [];
      this.recentStickers.icon = "";
      return;
    }

    this.recentStickers.stickers = stickers;
    this.recentStickers.icon = stickers[0]?.path ?? "";
  }

  private writeConfig(filePath: string, stickers: Stickers) {
    writeConfigFile(filePath, JSON.stringify(stickers, null, 2), "automatic");
  }

  public setRootPath(rootPath: string) {
    const previousPath = this.recentStickersPath;
    this.recentStickersPath = path.join(rootPath, "recentStickers.json");
    try {
      this.ensureConfigExists();
    } catch (error) {
      this.recentStickersPath = previousPath;
      throw error;
    }
  }

  public updateRecentStickers(sticker: Sticker) {
    const stickers = this.recentStickers.stickers.filter((item) => item.path !== sticker.path);
    stickers.unshift(sticker);
    const maxStickers =
      configManager.value.localStickers.stickersPerRow * configManager.value.localStickers.recentStickers.limit;
    const nextStickers = stickers.slice(0, maxStickers);
    this.writeConfig(this.recentStickersPath, nextStickers);
    this.recentStickers.stickers = nextStickers;
    this.recentStickers.icon = sticker.path;
  }

  public deleteSticker(inputPath: Path) {
    const stickerPath = inputPath.replace(/\\/g, "/");
    const index = this.recentStickers.stickers.findIndex((item) => item.path === stickerPath);
    if (index > -1) {
      const nextStickers = this.recentStickers.stickers.filter((item) => item.path !== stickerPath);
      this.writeConfig(this.recentStickersPath, nextStickers);
      this.recentStickers.stickers = nextStickers;
      if (this.recentStickers.icon === stickerPath && nextStickers.length) {
        this.recentStickers.icon = nextStickers[0].path;
      }
    }
  }

  public getRecentStickers() {
    const maxStickers =
      configManager.value.localStickers.stickersPerRow * configManager.value.localStickers.recentStickers.limit;
    this.recentStickers.stickers = this.recentStickers.stickers.slice(0, maxStickers);
    return this.recentStickers;
  }
}

const recentStickersManager = new RecentStickersManager();
export { recentStickersManager };
