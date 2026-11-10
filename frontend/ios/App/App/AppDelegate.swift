import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        return true
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Save shared application state here if needed.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    func application(
        _ application: UIApplication,
        configurationForConnecting connectingSceneSession: UISceneSession,
        options: UIScene.ConnectionOptions
    ) -> UISceneConfiguration {
        let configuration = UISceneConfiguration(name: "Default Configuration", sessionRole: connectingSceneSession.role)
        configuration.delegateClass = SceneDelegate.self
        return configuration
    }
}

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        // 场景窗口由 Main.storyboard 提供（Info.plist 里 UISceneStoryboardFile = Main，
        // 根控制器是 CAPBridgeViewController）。这里再手工创建第二个 UIWindow 会实例化第二个
        // CAPBridgeViewController：WebView 其实已加载完成，但场景窗口一直停在 LaunchScreen 上，
        // 表现就是「白屏、只剩启动图」。所以只保留冷启动 URL / Universal Link 的转发。
        DispatchQueue.main.async {
            for urlContext in connectionOptions.urlContexts {
                _ = ApplicationDelegateProxy.shared.application(
                    UIApplication.shared,
                    open: urlContext.url,
                    options: [:]
                )
            }

            for userActivity in connectionOptions.userActivities {
                _ = ApplicationDelegateProxy.shared.application(
                    UIApplication.shared,
                    continue: userActivity,
                    restorationHandler: { _ in }
                )
            }
        }

        writeBootDiagnostics(scene)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for urlContext in URLContexts {
            _ = ApplicationDelegateProxy.shared.application(
                UIApplication.shared,
                open: urlContext.url,
                options: [:]
            )
        }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        _ = ApplicationDelegateProxy.shared.application(
            UIApplication.shared,
            continue: userActivity,
            restorationHandler: { _ in }
        )
    }

    // 把场景/窗口状态写到沙盒 Documents/boot-diag.json，方便在没有 Mac 的情况下
    // 通过设备 MCP 直接读回，判断是「窗口没显示」还是「WebView 没加载」。
    private func writeBootDiagnostics(_ scene: UIScene) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 8) {
            guard let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { return }
            let windowScene = scene as? UIWindowScene
            let windows = windowScene?.windows ?? []
            let keyWindow = windows.first(where: { $0.isKeyWindow }) ?? windows.first
            let root = keyWindow?.rootViewController
            let info: [String: Any] = [
                "sceneWindows": windows.count,
                "connectedScenes": UIApplication.shared.connectedScenes.count,
                "keyWindowHidden": keyWindow?.isHidden as Any,
                "keyWindowBounds": String(describing: keyWindow?.bounds ?? CGRect.zero),
                "rootController": root.map { String(describing: type(of: $0)) } ?? "nil",
                "rootSubviews": root?.view.subviews.count ?? -1,
                "rootViewBounds": String(describing: root?.view.bounds ?? CGRect.zero)
            ]
            guard let data = try? JSONSerialization.data(withJSONObject: info, options: [.prettyPrinted]) else { return }
            try? data.write(to: docs.appendingPathComponent("boot-diag.json"))
        }
    }
}