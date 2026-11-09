import { File, Paths } from "expo-file-system";
import type { DocumentPickerAsset } from "expo-document-picker";
import type { Sticker } from "./library-store";
import { MAX_ZIP_BYTES, type ZipImage } from "./sticker-zip";

export async function readArchive(asset: DocumentPickerAsset) {
  const file = new File(asset.uri);
  if (!file.exists)
    throw new Error("Could not open this ZIP. Choose it again.");
  if (file.size > MAX_ZIP_BYTES)
    throw new Error("Choose a ZIP smaller than 100 MB.");
  return file.bytes();
}

export async function withImage(
  image: ZipImage,
  consume: (asset: DocumentPickerAsset) => Promise<Sticker>,
) {
  // Archive paths never become filesystem paths. Only one extracted file is kept.
  const extension = image.name.split(".").at(-1)!.toLowerCase();
  const file = new File(
    Paths.cache,
    `peel-zip-${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`,
  );
  try {
    file.create();
    file.write(image.data);
    return await consume({
      uri: file.uri,
      name: image.name,
      mimeType: image.mimeType,
      size: image.data.length,
      lastModified: Date.now(),
    });
  } finally {
    if (file.exists) file.delete();
  }
}
