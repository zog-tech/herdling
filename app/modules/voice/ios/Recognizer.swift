import AVFAudio
import Foundation
import Speech

/// Rejection codes the JS side sees: "busy", "denied", "unavailable", "recognition_failed", "timeout", "cancelled",
/// "not_recording".
struct DictationError: Error {
  let code: String
  let message: String

  static let busy = DictationError(code: "busy", message: "Dictation is already running")
  static let cancelled = DictationError(code: "cancelled", message: "Dictation was cancelled")
  static let timeout = DictationError(code: "timeout", message: "Speech recognition did not finish in time")
  static func denied(_ message: String) -> DictationError { DictationError(code: "denied", message: message) }
  static func unavailable(_ message: String) -> DictationError { DictationError(code: "unavailable", message: message) }
  static func failed(_ error: Error) -> DictationError {
    error as? DictationError ?? DictationError(code: "recognition_failed", message: error.localizedDescription)
  }
}

typealias PartialHandler = @Sendable (String) -> Void
typealias ErrorHandler = @Sendable (_ code: String, _ message: String) -> Void

/// One dictation run of one engine. The Recognizer owns the microphone and feeds it buffers.
protocol DictationSession: AnyObject, Sendable {
  /// Sets up recognition for microphone buffers in `inputFormat`. Called before audio starts.
  func prepare(inputFormat: AVAudioFormat) async throws
  /// Called on the audio thread for every microphone buffer.
  func append(_ buffer: AVAudioPCMBuffer)
  /// The microphone has stopped: waits for and returns the final text.
  func finish() async throws -> String
  /// Drops the run. A pending `finish` ends with an error.
  func cancel() async
}

typealias LevelHandler = @Sendable (Double) -> Void
typealias HaltHandler = @Sendable (_ reason: String) -> Void

/// What `stopRecording` gives back: the WAV file, its length, and the live text when live
/// recognition ran (nil when it did not run or failed).
struct Recorded {
  let uri: String
  let durationMs: Int
  let text: String?
}

