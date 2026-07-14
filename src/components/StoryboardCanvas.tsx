"use client";

import {
  ArrowRight,
  CornerUpRight,
  FlipHorizontal,
  FlipVertical,
  RectangleHorizontal,
  Type,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ArrowMotion, CanvasElement, StoryboardShot } from "@/types/storyboard";

type Props = {
  shot: StoryboardShot;
  onChange: (elements: CanvasElement[]) => void;
};

type Point = { x: number; y: number };
type Bounds = { x: number; y: number; width: number; height: number };
type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
type DragState =
  | { mode: "move"; ids: string[]; start: Point; starts: CanvasElement[] }
  | { mode: "resize"; ids: string[]; handle: Handle; start: Point; starts: CanvasElement[]; bounds: Bounds }
  | { mode: "rotate"; ids: string[]; start: Point; starts: CanvasElement[]; center: Point; startAngle: number };

const arrowButtons: { motion: ArrowMotion; label: string; icon: React.ReactNode }[] = [
  { motion: "straight", label: "直箭头", icon: <ArrowRight className="h-4 w-4 text-red-600" /> },
  { motion: "curveRight", label: "右弯箭头", icon: <CornerUpRight className="h-4 w-4 text-red-600" /> },
];

export function StoryboardCanvas({ shot, onChange }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [clipboard, setClipboard] = useState<CanvasElement[]>([]);
  const [failedImageUrl, setFailedImageUrl] = useState("");
  const [textDraftOpen, setTextDraftOpen] = useState(false);
  const [textDraft, setTextDraft] = useState("");
  const selected = shot.canvasElements.filter((element) => selectedIds.includes(element.id));
  const selectedBounds = useMemo(() => unionBounds(selected), [selected]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const isMod = event.metaKey || event.ctrlKey;
      if (isTypingTarget(document.activeElement)) return;
      if ((event.key === "Backspace" || event.key === "Delete") && selectedIds.length) {
        event.preventDefault();
        deleteSelected();
      }
      if (isMod && event.key.toLowerCase() === "c") {
        event.preventDefault();
        setClipboard(cloneElements(selected, 0));
      }
      if (isMod && event.key.toLowerCase() === "v" && clipboard.length) {
        event.preventDefault();
        pasteElements(clipboard);
      }
      if (isMod && event.key.toLowerCase() === "d" && selected.length) {
        event.preventDefault();
        pasteElements(selected);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [clipboard, selected, selectedIds]);

  const addText = () => {
    setTextDraft("");
    setTextDraftOpen(true);
  };

  const confirmText = () => {
    const value = textDraft.trim();
    if (!value) return;
    const element: CanvasElement = {
      id: crypto.randomUUID(),
      type: "label",
      text: value,
      x: 12,
      y: 14,
      scale: 1,
      rotation: 0,
    };
    onChange([...shot.canvasElements, element]);
    setSelectedIds([element.id]);
    setTextDraft("");
    setTextDraftOpen(false);
  };

  const addRect = () => {
    const element: CanvasElement = {
      id: crypto.randomUUID(),
      type: "rect",
      x: 28,
      y: 24,
      width: 28,
      height: 18,
      scale: 1,
      rotation: 0,
    };
    onChange([...shot.canvasElements, element]);
    setSelectedIds([element.id]);
  };

  const addArrow = (motion: ArrowMotion) => {
    const element: CanvasElement = {
      id: crypto.randomUUID(),
      type: "arrow",
      motion,
      x: 28,
      y: 22,
      width: 34,
      height: 16,
      rotation: 0,
      scale: 1,
    };
    onChange([...shot.canvasElements, element]);
    setSelectedIds([element.id]);
  };

  const updateElements = (ids: string[], updater: (element: CanvasElement) => CanvasElement) => {
    onChange(shot.canvasElements.map((element) => (ids.includes(element.id) ? updater(element) : element)));
  };

  const deleteSelected = () => {
    onChange(shot.canvasElements.filter((element) => !selectedIds.includes(element.id)));
    setSelectedIds([]);
  };

  const pasteElements = (elements: CanvasElement[]) => {
    const copies = cloneElements(elements, 3.55);
    onChange([...shot.canvasElements, ...copies]);
    setSelectedIds(copies.map((element) => element.id));
  };

  const beginMove = (event: React.PointerEvent<SVGGElement>, element: CanvasElement) => {
    event.preventDefault();
    event.stopPropagation();
    const nextSelection = event.shiftKey
      ? toggleId(selectedIds, element.id)
      : selectedIds.includes(element.id)
        ? selectedIds
        : [element.id];
    setSelectedIds(nextSelection);
    setDragState({
      mode: "move",
      ids: nextSelection,
      start: svgPoint(event),
      starts: shot.canvasElements.filter((item) => nextSelection.includes(item.id)),
    });
  };

  const beginResize = (event: React.PointerEvent<SVGCircleElement>, handle: Handle) => {
    if (!selectedBounds) return;
    event.preventDefault();
    event.stopPropagation();
    setDragState({ mode: "resize", ids: selectedIds, handle, start: svgPoint(event), starts: selected, bounds: selectedBounds });
  };

  const beginRotate = (event: React.PointerEvent<SVGCircleElement>) => {
    if (!selectedBounds) return;
    event.preventDefault();
    event.stopPropagation();
    const center = boundsCenter(selectedBounds);
    const point = svgPoint(event);
    setDragState({
      mode: "rotate",
      ids: selectedIds,
      start: point,
      starts: selected,
      center,
      startAngle: Math.atan2(point.y - center.y, point.x - center.x),
    });
  };

  const moveDrag = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!dragState) return;
    const point = svgPoint(event);
    if (dragState.mode === "move") {
      const dx = point.x - dragState.start.x;
      const dy = point.y - dragState.start.y;
      replaceElements(dragState.ids, dragState.starts.map((element) => moveElement(element, dx, dy)));
    } else if (dragState.mode === "resize") {
      const nextBounds = resizeBounds(dragState.bounds, dragState.handle, point.x - dragState.start.x, point.y - dragState.start.y, event.shiftKey || isCorner(dragState.handle));
      replaceElements(dragState.ids, dragState.starts.map((element) => transformElementFromBounds(element, dragState.bounds, nextBounds)));
    } else {
      let angle = Math.atan2(point.y - dragState.center.y, point.x - dragState.center.x) - dragState.startAngle;
      let degrees = (angle * 180) / Math.PI;
      if (event.shiftKey) degrees = Math.round(degrees / 15) * 15;
      angle = (degrees * Math.PI) / 180;
      replaceElements(dragState.ids, dragState.starts.map((element) => rotateElementAround(element, dragState.center, angle, degrees)));
    }
  };

  const replaceElements = (ids: string[], replacements: CanvasElement[]) => {
    const byId = new Map(replacements.map((element) => [element.id, element]));
    onChange(shot.canvasElements.map((element) => (ids.includes(element.id) ? byId.get(element.id) ?? element : element)));
  };

  const svgPoint = (event: React.PointerEvent | PointerEvent) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) / rect.width) * 100, y: ((event.clientY - rect.top) / rect.height) * 56.25 };
  };

  return (
    <section className="flex h-full flex-col bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <ToolButton title="添加文字" onClick={addText} icon={<Type className="h-4 w-4" />} label="文字" />
        <ToolButton title="添加矩形框" onClick={addRect} icon={<RectangleHorizontal className="h-4 w-4" />} label="矩形" />
        {arrowButtons.map((item) => (
          <ToolButton key={item.motion} title={item.label} onClick={() => addArrow(item.motion)} icon={item.icon} label={item.label} />
        ))}
        {selected.length ? (
          <>
            <div className="mx-1 h-6 w-px bg-line" />
            <ToolButton title="水平镜像" onClick={() => updateElements(selectedIds, (element) => ({ ...element, flipX: !element.flipX }))} icon={<FlipHorizontal className="h-4 w-4" />} label="水平镜像" />
            <ToolButton title="垂直镜像" onClick={() => updateElements(selectedIds, (element) => ({ ...element, flipY: !element.flipY }))} icon={<FlipVertical className="h-4 w-4" />} label="垂直镜像" />
          </>
        ) : null}
      </div>

      {textDraftOpen ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-[#fffaf0] px-4 py-3">
          <span className="text-xs font-semibold text-stone-600">输入文字</span>
          <input
            value={textDraft}
            onChange={(event) => setTextDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") confirmText();
              if (event.key === "Escape") setTextDraftOpen(false);
            }}
            autoFocus
            className="h-9 min-w-[180px] border border-line bg-white px-3 text-sm text-red-700 outline-none focus:border-teal"
          />
          <button type="button" onClick={confirmText} className="h-9 border border-line bg-white px-3 text-sm font-semibold hover:border-teal">
            确认
          </button>
          <button type="button" onClick={() => setTextDraftOpen(false)} className="h-9 border border-line bg-white px-3 text-sm font-semibold hover:border-teal">
            取消
          </button>
        </div>
      ) : null}

      <div className="grid flex-1 place-items-center bg-stone-100 p-6">
        <div className="relative aspect-video w-full max-w-4xl overflow-hidden border border-ink bg-[#fbfaf7]">
          {shot.imageUrl && failedImageUrl !== shot.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shot.imageUrl} alt={`Shot ${shot.shotNumber}`} className="h-full w-full object-cover" onError={() => setFailedImageUrl(shot.imageUrl)} />
          ) : failedImageUrl === shot.imageUrl && shot.imageUrl ? (
            <div className="grid h-full place-items-center px-8 text-center text-sm font-semibold text-red-700">图片加载失败，请重新复制图片本身，或下载后用“从本地文件中选择”上传。</div>
          ) : (
            <div className="grid h-full place-items-center text-sm font-semibold text-stone-500">从本地文件中选择图片，或粘贴生成后的分镜图</div>
          )}
          <svg
            ref={svgRef}
            className="absolute inset-0 h-full w-full touch-none"
            viewBox="0 0 100 56.25"
            onPointerMove={moveDrag}
            onPointerUp={() => setDragState(null)}
            onPointerCancel={() => setDragState(null)}
            onPointerLeave={() => setDragState(null)}
            onPointerDown={() => setSelectedIds([])}
            onContextMenu={(event) => event.preventDefault()}
          >
            {shot.canvasElements.map((element) => (
              <g key={element.id} onPointerDown={(event) => beginMove(event, element)} className="cursor-move">
                {renderElement(element)}
              </g>
            ))}
            {selectedBounds ? (
              <SelectionBox bounds={selectedBounds} angle={selected.length === 1 ? selected[0].rotation ?? 0 : 0} onResize={beginResize} onRotate={beginRotate} />
            ) : null}
            {dragState?.mode === "rotate" && selected.length ? (
              <text x={selectedBounds ? selectedBounds.x + selectedBounds.width + 1 : 1} y={selectedBounds ? selectedBounds.y : 5} fontSize="2.4" fill="#0f766e" fontWeight="700">
                {Math.round(selected[0].rotation ?? 0)}°
              </text>
            ) : null}
          </svg>
        </div>
      </div>
    </section>
  );
}

