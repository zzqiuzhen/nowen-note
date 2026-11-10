import "./lib/runtimePrelude";
import "./lib/runtimeCompatibility";
import React from "react";
import ReactDOM from "react-dom/client";
import { MotionConfig } from "framer-motion";
import { initializeMobileLocalFirstRuntime } from "./lib/mobileLocalFirstRuntime";
import { initializeDesktopLocalSession } from './lib/desktopLocalSession';
import "./lib/androidCompat";
import "./lib/noteTransferRefreshBridge";
import "./lib/workspaceRefreshBridge";
import "./i18n";
// Must run before App and its import/export/editor schemas are evaluated.
import { ThemeProvider } from "./components/ThemeProvider";
import { SiteSettingsProvider } from "./hooks/useSiteSettings";
import { ConfirmProvider } from "./components/ui/confirm";
import Toaster from "./components/Toaster";
import "./index.css";
import "./motion.css";
import "./editor-list-markers.css";
import "./code-block-wrap.css";
import "./overlay-layers.css";
import "./space-actions.css";
import "./settings-switches.css";
import "./sidebar-search-experience.css";
import "./mobile-knowledge-tree-compact.css";
import "./knowledge-tree-display-size.css";
import "./siyuan-rich-text-callout.css";
import "./knowledge-tree-markdown-drop.css";
import "./inline-comments.css";
import "./loading-experience.css";
import "./note-appearance.css";
import "./nowen-refresh.css";
import "./mobile-tabbar.css";
import { resolveCurrentAppPathname } from "./lib/appPathNavigation";
import { observeBootSplashReadiness, reportBootStage } from "./lib/bootSplash";

reportBootStage("runtime");

// ---------------------------------------------------------------------------
// On-device boot probe.
// iOS builds ship through TrollStore and are validated without Xcode, so the native
// SceneDelegate evaluates window.__NOWEN_PROBE__() against its own WKWebView and stores
// the JSON in Documents/ui-probe-*.json. That makes "blank screen" answerable with data
// (DOM present? root concealed? splash stuck?) instead of guesswork.
// ---------------------------------------------------------------------------
function bootErrorText(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  try {
    return String(error);
  } catch {
    return "unserializable error";
  }
}

// Written outside #root with inline styles: the React root is deliberately concealed
// (opacity: 0) during boot, so anything inside it stays invisible when boot fails.
function showFatalOverlay(source: string, error: unknown): void {
  try {
    if (!document.body) return;
    let overlay = document.getElementById("__nowen_boot_fatal");
    if (!overlay) {
      overlay = document.createElement("pre");
      overlay.id = "__nowen_boot_fatal";
      overlay.setAttribute(
        "style",
        "position:fixed;inset:0;z-index:2147483647;margin:0;padding:24px;background:#ffffff;color:#111111;font:12px/1.5 ui-monospace,Menlo,monospace;white-space:pre-wrap;overflow:auto;-webkit-user-select:text;user-select:text;",
      );
      document.body.appendChild(overlay);
      const root = document.getElementById("root");
      if (root) {
        root.style.opacity = "1";
        root.style.pointerEvents = "";
      }
    }
    overlay.textContent = `${overlay.textContent ?? ""}[${source}] ${bootErrorText(error)}\n`;
  } catch {
    /* diagnostics must never become another startup failure */
  }
}

try {
  type ProbeWindow = Window & {
    __NOWEN_PROBE__?: () => string;
    __NOWEN_BOOT_DIAGNOSTICS__?: { stage?: string; errors?: unknown[] };
    __NOWEN_BOOT_READY__?: boolean;
    Capacitor?: unknown;
  };
  (window as ProbeWindow).__NOWEN_PROBE__ = () => {
    const probeWindow = window as ProbeWindow;
    const root = document.getElementById("root");
    const splash = document.getElementById("app-boot-splash");
    const diagnostics = probeWindow.__NOWEN_BOOT_DIAGNOSTICS__;
    const rect = root?.getBoundingClientRect();
    const rawErrors = diagnostics?.errors;
    const bootErrors = Array.isArray(rawErrors) ? rawErrors.slice(-4) : null;
    return JSON.stringify({
      href: location.href,
      readyState: document.readyState,
      title: document.title,
      bodyLength: document.body ? document.body.innerHTML.length : -1,
      bodyText: (document.body?.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 400),
      rootChildren: root ? root.children.length : -1,
      rootOpacity: root ? getComputedStyle(root).opacity : null,
      rootSize: rect ? `${Math.round(rect.width)}x${Math.round(rect.height)}` : null,
      rootHTML: root ? root.innerHTML.slice(0, 600) : null,
      splashPresent: Boolean(splash),
      splashClass: splash ? splash.className : null,
      bootReady: Boolean(probeWindow.__NOWEN_BOOT_READY__),
      stage: diagnostics?.stage ?? null,
      errors: bootErrors,
      capacitor: typeof probeWindow.Capacitor !== "undefined",
      resources: performance
        .getEntriesByType("resource")
        .filter((entry) => /\.(js|css)$/.test(entry.name))
        .slice(-10)
        .map((entry) => `${entry.name.split("/").pop()} ${Math.round(entry.duration)}ms`),
    });
  };
} catch {
  /* probe installation is best-effort only */
}

