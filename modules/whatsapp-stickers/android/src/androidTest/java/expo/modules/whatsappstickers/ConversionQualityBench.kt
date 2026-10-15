package expo.modules.whatsappstickers

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.os.SystemClock
import android.util.Base64
import org.json.JSONObject
import java.io.File
import kotlin.math.log10
import kotlin.math.max

/** Deterministic visual fixtures, also runnable against the previous fitter. */
internal object ConversionQualityBench {
  fun run(context: Context, baseline: Boolean): String {
    val root = File(context.cacheDir, "quality-test").apply { mkdirs() }
    val metrics = JSONObject()
    val random = java.util.Random(901)
    val pixels = IntArray(512 * 512) { index ->
      val x = index % 512
      val y = index / 512
      if (x !in 24..487 || y !in 24..487) Color.TRANSPARENT
      else Color.rgb((x / 3 + random.nextInt(65)).coerceAtMost(255),
        (y / 3 + random.nextInt(65)).coerceAtMost(255), random.nextInt(96) + 80)
    }
    val artwork = Bitmap.createBitmap(512, 512, Bitmap.Config.ARGB_8888).apply { setPixels(pixels, 0, 512, 0, 0, 512, 512) }
    try {
      val canvas = Canvas(artwork)
      val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.MAGENTA; textSize = 112f; isFakeBoldText = true }
      canvas.drawText("PEEL", 80f, 270f, paint)
      paint.color = Color.CYAN
      paint.strokeWidth = 2f
      for (line in 0 until 30) canvas.drawLine(40f, 320f + line * 4, 470f, 322f + line * 4, paint)
      val source = File(root, "artwork.png")
      source.outputStream().use { artwork.compress(Bitmap.CompressFormat.PNG, 100, it) }
      val started = SystemClock.elapsedRealtime()
      val result = OfflineConverter.convert(context, source.toURI().toString(), 0.0, 0.0)
      val elapsed = SystemClock.elapsedRealtime() - started
      val bytes = Base64.decode(result["data"] as String, Base64.DEFAULT)
      File(root, "artwork.webp").writeBytes(bytes)
      check(bytes.size <= 100 * 1024)
      val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
      try {
        var squaredError = 0.0
        var edgeError = 0.0
        var alphaError = 0
        var edgeSamples = 0
        for (y in 0 until 512) for (x in 0 until 512) {
          val expected = artwork.getPixel(x, y)
          val actual = decoded.getPixel(x, y)
          alphaError = max(alphaError, kotlin.math.abs(Color.alpha(expected) - Color.alpha(actual)))
          for (background in listOf(0, 255)) for (shift in listOf(0, 8, 16)) {
            fun composite(pixel: Int): Int {
              val alpha = Color.alpha(pixel)
              return (((pixel shr shift) and 255) * alpha + background * (255 - alpha) + 127) / 255
            }
            val delta = composite(expected) - composite(actual)
            squaredError += delta * delta
            if (y in 150..445) { edgeError += delta * delta; edgeSamples++ }
          }
        }
        check(alphaError == 0) { "Full-resolution artwork changed alpha." }
        metrics.put("artwork", JSONObject().put("bytes", bytes.size).put("ms", elapsed)
          .put("psnr", 10 * log10(255.0 * 255 * 512 * 512 * 6 / squaredError))
          .put("edgePsnr", 10 * log10(255.0 * 255 * edgeSamples / edgeError)).put("maxAlphaError", alphaError))
      } finally { decoded.recycle() }
    } finally { artwork.recycle() }

