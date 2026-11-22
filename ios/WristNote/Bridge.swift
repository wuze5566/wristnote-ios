import Foundation
import UIKit
import WebKit
import AVFoundation
import PhotosUI
import UniformTypeIdentifiers

// MARK: - 本地媒体文件（wnmedia://images/xxx.jpg）

final class MediaSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "wnmedia"

    private var docs: URL {
        return FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(NSError(domain: "wnmedia", code: 400))
            return
        }
        var rel = url.host ?? ""
        if !url.path.isEmpty { rel += url.path }
        rel = rel.removingPercentEncoding ?? rel
        while rel.hasPrefix("/") { rel = String(rel.dropFirst()) }

        let base = docs.standardizedFileURL
        let file = base.appendingPathComponent(rel).standardizedFileURL
        guard file.path.hasPrefix(base.path + "/") || file.path == base.path,
              let data = try? Data(contentsOf: file) else {
            urlSchemeTask.didFailWithError(NSError(domain: "wnmedia", code: 404))
            return
        }
        let mime = NativeBridge.mimeType(for: file.path)
        let response = URLResponse(url: url, mimeType: mime,
                                   expectedContentLength: data.count, textEncodingName: nil)
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        // 无需处理
    }
}

// MARK: - UTF8 增量解码（流式分片可能切断多字节字符）

final class UTF8StreamDecoder {
    private var pending = Data()

    func append(_ data: Data) -> String {
        pending.append(data)
        var cut = pending.count
        while cut > 0 {
            if let s = String(data: pending.prefix(cut), encoding: .utf8) {
                pending.removeFirst(cut)
                return s
            }
            if pending.count - cut >= 3 { break }
            cut -= 1
        }
        return ""
    }
}

// MARK: - 流式 HTTP（SSE）

final class HTTPStream: NSObject, URLSessionDataDelegate {
    let id: Int
    weak var bridge: NativeBridge?
    private var session: URLSession?
    private var decoder = UTF8StreamDecoder()
    private var statusCode: Int = 0

    init(id: Int, bridge: NativeBridge) {
        self.id = id
        self.bridge = bridge
    }

    func start(_ request: URLRequest) {
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 600
        cfg.timeoutIntervalForResource = 1800
        cfg.httpAdditionalHeaders = ["Accept": "text/event-stream"]
        let s = URLSession(configuration: cfg, delegate: self, delegateQueue: nil)
        session = s
        s.dataTask(with: request).resume()
    }

    func cancel() {
        session?.invalidateAndCancel()
        session = nil
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        let text = decoder.append(data)
        if !text.isEmpty {
            bridge?.emitStream(id: id, event: "chunk", json: bridge?.jsonString(["text": text]) ?? "{}")
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let status = (task.response as? HTTPURLResponse)?.statusCode ?? statusCode
        if let e = error {
            bridge?.emitStream(id: id, event: "done",
                               json: bridge?.jsonString(["error": e.localizedDescription, "status": status]) ?? "{}")
        } else {
            bridge?.emitStream(id: id, event: "done", json: bridge?.jsonString(["status": status]) ?? "{}")
        }
        bridge?.removeStream(id: id)
        session.finishTasksAndInvalidate()
    }
}

// MARK: - JS <-> 原生

final class NativeBridge: NSObject, WKScriptMessageHandler, PHPickerViewControllerDelegate, UIDocumentPickerDelegate {

    weak var webView: WKWebView?
    weak var presenter: UIViewController?
    var safeInsets: UIEdgeInsets = .zero
    var isDark = false
    var onAppearanceChange: ((Bool) -> Void)?

    private let ioQueue = DispatchQueue(label: "wristnote.io", qos: .userInitiated)
    private var streams: [Int: HTTPStream] = [:]

    private var recorder: AVAudioRecorder?
    private var recorderURL: URL?
    private var recorderRelPath: String = ""
    private var recordStart: Date?

    private var player: AVPlayer?
    private var playerTimer: Timer?
    private var playerPath: String = ""
    private var endObserver: NSObjectProtocol?

    private var pendingPhotoId = 0
    private var pendingFileId = 0

    private var docs: URL {
        return FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    }

    private var logURL: URL {
        return docs.appendingPathComponent("diagnose.log")
    }

