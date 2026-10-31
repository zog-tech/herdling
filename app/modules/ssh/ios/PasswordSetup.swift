import Citadel
import ExpoModulesCore
import Foundation
import NIOCore
import NIOSSH

// One-shot password login for "Set up with password". Nothing here is tied to a saved host,
// and nothing keeps the password: it lives only in the options and the auth method of this
// call. It is never logged and never part of an error text.

struct ProbeOptions: Record {
  @Field var host: String = ""
  @Field var port: Int = 22
  @Field var timeoutMs: Int = 10_000
}

struct PasswordExecOptions: Record {
  @Field var host: String = ""
  @Field var port: Int = 22
  @Field var user: String = ""
  @Field var password: String = ""
  @Field var command: String = ""
  @Field var stdin: String = ""
  @Field var expectedFingerprint: String?
  @Field var timeoutMs: Int = 20_000
}

/// Largest stdout + stderr kept from the command.
private let outputLimit = 1 << 20

enum PasswordSetup {
  /// Connects far enough to see the host key, then stops: the key check fails on purpose,
  /// so the connection closes during key exchange, before any login is sent.
  static func probeHostKey(_ o: ProbeOptions) async throws -> [String: String] {
    let check = HostKeyCheck(pinned: nil, rejectAll: true)
    let box = ClientBox()
    let host = o.host, port = o.port, timeoutMs = o.timeoutMs
    return try await withDeadline(ms: timeoutMs, onTimeout: { box.close() }) {
      do {
        let client = try await SSHClient.connect(
          host: host,
          port: port,
          // Never sent: the host key check rejects the key first.
          authenticationMethod: .passwordBased(username: "herdling-probe", password: ""),
          hostKeyValidator: .custom(check),
          reconnect: .never,
          connectTimeout: .milliseconds(Int64(timeoutMs))
        )
        try? await client.close()
      } catch {
        if check.seen == nil {
          throw Exception(name: "ConnectFailed", description: String(describing: error), code: "connect_failed")
        }
      }
      guard let fingerprint = check.seen else {
        throw Exception(name: "ConnectFailed", description: "the host sent no host key", code: "connect_failed")
      }
      return ["fingerprint": fingerprint]
    }
  }

  /// Logs in with the password, runs one command, writes `stdin`, collects the output until the
  /// command ends, and disconnects. A non-zero exit is returned as `exitCode`, not thrown.
  static func execWithPassword(_ o: PasswordExecOptions) async throws -> [String: Any] {
    let check = HostKeyCheck(pinned: o.expectedFingerprint)
    let box = ClientBox()
    let host = o.host, port = o.port, user = o.user, command = o.command, stdin = o.stdin, timeoutMs = o.timeoutMs
    let password = o.password
    return try await withDeadline(ms: timeoutMs, onTimeout: { box.close() }) {
      let client: SSHClient
      do {
        client = try await SSHClient.connect(
          host: host,
          port: port,
          authenticationMethod: .passwordBased(username: user, password: password),
          hostKeyValidator: .custom(check),
          reconnect: .never,
          connectTimeout: .milliseconds(Int64(timeoutMs))
        )
      } catch {
        throw connectError(error, check: check, password: password)
      }
      guard box.set(client) else {
        try? await client.close()
        throw timeoutError()
      }
      do {
        let result = try await run(client, command: command, stdin: stdin)
        try? await client.close()
        return [
          "stdout": result.stdout,
          "stderr": result.stderr,
          "exitCode": result.exitCode,
          "hostFingerprint": check.seen ?? "",
        ]
      } catch {
        try? await client.close()
        throw Exception(name: "ExecFailed", description: redact(String(describing: error), password), code: "exec_failed")
      }
    }
  }

