#include <jni.h>
#include <android/bitmap.h>
#include <webp/encode.h>
#include <webp/mux.h>
#include <vector>
#include <algorithm>

extern "C" JNIEXPORT jbyteArray JNICALL
Java_expo_modules_whatsappstickers_OfflineConverter_encode(
    JNIEnv* env, jobject, jobjectArray frames, jint step, jint duration, jfloat quality, jboolean lossless) {
  const int count = env->GetArrayLength(frames);
  if (count == 0) return nullptr;
  WebPConfig config;
  WebPConfigInit(&config);
  // Lossless quality controls search effort, not pixel fidelity. The old 100
  // setting ran the most expensive search for every animation frame.
  config.quality = lossless ? 25 : quality;
  config.lossless = lossless;
  config.method = lossless ? 0 : 2;
  config.thread_level = 1;
  // Keep coverage lossless even when RGB needs compression to fit the cap.
  config.alpha_quality = 100;
  WebPAnimEncoderOptions options;
  WebPAnimEncoderOptionsInit(&options);
  options.anim_params.loop_count = 0;
  // Short stickers loop from the beginning; extra seek keyframes only cost
  // encode time and bytes. Keep inter-frame compression enabled.
  options.kmax = 0;
  options.kmin = 0;
  auto* encoder = count > 1 ? WebPAnimEncoderNew(512, 512, &options) : nullptr;
  if (count > 1 && !encoder) return nullptr;
  bool ok = true;
  WebPData data;
  WebPDataInit(&data);
  for (int i = 0; i < count && ok; ++i) {
    jobject bitmap = env->GetObjectArrayElement(frames, i);
    AndroidBitmapInfo info{};
    void* pixels = nullptr;
    ok = AndroidBitmap_getInfo(env, bitmap, &info) == 0 && info.width > 0 && info.width <= 512 &&
         info.height > 0 && info.height <= 512 && info.format == ANDROID_BITMAP_FORMAT_RGBA_8888 &&
         AndroidBitmap_lockPixels(env, bitmap, &pixels) == 0;
    if (ok) {
      WebPPicture picture;
      WebPPictureInit(&picture);
      picture.width = info.width;
      picture.height = info.height;
      picture.use_argb = 1;
      ok = WebPPictureAlloc(&picture);
      // Write straight-alpha ARGB directly into libwebp's input. The previous
      // RGBA scratch buffer required another full pixel conversion and copy
      // in WebPPictureImportRGBA for every frame of every compression pass.
      for (int y = 0; ok && y < static_cast<int>(info.height); ++y) {
        const auto* row = static_cast<uint8_t*>(pixels) + y * info.stride;
        auto* output = picture.argb + y * picture.argb_stride;
        for (int x = 0; x < static_cast<int>(info.width); ++x) {
          const auto* p = row + x * 4;
          const uint32_t alpha = p[3];
          if (alpha == 255) {
            output[x] = 0xff000000u | (uint32_t(p[0]) << 16) | (uint32_t(p[1]) << 8) | p[2];
          } else if (alpha == 0) {
            output[x] = 0;
          } else {
            const uint32_t red = std::min(255u, (p[0] * 255u + alpha / 2) / alpha);
            const uint32_t green = std::min(255u, (p[1] * 255u + alpha / 2) / alpha);
            const uint32_t blue = std::min(255u, (p[2] * 255u + alpha / 2) / alpha);
            output[x] = (alpha << 24) | (red << 16) | (green << 8) | blue;
          }
        }
      }
      AndroidBitmap_unlockPixels(env, bitmap);
      // Keep artwork at its original size after reducing spatial detail.
      if (ok && (info.width != 512 || info.height != 512))
        ok = WebPPictureRescale(&picture, 512, 512);
      if (ok && encoder) {
        ok = WebPAnimEncoderAdd(encoder, &picture, i * step, &config);
      } else if (ok) {
        // The animation encoder can keep a one-frame ANIM container when its
        // cropped representation is smaller. Photos must always be static.
        WebPMemoryWriter writer;
        WebPMemoryWriterInit(&writer);
        picture.writer = WebPMemoryWrite;
        picture.custom_ptr = &writer;
        ok = WebPEncode(&config, &picture);
        data.bytes = writer.mem;
        data.size = writer.size;
      }
      WebPPictureFree(&picture);
    }
    env->DeleteLocalRef(bitmap);
  }
  if (encoder) {
    ok = ok && WebPAnimEncoderAdd(encoder, nullptr, duration, nullptr) &&
         WebPAnimEncoderAssemble(encoder, &data);
  }
  jbyteArray result = nullptr;
  if (ok) {
    // Empty means encoded successfully but exceeds the transfer budget. It is
    // a compression retry, not a codec failure. Avoid a huge Java-side copy.
    const jsize size = data.size <= 8 * 1024 * 1024 ? static_cast<jsize>(data.size) : 0;
    result = env->NewByteArray(size);
    if (result && size) env->SetByteArrayRegion(result, 0, size, reinterpret_cast<const jbyte*>(data.bytes));
  }
  WebPDataClear(&data);
  WebPAnimEncoderDelete(encoder);
  return result;
}

