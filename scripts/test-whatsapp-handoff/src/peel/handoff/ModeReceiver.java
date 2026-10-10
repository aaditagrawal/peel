package peel.handoff;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** ADB-only fixture configuration on the disposable test emulator. */
public final class ModeReceiver extends BroadcastReceiver {
  @Override public void onReceive(Context context, Intent intent) {
    String mode = intent.getStringExtra("mode");
    if (!"accept".equals(mode) && !"reject".equals(mode) && !"cancel".equals(mode)) {
      setResultCode(1);
      setResultData("Expected accept, reject or cancel");
      return;
    }
    context.getSharedPreferences("fixture", 0).edit().putString("mode", mode).commit();
    setResultCode(0);
    setResultData(mode);
  }
}