  private static func run(_ client: SSHClient, command: String, stdin: String) async throws
    -> (stdout: String, stderr: String, exitCode: Int)
  {
    var out = Data()
    var err = Data()
    var exitCode = 0
    let ended = EndFlag()
    do {
      try await client.withExec(command) { inbound, outbound in
        if !stdin.isEmpty {
          try await outbound.write(ByteBuffer(string: stdin))
        }
        do {
          for try await chunk in inbound {
            switch chunk {
            case .stdout(let buffer): out.append(contentsOf: buffer.readableBytesView)
            case .stderr(let buffer): err.append(contentsOf: buffer.readableBytesView)
            }
            if out.count + err.count > outputLimit {
              throw OutputTooLarge()
            }
          }
        } catch let failed as SSHClient.CommandFailed {
          exitCode = failed.exitCode
        }
        ended.set()
      }
    } catch {
      // `withExec` closes the channel after `perform`; a close race after a clean end is not a failure.
      if !ended.isSet { throw error }
    }
    return (String(decoding: out, as: UTF8.self), String(decoding: err, as: UTF8.self), exitCode)
  }

  private static func connectError(_ error: Error, check: HostKeyCheck, password: String) -> Exception {
    if check.mismatch {
      return Exception(
        name: "HostKeyMismatch",
        description: "host key \(check.seen ?? "?") does not match the confirmed key",
        code: "host_key_mismatch"
      )
    }
    switch error as? SSHClientError {
    case .allAuthenticationOptionsFailed?, .unsupportedPasswordAuthentication?:
      return Exception(
        name: "AuthFailed",
        description: "the host did not accept the user name and password, or it does not allow password login",
        code: "auth_failed"
      )
    default:
      return Exception(name: "ConnectFailed", description: redact(String(describing: error), password), code: "connect_failed")
    }
  }

  /// Error texts come from Citadel and NIO and should never hold the password; this makes sure.
  private static func redact(_ text: String, _ password: String) -> String {
    password.isEmpty ? text : text.replacingOccurrences(of: password, with: "***")
  }
}

private struct OutputTooLarge: Error, CustomStringConvertible {
  var description: String { "the command printed more than \(outputLimit) bytes" }
}

private func timeoutError() -> Exception {
  Exception(name: "Timeout", description: "the host did not answer in time", code: "timeout")
}

/// The client of a one-shot call, so a timeout can close it. A client set after the
/// timeout is refused, and the caller closes it.
final class ClientBox: @unchecked Sendable {
  private let lock = NSLock()
  private var client: SSHClient?
  private var closed = false

  func set(_ client: SSHClient) -> Bool {
    lock.withLock {
      guard !closed else { return false }
      self.client = client
      return true
    }
  }

  func close() {
    let client: SSHClient? = lock.withLock {
      closed = true
      return self.client
    }
    if let client { Task { try? await client.close() } }
  }
}

/// Resumes a continuation once; later results are dropped.
private final class ResultGate<T>: @unchecked Sendable {
  private let lock = NSLock()
  private var continuation: CheckedContinuation<T, Error>?

  init(_ continuation: CheckedContinuation<T, Error>) {
    self.continuation = continuation
  }

  @discardableResult
  func finish(_ result: Result<T, Error>) -> Bool {
    let c: CheckedContinuation<T, Error>? = lock.withLock {
      defer { continuation = nil }
      return continuation
    }
    c?.resume(with: result)
    return c != nil
  }
}

/// Runs `op` and gives up after `ms`: then it throws "timeout" and calls `onTimeout`, which closes
/// what `op` opened. Citadel's connect does not react to task cancellation, so `op` is not awaited
/// after the deadline; it ends on its own when its connection closes.
private func withDeadline<T>(
  ms: Int,
  onTimeout: @escaping @Sendable () -> Void,
  _ op: @escaping @Sendable () async throws -> T
) async throws -> T {
  try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<T, Error>) in
    let gate = ResultGate(continuation)
    let work = Task {
      do {
        gate.finish(.success(try await op()))
      } catch {
        gate.finish(.failure(error))
      }
    }
    Task {
      try? await Task.sleep(nanoseconds: UInt64(max(ms, 1)) * 1_000_000)
      if gate.finish(.failure(timeoutError())) {
        onTimeout()
        work.cancel()
      }
    }
  }
}
