import { requireOptionalNativeModule } from "expo-modules-core";
import { Platform } from "react-native";
import { type Pack, validatePack } from "./library";
const bridge =
  Platform.OS === "web"
    ? null
    : requireOptionalNativeModule<{
        addPack(payload: string): Promise<boolean>;
      }>("WhatsAppStickers");
export async function addToWhatsApp(pack: Pack) {
  const problem = validatePack(pack);
  if (problem) throw Error(problem);
  if (!bridge)
    throw Error(
      Platform.OS === "web"
        ? "Open Peel on your phone to add this pack to WhatsApp. The web app can create and preview your stickers."
        : "WhatsApp export needs the Peel development or release build. Expo Go can create and preview packs.",
    );
  await bridge.addPack(
    JSON.stringify({
      identifier: pack.id,
      name: pack.name,
      publisher: "Made with Peel",
      animated_sticker_pack: pack.animated,
      tray_image: pack.stickers[0].tray,
      stickers: pack.stickers.map((s) => ({
        image_data: s.data,
        emojis: ["✨"],
        accessibility_text: s.name.slice(0, 125),
      })),
    }),
  );
}
