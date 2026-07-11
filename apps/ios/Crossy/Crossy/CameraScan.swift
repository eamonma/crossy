//
//  CameraScan.swift
//  Crossy
//
//  The camera half of the join panel (AD-2: AVFoundation stays in the app
//  target; CrossyUI renders the verdict and the chrome). Two pieces: the
//  authority that resolves whether scanning can happen at all, and the
//  UIViewRepresentable that runs one capture session with a QR metadata output,
//  emitting raw payloads for the screen's ingest (InviteScan digests them).
//

import AVFoundation
import SwiftUI

/// Whether this device can scan right now: a rear camera exists and the person
/// allowed it (asking first when the question was never put). The composition
/// root maps the verdict to JoinScanState; the simulator has no camera and
/// resolves false, landing the panel on its typed path.
enum CameraScanAuthority {
    static func resolve() async -> Bool {
        guard
            AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
                != nil
        else { return false }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            return true
        case .notDetermined:
            return await AVCaptureDevice.requestAccess(for: .video)
        case .denied, .restricted:
            return false
        @unknown default:
            return false
        }
    }
}

/// One capture session filling its bounds (aspect-fill, the viewport clips),
/// reading QR codes only. Payloads are throttled — the same code lingering in
/// frame emits once a second at most — and delivered on the main queue; the
/// screen's ingest owns dedupe against attempts, this layer only stops the
/// firehose.
struct CameraScanView: UIViewRepresentable {
    let onScan: (String) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onScan: onScan)
    }

    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        context.coordinator.attach(to: view)
        return view
    }

    func updateUIView(_ uiView: PreviewView, context: Context) {}

    static func dismantleUIView(_ uiView: PreviewView, coordinator: Coordinator) {
        coordinator.stop()
    }

    /// The preview layer IS the view's backing layer, so it tracks bounds through
    /// the viewport's fold without a layout observer.
    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var previewLayer: AVCaptureVideoPreviewLayer {
            layer as! AVCaptureVideoPreviewLayer
        }
    }

    /// Session lifecycle and the metadata delegate, confined to one serial queue
    /// (start/stop/configure block, so none of it runs on main).
    final class Coordinator: NSObject, AVCaptureMetadataOutputObjectsDelegate,
        @unchecked Sendable
    {
        private let onScan: (String) -> Void
        private let session = AVCaptureSession()
        private let queue = DispatchQueue(label: "crossy.join.scan")
        private var lastPayload: String?
        private var lastEmit = Date.distantPast

        init(onScan: @escaping (String) -> Void) {
            self.onScan = onScan
        }

        func attach(to view: PreviewView) {
            view.previewLayer.session = session
            view.previewLayer.videoGravity = .resizeAspectFill
            queue.async {
                self.configureIfNeeded()
                if !self.session.isRunning {
                    self.session.startRunning()
                }
            }
        }

        func stop() {
            queue.async {
                if self.session.isRunning {
                    self.session.stopRunning()
                }
            }
        }

        private func configureIfNeeded() {
            guard session.inputs.isEmpty,
                let device = AVCaptureDevice.default(
                    .builtInWideAngleCamera, for: .video, position: .back),
                let input = try? AVCaptureDeviceInput(device: device),
                session.canAddInput(input)
            else { return }
            session.beginConfiguration()
            session.addInput(input)
            let output = AVCaptureMetadataOutput()
            if session.canAddOutput(output) {
                session.addOutput(output)
                output.setMetadataObjectsDelegate(self, queue: queue)
                if output.availableMetadataObjectTypes.contains(.qr) {
                    output.metadataObjectTypes = [.qr]
                }
            }
            session.commitConfiguration()
        }

        func metadataOutput(
            _ output: AVCaptureMetadataOutput,
            didOutput metadataObjects: [AVMetadataObject],
            from connection: AVCaptureConnection
        ) {
            guard
                let payload = metadataObjects
                    .compactMap({ $0 as? AVMetadataMachineReadableCodeObject })
                    .first(where: { $0.type == .qr })?
                    .stringValue
            else { return }
            let now = Date()
            if payload == lastPayload, now.timeIntervalSince(lastEmit) < 1.0 { return }
            lastPayload = payload
            lastEmit = now
            DispatchQueue.main.async {
                self.onScan(payload)
            }
        }
    }
}
