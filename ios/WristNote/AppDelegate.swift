import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        installCrashHandler()

        let w = UIWindow(frame: UIScreen.main.bounds)
        w.rootViewController = WebViewController()
        w.makeKeyAndVisible()
        window = w
        return true
    }

    func application(_ application: UIApplication,
                     supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
        return .portrait
    }

    /// 把未捕获的 ObjC 异常写到/files/crash.txt，和安卓的 crash.txt 一个思路
    private func installCrashHandler() {
        NSSetUncaughtExceptionHandler { exception in
            let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            let url = docs.appendingPathComponent("crash.txt")
            let text = "时间: \(Date())\n异常: \(exception.name.rawValue)\n原因: \(exception.reason ?? "")\n" +
                exception.callStackSymbols.joined(separator: "\n") + "\n\n"
            if let data = text.data(using: .utf8) {
                if let handle = try? FileHandle(forWritingTo: url) {
                    handle.seekToEndOfFile()
                    handle.write(data)
                    try? handle.close()
                } else {
                    try? data.write(to: url)
                }
            }
        }
    }
}
