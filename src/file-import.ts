import type { DocumentPickerAsset } from "expo-document-picker";
import type { Sticker } from "./library-store";
import { conversionError } from "./conversion-error";
import {
  isZip,
  MAX_ZIP_BYTES,
  readStickerZip,
  type ZipImage,
} from "./sticker-zip";

export type ImportSource = {
  asset: DocumentPickerAsset;
  // A retry only converts failed entries, keeping successful imports intact.
  entries?: string[];
};

type ImportIO = {
  readArchive: (asset: DocumentPickerAsset) => Promise<Uint8Array>;
  withImage: (
    image: ZipImage,
    consume: (asset: DocumentPickerAsset) => Promise<Sticker>,
  ) => Promise<Sticker>;
  convert: (
    asset: DocumentPickerAsset,
    onProgress: (stage: string) => void,
  ) => Promise<Sticker>;
};

export async function importFiles(
  sources: ImportSource[],
  io: ImportIO,
  onProgress: (stage: string) => void,
) {
  const stickers: Sticker[] = [];
  const failedSources: ImportSource[] = [];
  const failures: string[] = [];
  let archiveName: string | undefined;
  let duplicates = 0;
  for (const { asset, entries } of sources) {
    const progress = (stage: string) => onProgress(`${asset.name} · ${stage}`);
    progress("Reading file…");
    if (!isZip(asset)) {
      try {
        stickers.push(await io.convert(asset, progress));
      } catch (error) {
        failedSources.push({ asset });
        failures.push(`${asset.name}: ${conversionError(error)}`);
      }
      continue;
    }
    try {
      if ((asset.size || 0) > MAX_ZIP_BYTES)
        throw new Error("Choose a ZIP smaller than 100 MB.");
      const archive = readStickerZip(await io.readArchive(asset), asset.name);
      if (!entries) duplicates += archive.duplicates;
      const images = entries
        ? archive.images.filter((image) => entries.includes(image.path))
        : archive.images;
      if (entries && images.length !== entries.length)
        throw new Error(
          "This ZIP has changed. Choose the original file to retry.",
        );
      const failed: string[] = [];
      for (const [index, image] of images.entries()) {
        const imageProgress = (stage: string) =>
          onProgress(
            `${index + 1}/${images.length} · ${image.name} · ${stage}`,
          );
        imageProgress("Reading sticker…");
        try {
          stickers.push(
            await io.withImage(image, (item) =>
              io.convert(item, imageProgress),
            ),
          );
          archiveName ??= archive.name;
        } catch (error) {
          failed.push(image.path);
          failures.push(
            `${asset.name} / ${image.name}: ${conversionError(error)}`,
          );
        }
      }
      if (failed.length) failedSources.push({ asset, entries: failed });
    } catch (error) {
      failedSources.push({ asset, entries });
      failures.push(`${asset.name}: ${conversionError(error)}`);
    }
  }
  return { stickers, failedSources, failures, archiveName, duplicates };
}