/// Dictation and recording: one run at a time. The audio session is active only while a run is.
/// A dictation run feeds live recognition only. A recording run writes a WAV file and can also
/// feed live recognition. Both emit a level for the waveform.
actor Recognizer {
  private struct Run {
    let engine: AVAudioEngine
    let session: DictationSession?
    let writer: WavWriter?
    let observer: NSObjectProtocol
  }

  /// Wait for the final text at most this long after the microphone stops.
  private static let finishTimeout: Duration = .seconds(5)

  private let onPartial: PartialHandler
  private let onError: ErrorHandler
  private let onLevel: LevelHandler
  private let onHalt: HaltHandler
  private var run: Run?
  private var starting = false
  /// `stop` is waiting for the final text; the audio session is still ours.
  private var finishing = false
  /// A stop or cancel came while `start` was still setting up.
  private var dropWhenStarted = false
  /// The microphone stopped by itself ("limit" or "interrupted"). The run waits for a stop.
  private var halted = false

  init(onPartial: @escaping PartialHandler, onError: @escaping ErrorHandler, onLevel: @escaping LevelHandler, onHalt: @escaping HaltHandler) {
    self.onPartial = onPartial
    self.onError = onError
    self.onLevel = onLevel
    self.onHalt = onHalt
  }

  /// Asks for microphone and speech recognition access. True only when both are granted.
  static func requestPermission() async -> Bool {
    let mic = await AVAudioApplication.requestRecordPermission()
    let speech = await withCheckedContinuation { (c: CheckedContinuation<SFSpeechRecognizerAuthorizationStatus, Never>) in
      SFSpeechRecognizer.requestAuthorization { c.resume(returning: $0) }
    }
    return mic && speech == .authorized
  }

  /// Asks for microphone access only (a recording for Parakeet or the host). True when granted.
  static func requestMicPermission() async -> Bool {
    await AVAudioApplication.requestRecordPermission()
  }

  /// True while dictation or a recording owns the audio session.
  var isBusy: Bool { run != nil || starting || finishing }

  /// Switches to the speech audio session unless dictation runs. The check and the switch cannot be split by a start.
  func activateSpeech() throws {
    guard !isBusy else { throw DictationError.busy }
    try AudioSession.activateForSpeech()
  }

  /// Ends the speech audio session unless dictation runs.
  func releaseSpeech() {
    guard !isBusy else { return }
    AudioSession.deactivate()
  }

  /// Starts live dictation.
  func start(localeId: String?) async throws {
    try await begin(live: true, record: false, localeId: localeId)
  }

  /// Starts a recording to a WAV file. `live`: also run live recognition (the Apple engine).
  func startRecording(live: Bool, localeId: String?) async throws {
    try await begin(live: live, record: true, localeId: localeId)
  }

  private func begin(live: Bool, record: Bool, localeId: String?) async throws {
    guard run == nil, !starting, !finishing else { throw DictationError.busy }
    guard AVAudioApplication.shared.recordPermission == .granted else {
      throw DictationError.denied("Microphone access is off. Turn it on in Settings.")
    }
    starting = true
    dropWhenStarted = false
    halted = false
    defer { starting = false }

    let locale = localeId.map(Locale.init(identifier:)) ?? Locale.current
    let session = live ? try await makeSession(locale: locale) : nil
    let engine = AVAudioEngine()
    var writer: WavWriter?
    do {
      try AudioSession.activate()
      let input = engine.inputNode
      let format = input.outputFormat(forBus: 0)
      guard format.sampleRate > 0, format.channelCount > 0 else {
        throw DictationError.unavailable("No microphone input")
      }
      try await session?.prepare(inputFormat: format)
      if record { writer = try WavWriter(inputFormat: format) }
      let meter = LevelMeter(emit: onLevel)
      let file = writer
      let capped = Flag()
      input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
        session?.append(buffer)
        meter.feed(buffer)
        if let file, file.append(buffer), capped.setOnce() {
          Task { await self?.halt(reason: "limit") }
        }
      }
      engine.prepare()
      try engine.start()
    } catch {
      Self.stopAudio(engine)
      await session?.cancel()
      writer?.discard()
      AudioSession.deactivate()
      throw DictationError.failed(error)
    }

    if dropWhenStarted {
      Self.stopAudio(engine)
      await session?.cancel()
      writer?.discard()
      AudioSession.deactivate()
      throw DictationError.cancelled
    }
    // A call or Siri takes the microphone: stop it and keep what was recorded.
    let observer = NotificationCenter.default.addObserver(
      forName: AVAudioSession.interruptionNotification, object: AVAudioSession.sharedInstance(), queue: nil
    ) { [weak self] note in
      let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
      guard raw.flatMap(AVAudioSession.InterruptionType.init(rawValue:)) == .began else { return }
      Task { await self?.halt(reason: "interrupted") }
    }
    run = Run(engine: engine, session: session, writer: writer, observer: observer)
  }

  /// Stops the microphone but keeps the run, so a later stop still returns the text and the file.
  private func halt(reason: String) {
    guard let run, !halted else { return }
    halted = true
    Self.stopAudio(run.engine)
    onHalt(reason)
  }

  /// Stops the microphone and returns the final text. Returns "" when nothing runs.
  func stop() async throws -> String {
    guard let run else {
      if starting { dropWhenStarted = true }
      return ""
    }
    // A recording run that JS stops with the dictation call: drop its file.
    run.writer?.discard()
    guard let session = run.session else {
      end(run)
      return ""
    }
    return try await finishLive(run, session: session)
  }

  /// Stops a recording and returns its file. The live text is nil when live recognition did not
  /// run or failed: the caller can still transcribe the file.
  func stopRecording() async throws -> Recorded {
    guard let run, let writer = run.writer else {
      if starting { dropWhenStarted = true }
      throw DictationError(code: "not_recording", message: "No recording runs")
    }
    let durationMs = writer.finish()
    var text: String?
    if let session = run.session {
      text = try? await finishLive(run, session: session)
    } else {
      end(run)
    }
    return Recorded(uri: writer.url.absoluteString, durationMs: durationMs, text: text)
  }

  /// Ends the run with its audio; the session finish is raced against the timeout.
  private func finishLive(_ run: Run, session: DictationSession) async throws -> String {
    self.run = nil
    finishing = true
    Self.stopAudio(run.engine)
    NotificationCenter.default.removeObserver(run.observer)
    defer {
      AudioSession.deactivate()
      finishing = false
    }
    // Race the final text against the timeout. Not a task group: it would wait for a `finish`
    // that only a cancel can end. The session is cancelled after the race, so a timeout always
    // reaches JS as "timeout", never as a silent "cancelled".
    let outcome = await Self.firstOf(session: session, timeout: Self.finishTimeout)
    switch outcome {
    case .success(let text):
      return text
    case .failure(let error):
      // A timed-out or failed finish may still wait on the recognizer: drop it.
      await session.cancel()
      throw DictationError.failed(error)
    }
  }

  private func end(_ run: Run) {
    self.run = nil
    Self.stopAudio(run.engine)
    NotificationCenter.default.removeObserver(run.observer)
    AudioSession.deactivate()
  }

  /// Stops the microphone and drops the transcript and the file.
  func cancel() async {
    guard let run else {
      if starting { dropWhenStarted = true }
      return
    }
    self.run = nil
    Self.stopAudio(run.engine)
    NotificationCenter.default.removeObserver(run.observer)
    await run.session?.cancel()
    run.writer?.discard()
    AudioSession.deactivate()
  }

  private func makeSession(locale: Locale) async throws -> DictationSession {
    if #available(iOS 26, *), let session = await AnalyzerSession.make(locale: locale, onPartial: onPartial, onError: onError) {
      return session
    }
    return try SFSession(locale: locale, onPartial: onPartial, onError: onError)
  }

  private static func firstOf(session: DictationSession, timeout: Duration) async -> Result<String, Error> {
    let once = Once<Result<String, Error>>()
    return await withCheckedContinuation { (c: CheckedContinuation<Result<String, Error>, Never>) in
      once.continuation = c
      Task {
        do { once.resume(.success(try await session.finish())) } catch { once.resume(.failure(error)) }
      }
      Task {
        try? await Task.sleep(for: timeout)
        once.resume(.failure(DictationError.timeout))
      }
    }
  }

  private static func stopAudio(_ engine: AVAudioEngine) {
    engine.inputNode.removeTap(onBus: 0)
    engine.stop()
  }
}

