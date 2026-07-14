import { randomUUID } from "node:crypto";
import { buildPanelPrompt } from "@/lib/panelPrompt";
import { normalizeCellText } from "@/lib/textClean";
import type { StoryboardShot } from "@/types/storyboard";

export type FeishuStoryboardField =
  | "shotNumber"
  | "scene"
  | "characters"
  | "product"
  | "shotSize"
  | "scriptText"
  | "dialogue"
  | "cameraMove"
  | "notes";

export type FeishuTableCandidate = {
  tableBlockId: string;
  title: string;
  rowCount: number;
  columnCount: number;
  headers: string[];
  previewRows: string[][];
  rows: string[][];
  autoMapping: Partial<Record<FeishuStoryboardField, number>>;
  missingRecommendedFields: FeishuStoryboardField[];
};

export type FeishuProjectState = {
  id: string;
  name: string;
  shots: Array<StoryboardShot & {
    originalIndex: number;
    currentIndex: number;
    originalShotNo: string;
    currentShotNo: string;
    propsText: string;
    dialogue: string;
    status: string;
    isLocked: boolean;
    imageLocked: boolean;
  }>;
  assets: Array<{
    id: string;
    type: "scene" | "character" | "prop";
    name: string;
    coreRequirements: string;
    templatePrompt?: string;
    aiPrompt?: string;
    activePromptMode?: "template" | "ai";
    imagePrompt?: string;
    isLocked: boolean;
  }>;
  characterRoles: Array<{ id: string; name: string; aliases: string[] }>;
  activeShotId: string | null;
  selectedShotIds: string[];
  viewMode: "original" | "current" | "scene";
  assetTab: "scene" | "character" | "prop";
  storyboardRatio: string;
  selectedImageShotId: string | null;
  editorState: {
    scrollTop: number;
    currentStep: string;
  };
  source?: {
    type: "feishu_doc_table";
    documentToken: string;
    tableBlockId: string;
    fieldMapping: Partial<Record<FeishuStoryboardField, number>>;
  };
  createdAt: string;
  updatedAt: string;
  version: number;
};

const fieldLabels: Record<FeishuStoryboardField, string> = {
  shotNumber: "镜号",
  scene: "场景",
  characters: "人物",
  product: "核心道具",
  shotSize: "景别",
  scriptText: "画面内容",
  dialogue: "台词 / 旁白 / 同期声",
  cameraMove: "镜头运动",
  notes: "备注",
};

export function mapFeishuHeaders(headers: string[]) {
  const mapping: Partial<Record<FeishuStoryboardField, number>> = {};
  headers.forEach((header, index) => {
    const field = classifyFeishuHeader(header);
    if (field && mapping[field] === undefined) mapping[field] = index;
  });
  return mapping;
}

export function classifyFeishuHeader(text: string): FeishuStoryboardField | null {
  const normalized = normalizeCellText(text).replace(/\s/g, "");
  if (!normalized) return null;
  if (/^(镜号|镜头|镜头号|分镜号|Shot|序号)$/i.test(normalized) || /镜号|镜头编号|分镜号|序号/i.test(normalized)) return "shotNumber";
  if (/场景|地点|环境/.test(normalized)) return "scene";
  if (/人物|角色|出镜人物/.test(normalized)) return "characters";
  if (/核心道具|道具|产品|商品/.test(normalized)) return "product";
  if (/景别|镜头景别/.test(normalized)) return "shotSize";
  if (/画面内容|动作|镜头内容|描述|画面描述/.test(normalized)) return "scriptText";
  if (/台词|对白|旁白|口播|同期声|声音|VO/i.test(normalized)) return "dialogue";
  if (/镜头运动|运镜|运动方式|推拉摇移/.test(normalized)) return "cameraMove";
  if (/备注|参考|编号|说明|补充/.test(normalized)) return "notes";
  return null;
}

export function buildFeishuTableCandidate(tableBlockId: string, rows: string[][], title?: string): FeishuTableCandidate | null {
  const normalizedRows = rows
    .map((row) => row.map((cell) => normalizeCellText(cell)))
    .filter((row) => row.some(Boolean));
  if (normalizedRows.length < 2) return null;
  const headers = normalizedRows[0].map((header, index) => header || `列${index + 1}`);
  const dataRows = normalizedRows.slice(1);
  const autoMapping = mapFeishuHeaders(headers);
  return {
    tableBlockId,
    title: title || `表格 ${tableBlockId}`,
    rowCount: dataRows.length,
    columnCount: headers.length,
    headers,
    previewRows: dataRows.slice(0, 5),
    rows: dataRows,
    autoMapping,
    missingRecommendedFields: recommendedMissingFields(autoMapping),
  };
}

