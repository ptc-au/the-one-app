package app.theone.client

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import android.util.Log
import java.io.File

/**
 * The app taking a newer build of itself, its network's APK, which its Rust downloaded (`apk` in updater.rs): installed
 * in place by Android's PackageInstaller, which from Android 12 asks nobody when an app updates itself and may
 * (UPDATE_PACKAGES_WITHOUT_USER_ACTION), as an app store's updates go. Android ends the app as it replaces it.
 */
object Updates {
  @JvmStatic
  fun install(context: Context, apk: String) {
    val installer = context.packageManager.packageInstaller
    val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
    params.setAppPackageName(context.packageName)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
    }
    val id = installer.createSession(params)
    installer.openSession(id).use { session ->
      val file = File(apk)
      session.openWrite("app.apk", 0, file.length()).use { out ->
        file.inputStream().use { it.copyTo(out) }
        session.fsync(out)
      }
      // Android fills in what happened, so the intent it's handed is mutable.
      val mutable = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
      val told = PendingIntent.getBroadcast(context, id, Intent(context, Installed::class.java), PendingIntent.FLAG_UPDATE_CURRENT or mutable)
      session.commit(told.intentSender)
    }
  }
}

/** What Android says of an update it was handed: where it asks its person first (before Android 12), its question is shown. */
class Installed : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
      PackageInstaller.STATUS_SUCCESS -> {}
      PackageInstaller.STATUS_PENDING_USER_ACTION -> {
        @Suppress("DEPRECATION")
        val question = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT) ?: return
        context.startActivity(question.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      }
      else -> Log.w("Updates", "the update didn't install: ${intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)}")
    }
  }
}
