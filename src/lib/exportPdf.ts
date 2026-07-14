import jsPDF from "jspdf";
import type { StoryboardShot } from "@/types/storyboard";
import { aspectRatioValue } from "./aspectRatio";

const fallbackColumns = [
  { key: "shotNumber", title: "镜号", width: 54 },
  { key: "shotSize", title: "景别", width: 70 },
  { key: "scriptText", title: "画面描述", width: 235 },
  { key: "imageUrl", title: "分镜图", width: 225 },
  { key: "copy", title: "文案/VO", width: 155 },
  { key: "notes", title: "备注", width: 150 },
] as const;

const pageWidth = 1190;
const pageHeight = 842;
const margin = 40;
const headerY = 92;
const headerHeight = 36;
const rowHeight = 144;

type ExportColumn = {
  key: string;
  title: string;
  width: number;
  sourceIndex?: number;
  isStoryboard?: boolean;
};

export async function exportStoryboardPdf(shots: StoryboardShot[], imageAspectRatio = "16:9") {
  const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const columns = buildExportColumns(shots);

  for (let pageStart = 0; pageStart < shots.length; pageStart += 4) {
    if (pageStart > 0) pdf.addPage();
    const pageImage = await renderPage(shots.slice(pageStart, pageStart + 4), pageStart, columns, imageAspectRatio);
    pdf.addImage(pageImage, "JPEG", 0, 0, pdf.internal.pageSize.getWidth(), pdf.internal.pageSize.getHeight());
  }

  pdf.save("storyboard-script-table.pdf");
}

async function renderPage(
  pageShots: StoryboardShot[],
  pageStart: number,
  columns: ExportColumn[],
  imageAspectRatio: string,
) {
  const canvas = document.createElement("canvas");
  canvas.width = pageWidth * 2;
  canvas.height = pageHeight * 2;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable");

  context.scale(2, 2);
  context.fillStyle = "#fbfaf7";
  context.fillRect(0, 0, pageWidth, pageHeight);

  drawPageTitle(context, pageStart);
  drawTableHeader(context, columns);

  for (let index = 0; index < pageShots.length; index += 1) {
    await drawShotRow(context, pageShots[index], headerY + headerHeight + index * rowHeight, columns, imageAspectRatio);
  }

  return canvas.toDataURL("image/jpeg", 0.92);
}

function drawPageTitle(context: CanvasRenderingContext2D, pageStart: number) {
  context.fillStyle = "#171717";
  context.font = font(22, 700);
  context.fillText("三、VO及脚本：", margin, 38);
  context.font = font(18, 700);
  context.fillText(`2. 视频脚本 / 分镜表  ${pageStart + 1}-${pageStart + 4}`, margin, 66);
}

function drawTableHeader(context: CanvasRenderingContext2D, columns: ExportColumn[]) {
  let currentX = tableStartX(columns);
  for (const column of columns) {
    drawCell(context, currentX, headerY, column.width, headerHeight, "#eeeeee");
    drawWrappedText(context, column.title, currentX + 8, headerY + 12, column.width - 16, headerHeight - 14, 14, 700);
    currentX += column.width;
  }
}

async function drawShotRow(
  context: CanvasRenderingContext2D,
  shot: StoryboardShot,
  y: number,
  columns: ExportColumn[],
  imageAspectRatio: string,
) {
  let currentX = tableStartX(columns);
  for (const column of columns) {
    drawCell(context, currentX, y, column.width, rowHeight, "#ffffff");

    if (column.isStoryboard || column.key === "imageUrl") {
      await drawStoryboardImage(
        context,
        shot.imageUrl,
        currentX + 8,
        y + 10,
        column.width - 16,
        rowHeight - 20,
        imageAspectRatio,
      );
    } else {
      drawWrappedText(context, cellText(shot, column), currentX + 8, y + 10, column.width - 16, rowHeight - 16);
    }

    currentX += column.width;
  }
}

function drawCell(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
) {
  context.fillStyle = fill;
  context.strokeStyle = "#525252";
  context.lineWidth = 1;
  context.fillRect(x, y, width, height);
  context.strokeRect(x, y, width, height);
}

function cellText(shot: StoryboardShot, column: ExportColumn) {
  if (typeof column.sourceIndex === "number") {
    return shot.sourceTable?.cells[column.sourceIndex] ?? "";
  }

  switch (column.key) {
    case "shotNumber":
      return shot.shotLabel || String(shot.shotNumber);
    case "shotSize":
      return shot.shotSize || shot.cameraMove || "";
    case "scriptText":
      return shot.scriptText;
    case "copy":
      return shot.copy;
    case "notes":
      return shot.notes;
    default:
      return "";
  }
}

function buildExportColumns(shots: StoryboardShot[]): ExportColumn[] {
  const sourceTable = shots.find((shot) => shot.sourceTable)?.sourceTable;
  if (!sourceTable) return scaleColumns(fallbackColumns.map((column) => ({ ...column })));

  const nonEmptyIndexes = sourceTable.headers
    .map((_, index) => index)
    .filter((index) => isUsefulSourceColumn(shots, index, sourceTable.referenceColumnIndex));
  const keptIndexes = nonEmptyIndexes.length ? nonEmptyIndexes : sourceTable.headers.map((_, index) => index);

  const inserted = keptIndexes.flatMap((index) => {
    const header = sourceTable.headers[index];
    const columns: ExportColumn[] = [
      {
        key: `source-${index}`,
        title: header || `列${index + 1}`,
        sourceIndex: index,
        width: 80,
      },
    ];

    if (index === sourceTable.referenceColumnIndex) {
      columns.push({
        key: "storyboardImage",
        title: "黑白分镜",
        width: 150,
        isStoryboard: true,
      });
    }

    return columns;
  });

  return scaleColumns(inserted.map((column) => ({ ...column, width: sourceColumnWeight(column) })));
}