export function rowsToFeishuStoryboardShots(
  rows: string[][],
  headers: string[],
  mapping: Partial<Record<FeishuStoryboardField, number>>,
) {
  const shots: StoryboardShot[] = [];
  rows.forEach((row, index) => {
    const value = (field: FeishuStoryboardField) => {
      const columnIndex = mapping[field];
      return typeof columnIndex === "number" ? normalizeCellText(row[columnIndex] ?? "") : "";
    };
    const shotLabel = value("shotNumber") || String(index + 1);
    const product = value("product") || inferCoreProps([value("scriptText"), value("notes")].join("\n"));
    const promptText = [
      value("scene") && `场景：${value("scene")}`,
      value("characters") && `人物：${value("characters")}`,
      value("scriptText"),
      product && `核心道具：${product}`,
    ]
      .filter(Boolean)
      .join("\n");

    shots.push({
      id: randomUUID(),
      shotNumber: Number(shotLabel.match(/\d+/)?.[0] ?? index + 1),
      shotLabel,
      scene: value("scene") || inferSceneName([value("scriptText"), product, value("notes")].join("\n")),
      characters: value("characters"),
      shotSize: value("shotSize"),
      cameraMove: value("cameraMove"),
      scriptText: value("scriptText"),
      reference: "",
      copy: value("dialogue"),
      notes: value("notes"),
      flowerText: "",
      product,
      imagePrompt: buildPanelPrompt(promptText || `Shot ${shotLabel}`, [value("shotSize"), value("cameraMove")].filter(Boolean).join(" / ")),
      referenceImages: [],
      imageUrl: "",
      canvasElements: [],
      sourceTable: {
        headers,
        cells: headers.map((_, columnIndex) => normalizeCellText(row[columnIndex] ?? "")),
        referenceColumnIndex: Math.max(0, mapping.scriptText ?? 0),
      },
    });
  });
  return shots;
}

export function createFeishuProjectState(input: {
  id: string;
  name: string;
  documentToken: string;
  tableBlockId: string;
  headers: string[];
  rows: string[][];
  fieldMapping: Partial<Record<FeishuStoryboardField, number>>;
}) {
  const now = new Date().toISOString();
  const baseShots = rowsToFeishuStoryboardShots(input.rows, input.headers, input.fieldMapping);
  const shots = baseShots.map((shot, index) => ({
    ...shot,
    originalIndex: index + 1,
    currentIndex: index + 1,
    originalShotNo: shot.shotLabel || String(index + 1),
    currentShotNo: shot.shotLabel || String(index + 1),
    propsText: shot.product || "",
    dialogue: shot.copy || "",
    status: "draft",
    isLocked: false,
    imageLocked: false,
  }));
  return {
    id: input.id,
    name: input.name || "飞书脚本分镜项目",
    shots,
    assets: deriveInitialAssets(shots),
    characterRoles: deriveCharacterRoles(shots),
    activeShotId: shots[0]?.id || null,
    selectedShotIds: [],
    viewMode: "original",
    assetTab: "scene",
    storyboardRatio: "16:9",
    selectedImageShotId: null,
    editorState: {
      scrollTop: 0,
      currentStep: shots.length ? "editing" : "empty",
    },
    source: {
      type: "feishu_doc_table",
      documentToken: input.documentToken,
      tableBlockId: input.tableBlockId,
      fieldMapping: input.fieldMapping,
    },
    createdAt: now,
    updatedAt: now,
    version: 1,
  } satisfies FeishuProjectState;
}

export function extractFeishuTableCandidates(blocks: unknown[]) {
  const tables: FeishuTableCandidate[] = [];
  const visit = (node: unknown, indexPath: string) => {
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    const blockId = String(record.block_id || record.blockId || record.id || indexPath);
    const rows = rowsFromAnyTableShape(record);
    if (rows.length) {
      const candidate = buildFeishuTableCandidate(blockId, rows, tableTitle(record, tables.length + 1));
      if (candidate) tables.push(candidate);
    }
    for (const key of ["children", "blocks", "items", "content"]) {
      const children = record[key];
      if (Array.isArray(children)) children.forEach((child, childIndex) => visit(child, `${indexPath}-${key}-${childIndex}`));
    }
  };
  blocks.forEach((block, index) => visit(block, String(index + 1)));
  return dedupeTables(tables);
}

function rowsFromAnyTableShape(record: Record<string, unknown>) {
  const table = objectValue(record.table) || objectValue(record.table_block) || objectValue(record.tableBlock) || record;
  const directRows = arrayValue(table.rows) || arrayValue(table.table_rows);
  if (directRows?.length) return directRows.map((row) => arrayValue(row)?.map(cellText) || arrayValue(objectValue(row)?.cells)?.map(cellText) || []);
  const cells = arrayValue(table.cells) || arrayValue(table.table_cells);
  if (cells?.length) {
    const rowCount = Number(table.row_size || table.rowCount || table.rows_count || 0);
    const columnCount = Number(table.column_size || table.columnCount || table.columns_count || 0);
    return cellsToRows(cells, rowCount, columnCount);
  }
  return [];
}