// iOS 上原生启动图覆盖在 WebView 之上；App 组件挂载前如果一直不隐藏，屏幕就停在启动图上。
// 这里在引导最开始就收敛（HTML 自带启动卡片，不需要原生启动图兜底）。
const hideNativeSplashEarly = () => {
  void import("@capacitor/splash-screen")
    .then(({ SplashScreen }) => SplashScreen.hide({ fadeOutDuration: 200 }))
    .catch(() => { /* web / 插件缺失时静默 */ });
};
hideNativeSplashEarly();

// The image transform schema patch must run before either private or public note
// surfaces evaluate their editor/import schemas, but it must not inflate the login entry.
const loadImageTransformBootstrap = () => import("./lib/imageNodeTransformBootstrap");
const App = React.lazy(async () => {
  await loadImageTransformBootstrap();
  return import("./App");
});
const PublicNotebookView = React.lazy(async () => {
  await loadImageTransformBootstrap();
  return import("./components/PublicNotebookView");
});
const GlobalBridges = React.lazy(() => import("./components/GlobalBridges"));

function reportBootError(source: string, error: unknown, fatal: boolean): void {
  // Fatal boot errors paint themselves outside #root; the root stays concealed until the
  // splash is dismissed, so a silent `return null` here used to look like a blank screen.
  if (fatal) showFatalOverlay(source, error);
  try {
    const reporter = (window as Window & { __NOWEN_REPORT_BOOT_ERROR__?: (source: string, error: unknown, fatal: boolean) => void }).__NOWEN_REPORT_BOOT_ERROR__;
    if (typeof reporter === "function") reporter(source, error, fatal);
  } catch {
    /* diagnostics must never become another startup failure */
  }
}

function installOptionalRuntime(source: string, install: () => unknown): void {
  try {
    install();
  } catch (error) {
    console.error(`[boot] optional runtime failed: ${source}`, error);
    reportBootError(source, error, false);
  }
}

class ApplicationBootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    reportBootError("react-render", error, true);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const diagnostics = (window as Window & { __NOWEN_BOOT_DIAGNOSTICS__?: { errors?: Array<{ source?: string; message?: string }> } }).__NOWEN_BOOT_DIAGNOSTICS__;
    const lines = (diagnostics?.errors ?? [])
      .slice(-4)
      .map((entry) => `[${entry.source ?? "unknown"}] ${entry.message ?? ""}`)
      .join("\n");
    return (
      <pre
        style={{
          position: "fixed",
          inset: 0,
          margin: 0,
          padding: 24,
          background: "#ffffff",
          color: "#111111",
          font: "12px/1.5 ui-monospace, Menlo, monospace",
          whiteSpace: "pre-wrap",
          overflow: "auto",
        }}
      >
        {`界面渲染失败\n${lines}`}
      </pre>
    );
  }
}


/**
 * The HTML startup card stays above React while lazy modules, auth restoration and quick
 * login probing are running. Once a real route or interactive surface mounts, this observer
 * dismisses it with the minimum-visible-time guard from bootSplash.ts.
 */
function BootSplashReadinessObserver() {
  React.useEffect(() => observeBootSplashReadiness(document.getElementById("root")), []);
  return null;
}

/**
 * Suspense must stay visually silent during cold start. The HTML startup card already owns
 * that feedback; rendering another centered spinner here caused the second loading screen.
 */
function MainRouteFallback() {
  return null;
}


const THEME_KEY = "nowen-note-theme";
try {
  if (typeof localStorage !== "undefined" && !localStorage.getItem(THEME_KEY)) {
    localStorage.setItem(THEME_KEY, "light");
  }
} catch (error) {
  reportBootError("theme-storage", error, false);
}

