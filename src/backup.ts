import * as FileSystem from "expo-file-system/legacy";
import * as DocumentPicker from "expo-document-picker";
import {
  MAX_BACKUP_BYTES,
  parseBackup,
  serializeBackup,
} from "./backup-format";
import type { Pack } from "./library-store";

export async function exportBackup(packs: Pack[]): Promise<boolean> {
  const raw = serializeBackup(packs);
  const access =
    await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!access.granted) return false;
  const name = `peel-backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const uri = await FileSystem.StorageAccessFramework.createFileAsync(
    access.directoryUri,
    name,
    "application/json",
  );
  try {
    await FileSystem.writeAsStringAsync(uri, raw);
    if ((await FileSystem.readAsStringAsync(uri)) !== raw)
      throw new Error("Backup verification failed.");
  } catch {
    await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    throw new Error(
      "The backup couldn't be saved. Choose a folder with enough free space and try again.",
    );
  }
  return true;
}
export async function importBackup(): Promise<Pack[] | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ["application/json", "text/plain", "application/octet-stream"],
    copyToCacheDirectory: true,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  try {
    const info = await FileSystem.getInfoAsync(asset.uri);
    if (!info.exists) throw new Error("The backup file couldn't be opened.");
    if (info.size > MAX_BACKUP_BYTES)
      throw new Error("This backup exceeds the 128 MB limit.");
    return parseBackup(await FileSystem.readAsStringAsync(asset.uri));
  } finally {
    if (
      FileSystem.cacheDirectory &&
      asset.uri.startsWith(FileSystem.cacheDirectory)
    ) {
      await FileSystem.deleteAsync(asset.uri, { idempotent: true }).catch(
        () => {},
      );
    }
  }
}