#include <webp/demux.h>
#include <memory>
#include <cstring>

namespace {
struct AnimationReader {
  std::vector<uint8_t> bytes;
  std::vector<uint8_t> canvas;
  WebPAnimDecoder* decoder = nullptr;
  uint8_t* pixels = nullptr;
  int timestamp = 0;
  int canvas_timestamp = -1;
  int width = 0;
  int height = 0;
  bool passthrough = false;
  ~AnimationReader() { WebPAnimDecoderDelete(decoder); }
};
jlong webpError(JNIEnv* env, const char* message) {
  env->ThrowNew(env->FindClass("java/lang/IllegalArgumentException"), message);
  return 0;
}

bool hasTransformingMetadata(WebPDemuxer* demux) {
  if (WebPDemuxGetI(demux, WEBP_FF_FORMAT_FLAGS) & (ICCP_FLAG | EXIF_FLAG | XMP_FLAG)) return true;
  for (const auto* name : {"ICCP", "EXIF", "XMP "}) {
    WebPChunkIterator chunk{};
    if (WebPDemuxGetChunk(demux, name, 1, &chunk)) {
      WebPDemuxReleaseChunkIterator(&chunk);
      return true;
    }
  }
  return false;
}

bool completeRiff(const WebPData& data) {
  if (data.size < 12) return false;
  const uint32_t size = uint32_t(data.bytes[4]) | (uint32_t(data.bytes[5]) << 8) |
                        (uint32_t(data.bytes[6]) << 16) | (uint32_t(data.bytes[7]) << 24);
  return uint64_t(size) + 8 == data.size;
}
}

extern "C" JNIEXPORT jboolean JNICALL
Java_expo_modules_whatsappstickers_OfflineConverter_compliantStaticWebp(
    JNIEnv* env, jobject, jbyteArray input) {
  const auto size = env->GetArrayLength(input);
  if (size < 12 || size > 100 * 1024) return false;
  std::vector<uint8_t> bytes(size);
  env->GetByteArrayRegion(input, 0, size, reinterpret_cast<jbyte*>(bytes.data()));
  if (env->ExceptionCheck()) return false;
  const WebPData data{bytes.data(), bytes.size()};
  std::unique_ptr<WebPDemuxer, decltype(&WebPDemuxDelete)> demux(WebPDemux(&data), WebPDemuxDelete);
  // An ANIM container always uses animation validation, including containers
  // with a single frame. Keep the native validation independent of Android
  // decoder versions that may tolerate a partially decodable still image.
  const bool metadata_valid = demux && completeRiff(data) &&
      WebPDemuxGetI(demux.get(), WEBP_FF_CANVAS_WIDTH) == 512 &&
      WebPDemuxGetI(demux.get(), WEBP_FF_CANVAS_HEIGHT) == 512 &&
      WebPDemuxGetI(demux.get(), WEBP_FF_FRAME_COUNT) == 1 &&
      (WebPDemuxGetI(demux.get(), WEBP_FF_FORMAT_FLAGS) & ANIMATION_FLAG) == 0 &&
      !hasTransformingMetadata(demux.get());
  if (!metadata_valid) return false;
  int width = 0, height = 0;
  auto* decoded = WebPDecodeRGBA(data.bytes, data.size, &width, &height);
  const bool valid = decoded && width == 512 && height == 512;
  WebPFree(decoded);
  return valid;
}