try {
  const desk: any = (window as any).nowenDesktop;
  if (desk && desk.isDesktop && typeof desk.platform === "string") {
    document.documentElement.setAttribute("data-electron", desk.platform);
  }
} catch {
  /* 纯 Web 环境：静默 */
}

function resolvePublicNotebookRoute(): { matched: boolean; token?: string } {
  const match = resolveCurrentAppPathname().match(/^\/public(?:\/([^/]+))?\/?$/);
  if (!match) return { matched: false };
  if (!match[1]) return { matched: true };
  try {
    return { matched: true, token: decodeURIComponent(match[1]) };
  } catch {
    return { matched: true, token: match[1] };
  }
}

const publicRoute = resolvePublicNotebookRoute();

let applicationRendered = false;

function renderApplication() {
  clearTimeout(bootRenderDeadline);
  if (applicationRendered) return;
  reportBootStage("rendering");
  applicationRendered = true;
  try {
    const root = document.getElementById("root");
    if (!root) throw new Error("Missing #root mount element");
    ReactDOM.createRoot(root).render(
      <ApplicationBootErrorBoundary>
      <React.StrictMode>
    {/* framer-motion 默认不响应系统“减少动态效果”；这里统一关闭位移/缩放/布局动画，保留透明度过渡。 */}
    <MotionConfig reducedMotion="user">
    <SiteSettingsProvider>
      <ConfirmProvider>
        <BootSplashReadinessObserver />
        {publicRoute.matched ? (
          <ThemeProvider>
            <React.Suspense fallback={<MainRouteFallback />}>
              <PublicNotebookView token={publicRoute.token} />
            </React.Suspense>
            <Toaster />
          </ThemeProvider>
        ) : (
          <>
            <React.Suspense fallback={null}>
              <GlobalBridges />
            </React.Suspense>
            <React.Suspense fallback={<MainRouteFallback />}>
              <App />
            </React.Suspense>
          </>
        )}
      </ConfirmProvider>
    </SiteSettingsProvider>
    </MotionConfig>
      </React.StrictMode>
      </ApplicationBootErrorBoundary>,
    );
  } catch (error) {
    applicationRendered = false;
    reportBootError("react-root", error, true);
  }
}

let coreRuntimeInstalled = false;

// 原生 SQLite / Keychain 初始化在个别 WKWebView 上可能永不 settle，await 会把首屏一起拖死
// （表现为纯白）。增强链路加硬超时：只放弃本地优先能力，不影响渲染登录/工作台。
const BOOT_RENDER_DEADLINE_MS = 4000;
const bootRenderDeadline = setTimeout(() => {
  if (coreRuntimeInstalled) renderApplication();
}, BOOT_RENDER_DEADLINE_MS);

Promise.resolve()
  .then(() => import("./lib/coreRuntimeInstallers"))
  .then(({ installCoreRuntime }) => {
    installCoreRuntime(installOptionalRuntime, reportBootError);
    coreRuntimeInstalled = true;
  })
  .then(() => initializeDesktopLocalSession().catch(error => reportBootError('desktop-local-session',error,false)))
  .then(() => Promise.race([
    initializeMobileLocalFirstRuntime(),
    new Promise<void>((resolve) => setTimeout(resolve, 3000)),
  ]))
  .then(
    () => renderApplication(),
    (error) => {
      // Native local-first initialization is an enhancement. A rejected or unsupported
      // native bridge must never prevent Web/WKWebView users from reaching login/workspace.
      if (!coreRuntimeInstalled) {
        // Required network and persistence guards were not installed; never
        // expose an editor that might write without those protections.
        reportBootError("core-runtime-install", error, true);
        return;
      }
      reportBootError("mobile-local-first", error, false);
      renderApplication();
    },
  );

// Last-resort visibility: if #root is still empty after 9s the app is not rendering for a
// reason the boundary never saw (concealed root + dismissed splash = plain background).
setTimeout(() => {
  const root = document.getElementById("root");
  if (root && root.children.length > 0) return;
  const diagnostics = (window as Window & { __NOWEN_BOOT_DIAGNOSTICS__?: { stage?: string; errors?: unknown[] } }).__NOWEN_BOOT_DIAGNOSTICS__;
  showFatalOverlay(
    "watchdog-empty-root",
    `stage=${diagnostics?.stage ?? "unknown"} errors=${JSON.stringify(diagnostics?.errors ?? []).slice(0, 600)}`,
  );
}, 9000);