import { Readable } from "stream";
import { join } from "path";
import { mkdirSync } from "fs";
import { spawn } from "child_process";
import zlib from "zlib";
import { writeConfigFile } from "@/main/utils/configFile";

import { configManager } from "@/main/modules/configManager";
import { settingsWindow } from "@/main/utils/windowTracker";
import { proxyManager, fetch } from "@/main/modules/proxyManager";
import { createLogger } from "@/main/utils/createLogger";
import { localStickers } from "./index";

import type {
  StickerConfig,
  TgStickerItem,
  TgStickerSetResponse,
  TgFileResponse,
} from "@/common/types/localStickers";

const log = createLogger("getTgSticker");

class TgStickerDownloader {
  private readonly MAX_CONCURRENT_DOWNLOADS = 8;

  constructor() {}

  private getFfmpegPath(): string {
    return configManager.value.localStickers.ffmpegPath || "ffmpeg";
  }

  public async getTgSticker(url: string): Promise<void> {
    if (!url.startsWith("https://t.me/addstickers/")) {
      this.sendWindowMessage(`输入地址不是 TG 贴纸包`, "error");
      return;
    }

    try {
      const stickerName = url.split("/")[4];
      this.sendWindowMessage(`准备下载 ${stickerName}`, "default", 60 * 60 * 1000);

      const res = await fetch(
        `https://api.telegram.org/bot${configManager.value.localStickers.telegramBotToken}/getStickerSet?name=${stickerName}`,
      );
      const data = (await res.json()) as TgStickerSetResponse;

      log("贴图集数据", data);

      if (!data.ok) {
        throw new Error(data.description);
      }

      if (data.result.sticker_type !== "regular") {
        throw new Error("不支持的贴纸包类型");
      }

      const stickerConfig: StickerConfig = {
        label: data.result.title,
        index: 0,
        icon: undefined,
        url,
      };

      this.sendWindowMessage(`开始下载 ${data.result.title}`, "default", 60 * 60 * 1000);

      const stickerList = data.result.stickers;
      const pictureList: TgStickerItem[] = [];
      const videoList: TgStickerItem[] = [];
      const animatedList: TgStickerItem[] = [];

      stickerList.forEach((item) => {
        if (item.is_animated) {
          animatedList.push(item);
        } else if (item.is_video) {
          videoList.push(item);
        } else {
          pictureList.push(item);
        }
      });

      log(`共有 ${pictureList.length}个静图 ${videoList.length}个视频 ${animatedList.length}个tgs`);

      const concatArr: TgStickerItem[] = [...pictureList];

      if (configManager.value.localStickers.tgsToGifPath) {
        concatArr.push(...animatedList);
      }

      if (videoList.length) {
        const supportEncoding = await this.checkVp9Support();
        if (!supportEncoding) return;
        concatArr.push(...videoList);
      }

      if (concatArr.length === 0) {
        if (animatedList.length) {
          this.sendWindowMessage(`无法处理 ${data.result.title} 贴纸包中的 TGS 贴纸`, "error");
        } else {
          this.sendWindowMessage(`${data.result.title} 没有可下载的贴纸`, "error");
        }
        return;
      }

      try {
        const downloads: Promise<boolean[]>[] = [];
        for (let i = 0; i < this.MAX_CONCURRENT_DOWNLOADS; i++) {
          const item = concatArr.shift();
          if (item) {
            downloads.push(this.downloadFile(item, concatArr, data));
          }
        }

        const resolves = await Promise.all(downloads);
        const downloadFailedNum = resolves.flat().filter((success) => !success).length;

        const folderPath = join(configManager.value.localStickers.path, data.result.name);
        const stickerConfigPath = join(folderPath, "sticker.json");
        writeConfigFile(stickerConfigPath, JSON.stringify(stickerConfig, null, 2), "automatic");
        localStickers.notifyStickerStoreUpdated();

        if (downloadFailedNum === 0) {
          this.sendWindowMessage(`${data.result.title} 下载完成`, "success");
        } else {
          this.sendWindowMessage(`${data.result.title} 下载结束，${downloadFailedNum} 个贴纸下载失败`, "default");
        }
      } catch (err: any) {
        log("下载出错", err);
        let message = `${data.result.title} 下载失败，${err?.message}`;
        if (err?.message === "fetch failed") {
          message = proxyManager.proxyIsValid
            ? `${data.result.title} 下载失败，网络错误，无法访问Telegram服务器`
            : `${data.result.title} 下载失败，网络错误，请尝试添加代理地址`;
        }
        this.sendWindowMessage(message, "error");
      }
    } catch (err: any) {
      log("下载贴纸包失败", err.message, err.stack);
      this.sendWindowMessage(`下载贴纸包时意外退出：${err.message}`, "error");
    }
  }

  private async downloadFile(
    item: TgStickerItem,
    stickerList: TgStickerItem[],
    data: TgStickerSetResponse,
    resolveAccumulator: boolean[] = [],
  ): Promise<boolean[]> {
    const fileId = item.file_id;
    const fileUniqueId = item.file_unique_id;

    const res = await fetch(
      `https://api.telegram.org/bot${configManager.value.localStickers.telegramBotToken}/getFile?file_id=${fileId}`,
    );
    const fileData = (await res.json()) as TgFileResponse;

    const fileRes = await fetch(
      `https://api.telegram.org/file/bot${configManager.value.localStickers.telegramBotToken}/${fileData.result.file_path}`,
    );
    const arrayBuffer = await fileRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const folderPath = join(configManager.value.localStickers.path, data.result.name);
    mkdirSync(folderPath, { recursive: true });

    let convertSuccess = false;
    if (item.is_video) {
      const filePath = join(folderPath, `${fileUniqueId}.gif`);
      convertSuccess = await this.convertWebmToGif(buffer, filePath);
    } else if (item.is_animated) {
      const filePath = join(folderPath, `${fileUniqueId}.gif`);
      convertSuccess = await this.convertLottieToGif(buffer, filePath);
    } else {
      const filePath = join(folderPath, `${fileUniqueId}.png`);
      convertSuccess = await this.convertWebpToPng(buffer, filePath);
    }

    resolveAccumulator.push(convertSuccess);

    if (stickerList.length > 0) {
      const nextSticker = stickerList.shift()!;
      return this.downloadFile(nextSticker, stickerList, data, resolveAccumulator);
    } else {
      return resolveAccumulator;
    }
  }

