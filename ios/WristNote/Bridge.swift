import Foundation
import UIKit
import WebKit
import AVFoundation
import PhotosUI

// MARK: - UTF8 增量解码（网络流式分片可能切断多字节字符）

final class UTF8StreamDecoder {
    private var pending = Data()

    func append(_ data: Data) -> String {
        pending.append(data)
        var cut = pending.count
        while cut > 0 {
            let sub = Data(pending.prefix(cut))
            if let s = String(data: sub, encoding: .utf8) {
                pending.removeFirst(cut)
                return s
            }
            if pending.count - cut >= 3 { break }
            cut -= 1
        }
        return ""
    }
}

// MARK: - 流式 HTTP（SSE / chunked）

final class HTTPStream: NSObject, URLSessionDataDelegate {
    let id: Int
    weak var bridge: NativeBridge?
    private var session: URLSession?
    private var decoder = UTF8StreamDecoder()

    init(id: Int, bridge: NativeBridge) {
        self.id = id
        self.bridge = bridge
    }

    func start(_ req: URLRequest) {
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 300
        cfg.timeoutIntervalForResource = 1800
        let s = URLSession(configuration: cfg, delegate: self, delegateQueue: nil)
        session = s
        s.dataTask(with: req).resume()
    }

    func cancel() {
        session?.invalidateAndCancel()
        session = nil
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        let text = decoder.append(data)
        if !text.isEmpty {
            bridge?.emit(event: "chunk", streamId: id, json: bridge?.jsonString(["text": text]) ?? "{}")
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let status = (task.response as? HTTPURLResponse)?.statusCode ?? 0
        if let e = error {
            bridge?.emit(event: "done", streamId: id,
                         json: bridge?.jsonString(["error": e.localizedDescription, "status": status]) ?? "{}")
        } else {
            bridge?.emit(event: "done", streamId: id, json: bridge?.jsonString(["status": status]) ?? "{}")
        }
        bridge?.closeStream(id: id)
    }
}

// MARK: - JS <-> 原生 桥

final class NativeBridge: NSObject, WKScriptMessageHandler, PHPickerViewControllerDelegate {
    weak var webView: WKWebView?
    weak var presenter: UIViewController?
    var safeInsets: UIEdgeInsets = .zero

    private let work = DispatchQueue(label: "wristnote.bridge", qos: .userInitiated)
    private var streams: [Int: HTTPStream] = [:]
    private var recorder: AVAudioRecorder?
    private var recorderURL: URL?
    private var recordStart: Date?
    private var pendingPhotoId: Int = 0

    private var docs: URL {
        return FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    }

    // MARK: 发送给 JS

    func jsonString(_ obj: Any) -> String {
        guard JSONSerialization.isValidJSONObject(obj),
              let d = try? JSONSerialization.data(withJSONObject: obj, options: []),
              var s = String(data: d, encoding: .utf8) else { return "null" }
        s = s.replacingOccurrences(of: "\u{2028}", with: "\\u2028")
        s = s.replacingOccurrences(of: "\u{2029}", with: "\\u2029")
        return s
    }

    func reply(_ id: Int, ok: Bool, json: String) {
        evaluate("window.__nres(\(id),\(ok ? "true" : "false"),\(json));")
    }

    func emit(event: String, streamId: Int, json: String) {
        evaluate("window.__nev(\(streamId),\"\(event)\",\(json));")
    }

    func closeStream(id: Int) {
        work.async { [weak self] in
            self?.streams.removeValue(forKey: id)
        }
    }

    private func evaluate(_ js: String) {
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript(js, completionHandler: nil)
        }
    }

    // MARK: WKScriptMessageHandler

