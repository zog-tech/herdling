import Citadel
import CryptoKit
import ExpoModulesCore
import Foundation
import NIOCore
import NIOSSH

struct ConnectOptions: Record {
  @Field var host: String = ""
  @Field var port: Int = 22
  @Field var user: String = ""
  @Field var fingerprint: String?
}

public class SshModule: Module {
  private let state = SshState()
  private let browser = Browser()
  private let previews = PreviewRegistry()

  public func definition() -> ModuleDefinition {
    Name("SshModule")

    Events("onData", "onStderr", "onChannelClose", "onDisconnect", "onServiceFound", "onServiceLost", "onBrowseState")

    AsyncFunction("ensureKey") { () throws -> [String: String] in
      let key = try Keys.loadOrCreate()
      return ["publicKey": Keys.openSSHPublicKey(key)]
    }

    AsyncFunction("connect") { (hostId: String, opts: ConnectOptions) async throws -> [String: String] in
      try await self.connect(hostId: hostId, opts: opts)
    }

    AsyncFunction("openExec") { (hostId: String, command: String) async throws -> String in
      try await self.openExec(hostId: hostId, command: command)
    }

    AsyncFunction("write") { (channelId: String, data: String) throws in
      guard let channel = self.state.channel(channelId) else {
        throw Exception(name: "ChannelClosed", description: "channel \(channelId) is not open", code: "channel_closed")
      }
      channel.outbox.yield(data)
    }

    AsyncFunction("closeChannel") { (channelId: String) in
      self.state.removeChannel(channelId)?.stop()
    }

    AsyncFunction("disconnect") { (hostId: String) async in
      await self.disconnect(hostId: hostId)
    }

    AsyncFunction("probeHostKey") { (opts: ProbeOptions) async throws -> [String: String] in
      try await PasswordSetup.probeHostKey(opts)
    }

    AsyncFunction("execWithPassword") { (opts: PasswordExecOptions) async throws -> [String: Any] in
      try await PasswordSetup.execWithPassword(opts)
    }

    AsyncFunction("startBrowse") {
      self.browser.start(
        onFound: { [weak self] service in self?.sendEvent("onServiceFound", service) },
        onLost: { [weak self] name in self?.sendEvent("onServiceLost", ["name": name]) },
        onState: { [weak self] state, error in
          var body: [String: Any] = ["state": state]
          if let error { body["error"] = error }
          self?.sendEvent("onBrowseState", body)
        }
      )
    }

    AsyncFunction("stopBrowse") {
      self.browser.stop()
    }

    AsyncFunction("startPreview") { (hostId: String, port: Int, command: String) async throws -> [String: Int] in
      try await self.startPreview(hostId: hostId, port: port, command: command)
    }

    AsyncFunction("stopPreview") { (localPort: Int) async in
      await self.stopPreview(localPort: localPort)
    }

    OnDestroy {
      self.browser.stop()
      for server in self.previews.removeAll() {
        server.stop()
      }
      for hostId in self.state.hostIds() {
        Task { await self.disconnect(hostId: hostId) }
      }
    }
  }

  // MARK: - Connect

  private func connect(hostId: String, opts: ConnectOptions) async throws -> [String: String] {
    // Only the newest connect (or disconnect) for a host may store its client.
    let token = state.beginAttempt(hostId)
    await disconnect(hostId: hostId, supersede: false)

    let key = try Keys.loadOrCreate()
    let check = HostKeyCheck(pinned: opts.fingerprint)
    let client: SSHClient
    do {
      client = try await SSHClient.connect(
        host: opts.host,
        port: opts.port,
        authenticationMethod: .ed25519(username: opts.user, privateKey: key),
        hostKeyValidator: .custom(check),
        reconnect: .never,
        connectTimeout: .seconds(10)
      )
    } catch {
      if check.mismatch {
        throw Exception(
          name: "HostKeyMismatch",
          description: "host key \(check.seen ?? "?") does not match the pinned key",
          code: "host_key_mismatch"
        )
      }
      if case SSHClientError.allAuthenticationOptionsFailed = error {
        throw Exception(name: "AuthFailed", description: "the host did not accept this phone's key", code: "auth_failed")
      }
      throw Exception(name: "ConnectFailed", description: String(describing: error), code: "connect_failed")
    }

    client.onDisconnect { [weak self] in
      self?.clientClosed(hostId: hostId, client: client)
    }
    guard let previous = state.commitClient(hostId, token: token, client) else {
      // A later connect or a disconnect for this host started meanwhile: this client is stale.
      try? await client.close()
      throw Exception(name: "Superseded", description: "a newer connect or disconnect replaced this one", code: "superseded")
    }
    if let old = previous {
      try? await old.close()
    }
    // A second connection for the preview uses the same login and the host key seen now.
    state.setTarget(hostId, HostTarget(host: opts.host, port: opts.port, user: opts.user, fingerprint: check.seen ?? opts.fingerprint))
    if !client.isConnected {
      clientClosed(hostId: hostId, client: client)
    }
    return ["fingerprint": check.seen ?? ""]
  }