function ToolButton({ title, onClick, icon, label, disabled = false }: { title: string; onClick: () => void; icon: React.ReactNode; label: string; disabled?: boolean }) {
  return (
    <button type="button" title={title} onClick={onClick} disabled={disabled} className="inline-flex h-9 items-center gap-2 border border-line px-3 text-sm font-semibold hover:border-teal disabled:cursor-not-allowed disabled:opacity-45">
      {icon}
      {label}
    </button>
  );
}

function renderElement(element: CanvasElement) {
  const bounds = elementBounds(element);
  const center = boundsCenter(bounds);
  const transform = transformForElement(element, center);

  if (element.type === "label") {
    return (
      <g transform={transform}>
        <rect x={bounds.x} y={bounds.y} width={bounds.width} height={bounds.height} fill="white" stroke="#111" strokeWidth="0.25" />
        <text x={bounds.x + 1} y={bounds.y + bounds.height * 0.68} fontSize={Math.max(1.8, bounds.height * 0.55)} fontWeight="700" fill="#dc2626">
          {element.text}
        </text>
      </g>
    );
  }

  if (element.type === "rect") {
    return <rect transform={transform} x={bounds.x} y={bounds.y} width={bounds.width} height={bounds.height} fill="none" stroke="#111" strokeWidth="0.65" />;
  }

  return <path transform={transform} d={arrowPath(element.motion, bounds)} fill="#ef0000" stroke="#ef0000" strokeWidth="0.15" />;
}