    func userContentController(_ userContentController: WKUserContentController,
                              didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any] else { return }
        let id = body["id"] as? Int ?? 0
        let method = body["method"] as? String ?? ""
        let params = body["params"] as? [String: Any] ?? [:]
        dispatch(id: id, method: method, params: params)
    }

    private func dispatch(id: Int, method: String, params: [String: Any]) {
        switch method {
        case "info":
            let b = Bundle.main.infoDictionary ?? [:]
            let ver = b["CFBundleShortVersionString"] as? String ?? "1.0"
            var info: [String: Any] = [
                "version": ver,
                "ios": UIDevice.current.systemVersion,
                "model": UIDevice.current.model,
                "width": Double(UIScreen.main.bounds.width),
                "height": Double(UIScreen.main.bounds.height),
                "scale": Double(UIScreen.main.scale),
                "safeTop": Double(safeInsets.top),
                "safeBottom": Double(safeInsets.bottom)
            ]
            info["name"] = UIDevice.current.name
            reply(id, ok: true, json: jsonString(info))

        case "http":
            http(id: id, p: params)

        case "fs":
            fileOp(id: id, p: params)

        case "audio.start":
            startRecording(id: id, p: params)

        case "audio.stop":
            stopRecording(id: id, p: params)

        case "audio.cancel":
            cancelRecording(id: id)

        case "audio.level":
            var level: Float = -160
            if let r = recorder, r.isRecording {
                r.updateMeters()
                level = r.averagePower(forChannel: 0)
            }
            reply(id, ok: true, json: jsonString(["level": Double(level)]))

        case "photo.pick":
            pickPhoto(id: id)

        case "openURL":
            if let s = params["url"] as? String, let u = URL(string: s) {
                UIApplication.shared.open(u, options: [:], completionHandler: nil)
            }
            reply(id, ok: true, json: "{}")

        case "share":
            share(id: id, p: params)

        case "haptic":
            DispatchQueue.main.async {
                let g = UIImpactFeedbackGenerator(style: .light)
                g.impactOccurred()
            }
            reply(id, ok: true, json: "{}")

        default:
            reply(id, ok: false, json: jsonString(["error": "unknown method: \(method)"]))
        }
    }

    // MARK: HTTP

    private func http(id: Int, p: [String: Any]) {
        guard let s = p["url"] as? String, let url = URL(string: s) else {
            reply(id, ok: false, json: jsonString(["error": "bad url"]))
            return
        }
        var req = URLRequest(url: url)
        req.httpMethod = (p["method"] as? String) ?? "GET"
        req.timeoutInterval = p["timeout"] as? Double ?? 120
        if let hs = p["headers"] as? [String: Any] {
            for (k, v) in hs {
                if let vs = v as? String { req.setValue(vs, forHTTPHeaderField: k) }
            }
        }
        if let body = p["body"] as? String {
            req.httpBody = body.data(using: .utf8)
        } else if let b64 = p["bodyBase64"] as? String, let d = Data(base64Encoded: b64) {
            req.httpBody = d
        }

        if (p["stream"] as? Bool) == true {
            let st = HTTPStream(id: id, bridge: self)
            work.async { [weak self] in self?.streams[id] = st }
            st.start(req)
            return
        }

        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = req.timeoutInterval
        let sess = URLSession(configuration: cfg)
        sess.dataTask(with: req) { [weak self] data, resp, err in
            guard let self = self else { return }
            sess.finishTasksAndInvalidate()
            if let e = err {
                self.reply(id, ok: false, json: self.jsonString(["error": e.localizedDescription]))
                return
            }
            let r = resp as? HTTPURLResponse
            let body = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
            var out: [String: Any] = ["status": r?.statusCode ?? 0, "body": body]
            if let h = r?.allHeaderFields {
                var hs: [String: String] = [:]
                for (k, v) in h { hs["\(k)"] = "\(v)" }
                out["headers"] = hs
            }
            self.reply(id, ok: true, json: self.jsonString(out))
        }.resume()
    }

    // MARK: 文件

    private func resolve(_ rel: String) -> URL? {
        let base = docs.standardizedFileURL
        let u = base.appendingPathComponent(rel).standardizedFileURL
        if u.path == base.path { return u }
        guard u.path.hasPrefix(base.path + "/") else { return nil }
        return u
    }

    private func fileOp(id: Int, p: [String: Any]) {
        let op = p["op"] as? String ?? ""
        let rel = p["path"] as? String ?? ""
        guard let u = resolve(rel) else {
            reply(id, ok: false, json: jsonString(["error": "bad path"]))
            return
        }
        let fm = FileManager.default
        switch op {
        case "write":
            let text = p["text"] as? String ?? ""
            do {
                try fm.createDirectory(at: u.deletingLastPathComponent(),
                                       withIntermediateDirectories: true, attributes: nil)
                try text.data(using: .utf8)?.write(to: u, options: .atomic)
                reply(id, ok: true, json: "{}")
            } catch {
                reply(id, ok: false, json: jsonString(["error": error.localizedDescription]))
            }

        case "read":
            if let d = try? Data(contentsOf: u), let s = String(data: d, encoding: .utf8) {
                reply(id, ok: true, json: jsonString(["text": s]))
            } else {
                reply(id, ok: false, json: jsonString(["error": "not found"]))
            }

        case "list":
            let names = (try? fm.contentsOfDirectory(atPath: u.path)) ?? []
            reply(id, ok: true, json: jsonString(["names": names.sorted()]))

        case "delete":
            try? fm.removeItem(at: u)
            reply(id, ok: true, json: "{}")

        case "exists":
            reply(id, ok: true, json: jsonString(["exists": fm.fileExists(atPath: u.path)]))

        case "bytes":
            if let d = try? Data(contentsOf: u) {
                reply(id, ok: true, json: jsonString(["base64": d.base64EncodedString()]))
            } else {
                reply(id, ok: false, json: jsonString(["error": "not found"]))
            }

        case "writeBytes":
            if let b64 = p["base64"] as? String, let d = Data(base64Encoded: b64) {
                do {
                    try fm.createDirectory(at: u.deletingLastPathComponent(),
                                           withIntermediateDirectories: true, attributes: nil)
                    try d.write(to: u, options: .atomic)
                    reply(id, ok: true, json: "{}")
                } catch {
                    reply(id, ok: false, json: jsonString(["error": error.localizedDescription]))
                }
            } else {
                reply(id, ok: false, json: jsonString(["error": "bad base64"]))
            }

        case "size":
            let attrs = try? fm.attributesOfItem(atPath: u.path)
            let n = (attrs?[.size] as? NSNumber)?.intValue ?? 0
            reply(id, ok: true, json: jsonString(["size": n]))

        default:
            reply(id, ok: false, json: jsonString(["error": "unknown fs op"]))
        }
    }

    // MARK: 录音（16k 单声道 WAV，直接可给 ASR 用）

    private func startRecording(id: Int, p: [String: Any]) {
        let rel = p["path"] as? String ?? "audio/rec-\(Int(Date().timeIntervalSince1970)).wav"
        guard let u = resolve(rel) else {
            reply(id, ok: false, json: jsonString(["error": "bad path"]))
            return
        }
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playAndRecord, mode: .default,
                                    options: [.defaultToSpeaker, .allowBluetooth, .allowBluetoothA2DP])
            try session.setActive(true)
        } catch {
            reply(id, ok: false, json: jsonString(["error": "audio session: \(error.localizedDescription)"]))
            return
        }

        if session.responds(to: #selector(AVAudioSession.requestRecordPermission(_:))) {
            if session.recordPermission == .denied {
                reply(id, ok: false, json: jsonString(["error": "麦克风权限被拒绝，请到 设置→备忘录 里打开"]))
                return
            }
        }

        session.requestRecordPermission { [weak self] granted in
            guard let self = self else { return }
            guard granted else {
                self.reply(id, ok: false, json: self.jsonString(["error": "麦克风权限被拒绝"]))
                return
            }
            do {
                try FileManager.default.createDirectory(at: u.deletingLastPathComponent(),
                                                        withIntermediateDirectories: true, attributes: nil)
                let settings: [String: Any] = [
                    AVFormatIDKey: Int(kAudioFormatLinearPCM),
                    AVSampleRateKey: 16000.0,
                    AVNumberOfChannelsKey: 1,
                    AVLinearPCMBitDepthKey: 16,
                    AVLinearPCMIsFloatKey: false,
                    AVLinearPCMIsBigEndianKey: false
                ]
                let r = try AVAudioRecorder(url: u, settings: settings)
                r.isMeteringEnabled = true
                r.prepareToRecord()
                r.record()
                self.recorder = r
                self.recorderURL = u
                self.recordStart = Date()
                self.reply(id, ok: true, json: self.jsonString(["path": rel]))
            } catch {
                self.reply(id, ok: false, json: self.jsonString(["error": error.localizedDescription]))
            }
        }
    }

    private func stopRecording(id: Int, p: [String: Any]) {
        var ms = 0
        if let s = recordStart { ms = Int(Date().timeIntervalSince(s) * 1000) }
        recorder?.stop()
        recorder = nil
        recordStart = nil
        let u = recorderURL
        recorderURL = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        guard let url = u else {
            reply(id, ok: false, json: jsonString(["error": "没有在录音"]))
            return
        }
        if let d = try? Data(contentsOf: url) {
            reply(id, ok: true, json: jsonString([
                "path": url.lastPathComponent,
                "ms": ms,
                "base64": d.base64EncodedString(),
                "size": d.count
            ]))
        } else {
            reply(id, ok: false, json: jsonString(["error": "录音文件读取失败"]))
        }
    }

    private func cancelRecording(id: Int) {
        recorder?.stop()
        recorder = nil
        recordStart = nil
        if let u = recorderURL { try? FileManager.default.removeItem(at: u) }
        recorderURL = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        reply(id, ok: true, json: "{}")
    }

    // MARK: 相册

    private func pickPhoto(id: Int) {
        pendingPhotoId = id
        var cfg = PHPickerConfiguration()
        cfg.filter = .images
        cfg.selectionLimit = 1
        let picker = PHPickerViewController(configuration: cfg)
        picker.delegate = self
        DispatchQueue.main.async { [weak self] in
            guard let vc = self?.presenter else { return }
            vc.present(picker, animated: true, completion: nil)
        }
    }

    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true, completion: nil)
        let reqId = pendingPhotoId
        guard let item = results.first?.itemProvider,
              item.canLoadObject(ofClass: UIImage.self) else {
            reply(reqId, ok: false, json: jsonString(["error": "取消"]))
            return
        }
        item.loadObject(ofClass: UIImage.self) { [weak self] obj, err in
            guard let self = self else { return }
            guard let img = obj as? UIImage, let d = img.jpegData(compressionQuality: 0.9) else {
                self.reply(reqId, ok: false, json: self.jsonString(["error": err?.localizedDescription ?? "读取失败"]))
                return
            }
            let name = "images/\(Int(Date().timeIntervalSince1970))-\(Int.random(in: 1000...9999)).jpg"
            if let u = self.resolve(name) {
                try? FileManager.default.createDirectory(at: u.deletingLastPathComponent(),
                                                         withIntermediateDirectories: true, attributes: nil)
                try? d.write(to: u, options: .atomic)
            }
            self.reply(reqId, ok: true, json: self.jsonString([
                "path": name,
                "base64": d.base64EncodedString(),
                "w": Double(img.size.width),
                "h": Double(img.size.height)
            ]))
        }
    }

    // MARK: 分享

    private func share(id: Int, p: [String: Any]) {
        let text = p["text"] as? String ?? ""
        DispatchQueue.main.async { [weak self] in
            guard let vc = self?.presenter else { return }
            let a = UIActivityViewController(activityItems: [text], applicationActivities: nil)
            if let pop = a.popoverPresentationController {
                pop.sourceView = vc.view
                pop.sourceRect = CGRect(x: vc.view.bounds.midX, y: vc.view.bounds.midY, width: 1, height: 1)
                pop.permittedArrowDirections = []
            }
            vc.present(a, animated: true, completion: nil)
        }
        reply(id, ok: true, json: "{}")
    }
}
