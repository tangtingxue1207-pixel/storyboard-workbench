import type { StoryboardShot } from "@/types/storyboard";
import { buildPanelPrompt } from "@/lib/panelPrompt";
import { cleanPdfItemText, normalizeCellText, normalizeExtractedScriptText } from "@/lib/textClean";

type PdfjsModule = typeof import("pdfjs-dist");

let pdfjsPromise: Promise<PdfjsModule> | null = null;

async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.mjs",
        import.meta.url,
      ).toString();
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

export async function extractPdfText(file: File) {
  const pdfjs = await loadPdfjs();
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buffer }).promise;
  const pages: string[] = [];
  const tableShots: StoryboardShot[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const renderedTable = await detectRenderedTable(page);
    const content = await page.getTextContent();
    const items = content.items
      .flatMap((item) => {
        if (!("str" in item) || !item.str.trim()) return [];
        const transform = Array.isArray(item.transform) ? item.transform : [1, 0, 0, 1, 0, 0];
        const x = Number(transform[4] ?? 0);
        const y = viewport.height - Number(transform[5] ?? 0);
        return [{
          text: cleanPdfItemText(item.str),
          x,
          y,
        }];
      })
      .filter((item) => item.text);
    const pageTableShots = extractRenderedTableRows({
      pageNumber,
      width: viewport.width,
      height: viewport.height,
      items,
      renderedTable,
      previousShots: tableShots,
    });
    tableShots.push(...pageTableShots);
    const text = linesFromItems(items)
      .map((line) => line.text)
      .join("\n")
      .trim();
    pages.push(normalizeExtractedScriptText(text));
  }

  return {
    pageCount: pdf.numPages,
    text: normalizeExtractedScriptText(pages.join("\n\n")),
    pages,
    tableShots: dedupeShots(tableShots).sort((a, b) => a.shotNumber - b.shotNumber),
  };
}

const shotPattern = /(^|\n)\s*(Shot\s*\d+|分镜\s*\d+|镜头\s*\d+|\d{1,3}\s*[\.、，:]?)(?=\s|\n|$)/gim;
const motionPattern = /(推|推近|拉|后拉|摇左|摇右|上移|下移|俯拍|俯|跟拍|跟|摇|移|特写|近景|中景|中近景|全景|大全|小全|过肩|固定|升格)/g;

