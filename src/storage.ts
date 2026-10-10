import * as FileSystem from "expo-file-system/legacy";
const path = `${FileSystem.documentDirectory}peel-library.json`;
export async function readLibrary(): Promise<string | null> {
  const info = await FileSystem.getInfoAsync(path);
  if (info.exists) return FileSystem.readAsStringAsync(path);
  // Recover a completed write if the app closed between removing and replacing the old file.
  const pending = await FileSystem.getInfoAsync(path + ".pending");
  return pending.exists
    ? FileSystem.readAsStringAsync(path + ".pending")
    : null;
}
export async function writeLibrary(value: string) {
  const temporary = path + ".pending";
  await FileSystem.writeAsStringAsync(temporary, value);
  await FileSystem.moveAsync({ from: temporary, to: path });
}
