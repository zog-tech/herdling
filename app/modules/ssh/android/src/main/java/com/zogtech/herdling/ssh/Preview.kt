package com.zogtech.herdling.ssh

import net.schmizz.sshj.connection.channel.direct.Session
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.security.SecureRandom
import java.util.Collections
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Semaphore
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/**
 * The local access gate of the browser preview. On Android every app can connect to a loopback
 * port, so each connection must send the preview cookie in its HTTP request head.
 */
object PreviewGate {
  const val COOKIE_NAME = "herdling_preview"

  /** The longest request head that is read before the gate decides. */
  const val MAX_HEAD = 16 * 1024

  enum class Verdict { NEED_MORE, ALLOW, DENY }

  val FORBIDDEN: ByteArray =
    "HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\nContent-Length: 10\r\nConnection: close\r\n\r\nForbidden\n"
      .toByteArray(Charsets.US_ASCII)

  /** `ALLOW` when the head is complete and a `Cookie` header holds `herdling_preview=<cookie>`. */
  fun check(head: ByteArray, length: Int, cookie: String): Verdict {
    val end = headEnd(head, length) ?: return if (length >= MAX_HEAD) Verdict.DENY else Verdict.NEED_MORE
    if (end > MAX_HEAD) return Verdict.DENY
    val want = "$COOKIE_NAME=$cookie"
    val lines = String(head, 0, end, Charsets.ISO_8859_1).split("\r\n").drop(1)
    for (line in lines) {
      val colon = line.indexOf(':')
      if (colon <= 0 || !line.substring(0, colon).trim().equals("cookie", ignoreCase = true)) continue
      if (line.substring(colon + 1).split(';').any { it.trim() == want }) return Verdict.ALLOW
    }
    return Verdict.DENY
  }

  /** The index just after the blank line that ends the head, or null. */
  fun headEnd(b: ByteArray, length: Int): Int? {
    var i = 0
    while (i + 3 < length) {
      if (b[i] == '\r'.code.toByte() && b[i + 1] == '\n'.code.toByte() && b[i + 2] == '\r'.code.toByte() && b[i + 3] == '\n'.code.toByte()) {
        return i + 4
      }
      i++
    }
    return null
  }
}

/** One random cookie value for the life of the app process. All previews share it. */
object PreviewCookie {
  val value: String by lazy {
    val bytes = ByteArray(16)
    SecureRandom().nextBytes(bytes)
    bytes.joinToString("") { "%02x".format(it) }
  }

  /** Puts the cookie for `localhost` in the cookie store of the web view. Call on the main thread. */
  fun install() {
    try {
      val cm = android.webkit.CookieManager.getInstance()
      cm.setCookie("http://localhost", "${PreviewGate.COOKIE_NAME}=$value; Path=/; HttpOnly")
      cm.flush()
    } catch (_: Exception) {
      // No web view on this device: the preview screen does not load anyway.
    }
  }
}

