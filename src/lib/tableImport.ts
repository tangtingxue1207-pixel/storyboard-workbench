import { buildPanelPrompt } from "@/lib/panelPrompt";
import { normalizeCellText } from "@/lib/textClean";
import type { StoryboardShot } from "@/types/storyboard";

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

const outputFields: Array<{ key: TableFieldKey; title: string }> = [
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

export function canParseTableFile(file: File) {
  return /\.(csv|xlsx)$/i.test(file.name);
}

export async function extractTableFile(file: File) {
  const rows = /\.csv$/i.test(file.name)
    ? parseCsv(await file.text())
    : await parseXlsx(await file.arrayBuffer());
  const shots = rowsToShots(rows);

  return {
    text: rows.map((row) => row.join("\t")).join("\n"),
    shots,
  };
}

function rowsToShots(rows: string[][]) {
  const headerIndex = rows.findIndex((row) => row.some((cell) => classifyHeader(cell) === "shotNumber"));
  const headers = (headerIndex >= 0 ? rows[headerIndex] : outputFields.map((field) => field.title)).map((cell, index) =>
    normalizeCellText(cell) || `列${index + 1}`,
  );
  const dataRows = rows.slice(headerIndex >= 0 ? headerIndex + 1 : 0);
  const columnMap = mapColumns(headers);
  const referenceColumnIndex = Math.max(
    0,
    headers.findIndex((header) => classifyHeader(header) === "reference"),
  );
  const shots: StoryboardShot[] = [];
  let current: StoryboardShot | null = null;

  for (const row of dataRows) {
    const normalizedRow = headers.map((_, index) => normalizeCellText(row[index] ?? ""));
    if (!normalizedRow.some(Boolean)) continue;

    const values = valuesFromRow(normalizedRow, columnMap);
    const shotLabel = normalizeShotLabel(values.shotNumber);

    if (!shotLabel && current) {
      mergeContinuationRow(current, values, headers, normalizedRow);
      continue;
    }

    if (!shotLabel) continue;

    const shotNumber = Number(shotLabel.match(/\d+/)?.[0] ?? shots.length + 1);
    current = makeShot(shotNumber, shotLabel, values, headers, normalizedRow, referenceColumnIndex);
    shots.push(current);
  }

  return shots;
}

function mapColumns(headers: string[]) {
  const map = new Map<TableFieldKey, number>();
  headers.forEach((header, index) => {
    const key = classifyHeader(header);
    if (key && !map.has(key)) map.set(key, index);
  });

  if (!map.size) {
    outputFields.slice(0, headers.length).forEach((field, index) => {
      if (!map.has(field.key)) map.set(field.key, index);
    });
  }

  return map;
}

function valuesFromRow(row: string[], columnMap: Map<TableFieldKey, number>) {
  const values = Object.fromEntries(outputFields.map((field) => [field.key, ""])) as Record<TableFieldKey, string>;
  for (const field of outputFields) {
    const index = columnMap.get(field.key);
    values[field.key] = typeof index === "number" ? row[index] ?? "" : "";
  }
  return values;
}

function makeShot(
  shotNumber: number,
  shotLabel: string,
  values: Record<TableFieldKey, string>,
  headers: string[],
  cells: string[],
  referenceColumnIndex: number,
): StoryboardShot {
  const inferredProduct = values.product || inferCoreProps([values.reference, values.scriptText, values.notes].filter(Boolean).join("\n"));
  const promptText = [
    sceneName(values) && `场景：${sceneName(values)}`,
    values.characters && `人物：${values.characters}`,
    values.scriptText,
    values.reference && `画面参考：${values.reference}`,
    inferredProduct && `核心道具：${inferredProduct}`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    id: crypto.randomUUID(),
    shotNumber,
    shotLabel,
    scene: sceneName(values),
    characters: values.characters,
    shotSize: values.shotSize,
    cameraMove: values.cameraMove,
    scriptText: values.scriptText,
    reference: values.reference,
    copy: values.flowerText,
    notes: values.notes,
    flowerText: values.flowerText,
    product: inferredProduct,
    imagePrompt: buildPanelPrompt(promptText || `Shot ${shotLabel}`, [values.shotSize, values.cameraMove].filter(Boolean).join(" / ")),
    referenceImages: [],
    imageUrl: "",
    canvasElements: [],
    sourceTable: {
      headers,
      cells,
      referenceColumnIndex,
    },
  };
}

function sceneName(values: Record<TableFieldKey, string>) {
  return values.scene || inferSceneName([values.scriptText, values.reference, values.notes, values.product].filter(Boolean).join("\n"));
}

function mergeContinuationRow(
  shot: StoryboardShot,
  values: Record<TableFieldKey, string>,
  headers: string[],
  row: string[],
) {
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
  shot.product = append(shot.product, values.product || inferCoreProps([values.reference, values.scriptText, values.notes].filter(Boolean).join("\n")));

  if (shot.sourceTable) {
    shot.sourceTable.cells = headers.map((_, index) => append(shot.sourceTable?.cells[index], row[index] ?? ""));
  }
}

function classifyHeader(text: string): TableFieldKey | null {
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

function inferSceneName(text: string) {
  const normalized = normalizeCellText(text);
  if (!normalized) return "";
  if (/母婴店|门店|店内|货架|导购|展示台|陈列|收银/.test(normalized)) return "母婴门店";
  if (/淡蓝色.*家居空间|家居空间.*淡蓝色|空背家居空间/.test(normalized)) return "淡蓝色家居空间";
  if (/大软包|软包/.test(normalized)) return "家居软包互动区";
  if (/客厅|沙发|茶几|地毯|电视柜/.test(normalized)) return "家庭客厅";
  if (/餐厅|餐桌|餐椅|儿童餐椅|辅食椅|用餐|辅食/.test(normalized)) return "家庭餐厅";
  if (/卧室|婴儿床|床头|哄睡|睡眠/.test(normalized)) return "家庭卧室";
  if (/厨房|冲奶|奶瓶|水壶|厨房台面|橱柜/.test(normalized)) return "家庭厨房";
  if (/浴室|洗澡|沐浴|浴盆|澡盆|洗护|毛巾/.test(normalized)) return "家庭浴室";
  if (/家居|家庭|家中|居家/.test(normalized)) return "家庭居家空间";
  return "";
}

function inferCoreProps(text: string) {
  const normalized = normalizeCellText(text);
  if (!normalized) return "";
  const props = normalized.match(/尿布台|护理台|抚触台|纸尿裤|尿不湿|奶瓶|水杯|水壶|婴儿床|床|沙发|茶几|地毯|餐桌|餐椅|儿童餐椅|辅食椅|碗|勺|浴盆|澡盆|毛巾|洗护用品|货架|展示台|咨询台|收银台|柜台|小象|大软包|软包|玩具|收纳篮|湿巾|推车|安全座椅|抱枕|窗帘|夜灯|绘本|奶粉罐|橱柜|厨房台面/g) || [];
  return Array.from(new Set(props)).join("、");
}

function normalizeShotLabel(text: string) {
  const digitParts = normalizeCellText(text).match(/\d+/g);
  if (digitParts?.length) return digitParts.join("");
  return normalizeCellText(text).replace(/\s/g, "");
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (quoted && char === "\"" && next === "\"") {
      cell += "\"";
      index += 1;
    } else if (char === "\"") {
      quoted = !quoted;
    } else if (!quoted && char === ",") {
      row.push(cell);
      cell = "";
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell);
  rows.push(row);
  return rows;
}

async function parseXlsx(buffer: ArrayBuffer) {
  const entries = await unzip(buffer);
  const sharedStrings = parseSharedStrings(entries.get("xl/sharedStrings.xml") ?? "");
  const sheetPath = firstSheetPath(entries);
  if (!sheetPath) return [];
  return parseSheetXml(entries.get(sheetPath) ?? "", sharedStrings);
}

async function unzip(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const entries = new Map<string, string>();
  let offset = 0;

  while (offset + 30 < bytes.length && readUint32(bytes, offset) === 0x04034b50) {
    const method = readUint16(bytes, offset + 8);
    const compressedSize = readUint32(bytes, offset + 18);
    const uncompressedSize = readUint32(bytes, offset + 22);
    const nameLength = readUint16(bytes, offset + 26);
    const extraLength = readUint16(bytes, offset + 28);
    const name = new TextDecoder().decode(bytes.slice(offset + 30, offset + 30 + nameLength));
    const dataStart = offset + 30 + nameLength + extraLength;
    const data = bytes.slice(dataStart, dataStart + compressedSize);

    if (method === 0) {
      entries.set(name, new TextDecoder().decode(data));
    } else if (method === 8 && uncompressedSize > 0) {
      entries.set(name, await inflateRaw(data));
    }

    offset = dataStart + compressedSize;
  }

  return entries;
}

async function inflateRaw(data: Uint8Array) {
  if ("DecompressionStream" in globalThis) {
    const chunk = new Uint8Array(data).buffer;
    const stream = new Blob([chunk]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    const inflated = await new Response(stream).arrayBuffer();
    return new TextDecoder().decode(inflated);
  }

  const { decompressSync } = await import("fflate");
  return new TextDecoder().decode(decompressSync(data));
}

function firstSheetPath(entries: Map<string, string>) {
  if (entries.has("xl/worksheets/sheet1.xml")) return "xl/worksheets/sheet1.xml";
  return [...entries.keys()].find((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)) ?? null;
}

function parseSharedStrings(xml: string) {
  if (!xml) return [];
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return Array.from(doc.querySelectorAll("si")).map((si) =>
    Array.from(si.querySelectorAll("t"))
      .map((node) => node.textContent ?? "")
      .join(""),
  );
}

function parseSheetXml(xml: string, sharedStrings: string[]) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const rows: string[][] = [];

  for (const rowNode of Array.from(doc.querySelectorAll("sheetData row"))) {
    const row: string[] = [];
    for (const cellNode of Array.from(rowNode.querySelectorAll("c"))) {
      const ref = cellNode.getAttribute("r") ?? "";
      const columnIndex = columnIndexFromRef(ref);
      const type = cellNode.getAttribute("t");
      const raw = cellNode.querySelector("v")?.textContent ?? cellNode.querySelector("is t")?.textContent ?? "";
      const value = type === "s" ? sharedStrings[Number(raw)] ?? "" : raw;
      row[columnIndex] = value;
    }
    rows.push(row.map((cell) => cell ?? ""));
  }

  return rows;
}

function columnIndexFromRef(ref: string) {
  const letters = ref.match(/[A-Z]+/i)?.[0]?.toUpperCase() ?? "A";
  let index = 0;
  for (const letter of letters) {
    index = index * 26 + letter.charCodeAt(0) - 64;
  }
  return index - 1;
}

function readUint16(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24);
}
