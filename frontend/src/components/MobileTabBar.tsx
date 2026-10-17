import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Bell,
  BrainCircuit,
  Check,
  FileText,
  FolderOpen,
  Link2,
  ListTodo,
  NotebookPen,
  RotateCcw,
  Settings,
  Sparkles,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { useApp, useAppActions } from "@/store/AppContext";
import { cn } from "@/lib/utils";
import { OPEN_NOTIFICATIONS_EVENT, parseIssueAppPath } from "@/lib/workspaceIssueNavigation";
import { pushAppPathState, resolveCurrentAppPathname } from "@/lib/appPathNavigation";
import { getCurrentMindMapAppRoute, pushMindMapAppPath } from "@/lib/mindMapDeepLink";
import {
  DEFAULT_MOBILE_TABS,
  MOBILE_TAB_COUNT,
  MOBILE_TAB_OPTIONS,
  MOBILE_TABS_CHANGED_EVENT,
  OPEN_MOBILE_TABS_CUSTOMIZER_EVENT,
  isMobileTabActive,
  loadMobileTabs,
  mobileTabOption,
  saveMobileTabs,
  type MobileTabActionId,
} from "@/lib/mobileTabBar";
import { isMobileLocalMode, requestMobileAccountLogin } from "@/lib/mobileLocalMode";
import type { ViewMode } from "@/types";

const TAB_ICON_SIZE = 21;

const TAB_ICONS: Record<MobileTabActionId, React.ReactNode> = {
  "all-notes": <FileText size={TAB_ICON_SIZE} strokeWidth={1.9} />,
  tasks: <ListTodo size={TAB_ICON_SIZE} strokeWidth={1.9} />,
  files: <FolderOpen size={TAB_ICON_SIZE} strokeWidth={1.9} />,
  "ai-chat": <Sparkles size={TAB_ICON_SIZE} strokeWidth={1.9} />,
  settings: <Settings size={TAB_ICON_SIZE} strokeWidth={1.9} />,
  mindmaps: <BrainCircuit size={TAB_ICON_SIZE} strokeWidth={1.9} />,
  diary: <NotebookPen size={TAB_ICON_SIZE} strokeWidth={1.9} />,
  favorites: <Star size={TAB_ICON_SIZE} strokeWidth={1.9} />,
  shares: <Link2 size={TAB_ICON_SIZE} strokeWidth={1.9} />,
  trash: <Trash2 size={TAB_ICON_SIZE} strokeWidth={1.9} />,
  notifications: <Bell size={TAB_ICON_SIZE} strokeWidth={1.9} />,
};

/** 模块类动作对应的 ViewMode；设置 / 通知走全局事件。 */
const ACTION_VIEW_MODE: Partial<Record<MobileTabActionId, ViewMode>> = {
  favorites: "favorites",
  tasks: "tasks",
  mindmaps: "mindmaps",
  files: "files",
  diary: "diary",
  "ai-chat": "ai-chat",
  shares: "shares",
  trash: "trash",
};

const LONG_PRESS_MS = 460;

/**
 * 移动端底部标签栏 —— 微信式 5 槽位，长按任意槽位可替换为侧边栏里的其它模块。
 * 只在 < md 断点显示；液态玻璃样式见 mobile-liquid-glass.css。
 */