  private convertWebpToPng(buffer: Buffer, outputPath: string): Promise<boolean> {
    return new Promise((resolve) => {
      // ffmpeg -i pipe:0 -y outputPath
      const ffmpeg = spawn(this.getFfmpegPath(), [
        "-i",
        "pipe:0", // 从标准输入读取
        "-y", // 强制覆盖输出文件，防止卡住
        outputPath,
      ]);

      ffmpeg.on("error", (err) => {
        log("webp 转 png 启动失败", err.message);
        resolve(false);
      });

      ffmpeg.on("close", (code) => {
        if (code === 0) {
          log("静图下载完成", outputPath);
          resolve(true);
        } else {
          log("webp 转 png 失败，退出码:", code);
          resolve(false);
        }
      });

      // 将 Buffer 通过流写入 ffmpeg 的 stdin
      Readable.from(buffer).pipe(ffmpeg.stdin);
    });
  }

  private convertWebmToGif(buffer: Buffer, outputPath: string): Promise<boolean> {
    return new Promise((resolve) => {
      // ffmpeg -vcodec libvpx-vp9 -i pipe:0 -vf "split..." -loop 0 -y outputPath
      const ffmpeg = spawn(this.getFfmpegPath(), [
        "-vcodec",
        "libvpx-vp9",
        "-i",
        "pipe:0",
        "-vf",
        "split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse",
        "-loop",
        "0",
        "-y",
        outputPath,
      ]);

      ffmpeg.on("error", (err) => {
        log("webm 转 gif 启动失败", err.message);
        resolve(false);
      });

      ffmpeg.on("close", (code) => {
        if (code === 0) {
          log("动图下载完成", outputPath);
          resolve(true);
        } else {
          log("webm 转 gif 失败，退出码:", code);
          resolve(false);
        }
      });

      Readable.from(buffer).pipe(ffmpeg.stdin);
    });
  }

  private convertLottieToGif(buffer: Buffer, outputPath: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const exePath = configManager.value.localStickers.tgsToGifPath;
      if (!exePath) {
        log("缺少 tgs_to_gif 路径配置");
        return resolve(false);
      }

      const convertStdin = spawn(exePath, [outputPath]);
      const inputStream = Readable.from(buffer);

      convertStdin.stderr.on("data", (err: Buffer) => {
        log("Lottie 转 Gif 出错:", err.toString());
        try {
          const errbuffer = zlib.gunzipSync(buffer);
          log(outputPath, "出错数据：", errbuffer.toString());
        } catch (e) {
          log("解压出错数据失败", e);
        }
        resolve(false);
      });

      convertStdin.on("close", (code) => {
        if (code === 0) {
          log("Lottie 转 Gif 完成", outputPath);
        } else {
          log(outputPath, "Lottie 转 Gif 非正常退出", code);
        }
        resolve(true);
      });

      convertStdin.on("error", (error) => {
        log("TGS 转 GIF 进程出错:", error);
        reject(new Error("TGS 转 GIF 出错，请检查 tgs_to_gif 路径是否填写正确"));
      });

      inputStream.pipe(convertStdin.stdin);
    });
  }

  private checkVp9Support(): Promise<boolean> {
    return new Promise((resolve) => {
      const ffmpeg = spawn(this.getFfmpegPath(), ["-codecs"]);
      let output = "";

      ffmpeg.stdout.on("data", (data) => {
        output += data.toString();
      });

      // 有时候 FFmpeg 会把信息输出到 stderr
      ffmpeg.stderr.on("data", (data) => {
        output += data.toString();
      });

      ffmpeg.on("error", () => {
        this.sendWindowMessage(`FFmpeg 命令执行失败，请检查 FFmpeg 路径是否填写正确`, "error");
        resolve(false);
      });

      ffmpeg.on("close", (code) => {
        // 如果无法运行或者没有输出，当做失败处理
        if (code !== 0 && output.trim() === "") {
          this.sendWindowMessage(`FFmpeg 命令执行失败，请检查 FFmpeg 路径是否填写正确`, "error");
          resolve(false);
        } else if (output.includes("libvpx-vp9") || output.includes("vp9")) {
          resolve(true);
        } else {
          this.sendWindowMessage(`当前 FFmpeg 不支持 libvpx-vp9 编码格式，请更换版本后重试`, "error");
          resolve(false);
        }
      });
    });
  }

  private sendWindowMessage(content: string, type: "default" | "error" | "success", duration: number = 6000): void {
    if (!settingsWindow || !settingsWindow.webContents) return;
    this.clearWindowMessage();
    settingsWindow.webContents.send("lite_tools.toast", {
      content,
      type,
      duration,
    });
  }

  private clearWindowMessage(): void {
    if (!settingsWindow || !settingsWindow.webContents) return;
    settingsWindow.webContents.send("lite_tools.clearToast");
  }
}

const tgStickerDownloader = new TgStickerDownloader();

export { tgStickerDownloader };