    static func mimeType(for path: String) -> String {
        switch (path as NSString).pathExtension.lowercased() {
        case "jpg", "jpeg": return "image/jpeg"
        case "png": return "image/png"
        case "gif": return "image/gif"
        case "webp": return "image/webp"
        case "wav": return "audio/wav"
        case "m4a": return "audio/mp4"
        case "caf": return "audio/x-caf"
        case "mp3": return "audio/mpeg"
        case "json": return "application/json"
        case "txt", "log", "md": return "text/plain"
        case "pdf": return "application/pdf"
        default: return "application/octet-stream"
        }
    }

    // MARK: 发给 JS 的通道

    func jsonString(_ obj: Any) -> String {
        guard JSONSerialization.isValidJSONObject(obj),
              let data = try? JSONSerialization.data(withJSONObject: obj),
              var s = String(data: data, encoding: .utf8) else { return "null" }
        s = s.replacingOccurrences(of: "\u{2028}", with: "\\u2028")
        s = s.replacingOccurrences(of: "\u{2029}", with: "\\u2029")
        return s
    }

    func reply(_ id: Int, ok: Bool, json: String) {
        evaluate("window.__nres(\(id),\(ok ? "true" : "false"),\(json));")
    }

    func emitStream(id: Int, event: String, json: String) {
        evaluate("window.__nev(\(id),\"\(event)\",\(json));")
    }

    func removeStream(id: Int) {
        ioQueue.async { [weak self] in
            self?.streams.removeValue(forKey: id)
        }
    }

    private func emitAudio(state: String, ms: Int, dur: Int, path: String) {
        let payload: [String: Any] = ["state": state, "ms": ms, "dur": dur, "path": path]
        evaluate("window.__naudio(\(jsonString(payload)));")
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
        let id = intValue(body["id"]) ?? 0
        let method = body["method"] as? String ?? ""
        let params = body["params"] as? [String: Any] ?? [:]
        dispatch(id: id, method: method, params: params)
    }

    private func dispatch(id: Int, method: String, params: [String: Any]) {
        switch method {
        case "info":
            let bundle = Bundle.main.infoDictionary ?? [:]
            let version = bundle["CFBundleShortVersionString"] as? String ?? "1.0.0"
            let build = bundle["CFBundleVersion"] as? String ?? "1"
            let dark = UITraitCollection.current.userInterfaceStyle == .dark
            let screen = UIScreen.main.bounds
            let info: [String: Any] = [
                "version": version,
                "build": build,
                "ios": UIDevice.current.systemVersion,
                "model": deviceModel(),
                "name": UIDevice.current.name,
                "width": Double(min(screen.width, screen.height)),
                "height": Double(max(screen.width, screen.height)),
                "scale": Double(UIScreen.main.scale),
                "safeTop": Double(safeInsets.top),
                "safeBottom": Double(safeInsets.bottom),
                "dark": dark
            ]
            reply(id, ok: true, json: jsonString(info))

        case "http":
            http(id: id, p: params)

        case "http.cancel":
            let streamId = intValue(params["id"]) ?? -1
            streams[streamId]?.cancel()
            streams.removeValue(forKey: streamId)
            reply(id, ok: true, json: "{}")

        case "http.multipart":
            multipart(id: id, p: params)

        case "fs":
            fileOp(id: id, p: params)

        case "audio.start":
            startRecording(id: id, p: params)

        case "audio.stop":
            if recorder != nil {
                stopRecording(id: id)
            } else {
                stopAudio(emit: true)
                reply(id, ok: true, json: "{}")
            }

        case "audio.cancel":
            cancelRecording(id: id)

        case "audio.level":
            var level: Float = -160
            if let r = recorder, r.isRecording {
                r.updateMeters()
                level = r.averagePower(forChannel: 0)
            }
            reply(id, ok: true, json: jsonString(["level": Double(level)]))

        case "audio.play":
            playAudio(id: id, p: params)

        case "audio.pause":
            player?.pause()
            emitAudio(state: "paused", ms: currentMs(), dur: playerDur(), path: playerPath)
            reply(id, ok: true, json: "{}")

        case "audio.resume":
            player?.play()
            reply(id, ok: true, json: "{}")

        case "audio.seek":
            let ms = intValue(params["ms"]) ?? 0
            player?.seek(to: CMTime(value: CMTimeValue(ms), timescale: 1000))
            reply(id, ok: true, json: "{}")

        case "audio.merge":
            mergeAudio(id: id, p: params)

        case "photo.pick":
            pickPhoto(id: id)

        case "file.pick":
            pickFile(id: id)

        case "clip.set":
            UIPasteboard.general.string = params["text"] as? String ?? ""
            reply(id, ok: true, json: "{}")

        case "openURL":
            if let s = params["url"] as? String, let u = URL(string: s) {
                UIApplication.shared.open(u, options: [:], completionHandler: nil)
            }
            reply(id, ok: true, json: "{}")

        case "share":
            share(id: id, p: params)

        case "haptic":
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            reply(id, ok: true, json: "{}")

        case "log":
            appendLog(params["text"] as? String ?? "")
            reply(id, ok: true, json: "{}")

        case "log.read":
            readLog(id: id)

        case "log.clear":
            try? FileManager.default.removeItem(at: logURL)
            reply(id, ok: true, json: "{}")

        case "ui.appearance":
            let dark = params["dark"] as? Bool ?? false
            isDark = dark
            onAppearanceChange?(dark)
            reply(id, ok: true, json: "{}")

        default:
            reply(id, ok: false, json: jsonString(["error": "未知原生方法: \(method)"]))
        }
    }

