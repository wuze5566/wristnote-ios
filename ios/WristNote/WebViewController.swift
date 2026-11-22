import UIKit
import WebKit

final class WebViewController: UIViewController {
    private var webView: WKWebView!
    private let bridge = NativeBridge()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 1, green: 1, blue: 1, alpha: 1)

        let cfg = WKWebViewConfiguration()
        cfg.allowsInlineMediaPlayback = true
        cfg.mediaTypesRequiringUserActionForPlayback = []
        cfg.ignoresViewportScaleLimits = false
        let ucc = WKUserContentController()
        ucc.add(bridge, name: "native")
        cfg.userContentController = ucc

        webView = WKWebView(frame: view.bounds, configuration: cfg)
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.isOpaque = false
        webView.backgroundColor = .white
        webView.scrollView.backgroundColor = .white
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.showsVerticalScrollIndicator = false
        webView.allowsBackForwardNavigationGestures = false
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])

        bridge.webView = webView
        bridge.presenter = self

        loadApp()
    }

    private func loadApp() {
        guard let dir = Bundle.main.url(forResource: "www", withExtension: nil),
              let index = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "www")
        else {
            webView.loadHTMLString("<h1>资源缺失</h1>", baseURL: nil)
            return
        }
        webView.loadFileURL(index, allowingReadAccessTo: dir)
    }

    override var preferredStatusBarStyle: UIStatusBarStyle {
        return .darkContent
    }

    override var supportedInterfaceOrientations: UIInterfaceOrientationMask {
        return .portrait
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        bridge.safeInsets = view.safeAreaInsets
    }
}
