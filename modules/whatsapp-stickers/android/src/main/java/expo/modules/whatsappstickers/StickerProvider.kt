package expo.modules.whatsappstickers

import android.content.ContentProvider
import android.content.ContentValues
import android.content.res.AssetFileDescriptor
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import org.json.JSONObject
import java.io.File
import java.io.FileNotFoundException

class StickerProvider : ContentProvider() {
  override fun onCreate() = true
  private fun root() = File(requireNotNull(context).filesDir, "whatsapp-stickers")
  private fun pack(id: String): JSONObject? {
    if (!id.matches(Regex("[a-zA-Z0-9_-]{1,100}"))) return null
    return try { JSONObject(File(File(root(), id), "pack.json").readText()) } catch (_: Exception) { null }
  }
  override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor {
    val parts = uri.pathSegments
    if (parts.firstOrNull() == "metadata" && parts.size in 1..2) {
      val cursor = MatrixCursor(arrayOf("sticker_pack_identifier", "sticker_pack_name", "sticker_pack_publisher", "sticker_pack_icon", "android_play_store_link", "ios_app_download_link", "sticker_pack_publisher_email", "sticker_pack_publisher_website", "sticker_pack_privacy_policy_website", "sticker_pack_license_agreement_website", "image_data_version", "whatsapp_will_not_cache_stickers", "animated_sticker_pack"))
      val packs = if (parts.size == 2) listOfNotNull(pack(parts[1])) else root().listFiles()?.mapNotNull { pack(it.name) } ?: emptyList()
      packs.forEach { p -> cursor.addRow(arrayOf(p.getString("identifier"), p.getString("name"), p.getString("publisher"), "tray.png", "", "", "", "", "", "", p.optString("image_data_version", "1"), 0, if(p.optBoolean("animated_sticker_pack")) 1 else 0)) }
      cursor.setNotificationUri(requireNotNull(context).contentResolver, uri)
      return cursor
    }
    if (parts.firstOrNull() == "stickers" && parts.size == 2) {
      val cursor = MatrixCursor(arrayOf("sticker_file_name", "sticker_emoji", "sticker_file_accessibility_text"))
      val stickers = pack(parts[1])?.getJSONArray("stickers") ?: return cursor
      for (i in 0 until stickers.length()) {
        val s = stickers.getJSONObject(i)
        cursor.addRow(arrayOf(s.getString("image_file"), "✨", s.optString("accessibility_text", "Sticker")))
      }
      cursor.setNotificationUri(requireNotNull(context).contentResolver, uri)
      return cursor
    }
    throw IllegalArgumentException("Unknown sticker URI")
  }
  override fun openAssetFile(uri: Uri, mode: String): AssetFileDescriptor {
    val p = uri.pathSegments
    if (mode != "r" || p.size != 3 || p[0] != "stickers_asset") throw FileNotFoundException()
    val metadata = pack(p[1]) ?: throw FileNotFoundException()
    val files = metadata.getJSONArray("stickers")
    val allowed = p[2] == "tray.png" || (0 until files.length()).any { files.getJSONObject(it).getString("image_file") == p[2] }
    if (!allowed || !p[2].matches(Regex("(tray\\.png|[0-9]+\\.webp)"))) throw FileNotFoundException()
    val file = File(File(root(), p[1]), p[2])
    return AssetFileDescriptor(ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY), 0, file.length())
  }
  override fun getType(uri: Uri): String = when(uri.pathSegments.firstOrNull()) {
    "metadata" -> "vnd.android.cursor.${if(uri.pathSegments.size == 1) "dir" else "item"}/vnd.${uri.authority}.metadata"
    "stickers" -> "vnd.android.cursor.dir/vnd.${uri.authority}.stickers"
    "stickers_asset" -> if(uri.lastPathSegment == "tray.png") "image/png" else "image/webp"
    else -> throw IllegalArgumentException("Unknown sticker URI")
  }
  override fun insert(uri: Uri, values: ContentValues?): Uri? = throw UnsupportedOperationException()
  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = throw UnsupportedOperationException()
  override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int = throw UnsupportedOperationException()
}
