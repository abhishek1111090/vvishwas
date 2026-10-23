import AVFoundation
import ExpoModulesCore
import UIKit

/**
 Front + back cameras at the same time (AVCaptureMultiCamSession, iPhone XS/XR+).

 • Preview: back camera fills the view, front camera in a small corner window.
 • Recording: two separate movie files, one per camera, started and stopped together.
 • Photo + zoom act on the back camera.
 • Everything that touches the session runs on `queue`; results reported to JS
   are what AVFoundation actually returned.
 */
final class DualCameraView: ExpoView, AVCaptureFileOutputRecordingDelegate, AVCapturePhotoCaptureDelegate {
  let onReady = EventDispatcher()
  let onError = EventDispatcher()
  let onInterrupted = EventDispatcher()

  private let session = AVCaptureMultiCamSession()
  private let queue = DispatchQueue(label: "vishwas.dualcamera.session")
  private lazy var backPreview = AVCaptureVideoPreviewLayer(sessionWithNoConnection: session)
  private lazy var frontPreview = AVCaptureVideoPreviewLayer(sessionWithNoConnection: session)
  private let backOutput = AVCaptureMovieFileOutput()
  private let frontOutput = AVCaptureMovieFileOutput()
  private let photoOutput = AVCapturePhotoOutput()
  private var backDevice: AVCaptureDevice?

  private var configured = false
  private var isRecording = false
  private var stopping = false
  private var results: [String: [String: Any]] = [:]   // "back" / "front" → { uri?, error? }
  private var stopCompletion: (([String: Any]) -> Void)?
  private var photoCompletion: ((String?, String?) -> Void)?
  private var zoom: Double = 0

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .black
    clipsToBounds = true

    backPreview.videoGravity = .resizeAspectFill
    frontPreview.videoGravity = .resizeAspectFill
    frontPreview.cornerRadius = 10
    frontPreview.masksToBounds = true
    frontPreview.borderWidth = 2
    frontPreview.borderColor = UIColor.white.withAlphaComponent(0.85).cgColor
    layer.addSublayer(backPreview)
    layer.addSublayer(frontPreview)

