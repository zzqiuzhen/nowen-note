import UIKit
import Capacitor
import WebKit

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
        // Deliberately no storyboard: the window is created by SceneDelegate only.
        // The previous setup (UISceneStoryboardFile = Main in Info.plist) let UIKit build a
        // second scene window whose CAPBridgeViewController never attached its WebView to the
        // visible hierarchy, leaving a running process, executing JS and a blank screen.
        let configuration = UISceneConfiguration(name: "Default Configuration", sessionRole: connectingSceneSession.role)
        configuration.delegateClass = SceneDelegate.self
        return configuration
    }
}

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        // Exactly one UIWindow and one CAPBridgeViewController for the whole process.
        // The programmatic bridge renders correctly on iOS 16; the storyboard-instantiated
        // one does not.
        let window = UIWindow(windowScene: windowScene)
        window.rootViewController = CAPBridgeViewController()
        window.makeKeyAndVisible()
        self.window = window

        // Under the scene lifecycle cold-start URLs and Universal Links arrive here,
        // so they can only be forwarded once the bridge owns the window.
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

        // Diagnostics without Xcode: snapshot windows, web views and page DOM a few times
        // after launch into Documents/ui-probe-*.json so a blank screen can be triaged over MCP.
        for delay in [5.0, 12.0, 22.0] {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                self?.writeProbe(scene, tag: String(Int(delay)))
            }
        }
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

    private func writeProbe(_ scene: UIScene, tag: String) {
        guard let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { return }
        let windowScene = scene as? UIWindowScene
        let windows = windowScene?.windows ?? []

        var payload: [String: Any] = [
            "tag": tag,
            "at": ISO8601DateFormatter().string(from: Date()),
            "connectedScenes": UIApplication.shared.connectedScenes.count,
            "windowCount": windows.count
        ]
        payload["windows"] = windows.map { window -> [String: Any] in
            [
                "hidden": window.isHidden,
                "alpha": Double(window.alpha),
                "level": Double(window.windowLevel.rawValue),
                "isKey": window.isKeyWindow,
                "bounds": String(describing: window.bounds),
                "root": window.rootViewController.map { String(describing: type(of: $0)) } ?? "nil",
                "rootSubviews": window.rootViewController?.view.subviews.count ?? -1,
                "rootBounds": String(describing: window.rootViewController?.view.bounds ?? CGRect.zero)
            ]
        }

        let webViews = windows.flatMap { findWebViews(in: $0) }
        payload["webViewCount"] = webViews.count
        payload["webViews"] = webViews.map { webView -> [String: Any] in
            [
                "hidden": webView.isHidden,
                "alpha": Double(webView.alpha),
                "frame": String(describing: webView.frame),
                "url": webView.url?.absoluteString ?? "nil"
            ]
        }

        let group = DispatchGroup()
        let lock = NSLock()
        var jsResults: [String] = []
        for webView in webViews {
            group.enter()
            let js = "typeof window.__NOWEN_PROBE__ === 'function' ? window.__NOWEN_PROBE__() : JSON.stringify({probe:'absent',href:location.href,ready:document.readyState,bodyLength:document.body?document.body.innerHTML.length:-1})"
            webView.evaluateJavaScript(js) { value, error in
                let text = (value as? String) ?? ("js-error: " + (error?.localizedDescription ?? "nil"))
                lock.lock()
                jsResults.append(text)
                lock.unlock()
                group.leave()
            }
        }

        group.notify(queue: .main) {
            payload["js"] = jsResults
            guard let data = try? JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted]) else { return }
            try? data.write(to: docs.appendingPathComponent("ui-probe-" + tag + ".json"))
        }
    }

    private func findWebViews(in window: UIWindow) -> [WKWebView] {
        var found: [WKWebView] = []
        func walk(_ view: UIView) {
            if let webView = view as? WKWebView {
                found.append(webView)
                return
            }
            for subview in view.subviews {
                walk(subview)
            }
        }
        walk(window)
        return found
    }
}