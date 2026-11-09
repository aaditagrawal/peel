import type { DocumentPickerAsset } from "expo-document-picker";
import type { Sticker } from "./library-store";
import { MAX_ZIP_BYTES, type ZipImage } from "./sticker-zip";

export async function readArchive(asset: DocumentPickerAsset) {
  const file = asset.file || (await (await fetch(asset.uri)).blob());
  if (file.size > MAX_ZIP_BYTES)
    throw new Error("Choose a ZIP smaller than 100 MB.");
  return new Uint8Array(await file.arrayBuffer());
}

export async function withImage(
  image: ZipImage,
  consume: (asset: DocumentPickerAsset) => Promise<Sticker>,
) {
  const file = new File([new Uint8Array(image.data)], image.name, {
    type: image.mimeType,
  });
  const uri = URL.createObjectURL(file);
  try {
    return await consume({
      uri,
      file,
      name: image.name,
      mimeType: image.mimeType,
      size: file.size,
      lastModified: file.lastModified,
    });
  } finally {
    URL.revokeObjectURL(uri);
  }
}
