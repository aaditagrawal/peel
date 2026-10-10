import { get, set } from "idb-keyval";
export async function readTheme(): Promise<string | null> {
  return (await get<string>("peel.theme.v1")) ?? null;
}
export async function writeTheme(value: string) {
  await set("peel.theme.v1", value);
}
