"use client";
// Help: keyboard shortcuts, accessibility statement, troubleshooting and bug reports.
import { useEffect, useState } from "react";
import { useNav } from "./nav.js";
import { useT } from "./settings.js";

export interface HelpPageProps {
  /** Build identifier shown on the page and put into bug reports. */
  version: string;
  /** "New issue" address of the project's tracker; bug reports open it prefilled. */
  issuesUrl?: string;
}

export function HelpPage({ version, issuesUrl }: HelpPageProps) {
  const { tt, lang } = useT();
  const nav = useNav();
  const [browser, setBrowser] = useState("");
  useEffect(() => setBrowser(navigator.userAgent), []);

  const report =
    issuesUrl &&
    `${issuesUrl}?${new URLSearchParams({
      title: "",
      body: [
        "**What happened:**",
        "",
        "**What I expected:**",
        "",
        "**Steps:**",
        "1. ",
        "",
        "---",
        `Version: ${version}`,
        `Page: ${typeof location === "undefined" ? "" : location.pathname}`,
        `Browser: ${browser}`,
        `Language: ${lang}`,
      ].join("\n"),
    }).toString()}`;

  const keys: [string, string, string][] = [
    ["← ↑ → ↓", tt("Move the cursor on the board", "在棋盘上移动光标"), tt("Board", "棋盘")],
    ["Enter / Space", tt("Pick up the piece under the cursor, then put it down", "拿起光标处的棋子，再落子"), tt("Board", "棋盘")],
    ["Esc", tt("Drop the selected piece", "取消选中的棋子"), tt("Board", "棋盘")],
    ["Tab", tt("Move between the board and the buttons", "在棋盘和按钮之间切换"), tt("Everywhere", "全站")],
    ["← / →", tt("Previous / next move", "上一步 / 下一步"), tt("Analysis", "分析")],
    ["Home / End", tt("First / last move", "第一步 / 最后一步"), tt("Analysis", "分析")],
    [tt("Right-drag", "右键拖动"), tt("Draw an arrow (Shift red, Alt blue); right-click marks a point", "画箭头（Shift 红色，Alt 蓝色）；右键单击标记一点"), tt("Board", "棋盘")],
  ];

  return (
    <div className="help">
      <h1>{tt("Help", "帮助")}</h1>

      <section aria-labelledby="h-keys">
        <h2 id="h-keys">{tt("Keyboard shortcuts", "键盘快捷键")}</h2>
        <table className="keys">
          <thead>
            <tr>
              <th>{tt("Keys", "按键")}</th>
              <th>{tt("Action", "作用")}</th>
              <th>{tt("Where", "位置")}</th>
            </tr>
          </thead>
          <tbody>
            {keys.map(([k, what, where]) => (
              <tr key={k + where}>
                <td>
                  <kbd>{k}</kbd>
                </td>
                <td>{what}</td>
                <td>{where}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="h-a11y">
        <h2 id="h-a11y">{tt("Accessibility", "无障碍")}</h2>
        <p>
          {tt(
            "We aim for WCAG 2.1 level AA and check every page with automated tests (axe) on each release.",
            "我们以 WCAG 2.1 AA 级为目标，每次发布都会用自动化测试（axe）检查每个页面。",
          )}
        </p>
        <ul>
          <li>{tt("Every board can be played with the keyboard alone (see the shortcuts above).", "每个棋盘都可以只用键盘操作（见上面的快捷键）。")}</li>
          <li>
            {tt(
              "Screen readers hear each move in your chosen notation and language, with check and captures.",
              "读屏软件会按你选择的记谱法和语言朗读每一步，包括将军和吃子。",
            )}
          </li>
          <li>
            {tt(
              "Settings offer a high-contrast board, a colour-blind safe board, icon pieces, animation off and confirm each move.",
              "设置中提供高对比度棋盘、色盲友好棋盘、图标棋子、关闭动画和走子前确认。",
            )}
          </li>
          <li>{tt("Animations also stop when your system asks for reduced motion.", "当系统要求减少动态效果时，动画也会停止。")}</li>
        </ul>
        <p>
          <strong>{tt("Known gaps:", "已知不足：")}</strong>{" "}
          {tt(
            "the board's own spoken descriptions of the cursor are in English only, and puzzle and lesson boards have no spoken summary of the whole position yet.",
            "棋盘光标的朗读目前只有英文；题目和课程棋盘还不能朗读整个局面。",
          )}{" "}
          {report && (
            <>
              {tt("Please tell us about anything that gets in your way:", "如有任何障碍，请告诉我们：")}{" "}
              <a href={report} target="_blank" rel="noreferrer">
                {tt("report a problem", "报告问题")}
              </a>
              .
            </>
          )}
        </p>
      </section>

      <section aria-labelledby="h-trouble">
        <h2 id="h-trouble">{tt("Something isn't working", "遇到问题")}</h2>
        <ol>
          <li>
            {tt("Reload the page without the cache:", "强制刷新页面：")} <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd> ({tt("Mac", "Mac")}: <kbd>⌘</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd>).
          </li>
          <li>
            {tt(
              "Use a current Chrome, Edge, Firefox or Safari. The analysis engine and the bots need a browser that supports WebAssembly threads; on the first visit the page may reload once to turn them on.",
              "请使用最新版 Chrome、Edge、Firefox 或 Safari。分析引擎和机器人需要支持 WebAssembly 多线程的浏览器；首次访问时页面可能会自动刷新一次以启用。",
            )}
          </li>
          <li>
            {tt(
              "Private windows may not keep your progress, and some block the engine.",
              "无痕/隐私窗口可能不会保存进度，有些还会阻止引擎运行。",
            )}
          </li>
          <li>
            <strong>{tt("Careful:", "注意：")}</strong>{" "}
            {tt(
              "without an account your progress lives only in this browser. Clearing this site's data erases it.",
              "没有账号时，进度只保存在本浏览器中。清除本站数据会将其删除。",
            )}{" "}
            <a href={nav.href("/settings")}>{tt("Reset progress in Settings", "在设置中重置进度")}</a>.
          </li>
        </ol>
      </section>

      {report && (
        <section aria-labelledby="h-report">
          <h2 id="h-report">{tt("Report a problem", "报告问题")}</h2>
          <p>
            {tt(
              "This opens a new issue on GitHub with the version, page and browser filled in. Check the text before sending: it will be public.",
              "这会在 GitHub 上新建一个问题，并自动填入版本、页面和浏览器信息。发送前请检查内容：它将公开可见。",
            )}
          </p>
          <a className="button primary" href={report} target="_blank" rel="noreferrer">
            {tt("Report a problem on GitHub", "在 GitHub 上报告问题")}
          </a>
        </section>
      )}

      <section aria-labelledby="h-credits">
        <h2 id="h-credits">{tt("Credits", "致谢")}</h2>
        <ul>
          <li>
            {tt("Classical puzzles: positions from 适情雅趣 (1570) and the 江湖 street-endgame collection, via ", "古谱题目：局面出自《适情雅趣》（1570年）和江湖残局，取自 ")}
            <a href="https://github.com/floatai/xiangqibench" target="_blank" rel="noreferrer">
              XiangqiBench
            </a>{" "}
            {tt("(MIT licence, © 2026 FloatAI). Solutions are computed by our engine.", "（MIT 许可，© 2026 FloatAI）。解法由我们的引擎计算。")}
          </li>
          <li>
            {tt("Analysis and bots: ", "分析与机器人：")}
            <a href="https://github.com/fairy-stockfish/Fairy-Stockfish" target="_blank" rel="noreferrer">
              Fairy-Stockfish
            </a>{" "}
            {tt("(GPL-3.0). Puzzles were generated and checked with ", "（GPL-3.0）。题目由以下引擎生成并验证：")}
            <a href="https://github.com/official-pikafish/Pikafish" target="_blank" rel="noreferrer">
              Pikafish
            </a>{" "}
            (GPL-3.0).
          </li>
        </ul>
      </section>

      <p className="muted small">
        {tt("Version", "版本")} {version}
      </p>
    </div>
  );
}
