"use client";

import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import type { StoryboardShot } from "@/types/storyboard";

type Props = {
  shots: StoryboardShot[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
};

export function ShotList({ shots, activeId, onSelect, onDelete, onMove }: Props) {
  return (
    <nav className="storyboard-scrollbar flex max-h-[calc(100vh-280px)] flex-col gap-2 overflow-y-auto pr-1">
      {shots.map((shot, index) => (
        <div
          key={shot.id}
          className={`group border px-3 py-3 text-left transition ${
            activeId === shot.id
              ? "border-teal bg-white"
              : "border-line bg-transparent hover:border-stone-400 hover:bg-white"
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <button type="button" onClick={() => onSelect(shot.id)} className="min-w-0 flex-1 text-left">
              <div className="text-sm font-semibold text-ink">Shot {shot.shotNumber}</div>
              <div className="mt-1 line-clamp-2 text-xs leading-5 text-stone-600">
                {shot.scriptText || "暂无脚本文字"}
              </div>
            </button>
            <div className="flex shrink-0 gap-1 opacity-70 transition group-hover:opacity-100">
              <IconButton
                label="上移"
                disabled={index === 0}
                onClick={(event) => {
                  event.stopPropagation();
                  onMove(shot.id, -1);
                }}
              >
                <ArrowUp className="h-4 w-4" />
              </IconButton>
              <IconButton
                label="下移"
                disabled={index === shots.length - 1}
                onClick={(event) => {
                  event.stopPropagation();
                  onMove(shot.id, 1);
                }}
              >
                <ArrowDown className="h-4 w-4" />
              </IconButton>
              <IconButton
                label="删除"
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete(shot.id);
                }}
              >
                <Trash2 className="h-4 w-4" />
              </IconButton>
            </div>
          </div>
        </div>
      ))}
    </nav>
  );
}

function IconButton({
  children,
  label,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  disabled?: boolean;
  onClick: React.MouseEventHandler<HTMLButtonElement>;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid h-7 w-7 place-items-center border border-transparent text-stone-600 hover:border-line hover:bg-paper disabled:cursor-not-allowed disabled:opacity-30"
    >
      {children}
    </button>
  );
}
