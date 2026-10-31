import Citadel
import Foundation
import Network
import NIOCore
import Security
import WebKit

/// The local access gate of the browser preview. Any app on the phone can connect to a loopback
/// port, so each connection must send the preview cookie in its HTTP request head.
enum PreviewGate {
  static let cookieName = "herdling_preview"
  /// The longest request head that is read before the gate decides.
  static let maxHead = 16 * 1024

  enum Verdict: Equatable { case needMore, allow, deny }

  /// Looks at the first bytes of a connection. `allow` when the head is complete and a `Cookie`
  /// header holds `herdling_preview=<cookie>`.
  static func check(_ head: [UInt8], cookie: String) -> Verdict {
    guard let end = headEnd(head) else {
      return head.count >= maxHead ? .deny : .needMore
    }
    if end > maxHead { return .deny }
    let text = String(decoding: head[0..<end], as: UTF8.self)
    let want = "\(cookieName)=\(cookie)"
    for line in text.split(separator: "\r\n").dropFirst() {
      guard let colon = line.firstIndex(of: ":") else { continue }
      guard line[..<colon].trimmingCharacters(in: .whitespaces).lowercased() == "cookie" else { continue }
      let pairs = line[line.index(after: colon)...].split(separator: ";")
      if pairs.contains(where: { $0.trimmingCharacters(in: .whitespaces) == want }) { return .allow }
    }
    return .deny
  }

  /// The index just after the blank line that ends the head, or nil.
  static func headEnd(_ b: [UInt8]) -> Int? {
    guard b.count >= 4 else { return nil }
    for i in 0...(b.count - 4) where b[i] == 13 && b[i + 1] == 10 && b[i + 2] == 13 && b[i + 3] == 10 {
      return i + 4
    }
    return nil
  }

  static let forbidden = Data("HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\nContent-Length: 10\r\nConnection: close\r\n\r\nForbidden\n".utf8)
}

/// One random cookie value for the life of the app process. All previews share it, so two
/// previews (two hosts) do not replace each other's cookie.
enum PreviewCookie {
  static let value: String = {
    var bytes = [UInt8](repeating: 0, count: 16)
    if SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) != errSecSuccess {
      bytes = (0..<16).map { _ in UInt8.random(in: 0...255) }
    }
    return bytes.map { String(format: "%02x", $0) }.joined()
  }()

  /// Puts the cookie for `localhost` in the cookie store that `react-native-webview` uses.
  @MainActor
  static func install() async {
    let props: [HTTPCookiePropertyKey: Any] = [
      .domain: "localhost",
      .path: "/",
      .name: PreviewGate.cookieName,
      .value: value,
      HTTPCookiePropertyKey("HttpOnly"): "TRUE",
    ]
    guard let cookie = HTTPCookie(properties: props) else { return }
    await WKWebsiteDataStore.default().httpCookieStore.setCookie(cookie)
  }
}

/// At most `limit` holders at once; the others wait in arrival order. `close()` lets every waiter go.
actor AsyncLimiter {
  private var available: Int
  private var closed = false
  private var waiters: [CheckedContinuation<Bool, Never>] = []

  init(_ limit: Int) { available = limit }

  /// Returns false when the limiter closed: the caller must not go on.
  func acquire() async -> Bool {
    if closed { return false }
    if available > 0 {
      available -= 1
      return true
    }
    return await withCheckedContinuation { waiters.append($0) }
  }

  func release() {
    if !waiters.isEmpty {
      waiters.removeFirst().resume(returning: !closed)
    } else {
      available += 1
    }
  }

  func close() {
    closed = true
    let all = waiters
    waiters = []
    all.forEach { $0.resume(returning: false) }
  }
}

/// Async wrappers for `NWConnection`.
enum Conn {
  /// The next bytes, or nil at the end of the stream.
  static func receive(_ c: NWConnection) async throws -> Data? {
    try await withCheckedThrowingContinuation { cont in
      c.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { data, _, isComplete, error in
        if let data, !data.isEmpty {
          cont.resume(returning: data)
        } else if let error {
          cont.resume(throwing: error)
        } else if isComplete {
          cont.resume(returning: nil)
        } else {
          cont.resume(returning: Data())
        }
      }
    }
  }

