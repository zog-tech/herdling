package com.zogtech.herdling.ssh

import net.schmizz.sshj.SSHClient

/** The login of a connected host: address, user and the host key that was seen. */
data class HostTarget(val host: String, val port: Int, val user: String, val fingerprint: String?)

/** Connected clients and open channels, guarded by one lock. */
class SshState {
  private val clients = HashMap<String, SSHClient>()
  private val channels = HashMap<String, ExecChannel>()
  private val attempts = HashMap<String, Long>()

  /** Starts a new connect (or disconnect) for the host and returns its token. */
  @Synchronized
  fun beginAttempt(hostId: String): Long {
    val next = (attempts[hostId] ?: 0L) + 1
    attempts[hostId] = next
    return next
  }

  /**
   * Stores the client if `token` is still the newest attempt. Returns false when stale.
   * `previous` gets the client it replaced (the caller closes it).
   */
  @Synchronized
  fun commitClient(hostId: String, token: Long, client: SSHClient, previous: (SSHClient?) -> Unit): Boolean {
    if (attempts[hostId] != token) return false
    previous(clients.put(hostId, client))
    return true
  }

  /** The login of each connected host, for the second connection of the preview. */
  private val targets = HashMap<String, HostTarget>()

  /** The second connection of the preview, when the first one could not open more channels. */
  private val previewClients = HashMap<String, SSHClient>()

  @Synchronized fun setTarget(hostId: String, target: HostTarget) {
    targets[hostId] = target
  }

  @Synchronized fun target(hostId: String): HostTarget? = targets[hostId]

  @Synchronized fun previewClient(hostId: String): SSHClient? = previewClients[hostId]

  /** Stores the second connection of the preview. Returns the one already stored instead, if any. */
  @Synchronized
  fun setPreviewClient(hostId: String, client: SSHClient): SSHClient? {
    previewClients[hostId]?.let { return it }
    previewClients[hostId] = client
    return null
  }

  @Synchronized fun removePreviewClient(hostId: String): SSHClient? = previewClients.remove(hostId)

  @Synchronized fun hostIds(): List<String> = clients.keys.toList()

  @Synchronized fun client(hostId: String): SSHClient? = clients[hostId]

  @Synchronized fun removeClient(hostId: String): SSHClient? = clients.remove(hostId)

  @Synchronized
  fun removeClient(hostId: String, ifIdentical: SSHClient): Boolean {
    if (clients[hostId] !== ifIdentical) return false
    clients.remove(hostId)
    return true
  }

  @Synchronized fun channel(id: String): ExecChannel? = channels[id]

  @Synchronized fun addChannel(channel: ExecChannel) {
    channels[channel.id] = channel
  }

  @Synchronized fun removeChannel(id: String): ExecChannel? = channels.remove(id)

  @Synchronized
  fun removeChannels(hostId: String): List<ExecChannel> {
    val matching = channels.values.filter { it.hostId == hostId }
    matching.forEach { channels.remove(it.id) }
    return matching
  }
}
