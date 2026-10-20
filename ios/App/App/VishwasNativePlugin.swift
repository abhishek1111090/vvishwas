import Foundation
import AVFoundation
import UIKit
import Capacitor

/// Root view controller: a CAPBridgeViewController that registers the
/// app-local VishwasNative plugin (see SceneDelegate.swift).
class VishwasBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(VishwasNativePlugin())
    }
}

/// VishwasNative — app-local Capacitor plugin (JS side: src/platform/vishwasNative.js).
///
/// iOS scope:
///  • camera / microphone authorization status and requests (AVCaptureDevice)
///  • openAppSettings() after a permanent denial
///  • SMS: iOS does not let apps send SMS without the user tapping Send,
///    so the SMS methods report "unavailable" and the JS layer falls back
///    to opening the Messages composer (reported as "not confirmed sent").
@objc(VishwasNativePlugin)
public class VishwasNativePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "VishwasNativePlugin"
    public let jsName = "VishwasNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "checkMediaPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestMediaPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkSmsPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestSmsPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sendSms", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openAppSettings", returnType: CAPPluginReturnPromise)
    ]

    private func stateString(_ status: AVAuthorizationStatus) -> String {
        switch status {
        case .authorized: return "granted"
        case .denied, .restricted: return "denied"
        case .notDetermined: return "prompt"
        @unknown default: return "prompt"
        }
    }

    private func hasDevice(_ type: AVMediaType) -> Bool {
        return AVCaptureDevice.default(for: type) != nil
    }

    private func mediaStates() -> [String: Any] {
        return [
            "camera": hasDevice(.video) ? stateString(AVCaptureDevice.authorizationStatus(for: .video)) : "unavailable",
            "microphone": hasDevice(.audio) ? stateString(AVCaptureDevice.authorizationStatus(for: .audio)) : "unavailable"
        ]
    }

    @objc func checkMediaPermissions(_ call: CAPPluginCall) {
        call.resolve(mediaStates())
    }

    @objc func requestMediaPermissions(_ call: CAPPluginCall) {
        let requested = (call.getArray("permissions") as? [String]) ?? ["camera", "microphone"]
        let group = DispatchGroup()
        for name in requested {
            let type: AVMediaType = name == "camera" ? .video : .audio
            guard hasDevice(type), AVCaptureDevice.authorizationStatus(for: type) == .notDetermined else { continue }
            group.enter()
            AVCaptureDevice.requestAccess(for: type) { _ in group.leave() }
        }
        group.notify(queue: .main) { [weak self] in
            guard let self = self else { return }
            call.resolve(self.mediaStates())
        }
    }

    @objc func checkSmsPermission(_ call: CAPPluginCall) {
        call.resolve(["sms": "unavailable"])
    }

    @objc func requestSmsPermission(_ call: CAPPluginCall) {
        call.resolve(["sms": "unavailable"])
    }

    @objc func sendSms(_ call: CAPPluginCall) {
        call.reject("iOS does not allow sending SMS without user confirmation", "UNAVAILABLE")
    }

    @objc func openAppSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let url = URL(string: UIApplication.openSettingsURLString) else {
                call.reject("Settings URL unavailable", "SETTINGS_UNAVAILABLE")
                return
            }
            UIApplication.shared.open(url, options: [:]) { opened in
                if opened {
                    call.resolve()
                } else {
                    call.reject("Could not open Settings", "SETTINGS_UNAVAILABLE")
                }
            }
        }
    }
}