  static func send(_ c: NWConnection, _ data: Data) async throws {
    try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
      c.send(content: data, completion: .contentProcessed { error in
        if let error { cont.resume(throwing: error) } else { cont.resume() }
      })
    }
  }

  /// Ends the sending side (TCP FIN) after the data sent before.
  static func finish(_ c: NWConnection) async {
    await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
      c.send(content: nil, contentContext: .finalMessage, isComplete: true, completion: .contentProcessed { _ in cont.resume() })
    }
  }

  /// True when the peer of an accepted connection is on loopback.
  static func fromLoopback(_ c: NWConnection) -> Bool {
    guard case .hostPort(let host, _) = c.endpoint else { return false }
    switch host {
    case .ipv4(let a): return a == .loopback
    case .ipv6(let a): return a == .loopback || a.asIPv4 == .loopback
    case .name(let n, _): return n == "localhost"
    @unknown default: return false
    }
  }
}

struct PreviewError: Error, CustomStringConvertible {
  let description: String
}

/// One running preview: a listener on `127.0.0.1` of the phone. Each accepted connection that
/// passes the gate gets its own exec channel with `command` and raw bytes both ways.
final class PreviewServer: @unchecked Sendable {
  let hostId: String
  let localPort: Int
  private let command: String
  private let listener: NWListener
  private let limiter: AsyncLimiter
  /// Runs `perform` on an exec channel of the host (the module picks the SSH connection).
  private let withChannel: (String, @escaping (TTYOutput, TTYStdinWriter) async throws -> Void) async throws -> Void
  private let queue: DispatchQueue
  private let lock = NSLock()
  private var connections: [ObjectIdentifier: NWConnection] = [:]
  private var stopped = false

  private init(
    hostId: String, localPort: Int, command: String, listener: NWListener, limiter: AsyncLimiter, queue: DispatchQueue,
    withChannel: @escaping (String, @escaping (TTYOutput, TTYStdinWriter) async throws -> Void) async throws -> Void
  ) {
    self.hostId = hostId
    self.localPort = localPort
    self.command = command
    self.listener = listener
    self.limiter = limiter
    self.queue = queue
    self.withChannel = withChannel
  }

  /// Binds `127.0.0.1:port`, else a free loopback port, and starts to accept.
  static func start(
    hostId: String, port: Int, command: String, limiter: AsyncLimiter,
    withChannel: @escaping (String, @escaping (TTYOutput, TTYStdinWriter) async throws -> Void) async throws -> Void
  ) async throws -> PreviewServer {
    let queue = DispatchQueue(label: "herdling.preview.\(port)")
    // The listener starts before the server object exists; connections before it are refused.
    let box = ServerBox()
    let accept: @Sendable (NWConnection) -> Void = { conn in
      guard let server = box.server else { conn.cancel(); return }
      server.accept(conn)
    }
    let listener: NWListener
    do {
      listener = try await listen(port: UInt16(port), queue: queue, accept: accept)
    } catch {
      listener = try await listen(port: 0, queue: queue, accept: accept)
    }
    guard let bound = listener.port?.rawValue else {
      listener.cancel()
      throw PreviewError(description: "the listener has no port")
    }
    let server = PreviewServer(
      hostId: hostId, localPort: Int(bound), command: command, listener: listener, limiter: limiter, queue: queue,
      withChannel: withChannel)
    box.server = server
    return server
  }