/// True once: the first `setOnce` returns true, every later one false.
private final class Flag: @unchecked Sendable {
  private let lock = NSLock()
  private var set = false

  func setOnce() -> Bool {
    lock.withLock {
      defer { set = true }
      return !set
    }
  }
}

/// Resumes a continuation with the first value only.
private final class Once<T>: @unchecked Sendable {
  private let lock = NSLock()
  private var done = false
  var continuation: CheckedContinuation<T, Never>?

  func resume(_ value: T) {
    let c: CheckedContinuation<T, Never>? = lock.withLock {
      guard !done, let c = continuation else { return nil }
      done = true
      continuation = nil
      return c
    }
    c?.resume(returning: value)
  }
}

enum AudioSession {
  static func activate() throws {
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.playAndRecord, mode: .default, options: [.duckOthers, .allowBluetoothHFP, .defaultToSpeaker])
    try session.setActive(true)
  }

  /// Playback for text-to-speech: ducks other audio, lets AirPods play it.
  static func activateForSpeech() throws {
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.playback, mode: .default, options: [.duckOthers, .allowBluetoothA2DP])
    try session.setActive(true)
  }

  /// Lets other audio and text-to-speech play again.
  static func deactivate() {
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }
}

// MARK: - SFSpeechRecognizer (iOS 17+)

/// Joins two pieces of transcript with one space.
func joinText(_ a: String, _ b: String) -> String {
  let a = a.trimmingCharacters(in: .whitespaces)
  let b = b.trimmingCharacters(in: .whitespaces)
  if a.isEmpty { return b }
  if b.isEmpty { return a }
  return a + " " + b
}

/// SFSpeechRecognizer, on-device when the locale supports it.
///
/// A long run must not lose text. SF can start a new transcript after a pause, can end its task
/// with a final result, or can end it with "no speech" while the user still records. The text
/// so far goes into `committed`, and a new task starts on a new request.
final class SFSession: DictationSession, @unchecked Sendable {
  private let recognizer: SFSpeechRecognizer
  private let onPartial: PartialHandler
  private let onError: ErrorHandler
  private let lock = NSLock()
  private var request = SFSpeechAudioBufferRecognitionRequest()
  private var task: SFSpeechRecognitionTask?
  /// Text of tasks and transcripts that ended.
  private var committed = ""
  /// The transcript of the current task.
  private var latest = ""
  /// Counts tasks, so a late callback of an old task is ignored.
  private var generation = 0
  private var stopping = false
  private var outcome: Result<String, DictationError>?
  private var waiter: CheckedContinuation<String, Error>?