export function splitTextToShots(text: string): StoryboardShot[] {
  const cleanText = normalizeExtractedScriptText(text, { joinSoftBreaks: true });
  const matches = [...cleanText.matchAll(shotPattern)];

  if (matches.length > 1) {
    return matches.map((match, index) => {
      const start = (match.index ?? 0) + (match[1]?.length ?? 0);
      const end = matches[index + 1]?.index ?? cleanText.length;
      const chunk = cleanText.slice(start, end).trim();
      return makeShot(extractShotNumber(match[2]) ?? index + 1, chunk);
    });
  }

  const chunks = cleanText
    .split(/(?<=[。！？!?])\s+|\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  const grouped: string[] = [];
  for (let i = 0; i < chunks.length; i += 2) {
    grouped.push([chunks[i], chunks[i + 1]].filter(Boolean).join(" "));
  }

  return (grouped.length ? grouped : [cleanText]).map((chunk, index) =>
    makeShot(index + 1, chunk),
  );
}

function makeShot(index: number, text: string): StoryboardShot {
  const motions = [...new Set(text.match(motionPattern) ?? [])].slice(0, 3);
  return {
    id: crypto.randomUUID(),
    shotNumber: index,
    scriptText: text,
    shotSize: motions.join(" / "),
    reference: "",
    cameraMove: motions.join(" / "),
    copy: "",
    notes: "",
    imagePrompt: buildImagePrompt(text, motions.join(" / ")),
    referenceImages: [],
    imageUrl: "",
    canvasElements: [],
  };
}

function buildImagePrompt(text: string, cameraMove: string) {
  return buildPanelPrompt(text, cameraMove);
}

type PositionedText = {
  text: string;
  x: number;
  y: number;
};

type PositionedLine = {
  text: string;
  x: number;
  y: number;
  items: PositionedText[];
};

type PositionedPage = {
  pageNumber: number;
  width: number;
  height: number;
  items: PositionedText[];
};

type RenderedTable = {
  verticalLines: number[];
  horizontalLines: number[];
};

type TableFieldKey =
  | "shotNumber"
  | "scene"
  | "characters"
  | "shotSize"
  | "cameraMove"
  | "scriptText"
  | "reference"
  | "flowerText"
  | "notes"
  | "product";

const outputTableFields: Array<{ key: TableFieldKey; title: string }> = [
  { key: "shotNumber", title: "镜号" },
  { key: "scene", title: "场景" },
  { key: "characters", title: "人物" },
  { key: "shotSize", title: "景别" },
  { key: "cameraMove", title: "运镜" },
  { key: "scriptText", title: "画面内容描述" },
  { key: "reference", title: "画面参考" },
  { key: "flowerText", title: "花字" },
  { key: "notes", title: "备注" },
  { key: "product", title: "商品" },
];

const columnRatios = [
  { key: "shotNumber", min: 0.04, max: 0.115 },
  { key: "shotSize", min: 0.115, max: 0.185 },
  { key: "cameraMove", min: 0.185, max: 0.27 },
  { key: "scriptText", min: 0.27, max: 0.52 },
  { key: "reference", min: 0.52, max: 0.74 },
  { key: "notes", min: 0.74, max: 0.99 },
] as const;

type TableColumnKey = "shotNumber" | "shotSize" | "cameraMove" | "scriptText" | "reference" | "notes" | "other";

type TableColumn = {
  title: string;
  key: TableColumnKey;
  min: number;
  max: number;
};

async function detectRenderedTable(page: Awaited<ReturnType<Awaited<ReturnType<PdfjsModule["getDocument"]>["promise"]>["getPage"]>>) {
  const scale = 2;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;

  await page.render({ canvasContext: context, viewport }).promise;
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const verticalLines = detectDarkLines(image, "vertical", scale);
  const horizontalLines = detectDarkLines(image, "horizontal", scale);

  if (verticalLines.length < 2 || horizontalLines.length < 2) return null;
  return {
    verticalLines,
    horizontalLines,
  };
}

function detectDarkLines(image: ImageData, direction: "vertical" | "horizontal", scale: number) {
  const { data, width, height } = image;
  const length = direction === "vertical" ? width : height;
  const crossLength = direction === "vertical" ? height : width;
  const threshold = direction === "vertical" ? 0.16 : 0.22;
  const candidates: number[] = [];

  for (let index = 0; index < length; index += 1) {
    let dark = 0;
    for (let cross = 0; cross < crossLength; cross += 2) {
      const x = direction === "vertical" ? index : cross;
      const y = direction === "vertical" ? cross : index;
      const offset = (y * width + x) * 4;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      if (r < 150 && g < 150 && b < 150) dark += 1;
    }
    if (dark / (crossLength / 2) > threshold) candidates.push(index / scale);
  }

  return groupLineCandidates(candidates).filter((line, index, lines) => {
    if (index === 0) return true;
    return Math.abs(line - lines[index - 1]) > 6;
  });
}

function groupLineCandidates(candidates: number[]) {
  const groups: number[][] = [];
  for (const value of candidates) {
    const group = groups[groups.length - 1];
    if (group && value - group[group.length - 1] <= 2) group.push(value);
    else groups.push([value]);
  }
  return groups.map((group) => group.reduce((sum, value) => sum + value, 0) / group.length);
}

function extractRenderedTableRows({
  pageNumber,
  width,
  height,
  items,
  renderedTable,
  previousShots,
}: PositionedPage & { renderedTable: RenderedTable | null; previousShots: StoryboardShot[] }) {
  if (!renderedTable) {
    return extractVideoScriptTable([{ pageNumber, width, height, items }]);
  }

  const verticalLines = normalizeGridLines(renderedTable.verticalLines, width);
  const horizontalLines = normalizeGridLines(renderedTable.horizontalLines, height);
  if (verticalLines.length < 2 || horizontalLines.length < 2) return [];

  const rows = rowsFromGrid(items, verticalLines, horizontalLines);
  const headerIndex = rows.findIndex((row) => isTableHeader(row.join(" ")));
  const headerCells = headerIndex >= 0 ? rows[headerIndex] : [];
  const columnMap = mapGridColumns(headerCells, verticalLines.length - 1);
  const shots: StoryboardShot[] = [];
  let current = previousShots[previousShots.length - 1] ?? null;

  for (const row of rows.slice(headerIndex >= 0 ? headerIndex + 1 : 0)) {
    const fieldValues = fieldsFromGridRow(row, columnMap);
    const shotLabel = normalizeShotLabel(fieldValues.shotNumber);

    if (!shotLabel && current) {
      mergeContinuationRow(current, fieldValues);
      continue;
    }

    if (!shotLabel && !row.some(Boolean)) continue;
    if (!shotLabel) continue;

    const shotNumber = extractShotNumber(shotLabel) ?? shots.length + previousShots.length + 1;
    const shot = makeTableShot(shotNumber, shotLabel, fieldValues);
    shots.push(shot);
    current = shot;
  }

  return shots;
}

function normalizeGridLines(lines: number[], pageSize: number) {
  return lines
    .filter((line) => line >= 0 && line <= pageSize)
    .sort((a, b) => a - b)
    .filter((line, index, sorted) => index === 0 || line - sorted[index - 1] > 5);
}

function rowsFromGrid(items: PositionedText[], verticalLines: number[], horizontalLines: number[]) {
  const rows: string[][] = [];
  for (let rowIndex = 0; rowIndex < horizontalLines.length - 1; rowIndex += 1) {
    const top = horizontalLines[rowIndex];
    const bottom = horizontalLines[rowIndex + 1];
    const cells: string[] = [];
    for (let columnIndex = 0; columnIndex < verticalLines.length - 1; columnIndex += 1) {
      const left = verticalLines[columnIndex];
      const right = verticalLines[columnIndex + 1];
      cells.push(textInRect(items, left, right, top, bottom));
    }
    if (cells.some(Boolean)) rows.push(cells);
  }
  return rows;
}

function textInRect(items: PositionedText[], left: number, right: number, top: number, bottom: number) {
  return normalizeCellText(
    items
      .filter((item) => item.x >= left && item.x < right && item.y >= top && item.y < bottom)
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .map((item) => item.text)
      .join("\n"),
  );
}

function mapGridColumns(headerCells: string[], columnCount: number) {
  const map = new Map<TableFieldKey, number>();
  headerCells.forEach((cell, index) => {
    const key = classifyGridHeader(cell);
    if (key && !map.has(key)) map.set(key, index);
  });

  const fallbackOrder: TableFieldKey[] = [
    "shotNumber",
    "scene",
    "characters",
    "shotSize",
    "cameraMove",
    "scriptText",
    "reference",
    "flowerText",
    "notes",
    "product",
  ];
  fallbackOrder.slice(0, columnCount).forEach((key, index) => {
    if (!map.has(key)) map.set(key, index);
  });

  return map;
}

function classifyGridHeader(text: string): TableFieldKey | null {
  const normalized = normalizeCellText(text).replace(/\s/g, "");
  if (/镜号|镜头编号|分镜号|序号/.test(normalized)) return "shotNumber";
  if (/场景/.test(normalized)) return "scene";
  if (/人物|角色/.test(normalized)) return "characters";
  if (/景别/.test(normalized)) return "shotSize";
  if (/运镜|镜头运动|运动/.test(normalized)) return "cameraMove";
  if (/画面.*(内容|描述)|内容描述|画面内容|画面描述/.test(normalized)) return "scriptText";
  if (/画面.*参考|参考.*图片|参考图|图片/.test(normalized)) return "reference";
  if (/花字|字幕|屏幕字/.test(normalized)) return "flowerText";
  if (/备注|说明|声音|文案|VO|旁白/.test(normalized)) return "notes";
  if (/商品|产品|道具/.test(normalized)) return "product";
  return null;
}

function fieldsFromGridRow(row: string[], columnMap: Map<TableFieldKey, number>) {
  const values = Object.fromEntries(outputTableFields.map((field) => [field.key, ""])) as Record<TableFieldKey, string>;
  for (const field of outputTableFields) {
    const index = columnMap.get(field.key);
    values[field.key] = typeof index === "number" ? normalizeCellText(row[index] ?? "") : "";
  }
  return values;
}

function makeTableShot(shotNumber: number, shotLabel: string, values: Record<TableFieldKey, string>): StoryboardShot {
  const cells = outputTableFields.map((field) => (field.key === "shotNumber" ? shotLabel : values[field.key]));
  const promptText = [
    values.scene && `场景：${values.scene}`,
    values.characters && `人物：${values.characters}`,
    values.scriptText,
    values.reference && `画面参考：${values.reference}`,
    values.product && `商品：${values.product}`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    id: crypto.randomUUID(),
    shotNumber,
    shotLabel,
    scene: values.scene,
    characters: values.characters,
    shotSize: values.shotSize,
    cameraMove: values.cameraMove,
    scriptText: values.scriptText,
    reference: values.reference,
    copy: values.flowerText,
    notes: values.notes,
    flowerText: values.flowerText,
    product: values.product,
    imagePrompt: buildPanelPrompt(promptText || `Shot ${shotLabel}`, [values.shotSize, values.cameraMove].filter(Boolean).join(" / ")),
    referenceImages: [],
    imageUrl: "",
    canvasElements: [],
    sourceTable: {
      headers: outputTableFields.map((field) => field.title),
      cells,
      referenceColumnIndex: outputTableFields.findIndex((field) => field.key === "reference"),
    },
  };
}

function mergeContinuationRow(shot: StoryboardShot, values: Record<TableFieldKey, string>) {
  const append = (current: string | undefined, next: string) => [current, next].filter(Boolean).join("\n");
  shot.scene = append(shot.scene, values.scene);
  shot.characters = append(shot.characters, values.characters);
  shot.shotSize = append(shot.shotSize, values.shotSize);
  shot.cameraMove = append(shot.cameraMove, values.cameraMove);
  shot.scriptText = append(shot.scriptText, values.scriptText);
  shot.reference = append(shot.reference, values.reference);
  shot.copy = append(shot.copy, values.flowerText);
  shot.flowerText = append(shot.flowerText, values.flowerText);
  shot.notes = append(shot.notes, values.notes);
  shot.product = append(shot.product, values.product);
  if (shot.sourceTable) {
    shot.sourceTable.cells = outputTableFields.map((field) => {
      if (field.key === "shotNumber") return shot.shotLabel || String(shot.shotNumber);
      return String(shot[field.key] ?? "");
    });
  }
  shot.imagePrompt = buildPanelPrompt(
    [shot.scene, shot.characters, shot.scriptText, shot.reference, shot.product].filter(Boolean).join("\n") || `Shot ${shot.shotLabel ?? shot.shotNumber}`,
    [shot.shotSize, shot.cameraMove].filter(Boolean).join(" / "),
  );
}

function normalizeShotLabel(text: string) {
  const normalized = normalizeCellText(text).replace(/[^\dA-Za-z一二三四五六七八九十百]/g, "");
  if (/^\d+$/.test(normalized)) return normalized;
  const digitParts = normalizeCellText(text).match(/\d+/g);
  if (digitParts?.length) return digitParts.join("");
  return normalized;
}

function extractVideoScriptTable(pages: PositionedPage[]) {
  const shots: StoryboardShot[] = [];
  let previousColumns: TableColumn[] | null = null;

  for (const page of pages) {
    const lines = linesFromItems(page.items);
    const headerLine = lines.find((line) => isTableHeader(line.text));
    const columns: TableColumn[] = headerLine ? columnsForPage(page, headerLine) : previousColumns ?? columnsForPage(page);
    previousColumns = columns;
    const shotNumberColumn = columns.find((column) => column.key === "shotNumber") ?? columns[0];
    const referenceColumnIndex = Math.max(
      0,
      columns.findIndex((column) => column.key === "reference"),
    );
    const pageStartY = headerLine ? headerLine.y + 14 : 0;
    const shotLines = lines
      .filter((line) => line.y >= pageStartY)
      .flatMap((line) => {
        const numText = textInBand(line.items, shotNumberColumn.min, shotNumberColumn.max);
        const fallbackLeftText = textInBand(line.items, 0, columns[Math.min(1, columns.length - 1)].min);
        const shotNumber = extractShotNumber(numText) ?? extractShotNumber(fallbackLeftText);
        return shotNumber ? [{ ...line, shotNumber }] : [];
      })
      .sort((a, b) => a.y - b.y);

    for (let index = 0; index < shotLines.length; index += 1) {
      const shotLine = shotLines[index];
      const previousShotY = shotLines[index - 1]?.y;
      const nextShotY = shotLines[index + 1]?.y;
      const estimatedTop = previousShotY ? (previousShotY + shotLine.y) / 2 : pageStartY;
      const estimatedBottom = nextShotY ? (shotLine.y + nextShotY) / 2 : page.height;
      const rowLines = lines.filter((line) => line.y >= estimatedTop && line.y < estimatedBottom);
      const fields = fieldsFromRow(rowLines, columns);
      const shotLabel = fields.shotNumber || String(shotLine.shotNumber);
      const shotNumber = extractShotNumber(fields.shotNumber) ?? shotLine.shotNumber;
      if (!shotNumber || (!fields.scriptText && !fields.copy && !fields.notes)) continue;

      const cameraMove = fields.cameraMove || extractCameraMove(`${fields.shotSize}\n${fields.scriptText}`);
      const headers = columns.map((column) => column.title);
      const cells = columns.map((column) => fields.cells[column.title] ?? "");
      shots.push({
        id: crypto.randomUUID(),
        shotNumber,
        shotLabel,
        shotSize: fields.shotSize,
        scriptText: fields.scriptText,
        reference: fields.reference,
        copy: fields.copy,
        notes: fields.notes,
        cameraMove: cameraMove || fields.shotSize,
        imagePrompt: buildPanelPrompt(fields.scriptText || fields.copy || `Shot ${shotNumber}`, cameraMove || fields.shotSize),
        referenceImages: [],
        imageUrl: "",
        canvasElements: [],
        sourceTable: {
          headers,
          cells,
          referenceColumnIndex,
        },
      });
    }
  }

  return dedupeShots(shots).sort((a, b) => a.shotNumber - b.shotNumber);
}

function columnsForPage(page: PositionedPage, headerLine?: PositionedLine): TableColumn[] {
  const headerColumns = headerLine ? columnsFromHeaderLine(page, headerLine) : [];
  const knownColumnCount = headerColumns.filter((column) => column.key !== "other").length;
  if (headerColumns.length >= 4 && knownColumnCount >= 3 && headerColumns.some((column) => column.key === "shotNumber")) {
    return headerColumns;
  }

  return columnRatios.map((column) => ({
    title: defaultColumnTitle(column.key),
    key: column.key,
    min: page.width * column.min,
    max: page.width * column.max,
  }));
}

function isTableHeader(text: string) {
  const normalized = normalizeCellText(text).replace(/\s/g, "");
  return /镜号|镜头|分镜/.test(normalized) && /景别|运镜|画面|备注/.test(normalized);
}

function fieldsFromRow(lines: PositionedLine[], columns: TableColumn[]) {
  const fields = {
    shotNumber: "",
    shotSize: "",
    cameraMove: "",
    scriptText: "",
    reference: "",
    copy: "",
    notes: "",
    cells: {} as Record<string, string>,
  };

  for (const column of columns) {
    const values = lines
      .map((line) => textInBand(line.items, column.min, column.max))
      .filter(Boolean);
    const value = normalizeCellText(values.join("\n"));
    fields.cells[column.title] = value;
    if (column.key !== "other") {
      fields[column.key] = value;
    }
  }
  return fields;
}

function columnsFromHeaderLine(page: PositionedPage, headerLine: PositionedLine): TableColumn[] {
  const anchors = headerLine.items
    .map((item) => ({
      title: normalizeHeaderTitle(item.text),
      key: classifyHeader(item.text),
      x: item.x,
    }))
    .filter((item) => item.title && !/^[|｜]+$/.test(item.title))
    .sort((a, b) => a.x - b.x);

  const deduped = anchors.filter((item, index) => index === 0 || Math.abs(item.x - anchors[index - 1].x) > 8);
  if (deduped.length < 4) return [];

  return deduped.map((anchor, index) => {
    const previous = deduped[index - 1];
    const next = deduped[index + 1];
    return {
      title: anchor.title,
      key: anchor.key,
      min: previous ? (previous.x + anchor.x) / 2 : 0,
      max: next ? (anchor.x + next.x) / 2 : page.width,
    };
  });
}

function normalizeHeaderTitle(text: string) {
  return normalizeCellText(text).replace(/\n/g, "");
}

function classifyHeader(text: string): TableColumnKey {
  const normalized = normalizeHeaderTitle(text).replace(/\s/g, "");
  if (/镜号|镜头编号|分镜号|序号/.test(normalized)) return "shotNumber";
  if (/景别/.test(normalized)) return "shotSize";
  if (/运镜|镜头运动|运动/.test(normalized)) return "cameraMove";
  if (/画面.*(内容|描述)|内容描述|画面内容|画面描述/.test(normalized)) return "scriptText";
  if (/画面.*参考|参考.*图片|参考图|图片/.test(normalized)) return "reference";
  if (/备注|说明|声音|文案|VO|旁白/.test(normalized)) return "notes";
  return "other";
}

function defaultColumnTitle(key: TableColumnKey) {
  const titles: Record<TableColumnKey, string> = {
    shotNumber: "镜号",
    shotSize: "景别",
    cameraMove: "运镜",
    scriptText: "画面内容描述",
    reference: "画面参考图片",
    notes: "备注",
    other: "其他",
  };
  return titles[key];
}

function linesFromItems(items: PositionedText[]): PositionedLine[] {
  const groups: PositionedText[][] = [];
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);

  for (const item of sorted) {
    const group = groups.find((candidate) => Math.abs(candidate[0].y - item.y) < 4);
    if (group) group.push(item);
    else groups.push([item]);
  }

  return groups
    .map((group) => {
      const lineItems = [...group].sort((a, b) => a.x - b.x);
      return {
        text: normalizeCellText(lineItems.map((item) => item.text).join(" ")),
        x: Math.min(...lineItems.map((item) => item.x)),
        y: lineItems.reduce((sum, item) => sum + item.y, 0) / lineItems.length,
        items: lineItems,
      };
    })
    .filter((line) => line.text);
}

