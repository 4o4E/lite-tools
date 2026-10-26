import fs from "node:fs";
import path from "node:path";
import { backupConfigFile, readOptionalConfigFile, writeConfigFile } from "@/main/utils/configFile";

function validateImportedConfig(content: Buffer, filePath: string) {
  const value: unknown = JSON.parse(content.toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SyntaxError(`配置文件根节点必须是对象：${filePath}`);
  }
}

/** Import the legacy mappings once; subsequent startups only use the UID-derived path. */
export function migrateUserConfig(configDir: string, uid: string): string {
  const accountPath = (account: string) => path.join(configDir, "configs", `${account}.json`);
  const registryPath = path.join(configDir, "UserConfigRegistry.json");
  const registryBytes = readOptionalConfigFile(registryPath);
  if (registryBytes === undefined) return accountPath(uid);

  const parsed: unknown = JSON.parse(registryBytes.toString("utf8"));
  if (!Array.isArray(parsed) || !parsed.every((entry) =>
    Array.isArray(entry) && entry.length === 2 && entry.every((value) => typeof value === "string"),
  )) {
    throw new SyntaxError(`旧配置索引格式无效，已保留原文件：${registryPath}`);
  }
  const entries = new Map(parsed as [string, string][]);
  const imports: { destination: string; content: Buffer }[] = [];
  for (const [account, registered] of entries) {
    const destination = accountPath(account);
    const registeredPath = path.resolve(configDir, registered);
    let sourcePath = registeredPath;
    let sourceBytes = readOptionalConfigFile(registeredPath);
    let newestTime = sourceBytes === undefined ? -Infinity : fs.statSync(registeredPath).mtimeMs;
    const candidates = [destination];
    // A temporary read failure could also have activated the old shared fallback.
    // Compare its timestamp even if the registered file has become readable again.
    if (account === uid) candidates.push(path.join(configDir, "config.json"));
    for (const candidate of candidates) {
      if (path.resolve(candidate) === path.resolve(registeredPath)) continue;
      const bytes = readOptionalConfigFile(candidate);
      if (bytes === undefined) continue;
      const modified = fs.statSync(candidate).mtimeMs;
      if (modified > newestTime) {
        sourcePath = candidate;
        sourceBytes = bytes;
        newestTime = modified;
      }
    }

    if (sourceBytes !== undefined && path.resolve(sourcePath) !== path.resolve(destination)) {
      validateImportedConfig(sourceBytes, sourcePath);
      imports.push({ destination, content: sourceBytes });
    }
  }

  // Keep both the complete old mapping and every overwritten target. Source files stay intact.
  backupConfigFile(registryPath);
  for (const entry of imports) writeConfigFile(entry.destination, entry.content);
  fs.unlinkSync(registryPath);
  return accountPath(uid);
}
