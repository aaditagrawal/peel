package peel.handoff;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

/** Test double, never a WhatsApp implementation and never shipped with Peel. */
public final class ImportActivity extends Activity {
  private static final String TAG = "PeelHandoffContract";
  private final JSONObject report = new JSONObject();

  @Override public void onCreate(Bundle saved) {
    super.onCreate(saved);
    String mode = getSharedPreferences("fixture", 0).getString("mode", "accept");
    int result = RESULT_CANCELED;
    Intent data = new Intent();
    try {
      report.put("callingPackage", getCallingPackage());
      report.put("mode", mode);
      require("app.peel.stickers".equals(getCallingPackage()), "Caller identity missing. Use startActivityForResult without FLAG_ACTIVITY_NEW_TASK.");
      validate(getIntent());
      report.put("contractPassed", true);
      if ("reject".equals(mode)) data.putExtra("validation_error", "Contract test rejection: the sticker pack could not be added.");
      else if (!"cancel".equals(mode)) result = RESULT_OK;
    } catch (Exception error) {
      data.putExtra("validation_error", error.getMessage());
      try { report.put("contractPassed", false); report.put("error", error.toString()); } catch (Exception ignored) {}
    }
    try {
      report.put("resultCode", result);
      report.put("validation_error", data.getStringExtra("validation_error"));
      String json = report.toString(2);
      try (FileOutputStream output = openFileOutput("latest.json", MODE_PRIVATE)) {
        output.write(json.getBytes(StandardCharsets.UTF_8));
      }
      Log.i(TAG, json);
    } catch (Exception error) { Log.e(TAG, "Could not write report", error); }
    setResult(result, data);
    finish();
  }

  private void validate(Intent intent) throws Exception {
    require("com.whatsapp.intent.action.ENABLE_STICKER_PACK".equals(intent.getAction()), "Wrong action");
    String id = intent.getStringExtra("sticker_pack_id");
    String authority = intent.getStringExtra("sticker_pack_authority");
    String name = intent.getStringExtra("sticker_pack_name");
    require(id != null && !id.isEmpty(), "Missing sticker_pack_id");
    require("app.peel.stickers.stickers".equals(authority), "Wrong sticker_pack_authority");
    require(name != null && !name.isEmpty(), "Missing sticker_pack_name");
    report.put("packId", id);
    report.put("packName", name);
    Uri base = new Uri.Builder().scheme("content").authority(authority).build();
    boolean animated;
    String tray;
    try (Cursor metadata = getContentResolver().query(base.buildUpon().appendPath("metadata").appendPath(id).build(), null, null, null, null)) {
      require(metadata != null && metadata.getCount() == 1 && metadata.moveToFirst(), "Pack metadata not readable");
      require(id.equals(value(metadata, "sticker_pack_identifier")), "Metadata identifier mismatch");
      require(name.equals(value(metadata, "sticker_pack_name")), "Metadata name mismatch");
      require(!value(metadata, "sticker_pack_publisher").isEmpty(), "Publisher missing");
      require(!value(metadata, "image_data_version").isEmpty(), "Version missing");
      tray = value(metadata, "sticker_pack_icon");
      animated = metadata.getInt(metadata.getColumnIndexOrThrow("animated_sticker_pack")) == 1;
    }
    byte[] icon = read(base, id, tray, 50 * 1024);
    checkDimensions(icon, 96);
    int count = 0;
    try (Cursor stickers = getContentResolver().query(base.buildUpon().appendPath("stickers").appendPath(id).build(), null, null, null, null)) {
      require(stickers != null && stickers.getCount() >= 3 && stickers.getCount() <= 30, "Expected 3 to 30 stickers");
      stickers.getColumnIndexOrThrow("sticker_file_accessibility_text");
      stickers.getColumnIndexOrThrow("sticker_emoji");
      while (stickers.moveToNext()) {
        String file = value(stickers, "sticker_file_name");
        require(file.endsWith(".webp"), "Sticker must use .webp");
        require(!value(stickers, "sticker_file_accessibility_text").isEmpty(), "Sticker name missing");
        byte[] image = read(base, id, file, animated ? 500 * 1024 : 100 * 1024);
        require(image.length > 20 && ascii(image, 0, 4).equals("RIFF") && ascii(image, 8, 4).equals("WEBP"), "Invalid WebP");
        checkDimensions(image, 512);
        boolean imageAnimated = ascii(image, 12, 4).equals("VP8X") && (image[20] & 2) != 0;
        require(imageAnimated == animated, "Mixed animation types");
        if (animated) checkAnimation(image);
        count++;
      }
    }
    report.put("stickerCount", count);
    report.put("animated", animated);
    report.put("providerReadPassed", true);
  }

  private byte[] read(Uri base, String id, String file, int limit) throws Exception {
    Uri uri = base.buildUpon().appendPath("stickers_asset").appendPath(id).appendPath(file).build();
    String expected = file.endsWith(".png") ? "image/png" : "image/webp";
    require(expected.equals(getContentResolver().getType(uri)), "Wrong asset MIME type");
    try (InputStream input = getContentResolver().openInputStream(uri); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
      require(input != null, "Asset not readable");
      byte[] buffer = new byte[8192];
      int size;
      while ((size = input.read(buffer)) != -1) {
        output.write(buffer, 0, size);
        require(output.size() <= limit, "Asset exceeds byte limit: " + file);
      }
      require(output.size() > 0, "Empty asset");
      return output.toByteArray();
    }
  }
  private static void checkDimensions(byte[] bytes, int size) {
    Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
    require(bitmap != null, "Asset cannot be decoded");
    try { require(bitmap.getWidth() == size && bitmap.getHeight() == size, "Wrong asset dimensions"); }
    finally { bitmap.recycle(); }
  }
  private static void checkAnimation(byte[] bytes) {
    int duration = 0, count = 0;
    for (int offset = 12; offset + 8 <= bytes.length;) {
      int size = le(bytes, offset + 4, 4);
      require(size >= 0 && offset + 8L + size <= bytes.length, "Malformed WebP chunk");
      String tag = ascii(bytes, offset, 4);
      if (tag.equals("ANMF")) {
        require(size >= 16, "Short frame chunk");
        int delay = le(bytes, offset + 20, 3);
        require(delay >= 8, "Frame shorter than 8ms");
        duration += delay;
        count++;
      }
      if (tag.equals("ANIM")) require(size >= 6 && le(bytes, offset + 12, 2) == 0, "Animation must loop indefinitely");
      offset += 8 + size + (size & 1);
    }
    require(count >= 2 && duration <= 10000, "Invalid animation duration/frame count");
  }
  private static int le(byte[] bytes, int offset, int count) {
    int value = 0;
    for (int i = 0; i < count; i++) value |= (bytes[offset + i] & 255) << (i * 8);
    return value;
  }
  private static String ascii(byte[] bytes, int offset, int size) { return new String(bytes, offset, size, StandardCharsets.US_ASCII); }
  private static String value(Cursor cursor, String key) { return cursor.getString(cursor.getColumnIndexOrThrow(key)); }
  private static void require(boolean condition, String message) { if (!condition) throw new IllegalStateException(message); }
}
