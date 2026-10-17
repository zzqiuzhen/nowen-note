/**
 * PageErrorBoundary —— 模块页（待办 / 文件 / AI / 日记 / 分享 …）的兜底。
 *
 * 为什么需要：这些页面各自 lazy 加载、各自拉接口，任何一处渲染期异常都会冒到
 * React root，让整块内容变成白屏——用户只能描述成“什么也不显示”，我们完全拿不到
 * 线索。这里把异常拦在模块内，直接把错误文本画在页面上，既不影响底部导航，也让
 * 下一次反馈带上可定位的信息。
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  /** 切换它时自动重置（通常传 viewMode） */
  resetKey?: string | number | null;
  label?: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class PageErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[page-boundary] ${this.props.label || "module"} crashed:`, error, info.componentStack);
  }

  componentDidUpdate(previous: Props): void {
    if (this.state.error && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex h-full min-h-0 w-full flex-col items-center justify-center gap-3 p-6 text-center" role="alert">
        <p className="text-sm font-medium text-tx-primary">
          {this.props.label ? `「${this.props.label}」没能打开` : "这个页面没能打开"}
        </p>
        <p className="max-w-[36ch] break-words text-xs leading-5 text-tx-tertiary">
          {error.message || String(error)}
        </p>
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          className="rounded-full bg-accent-primary px-4 py-1.5 text-xs font-medium text-white active:scale-95"
        >
          重试
        </button>
      </div>
    );
  }
}