/** An exec channel of a preview connection. */
class ProxyChannel(private val session: Session, val command: Session.Command) {
  fun close() {
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

/**
 * One running preview: a listener on `127.0.0.1` of the phone. Each accepted connection that
 * passes the gate gets its own exec channel with `command` (from `open`) and raw bytes both ways.
 */
class PreviewServer private constructor(
  val hostId: String,
  private val server: ServerSocket,
  private val command: String,
  private val limiter: Semaphore,
  private val open: (String) -> ProxyChannel,
) {
  val localPort: Int = server.localPort
  private val sockets: MutableSet<Socket> = Collections.newSetFromMap(ConcurrentHashMap())

  @Volatile private var stopped = false

  companion object {
    /** Binds `127.0.0.1:port`, else a free loopback port, and starts to accept. */
    fun start(hostId: String, port: Int, command: String, limiter: Semaphore, open: (String) -> ProxyChannel): PreviewServer {
      val ss = bind(port) ?: bind(0) ?: throw IOException("no free loopback port")
      return PreviewServer(hostId, ss, command, limiter, open).also { it.acceptLoop() }
    }

    private fun bind(port: Int): ServerSocket? =
      try {
        ServerSocket().apply {
          reuseAddress = false
          bind(InetSocketAddress(InetAddress.getByName("127.0.0.1"), port), 50)
        }
      } catch (_: IOException) {
        null
      }
  }

  fun stop() {
    stopped = true
    try {
      server.close()
    } catch (_: IOException) {
    }
    sockets.toList().forEach { closeQuietly(it) }
    sockets.clear()
  }

  private fun acceptLoop() {
    thread(name = "herdling-preview-accept") {
      while (!stopped) {
        val s = try {
          server.accept()
        } catch (_: IOException) {
          break
        }
        if (!s.inetAddress.isLoopbackAddress || stopped) {
          closeQuietly(s)
          continue
        }
        sockets.add(s)
        thread(name = "herdling-preview-conn") {
          try {
            serve(s)
          } catch (_: Exception) {
            // A closed socket or a refused channel: the web view sees the socket close.
          } finally {
            closeQuietly(s)
            sockets.remove(s)
          }
        }
      }
    }
  }

  private fun serve(s: Socket) {
    s.tcpNoDelay = true
    val input = s.getInputStream()
    val head = ByteArrayOutputStream()
    val buf = ByteArray(16 * 1024)
    while (true) {
      val n = input.read(buf)
      if (n < 0) return
      head.write(buf, 0, n)
      val bytes = head.toByteArray()
      when (PreviewGate.check(bytes, bytes.size, PreviewCookie.value)) {
        PreviewGate.Verdict.NEED_MORE -> continue
        PreviewGate.Verdict.DENY -> {
          s.getOutputStream().apply {
            write(PreviewGate.FORBIDDEN)
            flush()
          }
          return
        }
        PreviewGate.Verdict.ALLOW -> break
      }
    }
    // At most a few channels per host; wait for a free one while the preview runs.
    while (!limiter.tryAcquire(500, TimeUnit.MILLISECONDS)) {
      if (stopped || s.isClosed) return
    }
    try {
      if (stopped) return
      val ch = open(command)
      try {
        val toHost = ch.command.outputStream
        toHost.write(head.toByteArray())
        toHost.flush()
        thread(name = "herdling-preview-up") {
          // Phone to computer. The end of the stream ends the channel, so the down copy ends too.
          try {
            pump(input, toHost)
          } catch (_: IOException) {
          } finally {
            ch.close()
          }
        }
        // Computer to phone. Raw bytes: no text decoding on this path.
        try {
          pump(ch.command.inputStream, s.getOutputStream())
          s.shutdownOutput()
        } catch (_: IOException) {
        }
      } finally {
        ch.close()
      }
    } finally {
      limiter.release()
    }
  }

  private fun pump(from: InputStream, to: OutputStream) {
    val buf = ByteArray(32 * 1024)
    while (true) {
      val n = from.read(buf)
      if (n < 0) return
      if (n == 0) continue
      to.write(buf, 0, n)
      to.flush()
    }
  }

  private fun closeQuietly(s: Socket) {
    try {
      s.close()
    } catch (_: IOException) {
    }
  }
}

/** The running previews by local port, and one channel limiter per host. */
class PreviewRegistry {
  private val servers = HashMap<Int, PreviewServer>()
  private val limiters = HashMap<String, Semaphore>()

  companion object {
    /** At most 6 proxy channels at once per host. OpenSSH `MaxSessions` is 10 by default, and the rpc channel uses one. */
    const val CHANNELS_PER_HOST = 6
  }

  @Synchronized
  fun limiter(hostId: String): Semaphore = limiters.getOrPut(hostId) { Semaphore(CHANNELS_PER_HOST, true) }

  @Synchronized
  fun add(s: PreviewServer) {
    servers[s.localPort] = s
  }

  /** Removes the preview. `last` is true when it was the last preview of its host. */
  @Synchronized
  fun remove(localPort: Int): Pair<PreviewServer, Boolean>? {
    val s = servers.remove(localPort) ?: return null
    val last = servers.values.none { it.hostId == s.hostId }
    if (last) limiters.remove(s.hostId)
    return s to last
  }

  @Synchronized
  fun removeAll(): List<PreviewServer> {
    val all = servers.values.toList()
    servers.clear()
    limiters.clear()
    return all
  }
}
