package com.zogtech.herdling.ssh

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import androidx.annotation.RequiresApi
import java.net.Inet4Address
import java.net.InetAddress

/**
 * Browses mDNS for `_herdling._tcp` with NsdManager and resolves each service to an address,
 * a port and its TXT record. All state lives on one handler thread.
 *
 * Android 14 (API 34) and newer: `registerServiceInfoCallback`, many resolves at a time.
 * Older versions: `resolveService`, which allows only one resolve at a time, so resolves queue.
 */
class Browser(context: Context) {
  companion object {
    const val SERVICE_TYPE = "_herdling._tcp"
    /** Used as `pairPort` when the service does not resolve (the companion default). */
    const val DEFAULT_PAIR_PORT = 7790
    const val RESOLVE_TIMEOUT_MS = 3_000L
    private const val RETRY_MS = 300L
    private const val MAX_RETRIES = 5
  }

  private val appContext = context.applicationContext
  private val nsd = appContext.getSystemService(Context.NSD_SERVICE) as NsdManager
  private val handler = Handler(HandlerThread("herdling-nsd").apply { start() }.looper)

  private var onFound: (Map<String, Any?>) -> Unit = {}
  private var onLost: (String) -> Unit = {}
  private var onState: (String, String?) -> Unit = { _, _ -> }

  private var listener: NsdManager.DiscoveryListener? = null
  private var multicastLock: WifiManager.MulticastLock? = null
  /** Bumped by every start and stop. Callbacks of an older browse are ignored. */
  private var generation = 0
  /** Service instances seen, by name and network. A name is lost when none of its instances is left. */
  private val present = HashMap<String, MutableSet<String>>()
  /** Open resolves by service name. A new result for the same name replaces the old resolve. */
  private val resolves = HashMap<String, Resolve>()
  /** Resolves that wait for their turn (before API 34). */
  private val queue = ArrayDeque<Resolve>()
  private var legacyActive: Resolve? = null

