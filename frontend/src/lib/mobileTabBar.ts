/**
 * 移动端底部标签栏（微信式）的配置与持久化。
 *
 * 设计要点：
 * - 5 个槽位，每个槽位对应一个「导航动作」，默认：全部笔记 / 待办 / 文件管理 / AI快记 / 设置。
 * - 任意槽位都可以长按替换成侧边栏里的其它模块（例如用「思维导图」换掉「文件管理」）。
 * - 配置写在 localStorage，并通过 window 事件广播，方便设置页与运行时同步。
 */
import type { ViewMode } from "@/types";

export type MobileTabActionId =
  | "all-notes"
  | "favorites"
  | "tasks"
  | "mindmaps"
  | "files"
  | "diary"
  | "ai-chat"
  | "shares"
  | "trash"
  | "notifications"
  | "settings";

export interface MobileTabOption {
  id: MobileTabActionId;
  /** 对应 i18n 里的 sidebar.* / 自定义 key；labelZh/labelEn 作为兜底文案。 */
  labelZh: string;
  labelEn: string;
}

/** 候选动作：优先按用户常用顺序排（全部笔记 → 内容模块 → 工具 → 设置）。 */
export const MOBILE_TAB_OPTIONS: MobileTabOption[] = [
  { id: "all-notes", labelZh: "全部笔记", labelEn: "All notes" },
  { id: "tasks", labelZh: "待办", labelEn: "Tasks" },
  { id: "files", labelZh: "文件管理", labelEn: "Files" },
  { id: "ai-chat", labelZh: "AI快记", labelEn: "AI Notes" },
  { id: "settings", labelZh: "设置", labelEn: "Settings" },
  { id: "mindmaps", labelZh: "思维导图", labelEn: "Mind maps" },
  { id: "diary", labelZh: "每日记录", labelEn: "Daily" },
  { id: "favorites", labelZh: "收藏", labelEn: "Favorites" },
  { id: "shares", labelZh: "分享管理", labelEn: "Shares" },
  { id: "trash", labelZh: "回收站", labelEn: "Trash" },
  { id: "notifications", labelZh: "通知", labelEn: "Notifications" },
];

export const MOBILE_TAB_COUNT = 5;

export const DEFAULT_MOBILE_TABS: MobileTabActionId[] = [
  "all-notes",
  "tasks",
  "files",
  "ai-chat",
  "settings",
];

export const MOBILE_TABS_STORAGE_KEY = "nowen-mobile-tabbar-v1";
export const MOBILE_TABS_CHANGED_EVENT = "nowen:mobile-tabs-changed";
export const OPEN_MOBILE_TABS_CUSTOMIZER_EVENT = "nowen:open-mobile-tabbar-customizer";

const VALID_IDS = new Set<MobileTabActionId>(MOBILE_TAB_OPTIONS.map((option) => option.id));

function toId(value: unknown): MobileTabActionId | null {
  return typeof value === "string" && VALID_IDS.has(value as MobileTabActionId)
    ? (value as MobileTabActionId)
    : null;
}

/** 去重、补齐到 5 个槽位；任何脏数据都退回默认配置，避免底栏出现空格子。 */
export function sanitizeMobileTabs(input: unknown): MobileTabActionId[] {
  const source = Array.isArray(input) ? input : [];
  const result: MobileTabActionId[] = [];
  for (const raw of source) {
    const id = toId(raw);
    if (id && !result.includes(id)) result.push(id);
    if (result.length >= MOBILE_TAB_COUNT) break;
  }
  for (const fallback of DEFAULT_MOBILE_TABS) {
    if (result.length >= MOBILE_TAB_COUNT) break;
    if (!result.includes(fallback)) result.push(fallback);
  }
  return result.slice(0, MOBILE_TAB_COUNT);
}

export function loadMobileTabs(): MobileTabActionId[] {
  try {
    const raw = localStorage.getItem(MOBILE_TABS_STORAGE_KEY);
    if (!raw) return [...DEFAULT_MOBILE_TABS];
    return sanitizeMobileTabs(JSON.parse(raw));
  } catch {
    return [...DEFAULT_MOBILE_TABS];
  }
}

export function saveMobileTabs(next: MobileTabActionId[]): MobileTabActionId[] {
  const clean = sanitizeMobileTabs(next);
  try {
    localStorage.setItem(MOBILE_TABS_STORAGE_KEY, JSON.stringify(clean));
  } catch {
    // 存储失败（隐私模式 / 配额）时仅影响持久化，UI 仍按内存值工作
  }
  window.dispatchEvent(new CustomEvent(MOBILE_TABS_CHANGED_EVENT, { detail: clean }));
  return clean;
}

/** 「全部笔记」是笔记工作区的入口，笔记本 / 标签 / 搜索视图都算在它下面。 */
const NOTE_WORKSPACE_VIEWS = new Set<ViewMode>(["all", "notebook", "search", "tag"]);

export function isMobileTabActive(action: MobileTabActionId, viewMode: ViewMode): boolean {
  if (action === "all-notes") return NOTE_WORKSPACE_VIEWS.has(viewMode);
  return viewMode === action;
}

/** 设置 / 通知不是 ViewMode，由各自的全局事件打开。 */
export function isMobileTabOverlayAction(action: MobileTabActionId): boolean {
  return action === "settings" || action === "notifications";
}

export function mobileTabOption(id: MobileTabActionId): MobileTabOption {
  return MOBILE_TAB_OPTIONS.find((option) => option.id === id) || MOBILE_TAB_OPTIONS[0];
}
