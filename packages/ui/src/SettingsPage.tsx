"use client";
import type { PieceSet, ThemeName } from "@xq/board";
import { Board } from "./Board.js";
import { type Lang, type NotationStyle, type Settings, useSettings, useT } from "./settings.js";

/** The start position after 1. 炮二平五, used for decorative boards. */
const AFTER_CENTRAL_CANNON = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR b - - 1 1";

interface Props {
  /** Called when the language changes (the website switches to the other locale's URL). */
  onLanguage?: (lang: Lang) => void;
}

export function SettingsPage({ onLanguage }: Props) {
  const { settings, update } = useSettings();
  const { tt } = useT();
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => update({ [k]: v } as Partial<Settings>);

  return (
    <div className="settings">
      <div className="board-col">
        <Board fen={AFTER_CENTRAL_CANNON} movable="none" lastMove="h2e2" ariaLabel={tt("Board preview", "棋盘预览")} />
      </div>
      <section className="panel">
        <h1>{tt("Settings", "设置")}</h1>
        <p className="sub">{tt("Saved in this browser and used on every page.", "保存在本浏览器中，所有页面通用。")}</p>
        <div className="options">
          <label>
            {tt("Language", "语言")}
            <select
              value={settings.lang}
              onChange={(e) => {
                const lang = e.target.value as Lang;
                set("lang", lang);
                onLanguage?.(lang);
              }}
            >
              <option value="zh">中文</option>
              <option value="en">English</option>
            </select>
          </label>
          <label>
            {tt("Notation", "记谱")}
            <select value={settings.notation} onChange={(e) => set("notation", e.target.value as NotationStyle)}>
              <option value="chinese">中文 (炮二平五)</option>
              <option value="wxf">WXF (C2.5)</option>
              <option value="iccs">ICCS (h2e2)</option>
            </select>
          </label>
          <label>
            {tt("Pieces", "棋子")}
            <select value={settings.pieceSet} onChange={(e) => set("pieceSet", e.target.value as PieceSet)}>
              <option value="traditional">{tt("Chinese characters", "汉字")}</option>
              <option value="icons">{tt("Icons (for learners)", "图标（便于初学）")}</option>
            </select>
          </label>
          <label>
            {tt("Board theme", "棋盘主题")}
            <select value={settings.theme} onChange={(e) => set("theme", e.target.value as ThemeName)}>
              <option value="wood">{tt("Wood", "木纹")}</option>
              <option value="green">{tt("Green", "绿色")}</option>
              <option value="high-contrast">{tt("High contrast", "高对比度")}</option>
            </select>
          </label>
          <label>
            {tt("Coordinates", "坐标")}
            <select value={settings.coordinates} onChange={(e) => set("coordinates", e.target.value as Settings["coordinates"])}>
              <option value="wxf">{tt("Files 1–9 (WXF)", "路数 1–9")}</option>
              <option value="iccs">{tt("a–i / 0–9 (ICCS)", "a–i / 0–9（ICCS）")}</option>
              <option value="off">{tt("Off", "关闭")}</option>
            </select>
          </label>
          <label>
            {tt("Move pieces by", "走子方式")}
            <select value={settings.moveMethod} onChange={(e) => set("moveMethod", e.target.value as Settings["moveMethod"])}>
              <option value="both">{tt("Drag or click", "拖动或点击")}</option>
              <option value="drag">{tt("Drag", "拖动")}</option>
              <option value="click">{tt("Click", "点击")}</option>
            </select>
          </label>
        </div>
        <fieldset className="assists">
          <label className="check">
            <input type="checkbox" checked={settings.showLegalMoves} onChange={(e) => set("showLegalMoves", e.target.checked)} />
            {tt("Show legal moves", "显示可走位置")}
          </label>
          <label className="check">
            <input type="checkbox" checked={settings.sound} onChange={(e) => set("sound", e.target.checked)} />
            {tt("Sound", "声音")}
          </label>
        </fieldset>
      </section>
    </div>
  );
}
