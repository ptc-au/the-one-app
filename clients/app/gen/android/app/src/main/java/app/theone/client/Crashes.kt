package app.theone.client

import android.content.Context
import java.io.File

/**
 * What ended the app, where Android's own `ApplicationExitInfo` says only that it crashed (`MainActivity.exited`): an
 * exception nothing caught, its class, message and where it was thrown, written to a file as it happens and told to
 * Telemetry at the app's next start, as the client's own panics are. It's installed by whatever starts the app first,
 * its window or the service that wakes it (`Notifications`).
 */
object Crashes {
  @Volatile private var installed = false

  fun install(context: Context) {
    if (installed) return
    installed = true
    val file = File(context.applicationContext.filesDir, "crash.txt")
    val before = Thread.getDefaultUncaughtExceptionHandler()
    Thread.setDefaultUncaughtExceptionHandler { thread, error ->
      runCatching { file.writeText("$error on ${thread.name}\n" + error.stackTrace.take(30).joinToString("\n") { "    at $it" }) }
      before?.uncaughtException(thread, error)
    }
  }

  /** What the last run wrote as it crashed, if it did, once. */
  fun told(context: Context): String? {
    val file = File(context.applicationContext.filesDir, "crash.txt")
    val said = runCatching { file.readText() }.getOrNull()
    file.delete()
    return said?.take(1000)
  }
}