    let nc = NotificationCenter.default
    nc.addObserver(self, selector: #selector(sessionInterrupted(_:)), name: AVCaptureSession.wasInterruptedNotification, object: session)
    nc.addObserver(self, selector: #selector(sessionRuntimeError(_:)), name: AVCaptureSession.runtimeErrorNotification, object: session)
    nc.addObserver(self, selector: #selector(sessionInterruptionEnded(_:)), name: AVCaptureSession.interruptionEndedNotification, object: session)

    queue.async { [weak self] in self?.configureAndStart() }
  }

  deinit {
    NotificationCenter.default.removeObserver(self)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    backPreview.frame = bounds
    let w = (bounds.width * 0.30).rounded()
    let h = (w * 4 / 3).rounded()
    frontPreview.frame = CGRect(x: bounds.width - w - 12, y: 56, width: w, height: h)
    CATransaction.commit()
  }

  override func removeFromSuperview() {
    super.removeFromSuperview()
    queue.async { [session] in
      if session.isRunning { session.stopRunning() }
    }
  }

  // MARK: - Setup

  private func configureAndStart() {
    guard AVCaptureMultiCamSession.isMultiCamSupported else {
      emitError("This iPhone can't record front and back at the same time.")
      return
    }
    guard
      let back = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
      let front = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front)
    else {
      emitError("Front or back camera not found.")
      return
    }
    backDevice = back

    session.beginConfiguration()
    do {
      try selectMultiCamFormat(back)
      try selectMultiCamFormat(front)
      let backPort = try addInput(back)
      let frontPort = try addInput(front)

      try connect(port: backPort, to: backOutput)
      try connect(port: frontPort, to: frontOutput)
      try connect(port: backPort, to: photoOutput)
      try connect(port: backPort, preview: backPreview)
      try connect(port: frontPort, preview: frontPreview)
    } catch {
      session.commitConfiguration()
      emitError((error as? DualCameraError)?.message ?? error.localizedDescription)
      return
    }
    session.commitConfiguration()

    if session.hardwareCost > 1.0 {
      emitError("Running both cameras is too demanding on this iPhone (cost \(String(format: "%.2f", session.hardwareCost))).")
      return
    }

    session.startRunning()
    configured = true
    applyZoom()
    DispatchQueue.main.async { [weak self] in
      self?.onReady(["hardwareCost": self?.session.hardwareCost ?? 0])
    }
  }

  /// Multi-cam needs formats flagged isMultiCamSupported; 1280×720 keeps the hardware cost low.
  private func selectMultiCamFormat(_ device: AVCaptureDevice) throws {
    let candidates = device.formats.filter { $0.isMultiCamSupported }
    guard !candidates.isEmpty else { throw DualCameraError("No multi-camera format for \(device.localizedName).") }
    func dims(_ f: AVCaptureDevice.Format) -> CMVideoDimensions { CMVideoFormatDescriptionGetDimensions(f.formatDescription) }
    let preferred = candidates.first { dims($0).width == 1280 && dims($0).height == 720 }
      ?? candidates.filter { dims($0).width >= 640 }.min { dims($0).width < dims($1).width }
      ?? candidates[0]
    try device.lockForConfiguration()
    device.activeFormat = preferred
    device.unlockForConfiguration()
  }

  private func addInput(_ device: AVCaptureDevice) throws -> AVCaptureInput.Port {
    let input = try AVCaptureDeviceInput(device: device)
    guard session.canAddInput(input) else { throw DualCameraError("Can't use \(device.localizedName).") }
    session.addInputWithNoConnections(input)
    guard let port = input.ports(for: .video, sourceDeviceType: device.deviceType, sourceDevicePosition: device.position).first else {
      throw DualCameraError("No video port for \(device.localizedName).")
    }
    return port
  }

  private func connect(port: AVCaptureInput.Port, to output: AVCaptureOutput) throws {
    guard session.canAddOutput(output) else { throw DualCameraError("Can't add a camera output.") }
    session.addOutputWithNoConnections(output)
    let connection = AVCaptureConnection(inputPorts: [port], output: output)
    guard session.canAddConnection(connection) else { throw DualCameraError("Can't connect a camera output.") }
    session.addConnection(connection)
    setPortrait(connection)
  }

  private func connect(port: AVCaptureInput.Port, preview: AVCaptureVideoPreviewLayer) throws {
    let connection = AVCaptureConnection(inputPort: port, videoPreviewLayer: preview)
    guard session.canAddConnection(connection) else { throw DualCameraError("Can't show the camera preview.") }
    session.addConnection(connection)
    setPortrait(connection)
  }

  private func setPortrait(_ connection: AVCaptureConnection) {
    if #available(iOS 17.0, *) {
      if connection.isVideoRotationAngleSupported(90) { connection.videoRotationAngle = 90 }
    } else if connection.isVideoOrientationSupported {
      connection.videoOrientation = .portrait
    }
  }

  // MARK: - Zoom (back camera)

  func setZoom(_ value: Double) {
    zoom = max(0, min(1, value))
    queue.async { [weak self] in self?.applyZoom() }
  }

  private func applyZoom() {
    guard configured, let device = backDevice else { return }
    do {
      try device.lockForConfiguration()
      let maxZoom = max(1.0, device.activeFormat.videoMaxZoomFactor)
      device.videoZoomFactor = min(maxZoom, pow(maxZoom, CGFloat(zoom)))
      device.unlockForConfiguration()
    } catch {
      // Zoom is best-effort; recording continues.
    }
  }

  // MARK: - Recording

  func startRecording() throws {
    guard configured else { throw DualCameraError("The cameras are not ready yet.") }
    guard !isRecording else { return }
    let stamp = Int(Date().timeIntervalSince1970 * 1000)
    let dir = FileManager.default.temporaryDirectory
    let backURL = dir.appendingPathComponent("vishwas-back-\(stamp).mov")
    let frontURL = dir.appendingPathComponent("vishwas-front-\(stamp).mov")
    results = [:]
    stopping = false
    isRecording = true
    queue.async { [weak self] in
      guard let self else { return }
      self.backOutput.startRecording(to: backURL, recordingDelegate: self)
      self.frontOutput.startRecording(to: frontURL, recordingDelegate: self)
    }
  }