function SelectionBox({ bounds, angle, onResize, onRotate }: { bounds: Bounds; angle: number; onResize: (event: React.PointerEvent<SVGCircleElement>, handle: Handle) => void; onRotate: (event: React.PointerEvent<SVGCircleElement>) => void }) {
  const center = boundsCenter(bounds);
  const handles: Array<{ handle: Handle; x: number; y: number }> = [
    { handle: "nw", x: bounds.x, y: bounds.y },
    { handle: "n", x: center.x, y: bounds.y },
    { handle: "ne", x: bounds.x + bounds.width, y: bounds.y },
    { handle: "e", x: bounds.x + bounds.width, y: center.y },
    { handle: "se", x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    { handle: "s", x: center.x, y: bounds.y + bounds.height },
    { handle: "sw", x: bounds.x, y: bounds.y + bounds.height },
    { handle: "w", x: bounds.x, y: center.y },
  ];
  const transform = `rotate(${angle} ${center.x} ${center.y})`;

  return (
    <g transform={transform}>
      <rect x={bounds.x} y={bounds.y} width={bounds.width} height={bounds.height} fill="none" stroke="#06b6d4" strokeWidth="0.5" strokeDasharray="1.4 0.8" />
      <line x1={center.x} y1={bounds.y} x2={center.x} y2={bounds.y - 5} stroke="#06b6d4" strokeWidth="0.35" />
      <circle cx={center.x} cy={bounds.y - 5} r="1.15" fill="white" stroke="#06b6d4" strokeWidth="0.45" className="cursor-grab" onPointerDown={onRotate} />
      {handles.map((item) => (
        <circle key={item.handle} cx={item.x} cy={item.y} r="0.95" fill="white" stroke="#06b6d4" strokeWidth="0.45" className="cursor-pointer" onPointerDown={(event) => onResize(event, item.handle)} />
      ))}
    </g>
  );
}

function arrowPath(motion: ArrowMotion, b: Bounds) {
  const x = b.x;
  const y = b.y;
  const w = b.width;
  const h = b.height;
  if (motion === "curveUp") {
    return `M ${x + w * 0.8} ${y + h * 0.82} L ${x + w * 0.8} ${y + h * 0.55} Q ${x + w * 0.8} ${y + h * 0.25} ${x + w * 0.45} ${y + h * 0.25} L ${x + w * 0.45} ${y + h * 0.06} L ${x + w * 0.12} ${y + h * 0.38} L ${x + w * 0.45} ${y + h * 0.7} L ${x + w * 0.45} ${y + h * 0.5} Q ${x + w * 0.55} ${y + h * 0.5} ${x + w * 0.55} ${y + h * 0.62} L ${x + w * 0.55} ${y + h * 0.82} Z`;
  }
  if (motion === "curveRight") {
    return `M ${x + w * 0.12} ${y + h * 0.18} Q ${x + w * 0.12} ${y + h * 0.78} ${x + w * 0.62} ${y + h * 0.78} L ${x + w * 0.62} ${y + h * 0.96} L ${x + w * 0.94} ${y + h * 0.64} L ${x + w * 0.62} ${y + h * 0.32} L ${x + w * 0.62} ${y + h * 0.52} Q ${x + w * 0.38} ${y + h * 0.52} ${x + w * 0.38} ${y + h * 0.18} Z`;
  }
  return `M ${x + w * 0.08} ${y + h * 0.28} L ${x + w * 0.66} ${y + h * 0.28} L ${x + w * 0.66} ${y + h * 0.08} L ${x + w * 0.96} ${y + h * 0.5} L ${x + w * 0.66} ${y + h * 0.92} L ${x + w * 0.66} ${y + h * 0.72} L ${x + w * 0.08} ${y + h * 0.72} Z`;
}

function elementBounds(element: CanvasElement): Bounds {
  if (element.type === "label") {
    const scale = element.scale ?? 1;
    return { x: element.x, y: element.y, width: 12 * scale, height: 4.2 * scale };
  }
  if (element.type === "rect") {
    const scale = element.scale ?? 1;
    return { x: element.x, y: element.y, width: element.width * scale, height: element.height * scale };
  }
  if (typeof element.x === "number" && typeof element.y === "number") {
    return { x: element.x, y: element.y, width: element.width ?? 28, height: element.height ?? 14 };
  }
  const x1 = element.x1 ?? 28;
  const y1 = element.y1 ?? 22;
  const x2 = element.x2 ?? 62;
  const y2 = element.y2 ?? 38;
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1) || 28, height: Math.abs(y2 - y1) || 14 };
}

