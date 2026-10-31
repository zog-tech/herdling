package com.zogtech.herdling.ssh

import expo.modules.kotlin.exception.CodedException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull
import net.schmizz.keepalive.KeepAliveProvider
import net.schmizz.sshj.DefaultConfig
import net.schmizz.sshj.SSHClient
import net.schmizz.sshj.common.Buffer
import net.schmizz.sshj.transport.verification.HostKeyVerifier
import java.security.PublicKey
import kotlin.concurrent.thread

/** Seconds between keep-alive requests. A dead link is found after `KEEP_ALIVE_MAX` missed answers. */
private const val KEEP_ALIVE_SECONDS = 15
private const val KEEP_ALIVE_MAX = 3

/** Shared sshj setup for the saved-host connections and the one-shot calls. */
object Clients {
  private val config: DefaultConfig by lazy {
    Crypto.ensure()
    DefaultConfig().apply { keepAliveProvider = KeepAliveProvider.KEEP_ALIVE }
  }

  /** A client that checks the host key with `check` and gives up a TCP connect after `connectTimeoutMs`. */
  fun newClient(check: HostKeyCheck, connectTimeoutMs: Int, keepAlive: Boolean): SSHClient {
    Crypto.ensure()
    return SSHClient(config).apply {
      addHostKeyVerifier(check)
      connectTimeout = connectTimeoutMs
      if (keepAlive) {
        connection.keepAlive.keepAliveInterval = KEEP_ALIVE_SECONDS
        (connection.keepAlive as? net.schmizz.keepalive.KeepAliveRunner)?.maxAliveCount = KEEP_ALIVE_MAX
      }
    }
  }

  /** Closes the client and ignores errors. */
  fun closeQuietly(client: SSHClient?) {
    try {
      client?.disconnect()
    } catch (_: Exception) {
    }
  }
}

/**
 * Computes the server's SHA256 fingerprint and compares it with the pinned one (when given).
 * With `rejectAll` it only records the fingerprint and fails the check, so the connection stops
 * before any login (the host key probe).
 */
class HostKeyCheck(pinned: String?, private val rejectAll: Boolean = false) : HostKeyVerifier {
  private val pinned: String? = pinned?.takeIf { it.isNotEmpty() }

  @Volatile var seen: String? = null
    private set

  @Volatile var mismatch = false
    private set

  override fun verify(hostname: String?, port: Int, key: PublicKey): Boolean {
    val blob = Buffer.PlainBuffer().putPublicKey(key).compactData
    val fingerprint = KeyFormat.fingerprint(blob)
    val ok = pinned == null || pinned == fingerprint
    seen = fingerprint
    mismatch = !ok
    return ok && !rejectAll
  }

  override fun findExistingAlgorithms(hostname: String?, port: Int): List<String> = emptyList()
}

/** The client of a one-shot call, so a timeout can close it. A client set after the timeout is refused. */
class ClientBox {
  private var client: SSHClient? = null
  private var closed = false

  @Synchronized
  fun set(client: SSHClient): Boolean {
    if (closed) return false
    this.client = client
    return true
  }

  fun close() {
    val c = synchronized(this) {
      closed = true
      client
    }
    if (c != null) thread(name = "herdling-ssh-close") { Clients.closeQuietly(c) }
  }
}

fun sshError(code: String, message: String): CodedException = CodedException(code, message, null)

fun timeoutError(): CodedException = sshError("timeout", "the host did not answer in time")

/**
 * Runs the blocking `op` on its own thread and gives up after `ms`: then it throws "timeout" and
 * calls `onTimeout`, which closes what `op` opened. `op` is not awaited after the deadline; it
 * ends on its own when its connection closes.
 */
suspend fun <T> withDeadline(ms: Long, onTimeout: () -> Unit, op: () -> T): T {
  val result = CompletableDeferred<T>()
  thread(name = "herdling-ssh-call") {
    try {
      result.complete(op())
    } catch (e: Throwable) {
      result.completeExceptionally(e)
    }
  }
  val done = withTimeoutOrNull(ms.coerceAtLeast(1)) { result.join() } != null
  if (!done) {
    onTimeout()
    throw timeoutError()
  }
  return result.await()
}