  /// Called by Citadel when the TCP connection closes. Ignored for clients the app already disconnected.
  private func clientClosed(hostId: String, client: SSHClient) {
    guard state.removeClient(hostId, ifIdentical: client) else { return }
    for channel in state.removeChannels(of: hostId) {
      channel.stop()
    }
    if let second = state.removePreviewClient(hostId) {
      Task { try? await second.close() }
    }
    sendEvent("onDisconnect", ["hostId": hostId, "reason": "connection closed"])
  }

  /// Closes the host's channels and client. With `supersede`, an in-flight connect for the host becomes stale.
  /// A running preview stays: its next connections use the next client of the host.
  private func disconnect(hostId: String, supersede: Bool = true) async {
    if supersede { _ = state.beginAttempt(hostId) }
    for channel in state.removeChannels(of: hostId) {
      channel.stop()
    }
    if let second = state.removePreviewClient(hostId) {
      try? await second.close()
    }
    guard let client = state.removeClient(hostId) else { return }
    try? await client.close()
  }

  // MARK: - Browser preview

  private func startPreview(hostId: String, port: Int, command: String) async throws -> [String: Int] {
    guard (1...65535).contains(port) else {
      throw Exception(name: "BadPort", description: "port \(port) is not in the range 1-65535", code: "bad_request")
    }
    guard state.client(hostId) != nil else {
      throw Exception(name: "NotConnected", description: "host \(hostId) is not connected", code: "not_connected")
    }
    await PreviewCookie.install()
    let server: PreviewServer
    do {
      server = try await PreviewServer.start(
        hostId: hostId, port: port, command: command, limiter: previews.limiter(hostId),
        withChannel: previewChannel(hostId: hostId))
    } catch {
      throw Exception(name: "ListenFailed", description: String(describing: error), code: "listen_failed")
    }
    previews.add(server)
    return ["localPort": server.localPort]
  }

  private func stopPreview(localPort: Int) async {
    guard let removed = previews.remove(localPort) else { return }
    let (server, lastLimiter) = removed
    server.stop()
    if let limiter = lastLimiter {
      // The last preview of the host: let waiting connections go, and close the second connection.
      await limiter.close()
      if let second = state.removePreviewClient(server.hostId) {
        try? await second.close()
      }
    }
  }

  /// Runs `perform` on a new exec channel for the preview. It uses the host's connection. When the
  /// channel does not open there (for example sshd `MaxSessions`), it opens a second connection
  /// for the preview and uses that one from then on.
  private func previewChannel(hostId: String) -> (String, @escaping (TTYOutput, TTYStdinWriter) async throws -> Void) async throws -> Void {
    return { [weak self] command, perform in
      guard let self else { throw PreviewError(description: "the module is gone") }
      if let second = self.state.previewClient(hostId) {
        try await second.withExec(command) { inbound, outbound in try await perform(inbound, outbound) }
        return
      }
      guard let main = self.state.client(hostId) else { throw PreviewError(description: "host \(hostId) is not connected") }
      let opened = EndFlag()
      do {
        try await main.withExec(command) { inbound, outbound in
          opened.set()
          try await perform(inbound, outbound)
        }
      } catch {
        if opened.isSet || !main.isConnected { throw error }
        let second = try await self.makePreviewClient(hostId: hostId)
        try await second.withExec(command) { inbound, outbound in try await perform(inbound, outbound) }
      }
    }
  }

  private func makePreviewClient(hostId: String) async throws -> SSHClient {
    if let c = state.previewClient(hostId) { return c }
    guard let target = state.target(hostId) else { throw PreviewError(description: "no login saved for host \(hostId)") }
    let key = try Keys.loadOrCreate()
    let client = try await SSHClient.connect(
      host: target.host,
      port: target.port,
      authenticationMethod: .ed25519(username: target.user, privateKey: key),
      hostKeyValidator: .custom(HostKeyCheck(pinned: target.fingerprint)),
      reconnect: .never,
      connectTimeout: .seconds(10)
    )
    if let existing = state.setPreviewClient(hostId, client) {
      // Another connection of the preview won the race: keep that one.
      try? await client.close()
      return existing
    }
    client.onDisconnect { [weak self] in
      _ = self?.state.removePreviewClient(hostId, ifIdentical: client)
    }
    return client
  }

  // MARK: - Exec channels