function transformForElement(element: CanvasElement, center: Point) {
  const sx = element.flipX ? -1 : 1;
  const sy = element.flipY ? -1 : 1;
  return `rotate(${element.rotation ?? 0} ${center.x} ${center.y}) translate(${center.x} ${center.y}) scale(${sx} ${sy}) translate(${-center.x} ${-center.y})`;
}

function moveElement(element: CanvasElement, dx: number, dy: number): CanvasElement {
  if (element.type === "arrow") {
    const b = elementBounds(element);
    return { ...element, x: b.x + dx, y: b.y + dy, width: b.width, height: b.height };
  }
  return { ...element, x: element.x + dx, y: element.y + dy };
}

function transformElementFromBounds(element: CanvasElement, from: Bounds, to: Bounds): CanvasElement {
  const b = elementBounds(element);
  const nx = to.x + ((b.x - from.x) / from.width) * to.width;
  const ny = to.y + ((b.y - from.y) / from.height) * to.height;
  const nw = b.width * (to.width / from.width);
  const nh = b.height * (to.height / from.height);
  if (element.type === "label") return { ...element, x: nx, y: ny, scale: Math.max(0.2, nw / 12) };
  if (element.type === "rect") return { ...element, x: nx, y: ny, width: Math.max(1, nw), height: Math.max(1, nh), scale: 1 };
  return { ...element, x: nx, y: ny, width: Math.max(1, nw), height: Math.max(1, nh) };
}

