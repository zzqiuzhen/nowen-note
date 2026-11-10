import path from "path"
import fs from "node:fs"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { guardLookbehindCalls, findUnguardedLookbehind } from "./config/lookbehindGuard"

// 读取根 package.json 的 version，注入到前端以便 UI 展示真实版本号
// （release.sh 会在发布时更新根 package.json 的 version 字段）
const rootPkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf-8"),
) as { version?: string }
const APP_VERSION = rootPkg.version || "0.0.0"

// iOS 16.0 / 16.0.x WebKit 没有 RegExp lookbehind（Safari 16.4 才加）。
// 这里的源码级重写只覆盖 mdast-util-gfm-autolink-literal（源码里就是正则字面量，
// 字面量带 lookbehind 会让整个 chunk 在解析阶段就 SyntaxError）。
// 其余字符串形式的 `new RegExp("(?<=...)")` 由 config/lookbehindGuard.ts 在产物层统一兜住。
const LOOKBEHIND_REWRITES: Array<[string, string]> = [
  // mdast-util-gfm-autolink-literal: regex literal in source
  [String.raw`(?<=^|\s|\p{P}|\p{S})([-.\w+]+)@([-\w]+(?:\.[-\w]+)+)`,
   String.raw`([-.\w+]+)@([-\w]+(?:\.[-\w]+)+)`],
  // same regex as a prebuilt string literal (backslashes doubled)
  [String.raw`(?<=^|\\s|\\p{P}|\\p{S})([-\\w+]+)@([-\\w]+(?:\\.[-\\w]+)+)`,
   String.raw`([-\\w+]+)@([-\\w]+(?:\\.[-\\w]+)+)`],
];

