package expo.modules.whatsappstickers

import android.app.Instrumentation
import android.app.Activity
import android.os.Bundle
import android.os.SystemClock
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.util.Base64
import java.io.File

class ConverterInstrumentation : Instrumentation() {
  override fun onCreate(arguments: Bundle?) { super.onCreate(arguments); start() }
  override fun onStart() {
    val results = Bundle()
    val timings = StringBuilder()
    try {
      val root = File(targetContext.cacheDir, "converter-test").apply { mkdirs() }
      val photo = File(root, "photo.png")
      val bitmap = Bitmap.createBitmap(1200, 600, Bitmap.Config.ARGB_8888)
      bitmap.eraseColor(Color.RED)
      photo.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
      bitmap.recycle()
      fun checkFile(file: File, animated: Boolean, clip: Double = 0.0): ByteArray {
        val started = SystemClock.elapsedRealtime()
        val result = OfflineConverter.convert(targetContext, file.toURI().toString(), 0.0, clip)
        timings.append("${file.name}: ${SystemClock.elapsedRealtime() - started} ms, ${result["bytes"]} bytes\n")
        check(result["animated"] == animated) { "Wrong animation flag for ${file.name}" }
        val bytes = Base64.decode(result["data"] as String, Base64.DEFAULT)
        check(bytes.size <= if (animated) 500 * 1024 else 100 * 1024)
        val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        check(decoded.width == 512 && decoded.height == 512)
        if (!animated) {
          check(Color.alpha(decoded.getPixel(0, 0)) == 0)
          check(Color.red(decoded.getPixel(256, 256)) > 240)
        }
        decoded.recycle()
        val tray = Base64.decode(result["tray"] as String, Base64.DEFAULT)
        val icon = BitmapFactory.decodeByteArray(tray, 0, tray.size)
        check(icon.width == 96 && icon.height == 96)
        icon.recycle()
        File(root, "${file.name}.webp").writeBytes(bytes)
        return bytes
      }
      checkFile(photo, false)
      for (name in listOf("animated.gif", "clip.mp4", "detailed.gif")) {
        val file = File(root, name)
        context.assets.open(name).use { source -> file.outputStream().use { source.copyTo(it) } }
        checkFile(file, true, if (name.endsWith("mp4")) 1.0 else 0.0)
      }
      fun animationDuration(bytes: ByteArray): Int {
        fun le(offset: Int, count: Int): Int = (0 until count).sumOf { (bytes[offset + it].toInt() and 255) shl (it * 8) }
        var offset = 12
        var duration = 0
        while (offset + 8 <= bytes.size) {
          val size = le(offset + 4, 4)
          check(size >= 0 && offset + 8L + size <= bytes.size)
          if (String(bytes, offset, 4, Charsets.US_ASCII) == "ANMF") duration += le(offset + 20, 3)
          offset += 8 + size + (size and 1)
        }
        return duration
      }
      // Reimport actual animated WebP output, including unequal frame timing.
      val webpSource = File(root, "animated.gif.webp")
      val webpBytes = webpSource.readBytes()
      var chunk = 12
      while (chunk + 24 <= webpBytes.size) {
        val size = (0 until 4).sumOf { (webpBytes[chunk + 4 + it].toInt() and 255) shl (it * 8) }
        if (String(webpBytes, chunk, 4, Charsets.US_ASCII) == "ANMF") {
          webpBytes[chunk + 20] = 231.toByte()
          webpBytes[chunk + 21] = 0
          webpBytes[chunk + 22] = 0
          break
        }
        chunk += 8 + size + (size and 1)
      }
      webpSource.writeBytes(webpBytes)
      val reimported = checkFile(webpSource, true)
      check(animationDuration(reimported) == animationDuration(webpBytes)) { "WebP import changed duration." }
      val malformedWebp = File(root, "broken.webp").apply { writeBytes(webpBytes.copyOf(40)) }
      check(runCatching { OfflineConverter.convert(targetContext, malformedWebp.toURI().toString(), 0.0, 0.0) }.isFailure)
      val longWebp = webpBytes.copyOf()
      longWebp[chunk + 20] = 0x10
      longWebp[chunk + 21] = 0x27 // 10,000 ms plus all the remaining frames.
      val longFile = File(root, "long.webp").apply { writeBytes(longWebp) }
      check(runCatching { OfflineConverter.convert(targetContext, longFile.toURI().toString(), 0.0, 0.0) }.isFailure)
      // A successful lossless encode over the JNI transfer cap used to return
      // null, indistinguishable from a codec failure. Exercise the actual cap.
      val noisyFrames = Array(12) {
        val random = java.util.Random(700L + it)
        val pixels = IntArray(512 * 512) { Color.rgb(random.nextInt(256), random.nextInt(256), random.nextInt(256)) }
        Bitmap.createBitmap(pixels, 512, 512, Bitmap.Config.ARGB_8888)
      }
      try {
        val nativeEncode = OfflineConverter::class.java.getDeclaredMethod("encode", Array<Bitmap>::class.java,
          Int::class.javaPrimitiveType, Int::class.javaPrimitiveType, Float::class.javaPrimitiveType, Boolean::class.javaPrimitiveType)
        nativeEncode.isAccessible = true
        val oversized = nativeEncode.invoke(OfflineConverter, noisyFrames, 67, 804, 100f, true)
        check(oversized is ByteArray && oversized.isEmpty()) { "Oversized successful encode must request a compression retry." }
        // These frames cannot fit using the old quality-only ladder. Exercise
        // the real native fallback and inspect WebP timing, not just byte size.
        val stages = mutableListOf<String>()
        val started = SystemClock.elapsedRealtime()
        val fitted = OfflineConverter.fitToLimit(noisyFrames, 67, 804) { stages.add(it) }
        check(stages.contains("Optimizing for WhatsApp…")) { "Fixture must exercise adaptive transcoding." }
        check(fitted.size <= 500 * 1024)
        val decoded = BitmapFactory.decodeByteArray(fitted, 0, fitted.size)
        check(decoded.width == 512 && decoded.height == 512)
        decoded.recycle()
        fun le24(offset: Int) = (fitted[offset].toInt() and 255) or
          ((fitted[offset + 1].toInt() and 255) shl 8) or ((fitted[offset + 2].toInt() and 255) shl 16)
        var offset = 12
        var frameCount = 0
        var totalDuration = 0
        while (offset + 8 <= fitted.size) {
          val tag = String(fitted, offset, 4, Charsets.US_ASCII)
          val size = le24(offset + 4) or ((fitted[offset + 7].toInt() and 255) shl 24)
          check(size >= 0 && offset + 8L + size <= fitted.size)
          if (tag == "ANMF") {
            val delay = le24(offset + 20)
            check(delay >= 8)
            totalDuration += delay
            frameCount++
          }
          if (tag == "ANIM") check(fitted[offset + 12].toInt() == 0 && fitted[offset + 13].toInt() == 0)
          offset += 8 + size + (size and 1)
        }
        check(frameCount >= 2) { "Fallback must not flatten animation." }
        check(totalDuration == 804) { "Fallback changed duration: $totalDuration" }
        File(root, "adaptive.webp").writeBytes(fitted)
        timings.append("adaptive noise: ${SystemClock.elapsedRealtime() - started} ms, ${fitted.size} bytes, $frameCount frames, $totalDuration ms\n")
        val alphaRandom = java.util.Random(17)
        val alphaPixels = IntArray(512 * 512) { Color.argb(alphaRandom.nextInt(256), alphaRandom.nextInt(256), alphaRandom.nextInt(256), alphaRandom.nextInt(256)) }
        val alphaPhoto = Bitmap.createBitmap(alphaPixels, 512, 512, Bitmap.Config.ARGB_8888)
        try {
          val alphaStages = mutableListOf<String>()
          val still = OfflineConverter.fitToLimit(arrayOf(alphaPhoto), 100, 100) { alphaStages.add(it) }
          check(alphaStages.contains("Optimizing for WhatsApp…"))
          check(still.size <= 100 * 1024)
          val image = BitmapFactory.decodeByteArray(still, 0, still.size)
          check(image.width == 512 && image.height == 512 && image.hasAlpha())
          image.recycle()
          timings.append("adaptive alpha photo: ${still.size} bytes\n")
        } finally { alphaPhoto.recycle() }

      } finally { noisyFrames.forEach { it.recycle() } }
      val corrupt = File(root, "corrupt.png").apply { writeText("not an image") }
      check(runCatching { OfflineConverter.convert(targetContext, corrupt.toURI().toString(), 0.0, 0.0) }.isFailure)
      check(runCatching { OfflineConverter.convert(targetContext, File(root, "clip.mp4").toURI().toString(), 20.0, 1.0) }.isFailure)
      results.putString("stream", timings.toString() + "PASS: offline photo, GIF, animated WebP with unequal timing, corrupt WebP, long WebP rejection, video, detailed GIF compression fallback, dimensions, transparency, tray, byte limits, corrupt input and invalid clip range.\n")
      finish(Activity.RESULT_OK, results)
    } catch (error: Throwable) {
      results.putString("stream", error.stackTraceToString())
      finish(Activity.RESULT_CANCELED, results)
    }
  }
}