function rotateElementAround(element: CanvasElement, center: Point, angle: number, degrees: number): CanvasElement {
  const b = elementBounds(element);
  const c = rotatePoint(boundsCenter(b), center, angle);
  const moved = moveElement(element, c.x - boundsCenter(b).x, c.y - boundsCenter(b).y);
  return { ...moved, rotation: (element.rotation ?? 0) + degrees };
}

function resizeBounds(bounds: Bounds, handle: Handle, dx: number, dy: number, keepRatio: boolean): Bounds {
  let x = bounds.x;
  let y = bounds.y;
  let width = bounds.width;
  let height = bounds.height;
  if (handle.includes("e")) width += dx;
  if (handle.includes("s")) height += dy;
  if (handle.includes("w")) {
    x += dx;
    width -= dx;
  }
  if (handle.includes("n")) {
    y += dy;
    height -= dy;
  }
  width = Math.max(2, width);
  height = Math.max(2, height);
  if (keepRatio) {
    const ratio = bounds.width / bounds.height;
    if (Math.abs(dx) > Math.abs(dy)) height = width / ratio;
    else width = height * ratio;
    if (handle.includes("w")) x = bounds.x + bounds.width - width;
    if (handle.includes("n")) y = bounds.y + bounds.height - height;
  }
  return { x, y, width, height };
}

function unionBounds(elements: CanvasElement[]) {
  if (!elements.length) return null;
  const bounds = elements.map(elementBounds);
  const x = Math.min(...bounds.map((b) => b.x));
  const y = Math.min(...bounds.map((b) => b.y));
  const right = Math.max(...bounds.map((b) => b.x + b.width));
  const bottom = Math.max(...bounds.map((b) => b.y + b.height));
  return { x, y, width: right - x, height: bottom - y };
}

function boundsCenter(bounds: Bounds): Point {
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

function rotatePoint(point: Point, center: Point, angle: number): Point {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return { x: center.x + dx * Math.cos(angle) - dy * Math.sin(angle), y: center.y + dx * Math.sin(angle) + dy * Math.cos(angle) };
}

function cloneElements(elements: CanvasElement[], offset: number) {
  return elements.map((element) => moveElement({ ...element, id: crypto.randomUUID() }, offset, offset));
}

function toggleId(ids: string[], id: string) {
  return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
}

function isCorner(handle: Handle) {
  return ["nw", "ne", "se", "sw"].includes(handle);
}

function isTypingTarget(element: Element | null) {
  if (!element) return false;
  const tagName = element.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || element.hasAttribute("contenteditable");
}