  init(locale: Locale, onPartial: @escaping PartialHandler, onError: @escaping ErrorHandler) throws {
    guard SFSpeechRecognizer.authorizationStatus() == .authorized else {
      throw DictationError.denied("Speech recognition access is off. Turn it on in Settings.")
    }
    guard let recognizer = SFSpeechRecognizer(locale: locale) else {
      throw DictationError.unavailable("Speech recognition does not support \(locale.identifier)")
    }
    guard recognizer.isAvailable else {
      throw DictationError.unavailable("Speech recognition is not available right now")
    }
    self.recognizer = recognizer
    self.onPartial = onPartial
    self.onError = onError
  }

  func prepare(inputFormat: AVAudioFormat) async throws {
    lock.withLock { startTask() }
  }

  /// Starts a task on a fresh request. Call with the lock held.
  private func startTask() {
    let request = SFSpeechAudioBufferRecognitionRequest()
    request.shouldReportPartialResults = true
    request.taskHint = .dictation
    request.addsPunctuation = true
    if recognizer.supportsOnDeviceRecognition {
      request.requiresOnDeviceRecognition = true
    }
    self.request = request
    generation += 1
    let gen = generation
    task = recognizer.recognitionTask(with: request) { [weak self] result, error in
      self?.handle(result: result, error: error, generation: gen)
    }
  }

  func append(_ buffer: AVAudioPCMBuffer) {
    lock.withLock { request }.append(buffer)
  }

  func finish() async throws -> String {
    let (done, request) = lock.withLock {
      stopping = true
      return (outcome, self.request)
    }
    if let done { return try done.get() }
    request.endAudio()
    return try await withCheckedThrowingContinuation { c in
      lock.lock()
      if let outcome {
        lock.unlock()
        c.resume(with: outcome)
        return
      }
      waiter = c
      lock.unlock()
    }
  }

  func cancel() async {
    let (task, request) = lock.withLock {
      stopping = true
      return (self.task, self.request)
    }
    task?.cancel()
    request.endAudio()
    resolve(.failure(.cancelled))
  }

  private func handle(result: SFSpeechRecognitionResult?, error: Error?, generation gen: Int) {
    lock.lock()
    guard gen == generation else {
      lock.unlock()
      return
    }
    if let result {
      let text = result.bestTranscription.formattedString
      // A new transcript after a pause: it shares no first word with the old one and is
      // shorter. Keep the old one.
      if !latest.isEmpty && text.count < latest.count && Self.firstWord(text) != Self.firstWord(latest) {
        committed = joinText(committed, latest)
      }
      latest = text
    }
    let full = joinText(committed, latest)
    let stopping = self.stopping
    let noSpeech = (error as NSError?).map { $0.domain == "kAFAssistantErrorDomain" && $0.code == 1110 } ?? false
    // The task ended while the user still records: keep its text and go on with a new task.
    if !stopping && ((result?.isFinal ?? false) || noSpeech) {
      committed = full
      latest = ""
      startTask()
      lock.unlock()
      return
    }
    lock.unlock()

    if let result, result.isFinal {
      resolve(.success(full))
      return
    }
    if let error = error as NSError? {
      // 1110 = no speech detected: the text so far (maybe empty), not a failure.
      if stopping && noSpeech {
        resolve(.success(full))
        return
      }
      let failure = DictationError(code: "recognition_failed", message: error.localizedDescription)
      let first = resolve(.failure(failure))
      if !stopping && first { onError(failure.code, failure.message) }
      return
    }
    if result != nil && !stopping { onPartial(full) }
  }

  private static func firstWord(_ s: String) -> String {
    s.split(separator: " ", maxSplits: 1).first.map { $0.lowercased() } ?? ""
  }

  /// Stores the first outcome and wakes a waiting `finish`. Returns false when an outcome was already stored.
  @discardableResult
  private func resolve(_ value: Result<String, DictationError>) -> Bool {
    lock.lock()
    guard outcome == nil else {
      lock.unlock()
      return false
    }
    outcome = value
    let c = waiter
    waiter = nil
    lock.unlock()
    c?.resume(with: value)
    return true
  }
}

