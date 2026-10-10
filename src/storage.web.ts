import { get, set } from "idb-keyval";
export async function readLibrary(): Promise<string | null> {
  return (await get<string>("peel.library.v1")) ?? null;
}
export async function writeLibrary(value: string) {
  await set("peel.library.v1", value);
}
