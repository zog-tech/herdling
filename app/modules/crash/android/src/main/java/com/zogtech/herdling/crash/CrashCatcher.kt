package com.zogtech.herdling.crash

import android.content.Context
import java.io.File
import kotlin.system.exitProcess

/**
 * Native crash capture. The default uncaught exception handler writes the class, the message and
 * the first stack lines of the throwable to a small file in `filesDir`, then calls the previous
 * handler. On the next launch, JS reads the file, adds it to the crash log and deletes it.
 *
 * File format: line 1 is the time in epoch ms. The other lines are the text of the crash.
 */
object CrashCatcher {
  private const val FILE_NAME = "herdling-native-crash.txt"
  private const val STACK_LINES = 30
  private const val MESSAGE_CHARS = 500

  @Volatile private var file: File? = null
  private var installed = false

  fun file(context: Context): File = File(context.filesDir, FILE_NAME)

  /** Installs the handler once and keeps the previous handler. */
  @Synchronized
  fun install(context: Context) {
    if (installed) return
    installed = true
    file = file(context)
    val previous = Thread.getDefaultUncaughtExceptionHandler()
    Thread.setDefaultUncaughtExceptionHandler { thread, error ->
      try {
        write(thread, error)
      } catch (_: Throwable) {
        // A failed write must not hide the crash.
      }
      if (previous != null) {
        previous.uncaughtException(thread, error)
      } else {
        android.os.Process.killProcess(android.os.Process.myPid())
        exitProcess(10)
      }
    }
  }

  /** Writes one small file synchronously. The process stops right after this. */
  private fun write(thread: Thread, error: Throwable) {
    val target = file ?: return
    val text = StringBuilder()
    text.append(System.currentTimeMillis()).append('\n')
    text.append(headline(error)).append(" (thread ").append(thread.name).append(")\n")
    error.stackTrace.take(STACK_LINES).forEach { text.append("    at ").append(it).append('\n') }
    // The root cause often tells more than the wrapper (for example a JavascriptException).
    // The depth limit stops a loop in a cause chain that points back to itself.
    var root = error
    var depth = 0
    while (depth < 10) {
      val cause = root.cause ?: break
      if (cause === root) break
      root = cause
      depth++
    }
    if (root !== error) {
      text.append("Caused by: ").append(headline(root)).append('\n')
      root.stackTrace.take(5).forEach { text.append("    at ").append(it).append('\n') }
    }
    target.writeText(text.toString())
  }

  private fun headline(error: Throwable): String {
    val message = error.message?.take(MESSAGE_CHARS)
    return if (message.isNullOrEmpty()) error.javaClass.name else "${error.javaClass.name}: $message"
  }

  /** The file text, or null when no crash was saved. */
  fun read(context: Context): String? {
    val f = file(context)
    return if (f.exists()) f.readText() else null
  }

  fun clear(context: Context) {
    file(context).delete()
  }
}
