import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type ConfigWriteSource = "user" | "automatic";

export function backupConfigFile(filePath: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${filePath}.${stamp}.${randomUUID()}.bak`;
  fs.copyFileSync(filePath, backupPath, fs.constants.COPYFILE_EXCL);
  return backupPath;
}

/** Missing files are new configs; every other read error must stop the write. */
export function readOptionalConfigFile(filePath: string): Buffer | undefined {
  try {
    return fs.readFileSync(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** Automatic replacement requires a byte-for-byte backup before touching the original. */
export function writeConfigFile(
  filePath: string,
  content: string | Buffer,
  source: ConfigWriteSource = "automatic",
): boolean {
  const previous = readOptionalConfigFile(filePath);
  const next = typeof content === "string" ? Buffer.from(content, "utf8") : content;
  if (previous?.equals(next)) return false;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (previous !== undefined && source !== "user") backupConfigFile(filePath);

  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, next, { flag: "wx" });
    fs.renameSync(temporaryPath, filePath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
  return true;
}