extern "C" JNIEXPORT jlong JNICALL
Java_expo_modules_whatsappstickers_OfflineConverter_openWebp(
    JNIEnv* env, jobject, jbyteArray input, jintArray metadata) {
  auto reader = std::make_unique<AnimationReader>();
  const auto size = env->GetArrayLength(input);
  if (size <= 0 || size > 50 * 1024 * 1024 || env->GetArrayLength(metadata) < 1)
    return webpError(env, "Could not read this animated WebP.");
  reader->bytes.resize(size);
  env->GetByteArrayRegion(input, 0, size, reinterpret_cast<jbyte*>(reader->bytes.data()));
  if (env->ExceptionCheck()) return 0;
  const WebPData data{reader->bytes.data(), reader->bytes.size()};
  std::unique_ptr<WebPDemuxer, decltype(&WebPDemuxDelete)> demux(WebPDemux(&data), WebPDemuxDelete);
  if (!demux) return webpError(env, "Could not decode this animated WebP.");
  reader->width = WebPDemuxGetI(demux.get(), WEBP_FF_CANVAS_WIDTH);
  reader->height = WebPDemuxGetI(demux.get(), WEBP_FF_CANVAS_HEIGHT);
  if (reader->width <= 0 || reader->height <= 0 || int64_t(reader->width) * reader->height > 16000000)
    return webpError(env, "This animation is too large to process. Choose one below 16 megapixels.");
  const auto count = WebPDemuxGetI(demux.get(), WEBP_FF_FRAME_COUNT);
  if (count == 0 || count > 10000) return webpError(env, "Could not read this animation's frames.");
  WebPIterator frame{};
  if (!WebPDemuxGetFrame(demux.get(), 1, &frame)) return webpError(env, "Could not decode this animated WebP.");
  int64_t duration = 0;
  bool valid_delays = true;
  do {
    duration += frame.duration;
    valid_delays = valid_delays && frame.duration >= 8;
  } while (WebPDemuxNextFrame(&frame));
  WebPDemuxReleaseIterator(&frame);
  if (duration > 10000) return webpError(env, "Animated stickers can be up to 10 seconds long.");
  // Zero-length files have no usable timeline. Avoid manufacturing an animation.
  if (duration < 16) return webpError(env, "This animation has no usable duration.");
  WebPAnimDecoderOptions options;
  WebPAnimDecoderOptionsInit(&options);
  options.color_mode = MODE_RGBA;
  options.use_threads = 1;
  reader->decoder = WebPAnimDecoderNew(&data, &options);
  if (!reader->decoder) return webpError(env, "Could not decode this animated WebP.");
  reader->passthrough = reader->width == 512 && reader->height == 512 && count > 1 &&
      size <= 500 * 1024 && valid_delays && completeRiff(data) &&
      WebPDemuxGetI(demux.get(), WEBP_FF_LOOP_COUNT) == 0 &&
      !hasTransformingMetadata(demux.get());
  const jint millis = duration;
  env->SetIntArrayRegion(metadata, 0, 1, &millis);
  if (env->GetArrayLength(metadata) >= 2) {
    const jint eligible = reader->passthrough;
    env->SetIntArrayRegion(metadata, 1, 1, &eligible);
  }
  return reinterpret_cast<jlong>(reader.release());
}

