package com.zogtech.herdling.ssh

import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import net.schmizz.sshj.SSHClient
import net.schmizz.sshj.transport.DisconnectListener
import net.schmizz.sshj.userauth.UserAuthException
import java.io.IOException
import java.util.UUID
import kotlin.concurrent.thread

class ConnectOptions : Record {
  @Field val host: String = ""
  @Field val port: Int = 22
  @Field val user: String = ""
  @Field val fingerprint: String? = null
}

/** Connect timeout of a saved-host connection. */
private const val CONNECT_TIMEOUT_MS = 10_000

/**
 * The Android side of `modules/ssh`: the same JS API, events, error codes and formats as the
 * iOS module (SshModule.swift). Blocking sshj calls run on the IO dispatcher, so one slow
 * connect does not hold up other module calls.
 */
class SshModule : Module() {
  private val state = SshState()
  private var browser: Browser? = null
  private val previews = PreviewRegistry()

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("SshModule")

    Events("onData", "onStderr", "onChannelClose", "onDisconnect", "onServiceFound", "onServiceLost", "onBrowseState")

    AsyncFunction("ensureKey") Coroutine { ->
      withContext(Dispatchers.IO) {
        val key = Keys.loadOrCreate(context)
        mapOf("publicKey" to Keys.openSshPublicKey(context, key))
      }
    }

    AsyncFunction("connect") Coroutine { hostId: String, opts: ConnectOptions ->
      withContext(Dispatchers.IO) { connect(hostId, opts) }
    }

    AsyncFunction("openExec") Coroutine { hostId: String, command: String ->
      withContext(Dispatchers.IO) { openExec(hostId, command) }
    }

    AsyncFunction("write") { channelId: String, data: String ->
      val channel = state.channel(channelId) ?: throw sshError("channel_closed", "channel $channelId is not open")
      channel.write(data)
    }

    AsyncFunction("closeChannel") { channelId: String ->
      state.removeChannel(channelId)?.stop()
    }

    AsyncFunction("disconnect") Coroutine { hostId: String ->
      withContext(Dispatchers.IO) { disconnect(hostId) }
    }

    AsyncFunction("probeHostKey") Coroutine { opts: ProbeOptions ->
      PasswordSetup.probeHostKey(opts)
    }

    AsyncFunction("execWithPassword") Coroutine { opts: PasswordExecOptions ->
      PasswordSetup.execWithPassword(opts)
    }

    AsyncFunction("startBrowse") {
      val b = browser ?: Browser(context).also { browser = it }
      b.start(
        onFound = { service -> sendEvent("onServiceFound", service) },
        onLost = { name -> sendEvent("onServiceLost", mapOf("name" to name)) },
        onState = { s, error ->
          val body = mutableMapOf<String, Any?>("state" to s)
          if (error != null) body["error"] = error
          sendEvent("onBrowseState", body)
        },
      )
    }

    AsyncFunction("stopBrowse") {
      browser?.stop()
    }

    AsyncFunction("startPreview") Coroutine { hostId: String, port: Int, command: String ->
      startPreview(hostId, port, command)
    }

    AsyncFunction("stopPreview") Coroutine { localPort: Int ->
      withContext(Dispatchers.IO) { stopPreview(localPort) }
    }

