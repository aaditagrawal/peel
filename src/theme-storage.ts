import * as FileSystem from "expo-file-system/legacy";
const path = `${FileSystem.documentDirectory}peel-theme.txt`;
export async function readTheme(): Promise<string | null> {
  return (await FileSystem.getInfoAsync(path)).exists
    ? FileSystem.readAsStringAsync(path)
    : null;
}
export async function writeTheme(value: string) {
  await FileSystem.writeAsStringAsync(path, value);
}
