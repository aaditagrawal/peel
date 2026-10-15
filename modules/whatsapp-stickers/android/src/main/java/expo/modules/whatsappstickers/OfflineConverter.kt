package expo.modules.whatsappstickers

import android.content.Context
import android.graphics.*
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.util.Base64
import java.io.ByteArrayOutputStream
import kotlin.math.*

/** Bounded, on-device conversion. No network or shared storage is used. */
object OfflineConverter {
  init { System.loadLibrary("peelwebp") }
  private external fun encode(frames: Array<Bitmap>, step: Int, duration: Int, quality: Float, lossless: Boolean): ByteArray?

  private external fun openWebp(bytes: ByteArray, metadata: IntArray): Long
  private external fun readWebp(handle: Long, time: Int, bitmap: Bitmap): Boolean
  private external fun validateWebp(handle: Long): Boolean
  private external fun compliantStaticWebp(bytes: ByteArray): Boolean
  private external fun closeWebp(handle: Long)

  private fun square(source: Bitmap): Bitmap {
    val output = Bitmap.createBitmap(512, 512, Bitmap.Config.ARGB_8888)
    val scale = min(512f / source.width, 512f / source.height)
    val w = source.width * scale
    val h = source.height * scale
    Canvas(output).drawBitmap(source, null, RectF((512-w)/2, (512-h)/2, (512+w)/2, (512+h)/2), Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG))
    return output
  }

  /** Keep the ordinary full-detail path, then adapt only media that cannot fit.
   * Sampling spans the original timeline; neither playback speed nor duration changes.
   * Down/up-sampling removes expensive fine detail without shrinking the sticker artwork.
   */
  internal fun fitToLimit(array: Array<Bitmap>, step: Int, duration: Int, progress: (String) -> Unit): ByteArray {
    val limit = if (array.size > 1) 500 * 1024 else 100 * 1024
    var encoded: ByteArray? = null
    fun byteLimit(candidate: ByteArray): Int {
      val hasAnimation = candidate.size > 20 && String(candidate, 12, 4, Charsets.US_ASCII) == "VP8X" && (candidate[20].toInt() and 2) != 0
      return if (hasAnimation) limit else 100 * 1024
    }
    fun fits(candidate: ByteArray): Boolean {
      // JNI uses an empty result for a valid encode above its 8 MiB transfer
      // budget. Detailed GIFs must still reach the lossy compression passes.
      if (candidate.isEmpty()) return false
      return candidate.size <= byteLimit(candidate)
    }
    progress("Encoding…")
    val lossless = encode(array, step, duration, 100f, true) ?: error("Could not encode this sticker.")
    if (fits(lossless)) encoded = lossless
    else {
      // Keep the best valid result. Bound expensive full-animation passes,
      // using measured size to choose the next quality instead of nine rungs.
      var low = 30
      var high = 95
      var quality = high
      var fittedQuality = -1
      var fittedSize = 0
      var oversizedQuality = high
      var oversizedSize = 0
      for (attempt in 0 until 4) {
        progress(if (attempt == 0) "Encoding…" else "Fitting to WhatsApp…")
        val candidate = encode(array, step, duration, quality.toFloat(), false) ?: error("Could not encode this sticker.")
        if (fits(candidate)) {
          if (quality > fittedQuality) {
            encoded = candidate
            fittedQuality = quality
            fittedSize = candidate.size
          }
          low = quality + 1
        } else {
          high = quality - 1
          if (candidate.isNotEmpty()) {
            oversizedQuality = quality
            oversizedSize = candidate.size
          }
        }
        if (low > high) break
        quality = if (attempt == 2 && encoded == null) low
          else if (attempt == 0 && encoded == null) (quality * sqrt(byteLimit(candidate).toDouble() / (if (candidate.isEmpty()) 8 * 1024 * 1024 else candidate.size))).toInt().coerceIn(low, high)
          // File size is a heuristic for the next probe, never a fit test.
          // Once both sides are measured, spend remaining passes near the
          // byte cap rather than repeatedly bisecting unused quality points.
          else if (fittedSize > 0 && oversizedSize > fittedSize && oversizedQuality > fittedQuality)
            (fittedQuality + (oversizedQuality - fittedQuality) * ln(byteLimit(candidate).toDouble() / fittedSize) /
              ln(oversizedSize.toDouble() / fittedSize)).roundToInt().coerceIn(low, high)
          else (low + high) / 2
      }
    }

    if (encoded != null) return encoded
    val animated = array.size > 1
    // One encode per rung, bounded in memory and work. Keep moderate quality
    // instead of making full-resolution frames unreadable at near-zero quality.
    val profiles = listOf(384 to 12, 320 to 12, 256 to 10, 192 to 8, 128 to 6, 64 to 3, 32 to 2)
    for ((detail, fps) in profiles) {
      progress("Optimizing for WhatsApp…")
      val count = if (animated) min(array.size, max(2, duration * fps / 1000)) else 1
      val indices = IntArray(count) { it * array.size / count }
      // If regular sampling misses a brief blink/movement entirely, retain a
      // changed frame in the closest non-first slot instead of flattening it.
      if (animated && indices.all { array[it].sameAs(array[0]) }) {
        val changed = array.indices.firstOrNull { !array[it].sameAs(array[0]) }
        if (changed != null) indices[(changed * count / array.size).coerceIn(1, count - 1)] = changed
      }
      val reduced = mutableListOf<Bitmap>()
      try {
        for (i in 0 until count) {
          val source = array[indices[i]]
          // JNI restores the 512px canvas one frame at a time, so fallback
          // does not allocate another full-resolution animation in memory.
          reduced.add(Bitmap.createScaledBitmap(source, detail, detail, true))
        }
        val candidate = encode(reduced.toTypedArray(), max(8, duration / count), duration, 60f, false)
          ?: error("Could not encode this sticker.")
        if (fits(candidate)) return candidate
      } finally { reduced.forEach { it.recycle() } }
    }
    error("Could not fit this file into a sticker. Try importing it again.")
  }

  @Synchronized
  fun convert(context: Context, uriString: String, start: Double, length: Double, progress: (String) -> Unit = {}): Map<String, Any> {
    progress("Reading file…")
    val uri = Uri.parse(uriString)
    require(uri.scheme == "file" || uri.scheme == "content") { "Choose a file from your device." }
    val frames = mutableListOf<Bitmap>()
    var step = 100
    var duration = 100
    var originalWebp: ByteArray? = null
    try {
      if (length > 0) {
        require(start.isFinite() && start >= 0 && length.isFinite() && length in 1.0..6.0) { "Choose a clip between 1 and 6 seconds." }
        val retriever = MediaMetadataRetriever()
        try {
          retriever.setDataSource(context, uri)
          val total = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: error("Could not read this video's duration.")
          require(start * 1000 < total) { "The clip starts after the video ends." }
          duration = min((length * 1000).roundToInt(), total.toInt() - (start * 1000).roundToInt())
          require(duration >= 100) { "Choose a longer clip." }
          val count = max(2, (duration / 67.0).roundToInt())
          step = duration / count
          for (i in 0 until count) {
            if (i % 5 == 0) progress("Reading frames ${i + 1}/$count")
            val time = (start * 1_000_000).toLong() + i * step * 1000L
            val bitmap = if (Build.VERSION.SDK_INT >= 27)
              retriever.getScaledFrameAtTime(time, MediaMetadataRetriever.OPTION_CLOSEST, 512, 512)
            else retriever.getFrameAtTime(time, MediaMetadataRetriever.OPTION_CLOSEST)
            requireNotNull(bitmap) { "Android could not decode this video. Try an MP4 or a different clip." }
            try { frames.add(square(bitmap)) } finally { bitmap.recycle() }
          }
        } finally { retriever.release() }
      } else {
        val bytes = context.contentResolver.openInputStream(uri)?.use { stream ->
          val output = ByteArrayOutputStream()
          val buffer = ByteArray(64 * 1024)
          while (true) {
            val size = stream.read(buffer)
            if (size < 0) break
            require(output.size() + size <= 50 * 1024 * 1024) { "Images must be smaller than 50 MB." }
            output.write(buffer, 0, size)
          }
          output.toByteArray()
        } ?: error("Could not open this file.")
        val isGif = bytes.size >= 10 && String(bytes, 0, 3, Charsets.US_ASCII) == "GIF"
        if (isGif) {
          val width = (bytes[6].toInt() and 255) or ((bytes[7].toInt() and 255) shl 8)
          val height = (bytes[8].toInt() and 255) or ((bytes[9].toInt() and 255) shl 8)
          require(width.toLong() * height <= 16_000_000) { "This GIF is too large to process. Choose one below 16 megapixels." }
          @Suppress("DEPRECATION")
          val movie = Movie.decodeByteArray(bytes, 0, bytes.size) ?: error("Could not decode this GIF.")
          require(movie.width() > 0 && movie.height() > 0) { "This GIF has invalid dimensions." }
          duration = movie.duration().coerceAtLeast(100)
          require(duration <= 10_000) { "GIF stickers can be up to 10 seconds long." }
          val count = max(2, (duration / 67.0).roundToInt())
          step = max(8, duration / count)
          val scale = min(512f / movie.width(), 512f / movie.height())
          for (i in 0 until count) {
            if (i % 5 == 0) progress("Reading frames ${i + 1}/$count")
            val frame = Bitmap.createBitmap(512, 512, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(frame)
            canvas.translate((512 - movie.width() * scale) / 2, (512 - movie.height() * scale) / 2)
            canvas.scale(scale, scale)
            movie.setTime(i * step)
            movie.draw(canvas, 0f, 0f, Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG))
            frames.add(frame)
          }
        } else {
          // Decode composite animation frames locally, preserving the full timeline.
          val animatedWebp = bytes.size > 20 && String(bytes, 8, 4, Charsets.US_ASCII) == "WEBP" && String(bytes, 12, 4, Charsets.US_ASCII) == "VP8X" && (bytes[20].toInt() and 2) != 0
          if (animatedWebp) {
            val metadata = IntArray(2)
            val handle = openWebp(bytes, metadata)
            require(handle != 0L) { "Could not decode this animated WebP." }
            try {
              duration = metadata[0]
              if (metadata[1] == 1) {
                // Keep compliant media's exact pixels and frame delays. Decode
                // every frame before trusting its metadata, retaining only
                // the first composited frame for the tray icon.
                val frame = Bitmap.createBitmap(512, 512, Bitmap.Config.ARGB_8888)
                frames.add(frame)
                require(readWebp(handle, 0, frame) && validateWebp(handle)) { "Could not decode this animated WebP." }
                originalWebp = bytes
              } else {
                val count = max(2, (duration / 67.0).roundToInt())
                step = max(8, duration / count)
                for (i in 0 until count) {
                  if (i % 5 == 0) progress("Reading frames ${i + 1}/$count")
                  val frame = Bitmap.createBitmap(512, 512, Bitmap.Config.ARGB_8888)
                  frames.add(frame)
                  require(readWebp(handle, i * step, frame)) { "Could not decode this animated WebP." }
                }
              }
            } finally { closeWebp(handle) }
          } else {
            val bitmap = if (Build.VERSION.SDK_INT >= 28) {
              ImageDecoder.decodeBitmap(ImageDecoder.createSource(java.nio.ByteBuffer.wrap(bytes))) { decoder, info, _ ->
                require(info.size.width.toLong() * info.size.height <= 250_000_000) { "Images must be below 250 megapixels." }
                decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                decoder.setTargetColorSpace(ColorSpace.get(ColorSpace.Named.SRGB))
                val scale = min(1.0, 512.0 / max(info.size.width, info.size.height))
                decoder.setTargetSize(max(1, (info.size.width * scale).roundToInt()), max(1, (info.size.height * scale).roundToInt()))
              }
            } else {
              val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
              BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
              require(options.outWidth.toLong() * options.outHeight <= 250_000_000) { "Images must be below 250 megapixels." }
              options.inJustDecodeBounds = false
              options.inSampleSize = max(1, max(options.outWidth, options.outHeight) / 1024)
              BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options) ?: error("Unsupported image. Try a JPEG, PNG, GIF, HEIC or WebP.")
            }
            try {
              frames.add(square(bitmap))
              if (bitmap.width == 512 && bitmap.height == 512 && bytes.size <= 100 * 1024 &&
                bytes.size >= 12 && String(bytes, 8, 4, Charsets.US_ASCII) == "WEBP" && compliantStaticWebp(bytes)) {
                originalWebp = bytes
              }
            } finally { bitmap.recycle() }
          }
        }
      }
      val result = originalWebp ?: fitToLimit(frames.toTypedArray(), step, duration, progress)
      val animated = result.size > 20 && String(result, 12, 4, Charsets.US_ASCII) == "VP8X" && (result[20].toInt() and 2) != 0
      require(animated || result.size <= 100 * 1024) { "This still image is too detailed for WhatsApp. Choose a simpler image." }
      val trayBitmap = Bitmap.createScaledBitmap(frames.first(), 96, 96, true)
      progress("Finishing…")
      val tray = ByteArrayOutputStream()
      try { trayBitmap.compress(Bitmap.CompressFormat.PNG, 100, tray) } finally { trayBitmap.recycle() }
      return mapOf("data" to Base64.encodeToString(result, Base64.NO_WRAP), "tray" to Base64.encodeToString(tray.toByteArray(), Base64.NO_WRAP), "animated" to animated, "bytes" to result.size)
    } finally { frames.forEach { it.recycle() } }
  }
}