// MARK: - SpeechAnalyzer (iOS 26+)

/// SpeechAnalyzer + SpeechTranscriber. Used only when the locale's model is already installed.
@available(iOS 26, *)
final class AnalyzerSession: DictationSession, @unchecked Sendable {
  private let transcriber: SpeechTranscriber
  private let analyzer: SpeechAnalyzer
  private let onPartial: PartialHandler
  private let onError: ErrorHandler
  private let stream: AsyncStream<AnalyzerInput>
  private let input: AsyncStream<AnalyzerInput>.Continuation
  private let lock = NSLock()
  private var stopping = false
  private var format: AVAudioFormat?
  private var converter: AVAudioConverter?
  private var results: Task<String, Error>?

  static func make(locale: Locale, onPartial: @escaping PartialHandler, onError: @escaping ErrorHandler) async -> AnalyzerSession? {
    guard SpeechTranscriber.isAvailable,
          let supported = await SpeechTranscriber.supportedLocale(equivalentTo: locale)
    else { return nil }
    let transcriber = SpeechTranscriber(
      locale: supported,
      transcriptionOptions: [],
      reportingOptions: [.volatileResults],
      attributeOptions: []
    )
    guard await AssetInventory.status(forModules: [transcriber]) == .installed else { return nil }
    return AnalyzerSession(transcriber: transcriber, onPartial: onPartial, onError: onError)
  }

  private init(transcriber: SpeechTranscriber, onPartial: @escaping PartialHandler, onError: @escaping ErrorHandler) {
    self.transcriber = transcriber
    self.analyzer = SpeechAnalyzer(modules: [transcriber])
    self.onPartial = onPartial
    self.onError = onError
    (stream, input) = AsyncStream.makeStream(of: AnalyzerInput.self)
  }

  func prepare(inputFormat: AVAudioFormat) async throws {
    guard let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber], considering: inputFormat) else {
      throw DictationError.unavailable("No audio format for speech recognition")
    }
    if format != inputFormat {
      guard let converter = AVAudioConverter(from: inputFormat, to: format) else {
        throw DictationError.unavailable("Cannot convert microphone audio")
      }
      converter.primeMethod = .none
      lock.withLock {
        self.converter = converter
        self.format = format
      }
    }
    try await analyzer.prepareToAnalyze(in: format)

    let transcriber = transcriber
    let onPartial = onPartial
    results = Task { [weak self] in
      var done = ""
      do {
        for try await result in transcriber.results {
          let text = String(result.text.characters)
          // Final segments join with a space; a volatile result shows after them.
          if result.isFinal {
            done = joinText(done, text)
            onPartial(done)
          } else {
            onPartial(joinText(done, text))
          }
        }
      } catch {
        if let self, !self.isStopping {
          let failure = DictationError.failed(error)
          self.onError(failure.code, failure.message)
        }
        throw error
      }
      return done
    }
    try await analyzer.start(inputSequence: stream)
  }

  func append(_ buffer: AVAudioPCMBuffer) {
    guard let converted = convert(buffer) else { return }
    input.yield(AnalyzerInput(buffer: converted))
  }

  func finish() async throws -> String {
    lock.withLock { stopping = true }
    input.finish()
    try await analyzer.finalizeAndFinishThroughEndOfInput()
    return try await results?.value ?? ""
  }

  func cancel() async {
    lock.withLock { stopping = true }
    input.finish()
    await analyzer.cancelAndFinishNow()
    results?.cancel()
  }

  private var isStopping: Bool { lock.withLock { stopping } }

  private func convert(_ buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
    let (converter, format) = lock.withLock { (self.converter, self.format) }
    guard let converter, let format else { return buffer }
    let ratio = format.sampleRate / buffer.format.sampleRate
    let capacity = AVAudioFrameCount((Double(buffer.frameLength) * ratio).rounded(.up)) + 1
    guard let out = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else { return nil }
    var fed = false
    var error: NSError?
    converter.convert(to: out, error: &error) { _, status in
      if fed {
        status.pointee = .noDataNow
        return nil
      }
      fed = true
      status.pointee = .haveData
      return buffer
    }
    return error == nil && out.frameLength > 0 ? out : nil
  }
}