export default defineConfig(({ mode }) => ({
  // Electron 远端/API-only 模式会直接加载打包后的 frontend/dist/index.html。
  // 使用相对 base，确保 file:// 下 /assets 不会解析到磁盘根目录。
  base: "./",
  root: path.resolve(__dirname),
  plugins: [
    react(),
    // WKWebView 在 capacitor:// 自定义 scheme 下会给带 crossorigin 的 module script
    // 走 CORS 校验；Capacitor 的本地资源处理器不返回 ACAO，脚本被拦就是整页白屏。
    // 本地资源本来就是同源加载，构建时统一去掉该属性。
    {
      name: "strip-crossorigin-for-capacitor",
      apply: "build" as const,
      transformIndexHtml(html: string) {
        return html
          .replace(/\s+crossorigin(?==)/g, "")
          .replace(/\s+crossorigin(?=[\s>])/g, "");
      },
    },
    // iOS 16.0 的 WebKit has no RegExp lookbehind (Safari 16.4 added it). Any
    // /(?<=...)/ or new RegExp("(?<=...") throws at construction:
    // "Invalid regular expression: invalid group specifier name" -> the whole React
    // tree dies -> white screen. Three sources exist in this bundle:
    //   1) mdast-util-gfm-autolink-literal email regex (loads when a note renders)
    //   2) prettier markdown line-break counting regex (same chunk, built at module eval)
    //   3) prettier yaml comment split regex (built when formatting YAML)
    // mermaid probes support inside try/catch and keeps its fallback, so it is left alone.
    {
      name: "strip-regexp-lookbehind-for-ios16",
      enforce: "pre" as const,
      transform(code: string, id: string) {
        if (!/mdast-util-gfm-autolink-literal|prettier[\\/]plugins[\\/](markdown|yaml)/.test(id)) return null;
        let out = code;
        for (const [before, after] of LOOKBEHIND_REWRITES) out = out.split(before).join(after);
        if (out === code) return null;
        return { code: out, map: null };
      },
    },
    // 产物层兜底：把 `new RegExp("...(?<=...)")` 改写成“引擎支持就用原式、不支持就降级
    // 去掉 lookbehind”的 IIFE。iOS 16.0 上这类构造会抛
    // `Invalid regular expression: invalid group specifier name`；在 React 渲染期抛出
    // 就是整页白屏（MotionPhotoOverlay 就是这么炸的）。
    {
      name: "guard-regexp-lookbehind-for-ios16",
      apply: "build" as const,
      generateBundle(this: any, _options: any, bundle: Record<string, any>) {
        for (const item of Object.values(bundle)) {
          if (!item || item.type !== "chunk" || !String(item.fileName).endsWith(".js")) continue;
          const result = guardLookbehindCalls(item.code as string);
          if (!result.wrapped) continue;
          item.code = result.code;
          item.map = null;
        }
      },
    },
    // Final gate: 宁可构建失败，也不再发一个白屏包。
    {
      name: "verify-no-regexp-lookbehind-ios16",
      apply: "build" as const,
      generateBundle(this: any, _options: any, bundle: Record<string, any>) {
        const failures: string[] = [];
        for (const item of Object.values(bundle)) {
          if (!item || item.type !== "chunk" || !String(item.fileName).endsWith(".js")) continue;
          const code: string = item.code;
          const issues = findUnguardedLookbehind(code);
          if (!issues.length) continue;
          // mermaid 在运行时用 try/catch 探测 lookbehind 支持并保留降级路径，
          // 命中都来自懒加载 chunk 里的支持探测，放行。
          const base = String(item.fileName).split("/").pop() || "";
          if (base.startsWith("mermaid")) continue;
          failures.push(`${base}: ${issues[0].slice(0, 240).replace(/\s+/g, " ")}`);
        }
        if (failures.length) {
          this.error("[ios16-lookbehind] 仍有会在 iOS 16.0 上抛错的正则：\n  " + failures.join("\n  "));
        }
      },
    },
  ],
  define: {
    // 编译期常量；使用 JSON.stringify 确保是带引号的字符串字面量
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  resolve: {
    alias: [
      ...(mode === "harmony" ? [{
        find: /^@aparajita\/capacitor-secure-storage$/,
        replacement: path.resolve(__dirname, "./src/lib/harmonySecureStorage.ts"),
      }] : []),
      // Issue #512：内容树快捷“+”统一选择富文本、Markdown 或文件夹。
      // Runtime 壳通过相对路径加载原面板，避免精确别名递归。
      {
        find: /^@\/components\/KnowledgeTreePanel$/,
        replacement: path.resolve(__dirname, "./src/components/KnowledgeTreeCreateMenuRuntime.tsx"),
      },
      // Issue #218：AI 可靠性壳与原聊天面板整体延迟到用户真正打开 AI 侧栏时加载。
      // Lazy 壳和可靠性壳都使用相对路径进入下一层，避免精确别名递归。
      {
        find: /^@\/components\/AIChatPanel$/,
        replacement: path.resolve(__dirname, "./src/components/LazyAIChatPanelRuntime.tsx"),
      },
      {
        find: /^@\/components\/AISettingsPanel$/,
        replacement: path.resolve(__dirname, "./src/components/AISettingsReliabilityShell.tsx"),
      },
      // Issue #369：保留原 schema / serializer，仅替换高成本媒体 NodeView、公式与全文搜索壳。
      // Runtime 壳内部使用相对路径导入原组件，避免精确别名递归。
      {
        find: /^@\/components\/VideoExtension$/,
        replacement: path.resolve(__dirname, "./src/components/VideoExtensionRuntime.tsx"),
      },
      {
        find: /^@\/components\/MermaidView$/,
        replacement: path.resolve(__dirname, "./src/components/MermaidViewRuntime.tsx"),
      },
      {
        find: /^@\/components\/MathExtensions$/,
        replacement: path.resolve(__dirname, "./src/components/MathExtensionsRuntime.tsx"),
      },
      {
        find: /^@\/components\/SearchReplacePanel$/,
        replacement: path.resolve(__dirname, "./src/components/SearchReplacePanelRuntime.tsx"),
      },
      // Issue #369：统一监听 Markdown / Tiptap 首次可交互，普通模式超时后自动降级。
      // 初始化壳再通过相对路径进入原运行时，避免精确别名递归。
      {
        find: /^@\/components\/MarkdownEditor$/,
        replacement: path.resolve(__dirname, "./src/components/MarkdownEditorInitializationRuntime.tsx"),
      },
      {
        find: /^@\/components\/TiptapEditor$/,
        replacement: path.resolve(__dirname, "./src/components/TiptapEditorInitializationRuntime.tsx"),
      },
      // Issue #369：Tiptap 派生数据只扫描一次；优化模式暂停实时全文大纲。
      {
        find: /^@\/lib\/proseMirrorPlainText$/,
        replacement: path.resolve(__dirname, "./src/lib/proseMirrorPlainTextRuntime.ts"),
      },
      // Issue #369：大 Markdown 使用 CodeMirror transaction ↔ Y.Text delta 增量同步。
      // 原组件和纯策略通过相对路径保留，Runtime 壳只接管协作热路径。
      {
        find: /^@\/components\/LargeMarkdownSafeEditor$/,
        replacement: path.resolve(__dirname, "./src/components/LargeMarkdownSafeEditorRuntime.tsx"),
      },
      {
        find: /^@\/lib\/largeMarkdownSafety$/,
        replacement: path.resolve(__dirname, "./src/lib/largeMarkdownSafetyRuntime.ts"),
      },
      // 公开分享查看器包含 Markdown 渲染、评论和访客身份逻辑，只在分享路由命中时加载。
      {
        find: /^@\/components\/SharedNoteView$/,
        replacement: path.resolve(__dirname, "./src/components/LazySharedNoteViewRuntime.tsx"),
      },
      // Issue #369 P2：在不侵入 EditorPane 主体的前提下增加事务化文档拆分入口。
      {
        find: /^@\/components\/EditorPane$/,
        replacement: path.resolve(__dirname, "./src/components/EditorPaneRuntime.tsx"),
      },
      // 命令面板包含全文搜索中心；关闭状态只保留轻量壳，首次按 Cmd/Ctrl+K 时再下载。
      {
        find: /^@\/components\/common\/CommandPalette$/,
        replacement: path.resolve(__dirname, "./src/components/common/LazyCommandPaletteRuntime.tsx"),
      },
      // 登录页不应同步下载整个工作台。以下壳只保留轻量 Suspense 边界，
      // 真正的业务模块在用户进入对应页面时再加载。
      {
        find: /^@\/components\/Sidebar$/,
        replacement: path.resolve(__dirname, "./src/components/LazySidebarRuntime.tsx"),
      },
      {
        find: /^@\/components\/NavRail$/,
        replacement: path.resolve(__dirname, "./src/components/LazyNavRailRuntime.tsx"),
      },
      {
        find: /^@\/components\/NoteList$/,
        replacement: path.resolve(__dirname, "./src/components/LazyNoteListRuntime.tsx"),
      },
      {
        find: /^@\/components\/EditorSplitView$/,
        replacement: path.resolve(__dirname, "./src/components/LazyEditorSplitViewRuntime.tsx"),
      },
      {
        find: /^@\/components\/TaskCenter$/,
        replacement: path.resolve(__dirname, "./src/components/LazyTaskCenterRuntime.tsx"),
      },
      {
        find: /^@\/components\/MindMapEditor$/,
        replacement: path.resolve(__dirname, "./src/components/LazyMindMapEditorRuntime.tsx"),
      },
      {
        find: /^@\/components\/DiaryCenter$/,
        replacement: path.resolve(__dirname, "./src/components/LazyDiaryCenterRuntime.tsx"),
      },
      {
        find: /^@\/components\/FileManager$/,
        replacement: path.resolve(__dirname, "./src/components/LazyFileManagerRuntime.tsx"),
      },
      {
        find: /^@\/components\/ShareManagementPage$/,
        replacement: path.resolve(__dirname, "./src/components/LazyShareManagementPageRuntime.tsx"),
      },
      {
        find: /^@\/components\/NotebookShareJoinView$/,
        replacement: path.resolve(__dirname, "./src/components/LazyNotebookShareJoinViewRuntime.tsx"),
      },
      { find: "@", replacement: path.resolve(__dirname, "./src") },
    ],
  },
  optimizeDeps: {
    esbuildOptions: {
      keepNames: true,
    },
  },
  // Keep worker output compatible with the Chrome 64 / older Android WebView build target.
  worker: {
    format: "iife",
  },
  build: {
    target: ["chrome64", "safari13"],
    cssTarget: ["chrome64", "safari13"],
    sourcemap: false,
    manifest: true,
    // Safari / WKWebView are first-class web targets. Keep Vite's modulepreload fallback
    // enabled so older WebKit does not stall while resolving lazy startup chunks.
    modulePreload: { polyfill: true },
    // 降低 chunk 大小警告阈值
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        // 把首屏必需依赖与低频导出/Markdown 依赖分开。此前 vendor-lib 同时包含
        // framer-motion 和 JSZip/Turndown，登录页只要使用动画就会把低频工具一起下载。
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-ui': [
            'framer-motion',
            'lucide-react',
            'react-icons',
          ],
          'vendor-i18n': [
            'i18next',
            'react-i18next',
          ],
          'vendor-archive': ['jszip'],
          'vendor-date': ['date-fns'],
        },
      },
    },
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    // 接受来自手机 App（Capacitor WebView）跨 origin 的 HMR WebSocket 握手。
    // 手机侧的 `capacitor.config.ts#server.url` 会把 WebView 直接指向
    // `http://<电脑LAN_IP>:5173`，此时 host 就是 LAN IP。
    // 不设 hmr.host 时 vite 会把 HMR clientScript 固定成某个值（通常是 localhost），
    // 导致手机端无法命中 HMR 通道——因此显式放开。
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      // 后端的实时协作 WebSocket（Y.js presence / 协同编辑）也必须代理，
      // 否则手机端 `new WebSocket("/ws")` 会落到 vite 自己的 HMR server 上。
      "/ws": {
        target: "ws://localhost:3001",
        ws: true,
        changeOrigin: true,
      },
    },
  },
}))