    val frames = Array(18) { index ->
      Bitmap.createBitmap(512, 512, Bitmap.Config.ARGB_8888).also { frame ->
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(160, 255, 0, 128) }
        Canvas(frame).drawCircle(45f + index * 24, 256f, 36f, paint)
      }
    }
    try {
      val nativeEncode = OfflineConverter::class.java.getDeclaredMethod("encode", Array<Bitmap>::class.java,
        Int::class.javaPrimitiveType, Int::class.javaPrimitiveType, Float::class.javaPrimitiveType, Boolean::class.javaPrimitiveType).apply { isAccessible = true }
      val original = nativeEncode.invoke(OfflineConverter, frames, 16, 288, 100f, true) as ByteArray
      val source = File(root, "motion.webp").apply { writeBytes(original) }
      val started = SystemClock.elapsedRealtime()
      val stages = mutableListOf<String>()
      val result = OfflineConverter.convert(context, source.toURI().toString(), 0.0, 0.0) { stages.add(it) }
      val conversionMs = SystemClock.elapsedRealtime() - started
      val bytes = Base64.decode(result["data"] as String, Base64.DEFAULT)
      File(root, "motion-output.webp").writeBytes(bytes)
      var offset = 12
      var count = 0
      var duration = 0
      fun le(start: Int, length: Int) = (0 until length).sumOf { (bytes[start + it].toInt() and 255) shl (it * 8) }
      while (offset + 8 <= bytes.size) {
        val size = le(offset + 4, 4)
        if (String(bytes, offset, 4, Charsets.US_ASCII) == "ANMF") { count++; duration += le(offset + 20, 3) }
        offset += 8 + size + (size and 1)
      }
      check(duration == 288)
      if (!baseline) {
        check(original.contentEquals(bytes)) { "Compliant WebP lost original pixels or timing." }
        check(stages.none { it == "Encoding…" }) { "Compliant WebP was re-encoded." }
        check(count == 18)
        val open = OfflineConverter::class.java.getDeclaredMethod("openWebp", ByteArray::class.java, IntArray::class.java).apply { isAccessible = true }
        val close = OfflineConverter::class.java.getDeclaredMethod("closeWebp", Long::class.javaPrimitiveType).apply { isAccessible = true }
        fun eligible(candidate: ByteArray): Boolean {
          val metadata = IntArray(2)
          val handle = open.invoke(OfflineConverter, candidate, metadata) as Long
          try { return metadata[1] == 1 } finally { close.invoke(OfflineConverter, handle) }
        }
        check(eligible(original))
        var chunk = 12
        var firstFrame = -1
        var lastFrame = -1
        var animation = -1
        while (chunk + 8 <= original.size) {
          val size = (0 until 4).sumOf { (original[chunk + 4 + it].toInt() and 255) shl (it * 8) }
          when (String(original, chunk, 4, Charsets.US_ASCII)) {
            "ANIM" -> animation = chunk
            "ANMF" -> { if (firstFrame < 0) firstFrame = chunk; lastFrame = chunk }
          }
          chunk += 8 + size + (size and 1)
        }
        val finiteLoop = original.copyOf().apply { this[animation + 12] = 1 }
        check(!eligible(finiteLoop)) { "Finite loops must use the normalization path." }
        val shortDelay = original.copyOf().apply { this[firstFrame + 20] = 7 }
        check(!eligible(shortDelay)) { "Sub-8ms frames must use the normalization path." }
        val trailing = original.copyOf(original.size + 1)
        check(!eligible(trailing)) { "Trailing container data must not pass through." }
        val corrupt = original.copyOf().apply {
          // Keep RIFF/ANMF boundaries intact but invalidate the final VP8L
          // bitstream. Earlier frames must not hide a corrupt later frame.
          for (index in lastFrame + 37 until size) this[index] = 0
        }
        check(eligible(corrupt)) { "Corrupt fixture must retain valid container metadata." }
        val corruptFile = File(root, "corrupt-late.webp").apply { writeBytes(corrupt) }
        check(runCatching { OfflineConverter.convert(context, corruptFile.toURI().toString(), 0.0, 0.0) }.isFailure) {
          "Passthrough accepted a corrupt late frame."
        }
      }
      metrics.put("motion", JSONObject().put("bytes", bytes.size).put("ms", SystemClock.elapsedRealtime() - started)
        .put("conversionMs", conversionMs).put("frames", count).put("duration", duration).put("exact", original.contentEquals(bytes)))
    } finally { frames.forEach { it.recycle() } }
    val noisyFrames = Array(12) { index ->
      val noise = java.util.Random(700L + index)
      Bitmap.createBitmap(IntArray(512 * 512) { Color.rgb(noise.nextInt(256), noise.nextInt(256), noise.nextInt(256)) },
        512, 512, Bitmap.Config.ARGB_8888)
    }
    try {
      File(root, "noise.png").outputStream().use { noisyFrames[0].compress(Bitmap.CompressFormat.PNG, 100, it) }
      val started = SystemClock.elapsedRealtime()
      val fitted = OfflineConverter.fitToLimit(noisyFrames, 67, 804) {}
      File(root, "noise.webp").writeBytes(fitted)
      val decoded = BitmapFactory.decodeByteArray(fitted, 0, fitted.size)
      var error = 0.0
      try {
        for (y in 0 until 512) for (x in 0 until 512) for (shift in listOf(0, 8, 16)) {
          val delta = ((noisyFrames[0].getPixel(x, y) shr shift) and 255) - ((decoded.getPixel(x, y) shr shift) and 255)
          error += delta * delta
        }
      } finally { decoded.recycle() }
      var offset = 12
      var frameCount = 0
      while (offset + 8 <= fitted.size) {
        val size = (0 until 4).sumOf { (fitted[offset + 4 + it].toInt() and 255) shl (it * 8) }
        if (String(fitted, offset, 4, Charsets.US_ASCII) == "ANMF") frameCount++
        offset += 8 + size + (size and 1)
      }
      metrics.put("noise", JSONObject().put("bytes", fitted.size).put("ms", SystemClock.elapsedRealtime() - started)
        .put("frames", frameCount).put("psnr", 10 * log10(255.0 * 255 * 512 * 512 * 3 / error)))
      val nativeEncode = OfflineConverter::class.java.getDeclaredMethod("encode", Array<Bitmap>::class.java,
        Int::class.javaPrimitiveType, Int::class.javaPrimitiveType, Float::class.javaPrimitiveType, Boolean::class.javaPrimitiveType).apply { isAccessible = true }
      val staticFrame = BitmapFactory.decodeFile(File(root, "artwork.png").path)
      val staticBytes = try { nativeEncode.invoke(OfflineConverter, arrayOf(staticFrame), 100, 100, 30f, false) as ByteArray }
        finally { staticFrame.recycle() }
      check(staticBytes.size <= 100 * 1024)
      val staticSource = File(root, "static-source.webp").apply { writeBytes(staticBytes) }
      val staticStarted = SystemClock.elapsedRealtime()
      val staticResult = OfflineConverter.convert(context, staticSource.toURI().toString(), 0.0, 0.0)
      val staticElapsed = SystemClock.elapsedRealtime() - staticStarted
      val staticOutput = Base64.decode(staticResult["data"] as String, Base64.DEFAULT)
      File(root, "static-output.webp").writeBytes(staticOutput)
      if (!baseline) {
        check(staticBytes.contentEquals(staticOutput)) { "Compliant still WebP was re-encoded." }
        val checkStatic = OfflineConverter::class.java.getDeclaredMethod("compliantStaticWebp", ByteArray::class.java).apply { isAccessible = true }
        check(checkStatic.invoke(OfflineConverter, staticBytes.copyOf(staticBytes.size + 1)) == false)
      }
      metrics.put("static", JSONObject().put("bytes", staticOutput.size).put("ms", staticElapsed)
        .put("exact", staticBytes.contentEquals(staticOutput)))
    } finally { noisyFrames.forEach { it.recycle() } }
    File(root, "metrics.json").writeText(metrics.toString(2))
    return metrics.toString(2)
  }
}
