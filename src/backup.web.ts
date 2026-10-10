import * as DocumentPicker from "expo-document-picker";
import {
  MAX_BACKUP_BYTES,
  parseBackup,
  serializeBackup,
} from "./backup-format";
import type { Pack } from "./library-store";
export async function exportBackup(packs: Pack[]): Promise<boolean> {
  const url = URL.createObjectURL(
    new Blob([serializeBackup(packs)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `peel-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return true;
}
export async function importBackup(): Promise<Pack[] | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ["application/json", "text/plain"],
    base64: false,
  });
  if (result.canceled) return null;
  const file = result.assets[0].file;
  if (!file) throw new Error("The backup file couldn't be opened.");
  if (file.size > MAX_BACKUP_BYTES)
    throw new Error("This backup exceeds the 128 MB limit.");
  return parseBackup(await file.text());
}