    // MARK: 工具

    private func intValue(_ any: Any?) -> Int? {
        if let i = any as? Int { return i }
        if let d = any as? Double { return Int(d) }
        if let n = any as? NSNumber { return n.intValue }
        if let s = any as? String { return Int(s) }
        return nil
    }

    private func boolValue(_ any: Any?) -> Bool {
        if let b = any as? Bool { return b }
        if let n = any as? NSNumber { return n.boolValue }
        return false
    }

    private func deviceModel() -> String {
        var systemInfo = utsname()
        uname(&systemInfo)
        let machine = withUnsafePointer(to: &systemInfo.machine) {
            $0.withMemoryRebound(to: CChar.self, capacity: 64) {
                String(cString: $0)
            }
        }
        return machine.isEmpty ? UIDevice.current.model : machine
    }

    func resolve(_ rel: String) -> URL? {
        let base = docs.standardizedFileURL
        let u = base.appendingPathComponent(rel).standardizedFileURL
        if u.path == base.path { return u }
        guard u.path.hasPrefix(base.path + "/") else { return nil }
        return u
    }

    // MARK: HTTP

    private func http(id: Int, p: [String: Any]) {
        guard let s = p["url"] as? String, let url = URL(string: s) else {
            reply(id, ok: false, json: jsonString(["error": "链接无效"]))
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

        if boolValue(p["stream"]) {
            let st = HTTPStream(id: id, bridge: self)
            ioQueue.async { [weak self] in self?.streams[id] = st }
            st.start(req)
            return
        }

        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = req.timeoutInterval
        cfg.timeoutIntervalForResource = max(60, req.timeoutInterval * 2)
        let session = URLSession(configuration: cfg)
        session.dataTask(with: req) { [weak self] data, resp, err in
            guard let self = self else { return }
            session.finishTasksAndInvalidate()
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

    private func multipart(id: Int, p: [String: Any]) {
        guard let s = p["url"] as? String, let url = URL(string: s) else {
            reply(id, ok: false, json: jsonString(["error": "链接无效"]))
            return
        }
        let boundary = "----WristNote\(UUID().uuidString)"
        var body = Data()
        let fields = p["fields"] as? [[String: Any]] ?? []
        for f in fields {
            guard let name = f["name"] as? String else { continue }
            let value = f["value"] as? String ?? ""
            body.append("--\(boundary)\r\n".data(using: .utf8)!)
            body.append("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n".data(using: .utf8)!)
            body.append(value.data(using: .utf8)!)
            body.append("\r\n".data(using: .utf8)!)
        }
        if let file = p["file"] as? [String: Any],
           let field = file["field"] as? String,
           let rel = file["path"] as? String,
           let fileURL = resolve(rel),
           let data = try? Data(contentsOf: fileURL) {
            let name = (file["name"] as? String) ?? fileURL.lastPathComponent
            let mime = (file["mime"] as? String) ?? NativeBridge.mimeType(for: fileURL.path)
            body.append("--\(boundary)\r\n".data(using: .utf8)!)
            body.append("Content-Disposition: form-data; name=\"\(field)\"; filename=\"\(name)\"\r\n".data(using: .utf8)!)
            body.append("Content-Type: \(mime)\r\n\r\n".data(using: .utf8)!)
            body.append(data)
            body.append("\r\n".data(using: .utf8)!)
        }
        body.append("--\(boundary)--\r\n".data(using: .utf8)!)

        var req = URLRequest(url: url)
        req.httpMethod = (p["method"] as? String) ?? "POST"
        req.timeoutInterval = p["timeout"] as? Double ?? 180
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        if let hs = p["headers"] as? [String: Any] {
            for (k, v) in hs {
                if let vs = v as? String { req.setValue(vs, forHTTPHeaderField: k) }
            }
        }
        req.httpBody = body

        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = req.timeoutInterval
        cfg.timeoutIntervalForResource = 1800
        let session = URLSession(configuration: cfg)
        session.dataTask(with: req) { [weak self] data, resp, err in
            guard let self = self else { return }
            session.finishTasksAndInvalidate()
            if let e = err {
                self.reply(id, ok: false, json: self.jsonString(["error": e.localizedDescription]))
                return
            }
            let r = resp as? HTTPURLResponse
            let text = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
            self.reply(id, ok: true, json: self.jsonString(["status": r?.statusCode ?? 0, "body": text]))
        }.resume()
    }

    // MARK: 文件

    private func fileOp(id: Int, p: [String: Any]) {
        let op = p["op"] as? String ?? ""
        let rel = p["path"] as? String ?? ""
        guard let url = resolve(rel) else {
            reply(id, ok: false, json: jsonString(["error": "路径无效"]))
            return
        }
        ioQueue.async { [weak self] in
            guard let self = self else { return }
            let fm = FileManager.default
            switch op {
            case "write":
                let text = p["text"] as? String ?? ""
                do {
                    try fm.createDirectory(at: url.deletingLastPathComponent(),
                                           withIntermediateDirectories: true, attributes: nil)
                    try text.data(using: .utf8)?.write(to: url, options: .atomic)
                    self.reply(id, ok: true, json: "{}")
                } catch {
                    self.reply(id, ok: false, json: self.jsonString(["error": error.localizedDescription]))
                }

            case "read":
                if let d = try? Data(contentsOf: url), let s = String(data: d, encoding: .utf8) {
                    self.reply(id, ok: true, json: self.jsonString(["text": s]))
                } else {
                    self.reply(id, ok: false, json: self.jsonString(["error": "not found"]))
                }

            case "list":
                let names = (try? fm.contentsOfDirectory(atPath: url.path)) ?? []
                self.reply(id, ok: true, json: self.jsonString(["names": names.sorted()]))

            case "delete":
                try? fm.removeItem(at: url)
                self.reply(id, ok: true, json: "{}")

            case "exists":
                self.reply(id, ok: true, json: self.jsonString(["exists": fm.fileExists(atPath: url.path)]))

            case "bytes":
                if let d = try? Data(contentsOf: url) {
                    self.reply(id, ok: true, json: self.jsonString(["base64": d.base64EncodedString()]))
                } else {
                    self.reply(id, ok: false, json: self.jsonString(["error": "not found"]))
                }

            case "writeBytes":
                if let b64 = p["base64"] as? String, let d = Data(base64Encoded: b64) {
                    do {
                        try fm.createDirectory(at: url.deletingLastPathComponent(),
                                               withIntermediateDirectories: true, attributes: nil)
                        try d.write(to: url, options: .atomic)
                        self.reply(id, ok: true, json: "{}")
                    } catch {
                        self.reply(id, ok: false, json: self.jsonString(["error": error.localizedDescription]))
                    }
                } else {
                    self.reply(id, ok: false, json: self.jsonString(["error": "base64 无效"]))
                }

            case "size":
                let attrs = try? fm.attributesOfItem(atPath: url.path)
                let n = (attrs?[.size] as? NSNumber)?.intValue ?? 0
                self.reply(id, ok: true, json: self.jsonString(["size": n]))

            case "mkdir":
                try? fm.createDirectory(at: url, withIntermediateDirectories: true, attributes: nil)
                self.reply(id, ok: true, json: "{}")

            case "move":
                let fromRel = p["from"] as? String ?? ""
                let toRel = p["to"] as? String ?? ""
                guard let from = self.resolve(fromRel), let to = self.resolve(toRel) else {
                    self.reply(id, ok: false, json: self.jsonString(["error": "路径无效"]))
                    return
                }
                do {
                    try fm.createDirectory(at: to.deletingLastPathComponent(),
                                           withIntermediateDirectories: true, attributes: nil)
                    if fm.fileExists(atPath: to.path) { try? fm.removeItem(at: to) }
                    try fm.moveItem(at: from, to: to)
                    self.reply(id, ok: true, json: "{}")
                } catch {
                    self.reply(id, ok: false, json: self.jsonString(["error": error.localizedDescription]))
                }

            default:
                self.reply(id, ok: false, json: self.jsonString(["error": "未知文件操作"]))
            }
        }
    }

    // MARK: 录音（16k 单声道 16bit WAV，可直接给 ASR）

    private func requestMic(_ completion: @escaping (Bool) -> Void) {
        if #available(iOS 17.0, *) {
            AVAudioApplication.requestRecordPermission { granted in
                DispatchQueue.main.async { completion(granted) }
            }
        } else {
            AVAudioSession.sharedInstance().requestRecordPermission { granted in
                DispatchQueue.main.async { completion(granted) }
            }
        }
    }

    private func startRecording(id: Int, p: [String: Any]) {
        let rel = p["path"] as? String ?? "audio/rec-\(Int(Date().timeIntervalSince1970)).wav"
        guard let url = resolve(rel) else {
            reply(id, ok: false, json: jsonString(["error": "路径无效"]))
            return
        }

        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playAndRecord, mode: .default,
                                    options: [.defaultToSpeaker, .allowBluetooth, .allowBluetoothA2DP])
            try session.setActive(true)
        } catch {
            reply(id, ok: false, json: jsonString(["error": "音频会话失败：\(error.localizedDescription)"]))
            return
        }

        requestMic { [weak self] granted in
            guard let self = self else { return }
            guard granted else {
                self.reply(id, ok: false, json: self.jsonString(["error": "麦克风权限被拒绝，请到 设置→手表备忘录 里打开"]))
                return
            }
            do {
                try FileManager.default.createDirectory(at: url.deletingLastPathComponent(),
                                                        withIntermediateDirectories: true, attributes: nil)
                let settings: [String: Any] = [
                    AVFormatIDKey: Int(kAudioFormatLinearPCM),
                    AVSampleRateKey: 16000.0,
                    AVNumberOfChannelsKey: 1,
                    AVLinearPCMBitDepthKey: 16,
                    AVLinearPCMIsFloatKey: false,
                    AVLinearPCMIsBigEndianKey: false
                ]
                let r = try AVAudioRecorder(url: url, settings: settings)
                r.isMeteringEnabled = true
                r.prepareToRecord()
                r.record()
                self.recorder = r
                self.recorderURL = url
                self.recorderRelPath = rel
                self.recordStart = Date()
                self.reply(id, ok: true, json: self.jsonString(["path": rel]))
            } catch {
                self.reply(id, ok: false, json: self.jsonString(["error": error.localizedDescription]))
            }
        }
    }