  private func openExec(hostId: String, command: String) async throws -> String {
    guard let client = state.client(hostId) else {
      throw Exception(name: "NotConnected", description: "host \(hostId) is not connected", code: "not_connected")
    }
    let channelId = UUID().uuidString
    let (outStream, outbox) = AsyncStream<String>.makeStream()
    let ready = OnceSignal()
    let channel = ExecChannel(id: channelId, hostId: hostId, outbox: outbox)
    state.addChannel(channel)  // registered before the task can end

    channel.start(Task { [weak self] in
      let ended = EndFlag()
      var reason = "eof"
      do {
        try await client.withExec(command) { inbound, outbound in
          ready.resolve(nil)
          try await withThrowingTaskGroup(of: Void.self) { group in
            group.addTask {
              for await line in outStream {
                try await outbound.write(ByteBuffer(string: line))
              }
            }
            group.addTask {
              var stdout = Utf8Carry()
              var stderr = Utf8Carry()
              for try await output in inbound {
                switch output {
                case .stdout(let buffer):
                  if let text = stdout.decode(Array(buffer.readableBytesView)) {
                    self?.sendEvent("onData", ["channelId": channelId, "data": text])
                  }
                case .stderr(let buffer):
                  if let text = stderr.decode(Array(buffer.readableBytesView)) {
                    self?.sendEvent("onStderr", ["channelId": channelId, "data": text])
                  }
                }
              }
              if let text = stdout.flush() {
                self?.sendEvent("onData", ["channelId": channelId, "data": text])
              }
              if let text = stderr.flush() {
                self?.sendEvent("onStderr", ["channelId": channelId, "data": text])
              }
            }
            // The first task to finish ends the channel: the remote side closed or the app closed the outbox.
            try await group.next()
            group.cancelAll()
          }
          ended.set()
        }
      } catch let failed as SSHClient.CommandFailed {
        reason = "exit \(failed.exitCode)"
      } catch {
        // `withExec` closes the channel after `perform`; a close race after a clean end is not a failure.
        if !ended.isSet { reason = Task.isCancelled ? "closed" : String(describing: error) }
      }
      if Task.isCancelled && reason == "eof" { reason = "closed" }
      self?.state.removeChannel(channelId)
      // If this resolves the signal, the channel never opened: `openExec` rejects instead of an event.
      if !ready.resolve(ExecOpenError(reason: reason)) {
        self?.sendEvent("onChannelClose", ["channelId": channelId, "reason": reason])
      }
    })

    if let error = await ready.wait() {
      throw Exception(name: "ExecFailed", description: error.reason, code: "exec_failed")
    }
    return channelId
  }
}

// MARK: - Host key check

/// Computes the server's SHA256 fingerprint and compares it with the pinned one (when given).
/// With `rejectAll` it only records the fingerprint and fails the check, so the connection stops
/// before any login (the host key probe).
final class HostKeyCheck: NIOSSHClientServerAuthenticationDelegate, @unchecked Sendable {
  private let pinned: String?
  private let rejectAll: Bool
  private let lock = NSLock()
  private var _seen: String?
  private var _mismatch = false

  init(pinned: String?, rejectAll: Bool = false) {
    self.pinned = pinned?.isEmpty == true ? nil : pinned
    self.rejectAll = rejectAll
  }

  var seen: String? { lock.withLock { _seen } }
  var mismatch: Bool { lock.withLock { _mismatch } }

  func validateHostKey(hostKey: NIOSSHPublicKey, validationCompletePromise: EventLoopPromise<Void>) {
    let parts = String(openSSHPublicKey: hostKey).split(separator: " ")
    guard parts.count >= 2, let blob = Data(base64Encoded: String(parts[1])) else {
      validationCompletePromise.fail(HostKeyRejected())
      return
    }
    let fingerprint = Keys.fingerprint(ofWireBlob: blob)
    let ok = pinned == nil || pinned == fingerprint
    lock.withLock {
      _seen = fingerprint
      _mismatch = !ok
    }
    if ok && !rejectAll {
      validationCompletePromise.succeed(())
    } else {
      validationCompletePromise.fail(HostKeyRejected())
    }
  }
}

// MARK: - State

final class ExecChannel: @unchecked Sendable {
  let id: String
  let hostId: String
  let outbox: AsyncStream<String>.Continuation
  private let lock = NSLock()
  private var task: Task<Void, Never>?
  private var stopped = false

  init(id: String, hostId: String, outbox: AsyncStream<String>.Continuation) {
    self.id = id
    self.hostId = hostId
    self.outbox = outbox
  }

  /// Attaches the channel's task. Cancels it at once if `stop()` already ran.
  func start(_ task: Task<Void, Never>) {
    let cancelNow: Bool = lock.withLock {
      self.task = task
      return stopped
    }
    if cancelNow { task.cancel() }
  }

  func stop() {
    outbox.finish()
    let task: Task<Void, Never>? = lock.withLock {
      stopped = true
      return self.task
    }
    task?.cancel()
  }
}

