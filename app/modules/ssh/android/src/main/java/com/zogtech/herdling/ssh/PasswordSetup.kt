package com.zogtech.herdling.ssh

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import net.schmizz.sshj.SSHClient
import net.schmizz.sshj.userauth.UserAuthException
import net.schmizz.sshj.userauth.method.AuthKeyboardInteractive
import net.schmizz.sshj.userauth.method.AuthPassword
import net.schmizz.sshj.userauth.method.PasswordResponseProvider
import net.schmizz.sshj.userauth.password.PasswordFinder
import net.schmizz.sshj.userauth.password.Resource
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlin.concurrent.thread

// One-shot password login for "Set up with password". Nothing here is tied to a saved host,
// and nothing keeps the password: it lives only in the options and the auth method of this
// call. It is never logged and never part of an error text.

class ProbeOptions : Record {
  @Field val host: String = ""
  @Field val port: Int = 22
  @Field val timeoutMs: Int = 10_000
}

class PasswordExecOptions : Record {
  @Field val host: String = ""
  @Field val port: Int = 22
  @Field val user: String = ""
  @Field val password: String = ""
  @Field val command: String = ""
  @Field val stdin: String = ""
  @Field val expectedFingerprint: String? = null
  @Field val timeoutMs: Int = 20_000
}

/** Largest stdout + stderr kept from the command. */
private const val OUTPUT_LIMIT = 1 shl 20

private class OutputTooLarge : IOException("the command printed more than $OUTPUT_LIMIT bytes")

/** Gives the password for every request and never asks again. */
private class OnePassword(private val password: String) : PasswordFinder {
  override fun reqPassword(resource: Resource<*>?): CharArray = password.toCharArray()
  override fun shouldRetry(resource: Resource<*>?): Boolean = false
}

object PasswordSetup {
  /**
   * Connects far enough to see the host key, then stops: the key check fails on purpose,
   * so the connection closes during key exchange, before any login is sent.
   */
  suspend fun probeHostKey(o: ProbeOptions): Map<String, String> {
    val check = HostKeyCheck(null, rejectAll = true)
    val box = ClientBox()
    val host = o.host
    val port = o.port
    val timeoutMs = o.timeoutMs
    return withDeadline(timeoutMs.toLong(), { box.close() }) {
      val client = Clients.newClient(check, timeoutMs, keepAlive = false)
      if (!box.set(client)) throw timeoutError()
      try {
        client.connect(host, port)
      } catch (e: Exception) {
        if (check.seen == null) throw sshError("connect_failed", e.message ?: e.toString())
      } finally {
        Clients.closeQuietly(client)
      }
      val fingerprint = check.seen ?: throw sshError("connect_failed", "the host sent no host key")
      mapOf("fingerprint" to fingerprint)
    }
  }

  /**
   * Logs in with the password, runs one command, writes `stdin`, collects the output until the
   * command ends, and disconnects. A non-zero exit is returned as `exitCode`, not thrown.
   */
  suspend fun execWithPassword(o: PasswordExecOptions): Map<String, Any> {
    val check = HostKeyCheck(o.expectedFingerprint)
    val box = ClientBox()
    val host = o.host
    val port = o.port
    val user = o.user
    val password = o.password
    val command = o.command
    val stdin = o.stdin
    val timeoutMs = o.timeoutMs
    return withDeadline(timeoutMs.toLong(), { box.close() }) {
      val client = Clients.newClient(check, timeoutMs, keepAlive = false)
      if (!box.set(client)) throw timeoutError()
      try {
        try {
          client.connect(host, port)
        } catch (e: Exception) {
          throw connectError(e, check, password)
        }
        try {
          val finder = OnePassword(password)
          client.auth(user, AuthPassword(finder), AuthKeyboardInteractive(PasswordResponseProvider(finder)))
        } catch (e: UserAuthException) {
          throw sshError(
            "auth_failed",
            "the host did not accept the user name and password, or it does not allow password login",
          )
        } catch (e: Exception) {
          throw sshError("connect_failed", redact(e.message ?: e.toString(), password))
        }
        val result = try {
          run(client, command, stdin)
        } catch (e: Exception) {
          throw sshError("exec_failed", redact(e.message ?: e.toString(), password))
        }
        mapOf(
          "stdout" to result.first,
          "stderr" to result.second,
          "exitCode" to result.third,
          "hostFingerprint" to (check.seen ?: ""),
        )
      } finally {
        Clients.closeQuietly(client)
      }
    }
  }

  private fun run(client: SSHClient, command: String, stdin: String): Triple<String, String, Int> {
    val session = client.startSession()
    try {
      val cmd = session.exec(command)
      if (stdin.isNotEmpty()) {
        cmd.outputStream.write(stdin.toByteArray(Charsets.UTF_8))
        cmd.outputStream.flush()
      }
      val total = AtomicInteger(0)
      val err = ByteArrayOutputStream()
      var errFailure: IOException? = null
      val errThread = thread(name = "herdling-ssh-stderr") {
        try {
          collect(cmd.errorStream, err, total)
        } catch (e: IOException) {
          errFailure = e
        }
      }
      val out = ByteArrayOutputStream()
      try {
        collect(cmd.inputStream, out, total)
      } finally {
        errThread.join()
      }
      errFailure?.let { throw it }
      try {
        cmd.join(5, TimeUnit.SECONDS)
      } catch (_: Exception) {
      }
      return Triple(out.toString("UTF-8"), err.toString("UTF-8"), cmd.exitStatus ?: 0)
    } finally {
      try {
        session.close()
      } catch (_: Exception) {
      }
    }
  }

  private fun collect(stream: InputStream, into: ByteArrayOutputStream, total: AtomicInteger) {
    val buffer = ByteArray(16 * 1024)
    while (true) {
      val n = stream.read(buffer)
      if (n < 0) return
      synchronized(into) { into.write(buffer, 0, n) }
      if (total.addAndGet(n) > OUTPUT_LIMIT) throw OutputTooLarge()
    }
  }

  private fun connectError(e: Exception, check: HostKeyCheck, password: String): CodedException {
    if (check.mismatch) {
      return sshError("host_key_mismatch", "host key ${check.seen ?: "?"} does not match the confirmed key")
    }
    return sshError("connect_failed", redact(e.message ?: e.toString(), password))
  }

  /** Error texts come from sshj and should never hold the password; this makes sure. */
  private fun redact(text: String, password: String): String =
    if (password.isEmpty()) text else text.replace(password, "***")
}