extern "C" JNIEXPORT jboolean JNICALL
Java_expo_modules_whatsappstickers_OfflineConverter_validateWebp(
    JNIEnv*, jobject, jlong handle) {
  auto* reader = reinterpret_cast<AnimationReader*>(handle);
  if (!reader || !reader->passthrough) return false;
  // Demux metadata alone does not establish that every compressed frame is
  // decodable. Validate the entire original timeline before exporting bytes.
  while (WebPAnimDecoderHasMoreFrames(reader->decoder)) {
    if (!WebPAnimDecoderGetNext(reader->decoder, &reader->pixels, &reader->timestamp)) return false;
  }
  return true;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_expo_modules_whatsappstickers_OfflineConverter_readWebp(
    JNIEnv* env, jobject, jlong handle, jint time, jobject bitmap) {
  auto* reader = reinterpret_cast<AnimationReader*>(handle);
  if (!reader || time < 0) return false;
  // GetNext returns a fully composited canvas and the end timestamp of that
  // frame, handling disposal, transparency and unequal input frame durations.
  while (!reader->pixels || reader->timestamp <= time) {
    if (!WebPAnimDecoderGetNext(reader->decoder, &reader->pixels, &reader->timestamp)) return false;
  }
  // A source frame may cover many sampled timestamps. Scale and premultiply
  // it once, retaining only one 512px canvas regardless of source dimensions.
  if (reader->canvas_timestamp != reader->timestamp) {
    WebPPicture picture;
    WebPPictureInit(&picture);
    picture.use_argb = 1;
    picture.width = reader->width;
    picture.height = reader->height;
    const int width = reader->width >= reader->height ? 512 : std::max(1, reader->width * 512 / reader->height);
    const int height = reader->height >= reader->width ? 512 : std::max(1, reader->height * 512 / reader->width);
    const bool ok = WebPPictureImportRGBA(&picture, reader->pixels, reader->width * 4) &&
                    WebPPictureRescale(&picture, width, height);
    if (!ok) {
      WebPPictureFree(&picture);
      return false;
    }
    reader->canvas.assign(512 * 512 * 4, 0);
    for (int y = 0; y < height; ++y) {
      auto* row = reader->canvas.data() + ((y + (512 - height) / 2) * 512 + (512 - width) / 2) * 4;
      for (int x = 0; x < width; ++x) {
        const uint32_t argb = picture.argb[y * picture.argb_stride + x];
        const uint32_t alpha = argb >> 24;
        row[4*x] = (((argb >> 16) & 255) * alpha + 127) / 255;
        row[4*x+1] = (((argb >> 8) & 255) * alpha + 127) / 255;
        row[4*x+2] = ((argb & 255) * alpha + 127) / 255;
        row[4*x+3] = alpha;
      }
    }
    WebPPictureFree(&picture);
    reader->canvas_timestamp = reader->timestamp;
  }
  AndroidBitmapInfo info{};
  void* pixels = nullptr;
  const bool ok = AndroidBitmap_getInfo(env, bitmap, &info) == 0 && info.width == 512 && info.height == 512 &&
       info.format == ANDROID_BITMAP_FORMAT_RGBA_8888 && AndroidBitmap_lockPixels(env, bitmap, &pixels) == 0;
  if (ok) {
    for (int y = 0; y < 512; ++y)
      std::memcpy(static_cast<uint8_t*>(pixels) + y * info.stride,
                  reader->canvas.data() + y * 512 * 4, 512 * 4);
    AndroidBitmap_unlockPixels(env, bitmap);
  }
  return ok;
}

extern "C" JNIEXPORT void JNICALL
Java_expo_modules_whatsappstickers_OfflineConverter_closeWebp(JNIEnv*, jobject, jlong handle) {
  delete reinterpret_cast<AnimationReader*>(handle);
}
