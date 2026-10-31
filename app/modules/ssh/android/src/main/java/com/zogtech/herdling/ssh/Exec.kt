package com.zogtech.herdling.ssh

import net.schmizz.sshj.SSHClient
import net.schmizz.sshj.connection.channel.direct.Session
import java.io.IOException
import java.io.InputStream
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/** Sends text of one stream: "onData" or "onStderr". */
typealias ChunkHandler = (event: String, channelId: String, text: String) -> Unit

/**
 * One exec channel. Two reader threads send stdout and stderr; one writer thread sends stdin in
 * call order. When stdout and stderr end, `onEnd` gets the reason, once.
 */
class ExecChannel(
  val id: String,
  val hostId: String,
  private val client: SSHClient,
  private val session: Session,
  private val command: Session.Command,
) {
  private val writer = Executors.newSingleThreadExecutor { r -> Thread(r, "herdling-ssh-stdin") }

  @Volatile private var stopped = false

  /** Starts the readers. `onEnd` runs on a reader thread after both streams ended. */
  fun start(onChunk: ChunkHandler, onEnd: (reason: String) -> Unit) {
    thread(name = "herdling-ssh-exec") {
      var failure: String? = null
      val stderr = thread(name = "herdling-ssh-stderr") {
        try {
          pump(command.errorStream, "onStderr", onChunk)
        } catch (_: IOException) {
          // stdout reports the failure.
        }
      }
      try {
        pump(command.inputStream, "onData", onChunk)
      } catch (e: IOException) {
        failure = e.message ?: e.toString()
      }
      stderr.join()
      onEnd(reason(failure))
    }
  }

  /** Queues text for stdin. Text after `stop()` is dropped. */
  fun write(data: String) {
    val bytes = data.toByteArray(Charsets.UTF_8)
    try {
      writer.execute {
        try {
          command.outputStream.write(bytes)
          command.outputStream.flush()
        } catch (_: IOException) {
          // The channel is closing: the readers report the end.
        }
      }
    } catch (_: java.util.concurrent.RejectedExecutionException) {
    }
  }

  /** Closes the channel. The readers end and report "closed". Does not block. */
  fun stop() {
    stopped = true
    writer.shutdownNow()
    thread(name = "herdling-ssh-close") {
      try {
        command.close()
      } catch (_: Exception) {
      }
      try {
        session.close()
      } catch (_: Exception) {
      }
    }
  }

  private fun pump(stream: InputStream, event: String, onChunk: ChunkHandler) {
    val carry = Utf8Carry()
    val buffer = ByteArray(16 * 1024)
    try {
      while (true) {
        val n = stream.read(buffer)
        if (n < 0) break
        if (n == 0) continue
        carry.decode(buffer, n)?.let { onChunk(event, id, it) }
      }
    } finally {
      carry.flush()?.let { onChunk(event, id, it) }
    }
  }

  private fun reason(failure: String?): String {
    if (stopped) return "closed"
    if (failure != null) return if (client.isConnected) failure else "connection closed"
    // The exit status comes just before the channel close; wait a little for it.
    try {
      command.join(2, TimeUnit.SECONDS)
    } catch (_: Exception) {
    }
    writer.shutdownNow()
    val exit = command.exitStatus
    return if (exit != null && exit != 0) "exit $exit" else "eof"
  }
}
