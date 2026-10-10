#include <jni.h>
#include <android/bitmap.h>
#include <webp/encode.h>
#include <webp/mux.h>
#include <vector>
#include <algorithm>

extern "C" JNIEXPORT jbyteArray JNICALL
Java_expo_modules_whatsappstickers_OfflineConverter_encode(
    JNIEnv* env, jobject, jobjectArray frames, jint step, jint duration, jfloat quality, jboolean lossless) {
  WebPConfig config;
  WebPConfigInit(&config);
  // Lossless quality controls search effort, not pixel fidelity. The old 100
  // setting ran the most expensive search for every animation frame.
  config.quality = lossless ? 25 : quality;
  config.lossless = lossless;
  config.method = lossless ? 0 : 2;
  config.thread_level = 1;
  WebPAnimEncoderOptions options;
  WebPAnimEncoderOptionsInit(&options);
  options.anim_params.loop_count = 0;
  // Short stickers loop from the beginning; extra seek keyframes only cost
  // encode time and bytes. Keep inter-frame compression enabled.
  options.kmax = 0;
  options.kmin = 0;
  const int count = env->GetArrayLength(frames);
  if (count == 0) return nullptr;
  auto* encoder = count > 1 ? WebPAnimEncoderNew(512, 512, &options) : nullptr;
  if (count > 1 && !encoder) return nullptr;
  bool ok = true;
  WebPData data;
  WebPDataInit(&data);
  std::vector<uint8_t> rgba(512 * 512 * 4);
  for (int i = 0; i < count && ok; ++i) {
    jobject bitmap = env->GetObjectArrayElement(frames, i);
    AndroidBitmapInfo info{};
    void* pixels = nullptr;
    ok = AndroidBitmap_getInfo(env, bitmap, &info) == 0 && info.width > 0 && info.width <= 512 &&
         info.height > 0 && info.height <= 512 && info.format == ANDROID_BITMAP_FORMAT_RGBA_8888 &&
         AndroidBitmap_lockPixels(env, bitmap, &pixels) == 0;
    if (ok) {
      for (int y = 0; y < static_cast<int>(info.height); ++y) {
        const auto* row = static_cast<uint8_t*>(pixels) + y * info.stride;
        for (int x = 0; x < static_cast<int>(info.width); ++x) {
          const auto* p = row + x * 4;
          auto* q = rgba.data() + (y * info.width + x) * 4;
          q[3] = p[3];
          for (int c = 0; c < 3; ++c)
            q[c] = p[3] == 255 ? p[c] : p[3] ? std::min(255, (int(p[c]) * 255 + p[3] / 2) / p[3]) : 0;
        }
      }
      AndroidBitmap_unlockPixels(env, bitmap);
      WebPPicture picture;
      WebPPictureInit(&picture);
      picture.width = info.width;
      picture.height = info.height;
      picture.use_argb = 1;
      ok = WebPPictureImportRGBA(&picture, rgba.data(), info.width * 4);
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
  WebPAnimDecoder* decoder = nullptr;
  uint8_t* pixels = nullptr;
  int timestamp = 0;
  int width = 0;
  int height = 0;
  ~AnimationReader() { WebPAnimDecoderDelete(decoder); }
};
jlong webpError(JNIEnv* env, const char* message) {
  env->ThrowNew(env->FindClass("java/lang/IllegalArgumentException"), message);
  return 0;
}
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
  do { duration += frame.duration; } while (WebPDemuxNextFrame(&frame));
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
  const jint millis = duration;
  env->SetIntArrayRegion(metadata, 0, 1, &millis);
  return reinterpret_cast<jlong>(reader.release());
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
  WebPPicture picture;
  WebPPictureInit(&picture);
  picture.use_argb = 1;
  picture.width = reader->width;
  picture.height = reader->height;
  const int width = reader->width >= reader->height ? 512 : std::max(1, reader->width * 512 / reader->height);
  const int height = reader->height >= reader->width ? 512 : std::max(1, reader->height * 512 / reader->width);
  bool ok = WebPPictureImportRGBA(&picture, reader->pixels, reader->width * 4) &&
            WebPPictureRescale(&picture, width, height);
  AndroidBitmapInfo info{};
  void* pixels = nullptr;
  ok = ok && AndroidBitmap_getInfo(env, bitmap, &info) == 0 && info.width == 512 && info.height == 512 &&
       info.format == ANDROID_BITMAP_FORMAT_RGBA_8888 && AndroidBitmap_lockPixels(env, bitmap, &pixels) == 0;
  if (ok) {
    std::memset(pixels, 0, info.stride * info.height);
    for (int y = 0; y < height; ++y) {
      auto* row = static_cast<uint8_t*>(pixels) + (y + (512 - height) / 2) * info.stride + (512 - width) / 2 * 4;
      for (int x = 0; x < width; ++x) {
        const uint32_t argb = picture.argb[y * picture.argb_stride + x];
        const uint32_t alpha = argb >> 24;
        row[4*x] = (((argb >> 16) & 255) * alpha + 127) / 255;
        row[4*x+1] = (((argb >> 8) & 255) * alpha + 127) / 255;
        row[4*x+2] = ((argb & 255) * alpha + 127) / 255;
        row[4*x+3] = alpha;
      }
    }
    AndroidBitmap_unlockPixels(env, bitmap);
  }
  WebPPictureFree(&picture);
  return ok;
}

extern "C" JNIEXPORT void JNICALL
Java_expo_modules_whatsappstickers_OfflineConverter_closeWebp(JNIEnv*, jobject, jlong handle) {
  delete reinterpret_cast<AnimationReader*>(handle);
}