function textInBand(items: PositionedText[], min: number, max: number) {
  return normalizeCellText(
    items
      .filter((item) => item.x >= min && item.x < max)
      .sort((a, b) => a.x - b.x)
      .map((item) => item.text)
      .join(" "),
  );
}

function extractCameraMove(text: string) {
  return [...new Set(text.match(motionPattern) ?? [])].slice(0, 3).join(" / ");
}

function extractShotNumber(text: string) {
  const match = normalizeCellText(text).match(/(?:Shot|分镜|镜头)?\s*(\d{1,3})/i);
  if (!match) return null;
  const value = Number(match[1]);
  return value > 0 && value < 500 ? value : null;
}

export function dedupeShots(shots: StoryboardShot[]) {
  const byNumber = new Map<number, StoryboardShot>();

  for (const shot of shots) {
    const existing = byNumber.get(shot.shotNumber);
    if (!existing || shotContentScore(shot) > shotContentScore(existing)) {
      byNumber.set(shot.shotNumber, shot);
    }
  }

  return [...byNumber.values()];
}

export function mergeShotLists(primary: StoryboardShot[], fallback: StoryboardShot[]) {
  return dedupeShots([...primary, ...fallback])
    .sort((a, b) => a.shotNumber - b.shotNumber)
    .map((shot, index) => ({ ...shot, shotNumber: shot.shotNumber || index + 1 }));
}

function shotContentScore(shot: StoryboardShot) {
  return [shot.scriptText, shot.copy, shot.notes, shot.reference]
    .filter(Boolean)
    .join("\n")
    .length;
}