export default function MobileTabBar({ notificationCount = 0 }: { notificationCount?: number }) {
  const { t, i18n } = useTranslation();
  const { state } = useApp();
  const actions = useAppActions();
  const localDeviceMode = isMobileLocalMode();
  const [tabs, setTabs] = useState<MobileTabActionId[]>(() => loadMobileTabs());
  const [customizingSlot, setCustomizingSlot] = useState<number | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);
  const pressStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const sync = () => setTabs(loadMobileTabs());
    window.addEventListener(MOBILE_TABS_CHANGED_EVENT, sync);
    window.addEventListener(OPEN_MOBILE_TABS_CUSTOMIZER_EVENT, () => setCustomizingSlot(0));
    return () => {
      window.removeEventListener(MOBILE_TABS_CHANGED_EVENT, sync);
    };
  }, []);

  useEffect(() => () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  }, []);

  const activate = useCallback((action: MobileTabActionId) => {
    if (action === "settings") {
      window.dispatchEvent(new CustomEvent("nowen:open-settings"));
      return;
    }
    if (action === "notifications") {
      window.dispatchEvent(new Event(OPEN_NOTIFICATIONS_EVENT));
      return;
    }
    // 本地离线模式下 AI / 分享需要先登录：与抽屉 Rail 的行为保持一致。
    if (localDeviceMode && (action === "ai-chat" || action === "shares")) {
      requestMobileAccountLogin();
      window.location.reload();
      return;
    }

    if (action === "all-notes") {
      if (parseIssueAppPath(resolveCurrentAppPathname()).matched) pushAppPathState("/");
      else if (getCurrentMindMapAppRoute().matched) pushAppPathState("/");
      actions.setSelectedNotebook(null);
      actions.clearSelectedTags();
      actions.setSearchQuery("");
      actions.setViewMode("all");
      actions.setMobileView("list");
      actions.setMobileSidebar(false);
      return;
    }

    const mode = ACTION_VIEW_MODE[action];
    if (!mode) return;

    if (mode === "mindmaps") pushMindMapAppPath(null);
    else if (getCurrentMindMapAppRoute().matched) pushAppPathState("/");

    actions.setViewMode(mode);
    actions.setSelectedNotebook(null);
    actions.setMobileView("list");
    actions.setMobileSidebar(false);
  }, [actions]);

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    pressStart.current = null;
  }, []);

  const handlePointerDown = useCallback((index: number, event: React.PointerEvent<HTMLButtonElement>) => {
    longPressFired.current = false;
    clearLongPress();
    pressStart.current = { x: event.clientX, y: event.clientY };
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      longPressTimer.current = null;
      setCustomizingSlot(index);
    }, LONG_PRESS_MS);
  }, [clearLongPress]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const start = pressStart.current;
    if (!start) return;
    if (Math.abs(event.clientX - start.x) > 10 || Math.abs(event.clientY - start.y) > 10) clearLongPress();
  }, [clearLongPress]);

  const handleClick = useCallback((action: MobileTabActionId) => {
    if (longPressFired.current) {
      longPressFired.current = false;
      return;
    }
    activate(action);
  }, [activate]);

  const assignSlot = useCallback((slot: number, action: MobileTabActionId) => {
    const next = [...tabs];
    next[slot] = action;
    setTabs(saveMobileTabs(next));
    setCustomizingSlot(null);
  }, [tabs]);

  const resetTabs = useCallback(() => {
    setTabs(saveMobileTabs([...DEFAULT_MOBILE_TABS]));
    setCustomizingSlot(null);
  }, []);

  const labelFor = useCallback((action: MobileTabActionId) => {
    const option = mobileTabOption(action);
    const chinese = (i18n.language || "").toLowerCase().startsWith("zh");
    return chinese ? option.labelZh : option.labelEn;
  }, [i18n.language]);

  const usedElsewhere = useMemo(() => {
    if (customizingSlot === null) return new Set<MobileTabActionId>();
    return new Set(tabs.filter((_, index) => index !== customizingSlot));
  }, [customizingSlot, tabs]);

  const slotsFilled = Math.min(tabs.length, MOBILE_TAB_COUNT);

  return (
    <>
      <nav
        className="mobile-tabbar md:hidden"
        data-mobile-tabbar=""
        aria-label={t("mobileTabs.ariaLabel", { defaultValue: "主导航" })}
      >
        <div className="mobile-tabbar__glass" aria-hidden="true" />
        <div className="mobile-tabbar__items">
          {tabs.slice(0, slotsFilled).map((action, index) => {
            const active = isMobileTabActive(action, state.viewMode);
            return (
              <button
                key={`${action}-${index}`}
                type="button"
                data-mobile-tab-item={action}
                data-active={active ? "true" : "false"}
                aria-current={active ? "page" : undefined}
                aria-label={labelFor(action)}
                className={cn("mobile-tabbar__item", active && "is-active")}
                onPointerDown={(event) => handlePointerDown(index, event)}
                onPointerMove={handlePointerMove}
                onPointerUp={clearLongPress}
                onPointerCancel={clearLongPress}
                onPointerLeave={clearLongPress}
                onContextMenu={(event) => { event.preventDefault(); setCustomizingSlot(index); }}
                onClick={() => handleClick(action)}
              >
                {active && (
                  <motion.span
                    layoutId="mobile-tabbar-active-pill"
                    className="mobile-tabbar__pill"
                    transition={{ type: "spring", stiffness: 460, damping: 34, mass: 0.7 }}
                    aria-hidden="true"
                  />
                )}
                <span className="mobile-tabbar__icon">
                  {TAB_ICONS[action]}
                  {action === "notifications" && notificationCount > 0 && (
                    <span className="mobile-tabbar__badge">{notificationCount > 99 ? "99+" : notificationCount}</span>
                  )}
                </span>
                <span className="mobile-tabbar__label">{labelFor(action)}</span>
              </button>
            );
          })}
        </div>
      </nav>

      <AnimatePresence>
        {customizingSlot !== null && (
          <motion.div
            className="mobile-tabbar-sheet"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <button
              type="button"
              className="mobile-tabbar-sheet__backdrop"
              aria-label={t("common.close", { defaultValue: "关闭" })}
              onClick={() => setCustomizingSlot(null)}
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label={t("mobileTabs.customizeTitle", { defaultValue: "底栏按钮" })}
              className="mobile-tabbar-sheet__panel"
              initial={{ y: 260, opacity: 0.6 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 260, opacity: 0 }}
              transition={{ type: "spring", stiffness: 380, damping: 36 }}
            >
              <div className="mobile-tabbar-sheet__handle" aria-hidden="true" />
              <div className="mobile-tabbar-sheet__head">
                <div>
                  <h3>{t("mobileTabs.customizeTitle", { defaultValue: "底栏按钮" })}</h3>
                  <p>{t("mobileTabs.customizeHint", { defaultValue: "长按底栏按钮即可随时换掉它" })}</p>
                </div>
                <button
                  type="button"
                  className="mobile-tabbar-sheet__close"
                  aria-label={t("common.close", { defaultValue: "关闭" })}
                  onClick={() => setCustomizingSlot(null)}
                >
                  <X size={18} />
                </button>
              </div>

              <div className="mobile-tabbar-sheet__slots" role="tablist">
                {Array.from({ length: slotsFilled }).map((_, index) => (
                  <button
                    key={index}
                    type="button"
                    role="tab"
                    aria-selected={index === customizingSlot}
                    className={cn("mobile-tabbar-sheet__slot", index === customizingSlot && "is-active")}
                    onClick={() => setCustomizingSlot(index)}
                  >
                    <span className="mobile-tabbar-sheet__slot-icon">{TAB_ICONS[tabs[index]]}</span>
                    <span className="mobile-tabbar-sheet__slot-label">{labelFor(tabs[index])}</span>
                  </button>
                ))}
              </div>

              <div className="mobile-tabbar-sheet__options">
                {MOBILE_TAB_OPTIONS.map((option) => {
                  const current = tabs[customizingSlot] === option.id;
                  const disabled = !current && usedElsewhere.has(option.id);
                  return (
                    <button
                      key={option.id}
                      type="button"
                      disabled={disabled}
                      data-option={option.id}
                      className={cn("mobile-tabbar-sheet__option", current && "is-current", disabled && "is-used")}
                      onClick={() => assignSlot(customizingSlot, option.id)}
                    >
                      <span className="mobile-tabbar-sheet__option-icon">{TAB_ICONS[option.id]}</span>
                      <span className="mobile-tabbar-sheet__option-label">{labelFor(option.id)}</span>
                      {current && <Check size={16} className="mobile-tabbar-sheet__option-check" />}
                      {disabled && <span className="mobile-tabbar-sheet__option-tag">{t("mobileTabs.inUse", { defaultValue: "已在用" })}</span>}
                    </button>
                  );
                })}
              </div>

              <div className="mobile-tabbar-sheet__footer">
                <button type="button" className="mobile-tabbar-sheet__reset" onClick={resetTabs}>
                  <RotateCcw size={15} />
                  {t("mobileTabs.reset", { defaultValue: "恢复默认" })}
                </button>
                <button type="button" className="mobile-tabbar-sheet__done" onClick={() => setCustomizingSlot(null)}>
                  {t("common.done", { defaultValue: "完成" })}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
