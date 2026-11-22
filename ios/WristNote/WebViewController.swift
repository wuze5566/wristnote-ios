import UIKit
import WebKit

final class WebViewController: UIViewController {
    private var webView: WKWebView!
    private let bridge = NativeBridge()
    private let media = MediaSchemeHandler()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .white

        let cfg = WKWebViewConfiguration()
        cfg.allowsInlineMediaPlayback = true
        cfg.mediaTypesRequiringUserActionForPlayback = []
        cfg.ignoresViewportScaleLimits = false
        cfg.setURLSchemeHandler(media, forURLScheme: MediaSchemeHandler.scheme)

        let ucc = WKUserContentController()
        ucc.add(bridge, name: "native")
        cfg.userContentController = ucc

        webView = WKWebView(frame: .zero, configuration: cfg)
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.isOpaque = false
        webView.backgroundColor = .white
        webView.scrollView.backgroundColor = .white
        webView.scrollView.bounces = false
        webView.scrollView.alwaysBounceVertical = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.showsVerticalScrollIndicator = false
        webView.scrollView.keyboardDismissMode = .interactive
        webView.allowsBackForwardNavigationGestures = false
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }
        view.addSubview(webView)

        // 顶到屏幕边缘（安全区交给 CSS env()），底部贴着键盘上沿
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor)
        ])

        bridge.webView = webView
        bridge.presenter = self
        bridge.onAppearanceChange = { [weak self] dark in
            self?.applyAppearance(dark: dark)
        }

        loadApp()
    }

    private func applyAppearance(dark: Bool) {
        if #available(iOS 13.0, *) {
            overrideUserInterfaceStyle = dark ? .dark : .light
        }
        view.backgroundColor = dark ? UIColor(red: 0.07, green: 0.075, blue: 0.086, alpha: 1) : .white
        webView.backgroundColor = view.backgroundColor
        webView.scrollView.backgroundColor = view.backgroundColor
        setNeedsStatusBarAppearanceUpdate()
    }

    private func loadApp() {
        guard let dir = Bundle.main.url(forResource: "www", withExtension: nil),
              let index = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "www")
        else {
            webView.loadHTMLString("<h1 style=\"font-family:-apple-system;padding:40px\">资源缺失</h1>", baseURL: nil)
            return
        }
        webView.loadFileURL(index, allowingReadAccessTo: dir)
    }

    override var preferredStatusBarStyle: UIStatusBarStyle {
        return bridge.isDark ? .lightContent : .darkContent
    }

    override var supportedInterfaceOrientations: UIInterfaceOrientationMask {
        return .portrait
    }

    override var prefersHomeIndicatorAutoHidden: Bool {
        return false
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        bridge.safeInsets = view.safeAreaInsets
    }
}