  /// Stops both files; completes with { back: {uri?, error?}, front: {uri?, error?} } once both are finished.
  func stopRecording(_ completion: @escaping ([String: Any]) -> Void) {
    queue.async { [weak self] in
      guard let self else { return }
      guard self.isRecording else {
        completion(self.results)
        return
      }
      self.stopping = true
      self.stopCompletion = completion
      if self.backOutput.isRecording { self.backOutput.stopRecording() }
      if self.frontOutput.isRecording { self.frontOutput.stopRecording() }
      self.finishIfDone()
    }
  }

  func fileOutput(_ output: AVCaptureFileOutput, didFinishRecordingTo outputFileURL: URL, from connections: [AVCaptureConnection], error: Error?) {
    queue.async { [weak self] in
      guard let self else { return }
      let key = output === self.backOutput ? "back" : "front"
      // AVFoundation reports some normal endings as errors with "successfully finished" = true.
      let ok = error == nil || ((error as NSError?)?.userInfo[AVErrorRecordingSuccessfullyFinishedKey] as? Bool ?? false)
      var entry: [String: Any] = [:]
      if ok, FileManager.default.fileExists(atPath: outputFileURL.path) {
        entry["uri"] = outputFileURL.absoluteString
      }
      if let error, !ok { entry["error"] = error.localizedDescription }
      self.results[key] = entry
      if !self.stopping {
        // Ended without being asked (interruption, app backgrounded): tell JS so it can save what exists.
        DispatchQueue.main.async { self.onInterrupted(["camera": key]) }
      }
      self.finishIfDone()
    }
  }

  private func finishIfDone() {
    guard results["back"] != nil, results["front"] != nil else { return }
    isRecording = false
    if let completion = stopCompletion {
      stopCompletion = nil
      completion(results)
    }
  }

  // MARK: - Photo (back camera)

  func takePicture(_ completion: @escaping (String?, String?) -> Void) {
    queue.async { [weak self] in
      guard let self else { return }
      guard self.configured else { completion(nil, "The cameras are not ready yet."); return }
      guard self.photoCompletion == nil else { completion(nil, "Already taking a photo."); return }
      self.photoCompletion = completion
      let settings = AVCapturePhotoSettings()
      if #available(iOS 18.0, *), self.photoOutput.isShutterSoundSuppressionSupported {
        settings.isShutterSoundSuppressionEnabled = true
      }
      self.photoOutput.capturePhoto(with: settings, delegate: self)
    }
  }

  func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
    let completion = photoCompletion
    photoCompletion = nil
    if let error {
      completion?(nil, error.localizedDescription)
      return
    }
    guard let data = photo.fileDataRepresentation() else {
      completion?(nil, "No photo data.")
      return
    }
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("vishwas-photo-\(Int(Date().timeIntervalSince1970 * 1000)).jpg")
    do {
      try data.write(to: url)
      completion?(url.absoluteString, nil)
    } catch {
      completion?(nil, error.localizedDescription)
    }
  }

  // MARK: - Session events

  @objc private func sessionInterrupted(_ note: Notification) {
    DispatchQueue.main.async { [weak self] in self?.onInterrupted(["camera": "session"]) }
  }

  @objc private func sessionInterruptionEnded(_ note: Notification) {
    queue.async { [weak self] in
      guard let self, self.configured, !self.session.isRunning else { return }
      self.session.startRunning()
    }
  }

  @objc private func sessionRuntimeError(_ note: Notification) {
    let message = (note.userInfo?[AVCaptureSessionErrorKey] as? Error)?.localizedDescription ?? "Camera error"
    emitError(message)
    queue.async { [weak self] in
      guard let self, self.configured, !self.session.isRunning else { return }
      self.session.startRunning()
    }
  }

  private func emitError(_ message: String) {
    DispatchQueue.main.async { [weak self] in self?.onError(["message": message]) }
  }
}

struct DualCameraError: Error {
  let message: String
  init(_ message: String) { self.message = message }
}
