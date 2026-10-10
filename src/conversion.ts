import Constants from "expo-constants";
import { requireOptionalNativeModule } from "expo-modules-core";
import { Platform } from "react-native";
import type { DocumentPickerAsset } from "expo-document-picker";
import type { Sticker } from "./library";
function serverUrl() {
  if (process.env.EXPO_PUBLIC_CONVERTER_URL)
    return process.env.EXPO_PUBLIC_CONVERTER_URL.replace(/\/$/, "");
  if (Platform.OS === "web")
    return `${window.location.protocol}//${window.location.hostname}:4311`;
  const host = Constants.expoConfig?.hostUri?.split(":")[0];
  if (host && __DEV__) return `http://${host}:4311`;
  throw Error("The conversion service has not been configured for this build.");
}
export async function convert(
  asset: DocumentPickerAsset,
  clip?: { start: number; duration: number },
  onProgress?: (stage: string) => void,
): Promise<Sticker> {
  const limit = clip ? 100 : 50;
  if ((asset.size || 0) > limit * 1024 * 1024)
    throw Error(`${asset.name} is larger than ${limit} MB.`);
  if (Platform.OS === "android") {
    const native = requireOptionalNativeModule<{
      addListener(
        event: "conversionProgress",
        listener: (event: { uri: string; stage: string }) => void,
      ): { remove(): void };
      convert(
        uri: string,
        start: number,
        duration: number,
      ): Promise<Pick<Sticker, "data" | "tray" | "animated" | "bytes">>;
    }>("WhatsAppStickers");
    if (!native)
      throw Error("Install the Peel APK to convert files on your phone.");
    const subscription = native.addListener("conversionProgress", (event) => {
      if (event.uri === asset.uri) onProgress?.(event.stage);
    });
    try {
      const result = await native.convert(
        asset.uri,
        clip?.start ?? 0,
        clip?.duration ?? 0,
      );
      return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: asset.name,
        ...result,
      };
    } finally {
      subscription.remove();
    }
  }
  const body = new FormData();
  if (clip) {
    body.append("start", String(clip.start));
    body.append("duration", String(clip.duration));
  }
  if (Platform.OS === "web") {
    const blob = asset.file || (await (await fetch(asset.uri)).blob());
    body.append("file", blob, asset.name);
  } else {
    // React Native FormData accepts a file URI object instead of a browser Blob.
    body.append("file", {
      uri: asset.uri,
      name: asset.name,
      type: asset.mimeType || "application/octet-stream",
    } as unknown as Blob);
  }
  let response: Response;
  try {
    response = await fetch(`${serverUrl()}/convert`, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(300_000),
    });
  } catch {
    throw Error(
      "Could not reach the converter. Check your connection and try again.",
    );
  }
  const result = await response.json();
  if (!response.ok)
    throw Error(result.error || "Could not convert this image.");
  if (
    typeof result.data !== "string" ||
    typeof result.tray !== "string" ||
    typeof result.animated !== "boolean" ||
    typeof result.bytes !== "number"
  )
    throw Error("The converter returned an invalid sticker.");
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: asset.name,
    ...result,
  };
}
