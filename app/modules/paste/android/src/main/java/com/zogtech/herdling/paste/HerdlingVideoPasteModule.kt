package com.zogtech.herdling.paste

import android.content.ContentResolver
import android.content.Context
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.provider.OpenableColumns
import android.view.View
import android.webkit.MimeTypeMap
import android.widget.EditText
import androidx.core.view.OnReceiveContentListener
import androidx.core.view.ViewCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.lang.ref.WeakReference
import java.util.UUID
import java.util.concurrent.Executors

/**
 * Paste a video into the prompt box with the edit menu ("Paste") or the keyboard clipboard.
 *
 * Android shows "Paste" for any clip. While JS has called `attach`, the focused text input gets an
 * OnReceiveContentListener for `video/` content. A pasted video is copied to the cache folder and
 * JS gets its file URI. Other content (text) goes to the input as before.
 *
 * The module name differs from the iOS "HerdlingPaste": older JS takes "HerdlingPaste" as the image
 * hook, which Android does not have.
 */
class HerdlingVideoPasteModule : Module() {
  private val io = Executors.newSingleThreadExecutor()
  private var attached: WeakReference<View>? = null
  @Volatile private var maxBytes: Long = 0

  override fun definition() = ModuleDefinition {
    Name("HerdlingVideoPaste")

    Events("onPasteVideo")

    OnDestroy {
      detach()
      io.shutdown()
    }

    /** Puts the listener on the focused text input. `max`: a larger video is not copied (0 = no limit). */
    Function("attach") { max: Double ->
      maxBytes = max.toLong()
      val activity = appContext.currentActivity ?: return@Function false
      activity.runOnUiThread {
        detach()
        val view = activity.currentFocus as? EditText ?: return@runOnUiThread
        ViewCompat.setOnReceiveContentListener(view, arrayOf("video/*"), listener)
        attached = WeakReference(view)
      }
      true
    }

    /** Takes the listener off the text input again. */
    Function("detach") {
      appContext.currentActivity?.runOnUiThread { detach() }
      Unit
    }
  }

  private fun detach() {
    attached?.get()?.let { ViewCompat.setOnReceiveContentListener(it, null, null) }
    attached = null
  }

  private val listener = OnReceiveContentListener { view, payload ->
    val split = payload.partition { item -> item.uri != null && isVideo(view.context.contentResolver, item.uri!!) }
    val videos = split.first
    if (videos != null) {
      val clip = videos.clip
      for (i in 0 until clip.itemCount) {
        val uri = clip.getItemAt(i).uri ?: continue
        val context = view.context.applicationContext
        io.execute { copy(context, uri) }
      }
    }
    // The rest (text) goes to the input as before.
    split.second
  }

  private fun isVideo(resolver: ContentResolver, uri: Uri): Boolean =
    (resolver.getType(uri) ?: mimeFromName(uri.lastPathSegment))?.startsWith("video/") == true

  /** Copies the video to `cache/herdling-paste/<uuid>.<ext>` and sends the event. Runs on the I/O thread. */
  private fun copy(context: Context, uri: Uri) {
    val resolver = context.contentResolver
    var name = "pasted-video.mp4"
    var size = -1L
    try {
      resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
        if (c.moveToFirst()) {
          c.getColumnIndex(OpenableColumns.DISPLAY_NAME).takeIf { it >= 0 && !c.isNull(it) }?.let { name = c.getString(it) }
          c.getColumnIndex(OpenableColumns.SIZE).takeIf { it >= 0 && !c.isNull(it) }?.let { size = c.getLong(it) }
        }
      }
    } catch (_: Exception) {
      // Some providers do not answer the query: the copy below still works.
    }
    val mime = resolver.getType(uri) ?: mimeFromName(name)
    val ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(mime) ?: name.substringAfterLast('.', "mp4")
    if (!name.contains('.')) name = "$name.$ext"
    val max = maxBytes
    if (max > 0 && size > max) {
      send(mapOf("name" to name, "size" to size, "error" to "too_large"))
      return
    }
    val dir = File(context.cacheDir, "herdling-paste").apply { mkdirs() }
    cleanup(dir)
    val dest = File(dir, "${UUID.randomUUID()}.$ext")
    try {
      var copied = 0L
      resolver.openInputStream(uri)?.use { input ->
        dest.outputStream().use { output ->
          val buf = ByteArray(1 shl 16)
          while (true) {
            val n = input.read(buf)
            if (n < 0) break
            copied += n
            if (max > 0 && copied > max) {
              output.close()
              dest.delete()
              send(mapOf("name" to name, "size" to copied, "error" to "too_large"))
              return
            }
            output.write(buf, 0, n)
          }
        }
      } ?: throw IllegalStateException("Could not open the video.")
      val event = mutableMapOf<String, Any>("uri" to Uri.fromFile(dest).toString(), "name" to name, "size" to copied)
      if (mime != null) event["mime"] = mime
      durationMs(dest)?.let { event["duration"] = it }
      send(event)
    } catch (e: Exception) {
      dest.delete()
      send(mapOf("name" to name, "size" to maxOf(size, 0L), "error" to (e.message ?: "Could not read the video.")))
    }
  }

  private fun send(event: Map<String, Any>) = sendEvent("onPasteVideo", event)

  private fun durationMs(file: File): Long? =
    try {
      MediaMetadataRetriever().run {
        try {
          setDataSource(file.path)
          extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()
        } finally {
          release()
        }
      }
    } catch (_: Exception) {
      null
    }

  private fun mimeFromName(name: String?): String? =
    name?.substringAfterLast('.', "")?.lowercase()?.takeIf { it.isNotEmpty() }?.let {
      MimeTypeMap.getSingleton().getMimeTypeFromExtension(it)
    }

  /** Deletes pasted videos older than one day. */
  private fun cleanup(dir: File) {
    val cutoff = System.currentTimeMillis() - 24 * 3600 * 1000L
    dir.listFiles()?.forEach { if (it.lastModified() < cutoff) it.delete() }
  }
}