function sourceColumnWeight(column: ExportColumn) {
  if (column.isStoryboard) return 2.3;
  const title = column.title.replace(/\s/g, "");
  if (/镜号|序号/.test(title)) return 0.55;
  if (/景别|运镜/.test(title)) return 0.72;
  if (/场景|人物|商品/.test(title)) return 0.9;
  if (/画面.*内容|内容描述|画面描述/.test(title)) return 2.5;
  if (/参考|图片/.test(title)) return 1.3;
  if (/花字|备注|说明|文案|VO|旁白/.test(title)) return 1.35;
  return 1.0;
}

function scaleColumns(columns: ExportColumn[]) {
  const availableWidth = pageWidth - margin * 2;
  const totalWeight = columns.reduce((sum, column) => sum + column.width, 0);
  const scaled = columns.map((column) => ({
    ...column,
    width: Math.max(minColumnWidth(column), (column.width / totalWeight) * availableWidth),
  }));
  const scaledWidth = scaled.reduce((sum, column) => sum + column.width, 0);
  if (scaledWidth <= availableWidth) return scaled;

  const shrinkable = scaled.filter((column) => !column.isStoryboard);
  const overage = scaledWidth - availableWidth;
  const shrinkWeight = shrinkable.reduce((sum, column) => sum + Math.max(0, column.width - minColumnWidth(column)), 0);
  if (!shrinkWeight) return scaled;

  return scaled.map((column) => {
    if (column.isStoryboard) return column;
    const capacity = Math.max(0, column.width - minColumnWidth(column));
    return {
      ...column,
      width: column.width - overage * (capacity / shrinkWeight),
    };
  });
}

function isUsefulSourceColumn(shots: StoryboardShot[], index: number, referenceColumnIndex: number) {
  if (index === referenceColumnIndex) return true;
  return shots.some((shot) => {
    const value = shot.sourceTable?.cells[index];
    return value && value.trim() && value.trim() !== "-";
  });
}

function minColumnWidth(column: ExportColumn) {
  if (column.isStoryboard) return 175;
  const title = column.title.replace(/\s/g, "");
  if (/镜号|序号/.test(title)) return 44;
  if (/景别|运镜/.test(title)) return 56;
  return 64;
}

function tableStartX(columns: ExportColumn[]) {
  const tableWidth = columns.reduce((sum, column) => sum + column.width, 0);
  return (pageWidth - tableWidth) / 2;
}

function drawWrappedText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  width: number,
  maxHeight: number,
  size = 13,
  weight: 400 | 700 = 400,
) {
  context.fillStyle = "#171717";
  context.font = font(size, weight);
  context.textBaseline = "top";

  const lines = wrapText(context, text || "-", width);
  const lineHeight = size + 5;
  const maxLines = Math.max(1, Math.floor(maxHeight / lineHeight));

  lines.slice(0, maxLines).forEach((line, index) => {
    const value = index === maxLines - 1 && lines.length > maxLines ? `${line.slice(0, -1)}...` : line;
    context.fillText(value, x, y + index * lineHeight);
  });
}

function wrapText(context: CanvasRenderingContext2D, text: string, width: number) {
  const lines: string[] = [];
  for (const paragraph of text.split(/\n+/)) {
    let line = "";
    for (const char of paragraph) {
      const next = `${line}${char}`;
      if (line && context.measureText(next).width > width) {
        lines.push(line);
        line = char;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : ["-"];
}

async function drawStoryboardImage(
  context: CanvasRenderingContext2D,
  imageUrl: string,
  x: number,
  y: number,
  width: number,
  height: number,
  imageAspectRatio: string,
) {
  const frame = containedFrame(x, y, width, height, aspectRatioValue(imageAspectRatio));
  context.strokeStyle = "#171717";
  context.strokeRect(frame.x, frame.y, frame.width, frame.height);

  if (!imageUrl) {
    context.fillStyle = "#777777";
    context.font = font(13, 400);
    context.fillText("未放入图片", frame.x + frame.width / 2 - 34, frame.y + frame.height / 2 - 8);
    return;
  }

  try {
    const image = await loadImage(imageUrl);
    drawContainedImage(context, image, frame.x, frame.y, frame.width, frame.height);
  } catch {
    context.fillStyle = "#777777";
    context.font = font(13, 400);
    context.fillText("图片无法嵌入", frame.x + 12, frame.y + 18);
  }
}

function containedFrame(x: number, y: number, width: number, height: number, ratio: number) {
  let frameWidth = width;
  let frameHeight = width / ratio;
  if (frameHeight > height) {
    frameHeight = height;
    frameWidth = height * ratio;
  }
  return {
    x: x + (width - frameWidth) / 2,
    y: y + (height - frameHeight) / 2,
    width: frameWidth,
    height: frameHeight,
  };
}

function drawContainedImage(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const imageRatio = image.naturalWidth / image.naturalHeight || 16 / 9;
  const frameRatio = width / height;
  let drawWidth = width;
  let drawHeight = height;

  if (imageRatio > frameRatio) {
    drawHeight = width / imageRatio;
  } else {
    drawWidth = height * imageRatio;
  }

  context.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Image failed to load"));
    image.src = src;
  });
}

function font(size: number, weight: 400 | 700) {
  return `${weight} ${size}px "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", Arial, sans-serif`;
}