    OnDestroy {
      browser?.stop()
      previews.removeAll().forEach { it.stop() }
      val ids = state.hostIds()
      thread(name = "herdling-ssh-teardown") { ids.forEach { disconnect(it) } }
    }
  }

  // Connect

  private fun connect(hostId: String, opts: ConnectOptions): Map<String, String> {
    // Only the newest connect (or disconnect) for a host may store its client.
    val token = state.beginAttempt(hostId)
    disconnect(hostId, supersede = false)

    val key = Keys.loadOrCreate(context)
    val check = HostKeyCheck(opts.fingerprint)
    val client = Clients.newClient(check, CONNECT_TIMEOUT_MS, keepAlive = true)
    try {
      client.connect(opts.host, opts.port)
    } catch (e: Exception) {
      Clients.closeQuietly(client)
      if (check.mismatch) {
        throw sshError("host_key_mismatch", "host key ${check.seen ?: "?"} does not match the pinned key")
      }
      throw sshError("connect_failed", e.message ?: e.toString())
    }
    try {
      client.authPublickey(opts.user, key.keyProvider())
    } catch (e: UserAuthException) {
      Clients.closeQuietly(client)
      throw sshError("auth_failed", "the host did not accept this phone's key")
    } catch (e: Exception) {
      Clients.closeQuietly(client)
      throw sshError("connect_failed", e.message ?: e.toString())
    }

    client.transport.disconnectListener = DisconnectListener { _, _ ->
      // Called inside sshj's transport lock: clean up on another thread.
      thread(name = "herdling-ssh-dropped") { clientClosed(hostId, client) }
    }
    var previous: SSHClient? = null
    if (!state.commitClient(hostId, token, client) { previous = it }) {
      // A later connect or a disconnect for this host started meanwhile: this client is stale.
      Clients.closeQuietly(client)
      throw sshError("superseded", "a newer connect or disconnect replaced this one")
    }
    previous?.let { Clients.closeQuietly(it) }
    // A second connection for the preview uses the same login and the host key seen now.
    state.setTarget(hostId, HostTarget(opts.host, opts.port, opts.user, check.seen ?: opts.fingerprint))
    if (!client.isConnected) clientClosed(hostId, client)
    return mapOf("fingerprint" to (check.seen ?: ""))
  }

  /** Called when the connection closes. Ignored for clients the app already disconnected. */
  private fun clientClosed(hostId: String, client: SSHClient) {
    if (!state.removeClient(hostId, client)) return
    state.removeChannels(hostId).forEach { it.stop() }
    Clients.closeQuietly(client)
    state.removePreviewClient(hostId)?.let { Clients.closeQuietly(it) }
    sendEvent("onDisconnect", mapOf("hostId" to hostId, "reason" to "connection closed"))
  }

  /**
   * Closes the host's channels and client. With `supersede`, an in-flight connect for the host becomes stale.
   * A running preview stays: its next connections use the next client of the host.
   */
  private fun disconnect(hostId: String, supersede: Boolean = true) {
    if (supersede) state.beginAttempt(hostId)
    state.removeChannels(hostId).forEach { it.stop() }
    state.removePreviewClient(hostId)?.let { Clients.closeQuietly(it) }
    val client = state.removeClient(hostId) ?: return
    Clients.closeQuietly(client)
  }

  // Browser preview

  private suspend fun startPreview(hostId: String, port: Int, command: String): Map<String, Int> {
    if (port !in 1..65535) throw sshError("bad_request", "port $port is not in the range 1-65535")
    if (state.client(hostId) == null) throw sshError("not_connected", "host $hostId is not connected")
    withContext(Dispatchers.Main) { PreviewCookie.install() }
    val server = withContext(Dispatchers.IO) {
      try {
        PreviewServer.start(hostId, port, command, previews.limiter(hostId)) { cmd -> openProxyChannel(hostId, cmd) }
      } catch (e: IOException) {
        throw sshError("listen_failed", e.message ?: e.toString())
      }
    }
    previews.add(server)
    return mapOf("localPort" to server.localPort)
  }

  private fun stopPreview(localPort: Int) {
    val (server, last) = previews.remove(localPort) ?: return
    server.stop()
    // The last preview of the host closes the second connection.
    if (last) state.removePreviewClient(server.hostId)?.let { Clients.closeQuietly(it) }
  }

  /**
   * A new exec channel for the preview. It uses the host's connection. When the channel does not
   * open there (for example sshd `MaxSessions`), it opens a second connection for the preview and
   * uses that one from then on.
   */
  private fun openProxyChannel(hostId: String, command: String): ProxyChannel {
    state.previewClient(hostId)?.let { return proxyExec(it, command) }
    val main = state.client(hostId) ?: throw IOException("host $hostId is not connected")
    return try {
      proxyExec(main, command)
    } catch (e: Exception) {
      if (!main.isConnected) throw e
      proxyExec(previewClient(hostId), command)
    }
  }

  private fun proxyExec(client: SSHClient, command: String): ProxyChannel {
    val session = client.startSession()
    return try {
      ProxyChannel(session, session.exec(command))
    } catch (e: Exception) {
      try {
        session.close()
      } catch (_: Exception) {
      }
      throw e
    }
  }

  private fun previewClient(hostId: String): SSHClient {
    state.previewClient(hostId)?.let { return it }
    val target = state.target(hostId) ?: throw IOException("no login saved for host $hostId")
    val key = Keys.loadOrCreate(context)
    val client = Clients.newClient(HostKeyCheck(target.fingerprint), CONNECT_TIMEOUT_MS, keepAlive = true)
    try {
      client.connect(target.host, target.port)
      client.authPublickey(target.user, key.keyProvider())
    } catch (e: Exception) {
      Clients.closeQuietly(client)
      throw e
    }
    state.setPreviewClient(hostId, client)?.let {
      // Another connection of the preview won the race: keep that one.
      Clients.closeQuietly(client)
      return it
    }
    return client
  }

  // Exec channels

  private fun openExec(hostId: String, command: String): String {
    val client = state.client(hostId) ?: throw sshError("not_connected", "host $hostId is not connected")
    val channelId = UUID.randomUUID().toString().uppercase()
    val channel = try {
      val session = client.startSession()
      try {
        ExecChannel(channelId, hostId, client, session, session.exec(command))
      } catch (e: Exception) {
        try {
          session.close()
        } catch (_: Exception) {
        }
        throw e
      }
    } catch (e: Exception) {
      throw sshError("exec_failed", e.message ?: e.toString())
    }
    state.addChannel(channel)
    channel.start(
      onChunk = { event, id, text -> sendEvent(event, mapOf("channelId" to id, "data" to text)) },
      onEnd = { reason ->
        state.removeChannel(channelId)
        sendEvent("onChannelClose", mapOf("channelId" to channelId, "reason" to reason))
      },
    )
    return channelId
  }
}