  /// A listener on loopback only. `port` 0 picks a free port.
  private static func listen(port: UInt16, queue: DispatchQueue, accept: @escaping @Sendable (NWConnection) -> Void) async throws -> NWListener {
    let params = NWParameters.tcp
    params.requiredInterfaceType = .loopback
    params.allowLocalEndpointReuse = false
    params.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: NWEndpoint.Port(rawValue: port) ?? .any)
    let listener = try NWListener(using: params)
    listener.newConnectionHandler = accept
    let ready = OnceSignal()
    listener.stateUpdateHandler = { state in
      switch state {
      case .ready: ready.resolve(nil)
      case .failed(let e): ready.resolve(ExecOpenError(reason: e.debugDescription))
      case .cancelled: ready.resolve(ExecOpenError(reason: "cancelled"))
      default: break
      }
    }
    listener.start(queue: queue)
    if let error = await ready.wait() {
      listener.cancel()
      throw PreviewError(description: error.reason)
    }
    return listener
  }

  func stop() {
    let conns: [NWConnection] = lock.withLock {
      stopped = true
      defer { connections = [:] }
      return Array(connections.values)
    }
    listener.cancel()
    conns.forEach { $0.cancel() }
  }

  private func accept(_ conn: NWConnection) {
    let id = ObjectIdentifier(conn)
    let ok: Bool = lock.withLock {
      if stopped { return false }
      connections[id] = conn
      return true
    }
    guard ok, Conn.fromLoopback(conn) else {
      conn.cancel()
      return
    }
    conn.start(queue: queue)
    Task {
      await self.serve(conn)
      conn.cancel()
      _ = self.lock.withLock { self.connections.removeValue(forKey: id) }
    }
  }

  private func serve(_ conn: NWConnection) async {
    // The gate: read the request head, then check the cookie.
    var head = [UInt8]()
    while true {
      guard let chunk = try? await Conn.receive(conn) else { return }
      head.append(contentsOf: chunk)
      switch PreviewGate.check(head, cookie: PreviewCookie.value) {
      case .needMore: continue
      case .deny:
        try? await Conn.send(conn, PreviewGate.forbidden)
        await Conn.finish(conn)
        return
      case .allow: break
      }
      break
    }
    guard await limiter.acquire() else { return }
    let firstBytes = head
    do {
      try await withChannel(command) { inbound, outbound in
        try await outbound.write(ByteBuffer(bytes: firstBytes))
        try await withThrowingTaskGroup(of: Void.self) { group in
          group.addTask {
            // Phone to computer. The end of the stream ends the channel.
            while let data = try await Conn.receive(conn) {
              if !data.isEmpty { try await outbound.write(ByteBuffer(bytes: data)) }
            }
          }
          group.addTask {
            // Computer to phone. Raw bytes: no text decoding on this path.
            for try await output in inbound {
              if case .stdout(let buffer) = output {
                try await Conn.send(conn, Data(buffer.readableBytesView))
              }
            }
            await Conn.finish(conn)
          }
          try await group.next()
          // Unblocks a receive that waits for the phone side.
          conn.cancel()
          group.cancelAll()
        }
      }
    } catch {
      // A refused grant or a closed connection: the web view sees the socket close.
    }
    await limiter.release()
  }
}

/// Holds the server for the accept handler of its listener.
final class ServerBox: @unchecked Sendable {
  private let lock = NSLock()
  private var value: PreviewServer?
  var server: PreviewServer? {
    get { lock.withLock { value } }
    set { lock.withLock { value = newValue } }
  }
}

/// The running previews, by local port.
final class PreviewRegistry: @unchecked Sendable {
  private let lock = NSLock()
  private var servers: [Int: PreviewServer] = [:]
  private var limiters: [String: AsyncLimiter] = [:]

  /// At most 6 proxy channels at once per host. OpenSSH `MaxSessions` is 10 by default, and the rpc channel uses one.
  static let channelsPerHost = 6

  func limiter(_ hostId: String) -> AsyncLimiter {
    lock.withLock {
      if let l = limiters[hostId] { return l }
      let l = AsyncLimiter(Self.channelsPerHost)
      limiters[hostId] = l
      return l
    }
  }

  func add(_ s: PreviewServer) { lock.withLock { servers[s.localPort] = s } }

  /// Removes the preview. Returns it, and the host's limiter when it was the last preview of its host.
  func remove(_ localPort: Int) -> (PreviewServer, AsyncLimiter?)? {
    lock.withLock {
      guard let s = servers.removeValue(forKey: localPort) else { return nil }
      let last = !servers.values.contains { $0.hostId == s.hostId }
      return (s, last ? limiters.removeValue(forKey: s.hostId) : nil)
    }
  }

  func removeAll() -> [PreviewServer] {
    lock.withLock {
      defer {
        servers = [:]
        limiters = [:]
      }
      return Array(servers.values)
    }
  }
}
