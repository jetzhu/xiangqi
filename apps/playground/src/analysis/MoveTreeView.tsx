import type { ReactNode } from "react";
import type { GameTree, TreeNode } from "xiangqi-core";
import { type NotationStyle, moveNumber, nodeLabel } from "./notation.js";

interface Props {
  tree: GameTree;
  current: TreeNode;
  style: NotationStyle;
  onSelect: (n: TreeNode) => void;
}

/** Main line as running text; variations appear indented right after the move they replace. */
export function MoveTreeView({ tree, current, style, onSelect }: Props) {
  const token = (n: TreeNode, numbered: boolean) => {
    const red = n.move!.color === "red";
    const num = red ? `${moveNumber(tree, n)}.` : numbered ? `${moveNumber(tree, n)}…` : "";
    return (
      <span key={n.id} className="tok">
        {num && <span className="num">{num}</span>}
        <button
          type="button"
          className={`mv${n === current ? " current" : ""}${n.move!.check ? " check" : ""}`}
          onClick={() => onSelect(n)}
          aria-current={n === current ? "step" : undefined}
          title={n.comment || undefined}
        >
          {nodeLabel(n, style)}
        </button>
        {n.comment && <span className="comment">{n.comment}</span>}
      </span>
    );
  };

  const line = (first: TreeNode, numbered: boolean): ReactNode[] => {
    const out: ReactNode[] = [];
    let n: TreeNode | undefined = first;
    let force = numbered;
    while (n) {
      out.push(token(n, force));
      force = false;
      const parent: TreeNode = n.parent!;
      if (parent.children[0] === n && parent.children.length > 1) {
        for (const v of parent.children.slice(1)) {
          out.push(
            <div key={`v${v.id}`} className="variation">
              {line(v, true)}
            </div>,
          );
        }
        force = true; // renumber after a variation
      }
      n = n.children[0];
    }
    return out;
  };

  const first = tree.root.children[0];
  return (
    <div className="tree" aria-label="Moves">
      <button type="button" className={`mv start${current === tree.root ? " current" : ""}`} onClick={() => onSelect(tree.root)}>
        ⏮
      </button>
      {first ? line(first, true) : null}
    </div>
  );
}
