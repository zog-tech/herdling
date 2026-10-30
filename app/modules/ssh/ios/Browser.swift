import Foundation
import Network

/// Browses Bonjour for `_zogssh._tcp` and resolves each service to an address and port.
/// All state lives on `queue`.
final class Browser: @unchecked Sendable {
  static let serviceType = "_zogssh._tcp"
  /// Used as `pairPort` when the service does not resolve (the companion default).
  static let defaultPairPort = 7790
  static let resolveTimeout: TimeInterval = 3

  private let queue = DispatchQueue(label: "zogssh.bonjour")
  private var onFound: ([String: Any]) -> Void = { _ in }
  private var onLost: (String) -> Void = { _ in }
  /// Browse state: "ready", "waiting", "failed" or "stopped", and an error text.
  private var onState: (String, String?) -> Void = { _, _ in }

  private var browser: NWBrowser?
  /// Open resolves by service name. A new result for the same name replaces the old resolve.
  private var resolves: [String: Resolve] = [:]

  /// Starts a browse that reports to the given handlers. A running browse is stopped first.
  func start(
    onFound: @escaping ([String: Any]) -> Void,
    onLost: @escaping (String) -> Void,
    onState: @escaping (String, String?) -> Void
  ) {
    queue.async {
      self.stopOnQueue(report: false)
      self.onFound = onFound
      self.onLost = onLost
      self.onState = onState
      let b = NWBrowser(for: .bonjourWithTXTRecord(type: Browser.serviceType, domain: nil), using: .tcp)
      b.browseResultsChangedHandler = { [weak self, weak b] results, changes in
        guard let self, let b, self.browser === b else { return }
        self.handle(results: results, changes: changes)
      }
      b.stateUpdateHandler = { [weak self, weak b] state in
        guard let self, let b, self.browser === b else { return }
        switch state {
        case .ready:
          self.onState("ready", nil)
        case .waiting(let error):
          // NWBrowser waits here when local network access is denied.
          self.onState("waiting", "\(error)")
        case .failed(let error):
          self.stopOnQueue(report: false)
          self.onState("failed", "\(error)")
        default:
          break
        }
      }
      self.browser = b
      b.start(queue: self.queue)
    }
  }

  func stop() {
    queue.async { self.stopOnQueue(report: true) }
  }

  /// With `report`, a running browse sends "stopped". Callbacks of the old browser are ignored after this.
  private func stopOnQueue(report: Bool) {
    if report && browser != nil { onState("stopped", nil) }
    browser?.cancel()
    browser = nil
    resolves.values.forEach { $0.cancel() }
    resolves.removeAll()
  }

  private func handle(results: Set<NWBrowser.Result>, changes: Set<NWBrowser.Result.Change>) {
    var lost = Set<String>()
    for change in changes {
      switch change {
      case .added(let result):
        resolve(result)
      case .changed(_, let new, _):
        resolve(new)
      case .removed(let result):
        if let name = Browser.name(of: result) { lost.insert(name) }
      default:
        break
      }
    }
    // The same service can show on more than one interface: it is lost only when no result is left.
    let present = Set(results.compactMap(Browser.name(of:)))
    for name in lost.subtracting(present) {
      resolves.removeValue(forKey: name)?.cancel()
      onLost(name)
    }
  }

  private func resolve(_ result: NWBrowser.Result) {
    guard let name = Browser.name(of: result) else { return }
    var txt: [String: String] = [:]
    if case .bonjour(let record) = result.metadata { txt = record.dictionary }

    resolves.removeValue(forKey: name)?.cancel()
    let r = Resolve(endpoint: result.endpoint, queue: queue) { [weak self] address, port in
      guard let self else { return }
      self.resolves.removeValue(forKey: name)
      self.onFound([
        "name": name,
        "address": address.map { $0 as Any } ?? NSNull(),
        "pairPort": port ?? Browser.defaultPairPort,
        "txt": txt,
      ])
    }
    resolves[name] = r
    r.start()
  }

  private static func name(of result: NWBrowser.Result) -> String? {
    if case .service(let name, _, _, _) = result.endpoint { return name }
    return nil
  }
}

/// Opens a TCP connection to a service endpoint to learn its address, then closes it.
/// Tries IPv4 first, then any IP version, within one deadline. Calls `done` once, on `queue`,
/// unless cancelled.
private final class Resolve {
  private let endpoint: NWEndpoint
  private let queue: DispatchQueue
  private var done: ((String?, Int?) -> Void)?
  private var connection: NWConnection?
  private var triedAnyVersion = false
  private var deadline: DispatchWorkItem?

  init(endpoint: NWEndpoint, queue: DispatchQueue, done: @escaping (String?, Int?) -> Void) {
    self.endpoint = endpoint
    self.queue = queue
    self.done = done
  }

  func start() {
    let timeout = DispatchWorkItem { [weak self] in self?.finish(nil, nil) }
    deadline = timeout
    queue.asyncAfter(deadline: .now() + Browser.resolveTimeout, execute: timeout)
    connect(ipv4Only: true)
  }

  /// Stops without calling `done`.
  func cancel() {
    done = nil
    teardown()
  }

  private func connect(ipv4Only: Bool) {
    let params = NWParameters.tcp
    if ipv4Only, let ip = params.defaultProtocolStack.internetProtocol as? NWProtocolIP.Options {
      ip.version = .v4
    }
    let c = NWConnection(to: endpoint, using: params)
    connection = c
    c.stateUpdateHandler = { [weak self, weak c] state in
      guard let self, let c, self.connection === c else { return }
      switch state {
      case .ready:
        let (address, port) = Resolve.hostPort(c.currentPath?.remoteEndpoint)
        self.finish(address, port)
      case .failed, .waiting:
        if self.triedAnyVersion {
          self.finish(nil, nil)
        } else {
          self.triedAnyVersion = true
          c.cancel()
          self.connect(ipv4Only: false)
        }
      default:
        break
      }
    }
    c.start(queue: queue)
  }

  private func finish(_ address: String?, _ port: Int?) {
    let callback = done
    done = nil
    teardown()
    callback?(address, port)
  }

  private func teardown() {
    deadline?.cancel()
    deadline = nil
    connection?.stateUpdateHandler = nil
    connection?.cancel()
    connection = nil
  }

  /// Address text without a `%iface` zone, and the port.
  static func hostPort(_ endpoint: NWEndpoint?) -> (String?, Int?) {
    guard case .hostPort(let host, let port) = endpoint else { return (nil, nil) }
    let text: String
    switch host {
    case .ipv4(let a): text = "\(a)"
    case .ipv6(let a): text = "\(a)"
    case .name(let n, _): text = n
    @unknown default: return (nil, Int(port.rawValue))
    }
    let address = text.split(separator: "%", maxSplits: 1).first.map(String.init)
    return (address?.isEmpty == false ? address : nil, Int(port.rawValue))
  }
}