/// Connected clients and open channels, guarded by one lock.
final class SshState: @unchecked Sendable {
  private let lock = NSLock()
  private var clients: [String: SSHClient] = [:]
  private var channels: [String: ExecChannel] = [:]
  private var attempts: [String: UInt64] = [:]
  /// The login of each connected host, for the second connection of the preview.
  private var targets: [String: HostTarget] = [:]
  /// The second connection of the preview, when the first one could not open more channels.
  private var previewClients: [String: SSHClient] = [:]

  /// Starts a new connect (or disconnect) for the host and returns its token.
  func beginAttempt(_ hostId: String) -> UInt64 {
    lock.withLock {
      let next = (attempts[hostId] ?? 0) &+ 1
      attempts[hostId] = next
      return next
    }
  }

  /// Stores the client if `token` is still the newest attempt. Returns nil when stale,
  /// else `.some(previous client)` (the caller closes the previous one).
  func commitClient(_ hostId: String, token: UInt64, _ client: SSHClient) -> SSHClient?? {
    lock.withLock {
      guard attempts[hostId] == token else { return nil }
      let previous = clients[hostId]
      clients[hostId] = client
      return .some(previous)
    }
  }

  func hostIds() -> [String] { lock.withLock { Array(clients.keys) } }
  func client(_ hostId: String) -> SSHClient? { lock.withLock { clients[hostId] } }

  func setTarget(_ hostId: String, _ target: HostTarget) { lock.withLock { targets[hostId] = target } }
  func target(_ hostId: String) -> HostTarget? { lock.withLock { targets[hostId] } }

  func previewClient(_ hostId: String) -> SSHClient? { lock.withLock { previewClients[hostId] } }

  /// Stores the second connection of the preview. Returns the one already stored instead, if any.
  func setPreviewClient(_ hostId: String, _ client: SSHClient) -> SSHClient? {
    lock.withLock {
      if let existing = previewClients[hostId] { return existing }
      previewClients[hostId] = client
      return nil
    }
  }

  func removePreviewClient(_ hostId: String) -> SSHClient? {
    lock.withLock { previewClients.removeValue(forKey: hostId) }
  }

  func removePreviewClient(_ hostId: String, ifIdentical client: SSHClient) -> Bool {
    lock.withLock {
      guard previewClients[hostId] === client else { return false }
      previewClients.removeValue(forKey: hostId)
      return true
    }
  }

  func removeClient(_ hostId: String) -> SSHClient? {
    lock.withLock { clients.removeValue(forKey: hostId) }
  }

  func removeClient(_ hostId: String, ifIdentical client: SSHClient) -> Bool {
    lock.withLock {
      guard clients[hostId] === client else { return false }
      clients.removeValue(forKey: hostId)
      return true
    }
  }

  func channel(_ id: String) -> ExecChannel? { lock.withLock { channels[id] } }
  func addChannel(_ channel: ExecChannel) { lock.withLock { channels[channel.id] = channel } }

  @discardableResult
  func removeChannel(_ id: String) -> ExecChannel? {
    lock.withLock { channels.removeValue(forKey: id) }
  }

  func removeChannels(of hostId: String) -> [ExecChannel] {
    lock.withLock {
      let matching = channels.values.filter { $0.hostId == hostId }
      matching.forEach { channels.removeValue(forKey: $0.id) }
      return matching
    }
  }
}

/// The login of a connected host: address, user and the host key that was seen.
struct HostTarget {
  let host: String
  let port: Int
  let user: String
  let fingerprint: String?
}

struct ExecOpenError: Error {
  let reason: String
}

/// Resolves once; later calls are ignored. `wait()` returns the first value.
final class OnceSignal: @unchecked Sendable {
  private let lock = NSLock()
  private var result: ExecOpenError??
  private var waiter: CheckedContinuation<ExecOpenError?, Never>?

  /// Returns true when this call resolved the signal, false when it was already resolved.
  @discardableResult
  func resolve(_ error: ExecOpenError?) -> Bool {
    let (first, w): (Bool, CheckedContinuation<ExecOpenError?, Never>?) = lock.withLock {
      guard result == nil else { return (false, nil) }
      result = .some(error)
      defer { waiter = nil }
      return (true, waiter)
    }
    w?.resume(returning: error)
    return first
  }

  func wait() async -> ExecOpenError? {
    await withCheckedContinuation { cont in
      let done: ExecOpenError?? = lock.withLock {
        if let r = result { return .some(r) }
        waiter = cont
        return nil
      }
      if let r = done { cont.resume(returning: r) }
    }
  }
}

final class EndFlag: @unchecked Sendable {
  private let lock = NSLock()
  private var value = false
  var isSet: Bool { lock.withLock { value } }
  func set() { lock.withLock { value = true } }
}

struct HostKeyRejected: Error {}