function cellsToRows(cells: unknown[], rowCount: number, columnCount: number) {
  const width = columnCount || Math.max(1, Math.ceil(Math.sqrt(cells.length)));
  const height = rowCount || Math.ceil(cells.length / width);
  const rows = Array.from({ length: height }, () => Array.from({ length: width }, () => ""));
  cells.forEach((cell, index) => {
    const record = objectValue(cell) || {};
    const rowIndex = Number(record.row_index ?? record.rowIndex ?? Math.floor(index / width));
    const columnIndex = Number(record.column_index ?? record.columnIndex ?? index % width);
    if (rows[rowIndex] && columnIndex < rows[rowIndex].length) rows[rowIndex][columnIndex] = cellText(cell);
  });
  return rows;
}

function cellText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return normalizeCellText(String(value));
  if (Array.isArray(value)) return normalizeCellText(value.map(cellText).filter(Boolean).join(" "));
  if (typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  for (const key of ["text", "plain_text", "plainText", "content", "value"]) {
    const next = record[key];
    if (typeof next === "string" || typeof next === "number") return normalizeCellText(String(next));
  }
  return normalizeCellText(Object.values(record).map(cellText).filter(Boolean).join(" "));
}

function tableTitle(record: Record<string, unknown>, index: number) {
  return normalizeCellText(String(record.title || record.name || `表格 ${index}`));
}

function dedupeTables(tables: FeishuTableCandidate[]) {
  const seen = new Set<string>();
  return tables.filter((table) => {
    const key = `${table.tableBlockId}:${table.rowCount}:${table.columnCount}:${table.headers.join("|")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function recommendedMissingFields(mapping: Partial<Record<FeishuStoryboardField, number>>) {
  return (["shotNumber", "scriptText"] as FeishuStoryboardField[]).filter((field) => mapping[field] === undefined);
}

function deriveInitialAssets(shots: Array<StoryboardShot & { propsText?: string }>) {
  const make = (type: "scene" | "character" | "prop", name: string) => ({
    id: randomUUID(),
    type,
    name,
    coreRequirements: "",
    templatePrompt: "",
    aiPrompt: "",
    activePromptMode: "template" as const,
    imagePrompt: "",
    isLocked: false,
  });
  return [
    ...uniqueList(shots.map((shot) => shot.scene || "").filter(Boolean)).map((name) => make("scene", name)),
    ...uniqueList(shots.flatMap((shot) => splitNames(shot.characters || ""))).map((name) => make("character", name)),
    ...uniqueList(shots.flatMap((shot) => splitNames(shot.product || shot.propsText || ""))).map((name) => make("prop", name)),
  ];
}

function deriveCharacterRoles(shots: Array<StoryboardShot>) {
  return uniqueList(shots.flatMap((shot) => splitNames(shot.characters || ""))).map((name) => ({
    id: randomUUID(),
    name,
    aliases: [],
  }));
}

function splitNames(value: string) {
  return value.split(/[、，,\/；;\n]+|和|及|与/g).map((item) => normalizeCellText(item)).filter(Boolean);
}

function uniqueList(items: string[]) {
  return Array.from(new Set(items.map((item) => normalizeCellText(item)).filter(Boolean)));
}

function objectValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : null;
}

function inferSceneName(text: string) {
  const normalized = normalizeCellText(text);
  if (/母婴店|门店|店内|货架|展示台|陈列|收银|咨询台/.test(normalized)) return "母婴门店";
  if (/客厅|沙发|茶几|地毯/.test(normalized)) return "家庭客厅";
  if (/餐厅|餐桌|餐椅|辅食/.test(normalized)) return "家庭餐厅";
  if (/卧室|婴儿床|床头|睡眠|哄睡/.test(normalized)) return "家庭卧室";
  if (/厨房|冲奶|奶瓶|水壶|橱柜/.test(normalized)) return "家庭厨房";
  if (/浴室|洗澡|浴盆|毛巾/.test(normalized)) return "家庭浴室";
  if (/家居|家庭|居家/.test(normalized)) return "家庭居家空间";
  return "";
}

function inferCoreProps(text: string) {
  const normalized = normalizeCellText(text);
  const props = normalized.match(/尿布台|护理台|抚触台|纸尿裤|尿不湿|奶瓶|水杯|水壶|婴儿床|床|沙发|茶几|地毯|餐桌|餐椅|儿童餐椅|辅食椅|碗|勺|浴盆|澡盆|毛巾|洗护用品|货架|展示台|咨询台|收银台|柜台|小象|大软包|软包|玩具|收纳篮|湿巾|推车|安全座椅|抱枕|窗帘|夜灯|绘本|奶粉罐|橱柜|厨房台面/g) || [];
  return Array.from(new Set(props)).join("、");
}

export { fieldLabels as feishuFieldLabels };