    private func stopRecording(id: Int) {
        var ms = 0
        if let s = recordStart { ms = Int(Date().timeIntervalSince(s) * 1000) }
        recorder?.stop()
        recorder = nil
        recordStart = nil
        let url = recorderURL
        recorderURL = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        guard let u = url else {
            reply(id, ok: false, json: jsonString(["error": "没有在录音"]))
            return
        }
        let rel = recorderRelPath
        if let d = try? Data(contentsOf: u) {
            reply(id, ok: true, json: jsonString([
                "path": rel,
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

    // MARK: 播放

    private func currentMs() -> Int {
        guard let p = player else { return 0 }
        let t = p.currentTime()
        if t.timescale == 0 { return 0 }
        return Int(Double(t.value) / Double(t.timescale) * 1000)
    }

    private func playerDur() -> Int {
        guard let item = player?.currentItem else { return 0 }
        let d = item.duration
        if d.timescale == 0 || d.seconds.isNaN { return 0 }
        return Int(d.seconds * 1000)
    }

    private func playAudio(id: Int, p: [String: Any]) {
        guard let rel = p["path"] as? String, let url = resolve(rel) else {
            reply(id, ok: false, json: jsonString(["error": "语音文件丢失"]))
            return
        }
        guard FileManager.default.fileExists(atPath: url.path) else {
            reply(id, ok: false, json: jsonString(["error": "语音文件丢失"]))
            return
        }
        stopAudio(emit: false)
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .default, options: [.duckOthers])
        try? session.setActive(true)

        let item = AVPlayerItem(url: url)
        let p2 = AVPlayer(playerItem: item)
        player = p2
        playerPath = rel
        let speed = p["speed"] as? Double ?? 1.0
        let ms = intValue(p["ms"]) ?? 0
        if ms > 0 {
            p2.seek(to: CMTime(value: CMTimeValue(ms), timescale: 1000),
                    toleranceBefore: .zero, toleranceAfter: .zero)
        }
        p2.play()
        p2.rate = Float(speed)

        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main
        ) { [weak self] _ in
            guard let self = self else { return }
            self.stopTicker()
            self.emitAudio(state: "ended", ms: self.playerDur(), dur: self.playerDur(), path: self.playerPath)
            self.player = nil
        }

        startTicker()
        reply(id, ok: true, json: "{}")
    }

    private func startTicker() {
        playerTimer?.invalidate()
        playerTimer = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { [weak self] _ in
            guard let self = self, let p = self.player else { return }
            if p.rate != 0 {
                self.emitAudio(state: "playing", ms: self.currentMs(), dur: self.playerDur(), path: self.playerPath)
            }
        }
    }

    private func stopTicker() {
        playerTimer?.invalidate()
        playerTimer = nil
    }

    private func stopAudio(emit: Bool) {
        if let obs = endObserver {
            NotificationCenter.default.removeObserver(obs)
            endObserver = nil
        }
        stopTicker()
        player?.pause()
        player = nil
        if emit {
            emitAudio(state: "stopped", ms: 0, dur: 0, path: "")
        }
    }

    // MARK: 音频合并（多段 WAV -> 单段，给语音转文字用）

    private func mergeAudio(id: Int, p: [String: Any]) {
        let paths = p["paths"] as? [String] ?? []
        let outRel = p["out"] as? String ?? "audio/merged-\(Int(Date().timeIntervalSince1970)).wav"
        let maxMs = intValue(p["maxMs"]) ?? 0
        guard let outURL = resolve(outRel) else {
            reply(id, ok: false, json: jsonString(["error": "路径无效"]))
            return
        }
        ioQueue.async { [weak self] in
            guard let self = self else { return }
            var fmt = Data()
            var pcm = Data()
            var rate: UInt32 = 16000
            var channels: UInt16 = 1
            var bits: UInt16 = 16

            for rel in paths {
                guard let u = self.resolve(rel), let d = try? Data(contentsOf: u) else { continue }
                if let parts = NativeBridge.parseWav(d) {
                    fmt = parts.fmt
                    pcm.append(parts.pcm)
                    rate = NativeBridge.readU32(parts.fmt, 4) ?? rate
                    channels = NativeBridge.readU16(parts.fmt, 2) ?? channels
                    bits = NativeBridge.readU16(parts.fmt, 14) ?? bits
                }
            }
            if fmt.isEmpty {
                self.reply(id, ok: false, json: self.jsonString(["error": "没有可用的录音"]))
                return
            }
            if maxMs > 0 {
                let bytesPerSec = Int(rate) * Int(channels) * Int(bits) / 8
                let maxBytes = maxMs * bytesPerSec / 1000
                if pcm.count > maxBytes { pcm = pcm.prefix(maxBytes) }
            }
            var out = Data()
            out.append("RIFF".data(using: .ascii)!)
            NativeBridge.appendU32(&out, UInt32(4 + 8 + fmt.count + 8 + pcm.count))
            out.append("WAVE".data(using: .ascii)!)
            out.append("fmt ".data(using: .ascii)!)
            NativeBridge.appendU32(&out, UInt32(fmt.count))
            out.append(fmt)
            out.append("data".data(using: .ascii)!)
            NativeBridge.appendU32(&out, UInt32(pcm.count))
            out.append(pcm)

            do {
                try FileManager.default.createDirectory(at: outURL.deletingLastPathComponent(),
                                                        withIntermediateDirectories: true, attributes: nil)
                try out.write(to: outURL, options: .atomic)
                let durMs = Int(Double(pcm.count) / (Double(Int(rate) * Int(channels) * Int(bits) / 8)) * 1000)
                self.reply(id, ok: true, json: self.jsonString([
                    "path": outRel, "dur": durMs, "size": out.count
                ]))
            } catch {
                self.reply(id, ok: false, json: self.jsonString(["error": error.localizedDescription]))
            }
        }
    }

    static func parseWav(_ d: Data) -> (fmt: Data, pcm: Data)? {
        guard d.count >= 12 else { return nil }
        guard String(data: d[0..<4], encoding: .ascii) == "RIFF",
              String(data: d[8..<12], encoding: .ascii) == "WAVE" else { return nil }
        var offset = 12
        var fmt: Data?
        var pcm: Data?
        while offset + 8 <= d.count {
            let id = String(data: d[offset..<offset + 4], encoding: .ascii) ?? ""
            guard let size = readU32(d, offset + 4).map({ Int($0) }) else { break }
            let start = offset + 8
            let end = min(d.count, start + size)
            if id == "fmt " { fmt = d.subdata(in: start..<end) }
            if id == "data" { pcm = d.subdata(in: start..<end) }
            offset = start + size + (size % 2)
        }
        guard let f = fmt, let s = pcm else { return nil }
        return (f, s)
    }

    static func readU32(_ d: Data, _ o: Int) -> UInt32? {
        guard o + 4 <= d.count else { return nil }
        let b0 = UInt32(d[o]), b1 = UInt32(d[o + 1]), b2 = UInt32(d[o + 2]), b3 = UInt32(d[o + 3])
        return b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)
    }

    static func readU16(_ d: Data, _ o: Int) -> UInt16? {
        guard o + 2 <= d.count else { return nil }
        return UInt16(d[o]) | (UInt16(d[o + 1]) << 8)
    }

    static func appendU32(_ d: inout Data, _ v: UInt32) {
        d.append(UInt8(v & 0xFF))
        d.append(UInt8((v >> 8) & 0xFF))
        d.append(UInt8((v >> 16) & 0xFF))
        d.append(UInt8((v >> 24) & 0xFF))
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
        guard let provider = results.first?.itemProvider,
              provider.canLoadObject(ofClass: UIImage.self) else {
            reply(reqId, ok: false, json: jsonString(["error": "取消"]))
            return
        }
        provider.loadObject(ofClass: UIImage.self) { [weak self] object, error in
            guard let self = self else { return }
            guard var image = object as? UIImage else {
                self.reply(reqId, ok: false, json: self.jsonString(["error": error?.localizedDescription ?? "读取失败"]))
                return
            }
            image = NativeBridge.downscale(image, maxSide: 1600)
            guard let data = image.jpegData(compressionQuality: 0.82) else {
                self.reply(reqId, ok: false, json: self.jsonString(["error": "图片编码失败"]))
                return
            }
            let name = "images/\(Int(Date().timeIntervalSince1970))-\(Int.random(in: 1000...9999)).jpg"
            if let u = self.resolve(name) {
                try? FileManager.default.createDirectory(at: u.deletingLastPathComponent(),
                                                         withIntermediateDirectories: true, attributes: nil)
                try? data.write(to: u, options: .atomic)
            }
            self.reply(reqId, ok: true, json: self.jsonString([
                "path": name,
                "w": Double(image.size.width),
                "h": Double(image.size.height)
            ]))
        }
    }

    static func downscale(_ image: UIImage, maxSide: CGFloat) -> UIImage {
        let w = image.size.width, h = image.size.height
        let longest = max(w, h)
        if longest <= maxSide { return image }
        let scale = maxSide / longest
        let size = CGSize(width: floor(w * scale), height: floor(h * scale))
        let renderer = UIGraphicsImageRenderer(size: size)
        return renderer.image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
    }

    // MARK: 本机文件

    private func pickFile(id: Int) {
        pendingFileId = id
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [UTType.item], asCopy: true)
        picker.delegate = self
        picker.allowsMultipleSelection = false
        DispatchQueue.main.async { [weak self] in
            guard let vc = self?.presenter else { return }
            vc.present(picker, animated: true, completion: nil)
        }
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        let reqId = pendingFileId
        guard let src = urls.first else {
            reply(reqId, ok: false, json: jsonString(["error": "取消"]))
            return
        }
        let name = src.lastPathComponent
        let rel = "files/\(Int(Date().timeIntervalSince1970))-\(name)"
        guard let dst = resolve(rel) else {
            reply(reqId, ok: false, json: jsonString(["error": "路径无效"]))
            return
        }
        do {
            try FileManager.default.createDirectory(at: dst.deletingLastPathComponent(),
                                                    withIntermediateDirectories: true, attributes: nil)
            if FileManager.default.fileExists(atPath: dst.path) { try FileManager.default.removeItem(at: dst) }
            try FileManager.default.copyItem(at: src, to: dst)
            let attrs = try? FileManager.default.attributesOfItem(atPath: dst.path)
            let size = (attrs?[.size] as? NSNumber)?.intValue ?? 0
            reply(reqId, ok: true, json: jsonString([
                "path": rel, "name": name, "size": size,
                "mime": NativeBridge.mimeType(for: name)
            ]))
        } catch {
            reply(reqId, ok: false, json: jsonString(["error": error.localizedDescription]))
        }
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        reply(pendingFileId, ok: false, json: jsonString(["error": "取消"]))
    }

    // MARK: 分享

    private func share(id: Int, p: [String: Any]) {
        let text = p["text"] as? String ?? ""
        DispatchQueue.main.async { [weak self] in
            guard let vc = self?.presenter else { return }
            let activity = UIActivityViewController(activityItems: [text], applicationActivities: nil)
            if let pop = activity.popoverPresentationController {
                pop.sourceView = vc.view
                pop.sourceRect = CGRect(x: vc.view.bounds.midX, y: vc.view.bounds.midY, width: 1, height: 1)
                pop.permittedArrowDirections = []
            }
            vc.present(activity, animated: true, completion: nil)
        }
        reply(id, ok: true, json: "{}")
    }

    // MARK: 日志

    private func appendLog(_ text: String) {
        guard !text.isEmpty else { return }
        let formatter = DateFormatter()
        formatter.dateFormat = "MM-dd HH:mm:ss"
        let line = "[\(formatter.string(from: Date()))] \(text)\n"
        ioQueue.async { [weak self] in
            guard let self = self else { return }
            let fm = FileManager.default
            try? fm.createDirectory(at: self.docs, withIntermediateDirectories: true, attributes: nil)
            if let handle = try? FileHandle(forWritingTo: self.logURL) {
                handle.seekToEndOfFile()
                if let d = line.data(using: .utf8) { handle.write(d) }
                try? handle.close()
            } else {
                try? line.data(using: .utf8)?.write(to: self.logURL)
            }
            // 日志超过 512KB 时裁掉前面一半
            if let attrs = try? fm.attributesOfItem(atPath: self.logURL.path),
               let size = (attrs[.size] as? NSNumber)?.intValue, size > 512 * 1024,
               let data = try? Data(contentsOf: self.logURL) {
                let keep = data.suffix(256 * 1024)
                try? keep.write(to: self.logURL)
            }
        }
    }

    private func readLog(id: Int) {
        ioQueue.async { [weak self] in
            guard let self = self else { return }
            var text = (try? String(contentsOf: self.logURL, encoding: .utf8)) ?? ""
            // 崩溃日志放最上面
            let crash = self.docs.appendingPathComponent("crash.txt")
            if let c = try? String(contentsOf: crash, encoding: .utf8), !c.isEmpty {
                text = "=== 崩溃记录 ===\n" + c + "\n=== 运行日志 ===\n" + text
            }
            self.reply(id, ok: true, json: self.jsonString(["text": text]))
        }
    }
}