  fun start(
    onFound: (Map<String, Any?>) -> Unit,
    onLost: (String) -> Unit,
    onState: (String, String?) -> Unit,
  ) {
    handler.post {
      stopOnThread(report = false)
      this.onFound = onFound
      this.onLost = onLost
      this.onState = onState
      val gen = ++generation
      acquireMulticast()
      val l = object : NsdManager.DiscoveryListener {
        override fun onDiscoveryStarted(serviceType: String) = post(gen) { this@Browser.onState("ready", null) }
        override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) = post(gen) {
          stopOnThread(report = false)
          this@Browser.onState("failed", "NSD discovery failed (error $errorCode)")
        }
        override fun onServiceFound(info: NsdServiceInfo) = post(gen) { found(info) }
        override fun onServiceLost(info: NsdServiceInfo) = post(gen) { lost(info) }
        override fun onDiscoveryStopped(serviceType: String) {}
        override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}
      }
      listener = l
      try {
        nsd.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, l)
      } catch (e: Exception) {
        stopOnThread(report = false)
        onState("failed", e.message ?: e.toString())
      }
    }
  }

  fun stop() {
    handler.post { stopOnThread(report = true) }
  }

  private fun post(gen: Int, block: () -> Unit) {
    handler.post { if (gen == generation && listener != null) block() }
  }

  /** With `report`, a running browse sends "stopped". */
  private fun stopOnThread(report: Boolean) {
    generation++
    val l = listener
    listener = null
    if (l != null) {
      try {
        nsd.stopServiceDiscovery(l)
      } catch (_: Exception) {
      }
      if (report) onState("stopped", null)
    }
    resolves.values.forEach { it.cancel() }
    resolves.clear()
    queue.clear()
    legacyActive = null
    present.clear()
    releaseMulticast()
  }

  private fun instanceKey(info: NsdServiceInfo): String {
    val network = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) info.network?.toString() else null
    return network ?: ""
  }

  private fun found(info: NsdServiceInfo) {
    val name = info.serviceName ?: return
    present.getOrPut(name) { mutableSetOf() }.add(instanceKey(info))
    resolves.remove(name)?.cancel()
    val r = Resolve(info, generation)
    resolves[name] = r
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      r.startModern()
    } else {
      queue.addLast(r)
      pumpLegacy()
    }
  }

  private fun lost(info: NsdServiceInfo) {
    val name = info.serviceName ?: return
    val instances = present[name] ?: return
    instances.remove(instanceKey(info))
    if (instances.isNotEmpty()) return
    present.remove(name)
    resolves.remove(name)?.cancel()
    onLost(name)
  }

  private fun pumpLegacy() {
    while (legacyActive == null) {
      val next = queue.removeFirstOrNull() ?: return
      if (next.cancelled) continue
      legacyActive = next
      next.startLegacy()
    }
  }

  private fun acquireMulticast() {
    try {
      val wifi = appContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager ?: return
      multicastLock = wifi.createMulticastLock("herdling-browse").apply {
        setReferenceCounted(false)
        acquire()
      }
    } catch (_: Exception) {
      // Without the lock some devices drop mDNS answers; the browse still runs.
    }
  }

  private fun releaseMulticast() {
    try {
      multicastLock?.release()
    } catch (_: Exception) {
    }
    multicastLock = null
  }

  /** Reports the service once: with its address, or with a null address after the timeout. */
  private fun report(r: Resolve, address: String?, port: Int?, txt: Map<String, String>) {
    if (r.cancelled || r.gen != generation) return
    r.cancelled = true
    val name = r.info.serviceName
    if (resolves[name] === r) resolves.remove(name)
    onFound(
      mapOf(
        "name" to name,
        "address" to address,
        "pairPort" to (port?.takeIf { it > 0 } ?: DEFAULT_PAIR_PORT),
        "txt" to txt,
      ),
    )
  }

  private inner class Resolve(val info: NsdServiceInfo, val gen: Int) {
    var cancelled = false
    private var modernCallback: NsdManager.ServiceInfoCallback? = null
    private var retries = 0
    private val timeout = Runnable { finishTimeout() }

    @RequiresApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
    fun startModern() {
      handler.postDelayed(timeout, RESOLVE_TIMEOUT_MS)
      val cb = object : NsdManager.ServiceInfoCallback {
        override fun onServiceInfoCallbackRegistrationFailed(errorCode: Int) {
          handler.post { finish(null, null, emptyMap()) }
        }
        override fun onServiceUpdated(serviceInfo: NsdServiceInfo) {
          handler.post {
            val address = pickAddress(serviceInfo.hostAddresses)
            // Wait for an address; the timeout reports without one.
            if (address != null) finish(address, serviceInfo.port, txtOf(serviceInfo))
          }
        }
        override fun onServiceLost() {}
        override fun onServiceInfoCallbackUnregistered() {}
      }
      modernCallback = cb
      try {
        nsd.registerServiceInfoCallback(info, { handler.post(it) }, cb)
      } catch (e: Exception) {
        modernCallback = null
        finish(null, null, emptyMap())
      }
    }

    fun startLegacy() {
      handler.postDelayed(timeout, RESOLVE_TIMEOUT_MS)
      try {
        @Suppress("DEPRECATION")
        nsd.resolveService(
          info,
          object : NsdManager.ResolveListener {
            override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
              handler.post {
                if (errorCode == NsdManager.FAILURE_ALREADY_ACTIVE && retries < MAX_RETRIES && !cancelled) {
                  // Another app or an old resolve still runs: try again shortly.
                  retries++
                  handler.postDelayed({ if (!cancelled) startLegacyAgain() }, RETRY_MS)
                } else {
                  legacyDone()
                  finish(null, null, emptyMap())
                }
              }
            }

            override fun onServiceResolved(serviceInfo: NsdServiceInfo) {
              handler.post {
                legacyDone()
                @Suppress("DEPRECATION")
                finish(pickAddress(listOfNotNull(serviceInfo.host)), serviceInfo.port, txtOf(serviceInfo))
              }
            }
          },
        )
      } catch (e: Exception) {
        legacyDone()
        finish(null, null, emptyMap())
      }
    }

    private fun startLegacyAgain() {
      handler.removeCallbacks(timeout)
      startLegacy()
    }

    private fun legacyDone() {
      if (legacyActive === this) {
        legacyActive = null
        pumpLegacy()
      }
    }

    private fun finishTimeout() {
      legacyDone()
      finish(null, null, emptyMap())
    }

    private fun finish(address: String?, port: Int?, txt: Map<String, String>) {
      handler.removeCallbacks(timeout)
      unregister()
      report(this, address, port ?: info.port, txt)
    }

    fun cancel() {
      cancelled = true
      handler.removeCallbacks(timeout)
      unregister()
    }

    private fun unregister() {
      val cb = modernCallback ?: return
      modernCallback = null
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        try {
          nsd.unregisterServiceInfoCallback(cb)
        } catch (_: Exception) {
        }
      }
    }
  }
}

/** IPv4 first, else any address. Text without a `%iface` zone. */
internal fun pickAddress(addresses: List<InetAddress>): String? {
  val chosen = addresses.firstOrNull { it is Inet4Address } ?: addresses.firstOrNull() ?: return null
  val text = chosen.hostAddress?.substringBefore('%')
  return text?.takeIf { it.isNotEmpty() }
}

/** TXT keys and values as UTF-8 text. A key without a value maps to "". */
internal fun txtOf(info: NsdServiceInfo): Map<String, String> =
  info.attributes.orEmpty().mapValues { (_, v) -> v?.toString(Charsets.UTF_8) ?: "" }
