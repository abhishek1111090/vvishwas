import AVFoundation
import ExpoModulesCore

/// JS: requireOptionalNativeModule('VishwasDualCamera') — null in Expo Go.
public final class VishwasDualCameraModule: Module {
  public func definition() -> ModuleDefinition {
    Name("VishwasDualCamera")

    /// True on iPhones that can run the front and back cameras at once (iPhone XS / XR and newer).
    Function("isSupported") { () -> Bool in
      AVCaptureMultiCamSession.isMultiCamSupported
    }

    View(DualCameraView.self) {
      Events("onReady", "onError", "onInterrupted")

      Prop("zoom") { (view: DualCameraView, zoom: Double) in
        view.setZoom(zoom)
      }

      AsyncFunction("startRecording") { (view: DualCameraView) in
        try view.startRecording()
      }

      AsyncFunction("stopRecording") { (view: DualCameraView, promise: Promise) in
        view.stopRecording { result in
          promise.resolve(result)
        }
      }

      AsyncFunction("takePicture") { (view: DualCameraView, promise: Promise) in
        view.takePicture { uri, error in
          if let uri {
            promise.resolve(["uri": uri])
          } else {
            promise.reject("E_DUAL_PHOTO", error ?? "Could not take the photo")
          }
        }
      }
    }
  }
}
