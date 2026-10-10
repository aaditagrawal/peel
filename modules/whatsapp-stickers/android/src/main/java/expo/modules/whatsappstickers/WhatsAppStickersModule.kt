package expo.modules.whatsappstickers

import android.app.Activity
import android.content.Intent
import expo.modules.kotlin.Promise
import java.util.concurrent.atomic.AtomicReference
import android.util.Base64
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject
import java.io.File

class WhatsAppStickersModule : Module() {
  private val pendingImport = AtomicReference<Promise?>(null)
  private val importRequest = 0x5045
  override fun definition() = ModuleDefinition {
    Name("WhatsAppStickers")
    Events("conversionProgress")
    AsyncFunction("convert") { uri: String, start: Double, duration: Double ->
      val context = appContext.reactContext ?: error("App is not ready.")
      OfflineConverter.convert(context, uri, start, duration) { stage ->
        sendEvent("conversionProgress", mapOf("uri" to uri, "stage" to stage))
      }
    }
    OnActivityResult { _, result ->
      if (result.requestCode == importRequest) {
        val promise = pendingImport.getAndSet(null)
        val validation = result.data?.getStringExtra("validation_error")?.trim()
        if (!validation.isNullOrEmpty()) {
          promise?.reject("ERR_WHATSAPP_VALIDATION", "WhatsApp could not add this pack: ${validation.take(180)}", null)
        } else promise?.resolve(result.resultCode == Activity.RESULT_OK)
      }
    }
    OnDestroy {
      pendingImport.getAndSet(null)?.reject("ERR_IMPORT_INTERRUPTED", "WhatsApp import was interrupted. Please try again.", null)
    }
    AsyncFunction("addPack") { payload: String, promise: Promise ->
      check(pendingImport.get() == null) { "Finish the current WhatsApp import first." }
      val activity = appContext.currentActivity ?: error("Open Peel before importing this pack.")
      val context = appContext.reactContext ?: error("App is not ready.")
      val pack = JSONObject(payload)
      val id = pack.getString("identifier")
      require(id.matches(Regex("[a-zA-Z0-9_-]{1,100}"))) { "Invalid pack identifier." }
      val stickers = pack.getJSONArray("stickers")
      require(stickers.length() in 3..30) { "A pack needs 3 to 30 stickers." }
      val root = File(context.filesDir, "whatsapp-stickers").apply { mkdirs() }
      val directory = File(root, id).apply { mkdirs() }
      val tray = Base64.decode(pack.getString("tray_image"), Base64.DEFAULT)
      require(tray.size <= 50 * 1024) { "Tray image is too large." }
      File(directory, "tray.png").writeBytes(tray)
      for (i in 0 until stickers.length()) {
        val sticker = stickers.getJSONObject(i)
        val bytes = Base64.decode(sticker.getString("image_data"), Base64.DEFAULT)
        val max = if (pack.optBoolean("animated_sticker_pack")) 500 * 1024 else 100 * 1024
        require(bytes.size <= max) { "Sticker is too large." }
        val filename = "$i.webp"
        File(directory, filename).writeBytes(bytes)
        sticker.put("image_file", filename)
        sticker.remove("image_data")
      }
      pack.remove("tray_image")
      pack.put("image_data_version", System.currentTimeMillis().toString())
      val temp = File(directory, "pack.tmp")
      temp.writeText(pack.toString())
      require(temp.renameTo(File(directory, "pack.json"))) { "Could not save the sticker pack." }
      val intent = Intent("com.whatsapp.intent.action.ENABLE_STICKER_PACK").apply {
        putExtra("sticker_pack_id", id)
        putExtra("sticker_pack_authority", context.packageName + ".stickers")
        putExtra("sticker_pack_name", pack.getString("name"))
      }
      val target = listOf("com.whatsapp", "com.whatsapp.w4b").firstOrNull { pkg ->
        intent.setPackage(pkg)
        intent.resolveActivity(context.packageManager) != null
      } ?: error("Install WhatsApp to add this sticker pack.")
      intent.setPackage(target)
      // WhatsApp needs the calling activity's identity and returns validation
      // failures through the activity result. NEW_TASK loses both contracts.
      activity.runOnUiThread {
        if (!pendingImport.compareAndSet(null, promise)) {
          promise.reject("ERR_IMPORT_IN_PROGRESS", "Finish the current WhatsApp import first.", null)
        } else {
          try {
            check(!activity.isFinishing && !activity.isDestroyed) { "Open Peel before importing this pack." }
            @Suppress("DEPRECATION")
            activity.startActivityForResult(intent, importRequest)
          } catch (error: Exception) {
            pendingImport.compareAndSet(promise, null)
            promise.reject("ERR_WHATSAPP_OPEN", "Could not open WhatsApp. Please try again.", error)
          }
        }
      }
    }
  }
}
