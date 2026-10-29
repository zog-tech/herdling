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

  public func definition() -> ModuleDefinition {
    Name("SshModule")

    Events("onData", "onStderr", "onChannelClose", "onDisconnect")

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

    OnDestroy {
      for hostId in self.state.hostIds() {
        Task { await self.disconnect(hostId: hostId) }
      }
    }
  }

  // MARK: - Connect

  private func connect(hostId: String, opts: ConnectOptions) async throws -> [String: String] {
    await disconnect(hostId: hostId)

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

    state.setClient(hostId, client)
    client.onDisconnect { [weak self] in
      self?.clientClosed(hostId: hostId, client: client)
    }
    return ["fingerprint": check.seen ?? ""]
  }

  /// Called by Citadel when the TCP connection closes. Ignored for clients the app already disconnected.
  private func clientClosed(hostId: String, client: SSHClient) {
    guard state.removeClient(hostId, ifIdentical: client) else { return }
    for channel in state.removeChannels(of: hostId) {
      channel.stop()
    }
    sendEvent("onDisconnect", ["hostId": hostId, "reason": "connection closed"])
  }

  private func disconnect(hostId: String) async {
    for channel in state.removeChannels(of: hostId) {
      channel.stop()
    }
    guard let client = state.removeClient(hostId) else { return }
    try? await client.close()
  }

  // MARK: - Exec channels

  private func openExec(hostId: String, command: String) async throws -> String {
    guard let client = state.client(hostId) else {
      throw Exception(name: "NotConnected", description: "host \(hostId) is not connected", code: "not_connected")
    }
    let channelId = UUID().uuidString
    let (outStream, outbox) = AsyncStream<String>.makeStream()
    let ready = OnceSignal()

    let task = Task { [weak self] in
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
    }

    state.addChannel(ExecChannel(id: channelId, hostId: hostId, outbox: outbox, task: task))
    if let error = await ready.wait() {
      state.removeChannel(channelId)  // the task can end before `addChannel` runs
      throw Exception(name: "ExecFailed", description: error.reason, code: "exec_failed")
    }
    return channelId
  }
}

// MARK: - Host key check

/// Computes the server's SHA256 fingerprint and compares it with the pinned one (when given).
final class HostKeyCheck: NIOSSHClientServerAuthenticationDelegate, @unchecked Sendable {
  private let pinned: String?
  private let lock = NSLock()
  private var _seen: String?
  private var _mismatch = false

  init(pinned: String?) {
    self.pinned = pinned?.isEmpty == true ? nil : pinned
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
    if ok {
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
  let task: Task<Void, Never>

  init(id: String, hostId: String, outbox: AsyncStream<String>.Continuation, task: Task<Void, Never>) {
    self.id = id
    self.hostId = hostId
    self.outbox = outbox
    self.task = task
  }

  func stop() {
    outbox.finish()
    task.cancel()
  }
}

/// Connected clients and open channels, guarded by one lock.
final class SshState: @unchecked Sendable {
  private let lock = NSLock()
  private var clients: [String: SSHClient] = [:]
  private var channels: [String: ExecChannel] = [:]

  func hostIds() -> [String] { lock.withLock { Array(clients.keys) } }
  func client(_ hostId: String) -> SSHClient? { lock.withLock { clients[hostId] } }
  func setClient(_ hostId: String, _ client: SSHClient) { lock.withLock { clients[hostId] = client } }

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
