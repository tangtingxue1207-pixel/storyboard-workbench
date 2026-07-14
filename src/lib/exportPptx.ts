import type { StoryboardShot } from "@/types/storyboard";
import { aspectRatioValue } from "./aspectRatio";

const emu = 914400;
const slideW = 13.333333;
const slideH = 7.5;
const teal = "00A7A8";
const green = "00E51B";

type PptImage = {
  id: string;
  ext: string;
  data: Uint8Array;
  width: number;
  height: number;
};

type ZipEntry = {
  path: string;
  data: Uint8Array;
};

export async function exportStoryboardPptx(shots: StoryboardShot[], imageAspectRatio = "16:9") {
  const slideGroups = chunk(shots, 8);
  const slideImages = await Promise.all(slideGroups.map((group) => Promise.all(group.map(readShotImage))));
  const entries = buildPptxEntries(slideGroups, slideImages, imageAspectRatio);
  const blob = new Blob([zipStore(entries)], {
    type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  });
  downloadBlob(blob, "storyboard_export.pptx");
}

function buildPptxEntries(
  slideGroups: StoryboardShot[][],
  slideImages: Array<Array<PptImage | null>>,
  imageAspectRatio: string,
) {
  const entries: ZipEntry[] = [
    xmlEntry("[Content_Types].xml", contentTypes(slideGroups.length, slideImages.flat().filter(Boolean) as PptImage[])),
    xmlEntry("_rels/.rels", rootRels()),
    xmlEntry("docProps/core.xml", coreProps()),
    xmlEntry("docProps/app.xml", appProps(slideGroups.length)),
    xmlEntry("ppt/presentation.xml", presentationXml(slideGroups.length)),
    xmlEntry("ppt/_rels/presentation.xml.rels", presentationRels(slideGroups.length)),
    xmlEntry("ppt/slideMasters/slideMaster1.xml", slideMasterXml()),
    xmlEntry("ppt/slideMasters/_rels/slideMaster1.xml.rels", slideMasterRels()),
    xmlEntry("ppt/slideLayouts/slideLayout1.xml", slideLayoutXml()),
    xmlEntry("ppt/slideLayouts/_rels/slideLayout1.xml.rels", slideLayoutRels()),
    xmlEntry("ppt/theme/theme1.xml", themeXml()),
  ];

  slideGroups.forEach((group, slideIndex) => {
    const images = slideImages[slideIndex];
    entries.push(xmlEntry(`ppt/slides/slide${slideIndex + 1}.xml`, slideXml(group, images, slideIndex, imageAspectRatio)));
    entries.push(xmlEntry(`ppt/slides/_rels/slide${slideIndex + 1}.xml.rels`, slideRels(images)));
    images.forEach((image, imageIndex) => {
      if (image) entries.push({ path: `ppt/media/${image.id}.${image.ext}`, data: image.data });
    });
  });

  return entries;
}

function slideXml(
  shots: StoryboardShot[],
  images: Array<PptImage | null>,
  slideIndex: number,
  imageAspectRatio: string,
) {
  let shapeId = 2;
  const body = [
    rect(shapeId++, 0, 0, slideW, slideH, "000000", "000000"),
  ];

  shots.forEach((shot, index) => {
    body.push(...shotGroupXml(shot, images[index], index, shapeId, slideIndex, imageAspectRatio));
    shapeId += 8;
  });

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    ${body.join("\n")}
  </p:spTree></p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
}

function shotGroupXml(
  shot: StoryboardShot,
  image: PptImage | null,
  index: number,
  startId: number,
  slideIndex: number,
  imageAspectRatio: string,
) {
  const col = index % 4;
  const row = Math.floor(index / 4);
  const left = 0.24 + col * 3.24;
  const top = row === 0 ? 0.34 : 4.08;
  const slotW = 2.78;
  const maxImageH = 1.55;
  const ratio = aspectRatioValue(imageAspectRatio);
  const frame = fitFrame(left, top, slotW, maxImageH, ratio);
  const textTop = top + maxImageH + 0.18;
  const label = `Shot ${shot.shotLabel || shot.shotNumber}`;
  const description = shotDescription(shot);
  const relId = `rId${index + 2}`;
  const imageXml = image
    ? [
        rect(startId, frame.x, frame.y, frame.w, frame.h, "FFFFFF", teal, 1.2),
        picture(startId + 4, relId, frame.x, frame.y, frame.w, frame.h, image, `shot-${slideIndex + 1}-${index + 1}`),
      ].join("\n")
    : rect(startId, frame.x, frame.y, frame.w, frame.h, "FFFFFF", teal, 1.2);

  return [
    imageXml,
    rect(startId + 1, frame.x, frame.y, 0.86, 0.24, teal, teal),
    textBox(startId + 2, label, frame.x + 0.04, frame.y + 0.03, 0.78, 0.16, {
      color: "FFFFFF",
      size: 10,
      bold: false,
      align: "l",
    }),
    textBox(startId + 3, description, left + 0.1, textTop, slotW - 0.2, 1.25, {
      color: "FFFFFF",
      size: textSizeFor(description),
      bold: true,
      align: "l",
    }),
  ];
}

function fitFrame(x: number, y: number, maxW: number, maxH: number, ratio: number) {
  let w = maxW;
  let h = w / ratio;
  if (h > maxH) {
    h = maxH;
    w = h * ratio;
  }
  return {
    x: x + (maxW - w) / 2,
    y: y + (maxH - h) / 2,
    w,
    h,
  };
}

function shotDescription(shot: StoryboardShot) {
  const lines = [
    compactLine([shot.shotSize, shot.cameraMove].filter(Boolean).join(" / "), 24),
    compactLine(shot.scriptText || shot.reference || "", 58),
    compactLine([shot.scene, shot.characters, shot.product, shot.notes].filter(Boolean).join("，"), 46),
  ]
    .filter(Boolean)
    .slice(0, 3)
    .join("\n");
  return lines;
}

function compactLine(value: string, maxLength: number) {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 1)}…`;
}

function textSizeFor(text: string) {
  if (text.length > 110) return 7;
  if (text.length > 80) return 8;
  return 9;
}

function picture(
  id: number,
  relId: string,
  x: number,
  y: number,
  w: number,
  h: number,
  image: PptImage,
  name: string,
) {
  const fit = fitFrame(x, y, w, h, image.width / image.height || 16 / 9);
  return `<p:pic>
  <p:nvPicPr><p:cNvPr id="${id}" name="${escapeXml(name)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>
  <p:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
  <p:spPr><a:xfrm><a:off x="${toEmu(fit.x)}" y="${toEmu(fit.y)}"/><a:ext cx="${toEmu(fit.w)}" cy="${toEmu(fit.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:ln><a:noFill/></a:ln></p:spPr>
</p:pic>`;
}

function rect(id: number, x: number, y: number, w: number, h: number, fill: string, line: string, linePt = 0.75) {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Rectangle ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${toEmu(x)}" y="${toEmu(y)}"/><a:ext cx="${toEmu(w)}" cy="${toEmu(h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${fill}"/></a:solidFill><a:ln w="${Math.round(linePt * 12700)}"><a:solidFill><a:srgbClr val="${line}"/></a:solidFill></a:ln></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>`;
}

function textBox(
  id: number,
  text: string,
  x: number,
  y: number,
  w: number,
  h: number,
  options: { color: string; size: number; bold: boolean; align: "ctr" | "l" },
) {
  const paragraphs = text.split(/\n/).map((line) => `<a:p><a:pPr algn="${options.align}"/><a:r><a:rPr lang="zh-CN" sz="${options.size * 100}"${options.bold ? ' b="1"' : ""}><a:solidFill><a:srgbClr val="${options.color}"/></a:solidFill><a:latin typeface="Microsoft YaHei"/><a:ea typeface="Microsoft YaHei"/><a:cs typeface="Microsoft YaHei"/></a:rPr><a:t>${escapeXml(line || " ")}</a:t></a:r></a:p>`);
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="TextBox ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${toEmu(x)}" y="${toEmu(y)}"/><a:ext cx="${toEmu(w)}" cy="${toEmu(h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="square" anchor="t"><a:noAutofit/></a:bodyPr><a:lstStyle/>${paragraphs.join("")}</p:txBody></p:sp>`;
}

async function readShotImage(shot: StoryboardShot, index: number): Promise<PptImage | null> {
  const imageUrl = await normalizeImageUrl(shot.annotatedImage || shot.imageUrl);
  if (!imageUrl?.startsWith("data:image/")) return null;
  const jpeg = await imageUrlToJpeg(imageUrl).catch(() => null);
  if (!jpeg) return null;
  return {
    id: `image${index + 1}-${shot.id.replace(/[^a-z0-9]/gi, "")}`,
    ext: "jpg",
    data: jpeg.data,
    width: jpeg.width,
    height: jpeg.height,
  };
}

async function normalizeImageUrl(imageUrl: string) {
  if (!imageUrl) return "";
  if (imageUrl.startsWith("data:image/")) return imageUrl;
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) return "";
    const blob = await response.blob();
    if (!blob.type.startsWith("image/")) return "";
    return await blobToDataUrl(blob);
  } catch {
    return "";
  }
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

function imageSize(src: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth || 16, height: image.naturalHeight || 9 });
    image.onerror = reject;
    image.src = src;
  });
}

function imageUrlToJpeg(src: string) {
  return new Promise<{ data: Uint8Array; width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const width = image.naturalWidth || 1280;
      const height = image.naturalHeight || 720;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("Canvas unavailable"));
        return;
      }
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
      const match = dataUrl.match(/^data:image\/jpeg;base64,(.+)$/);
      if (!match) {
        reject(new Error("JPEG conversion failed"));
        return;
      }
      resolve({ data: base64ToBytes(match[1]), width, height });
    };
    image.onerror = () => reject(new Error("Image failed to load"));
    image.src = src;
  });
}

function contentTypes(slideCount: number, images: PptImage[]) {
  const defaults = [
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Default Extension="png" ContentType="image/png"/>',
    '<Default Extension="jpg" ContentType="image/jpeg"/>',
    '<Default Extension="jpeg" ContentType="image/jpeg"/>',
    '<Default Extension="webp" ContentType="image/webp"/>',
    '<Default Extension="svg" ContentType="image/svg+xml"/>',
  ];
  const overrides = [
    '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>',
    '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>',
    '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>',
    '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>',
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
    ...Array.from({ length: slideCount }, (_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`),
  ];
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${defaults.join("")}${overrides.join("")}</Types>`;
}

function rootRels() {
  return rels([
    ['rId1', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument', 'ppt/presentation.xml'],
    ['rId2', 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', 'docProps/core.xml'],
    ['rId3', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties', 'docProps/app.xml'],
  ]);
}

function presentationRels(slideCount: number) {
  return rels([
    ['rId1', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster', 'slideMasters/slideMaster1.xml'],
    ...Array.from({ length: slideCount }, (_, i) => [`rId${i + 2}`, 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide', `slides/slide${i + 1}.xml`] as [string, string, string]),
  ]);
}

function slideRels(images: Array<PptImage | null>) {
  return rels([
    ['rId1', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout', '../slideLayouts/slideLayout1.xml'],
    ...images.flatMap((image, index) =>
      image ? [[`rId${index + 2}`, 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image', `../media/${image.id}.${image.ext}`] as [string, string, string]] : [],
    ),
  ]);
}

function rels(items: Array<[string, string, string]>) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(([id, type, target]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`).join("")}</Relationships>`;
}

function presentationXml(slideCount: number) {
  const slideIds = Array.from({ length: slideCount }, (_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slideIds}</p:sldIdLst><p:sldSz cx="${toEmu(slideW)}" cy="${toEmu(slideH)}" type="wide"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;
}

function slideMasterXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`;
}

function slideMasterRels() {
  return rels([
    ['rId1', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout', '../slideLayouts/slideLayout1.xml'],
    ['rId2', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme', '../theme/theme1.xml'],
  ]);
}

function slideLayoutXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
}

function slideLayoutRels() {
  return rels([['rId1', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster', '../slideMasters/slideMaster1.xml']]);
}

function themeXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Storyboard"><a:themeElements><a:clrScheme name="Storyboard"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F1F1F"/></a:dk2><a:lt2><a:srgbClr val="F2F2F2"/></a:lt2><a:accent1><a:srgbClr val="${teal}"/></a:accent1><a:accent2><a:srgbClr val="${green}"/></a:accent2><a:accent3><a:srgbClr val="FFFFFF"/></a:accent3><a:accent4><a:srgbClr val="666666"/></a:accent4><a:accent5><a:srgbClr val="999999"/></a:accent5><a:accent6><a:srgbClr val="CCCCCC"/></a:accent6><a:hlink><a:srgbClr val="${teal}"/></a:hlink><a:folHlink><a:srgbClr val="${teal}"/></a:folHlink></a:clrScheme><a:fontScheme name="Storyboard"><a:majorFont><a:latin typeface="Microsoft YaHei"/><a:ea typeface="Microsoft YaHei"/><a:cs typeface="Microsoft YaHei"/></a:majorFont><a:minorFont><a:latin typeface="Microsoft YaHei"/><a:ea typeface="Microsoft YaHei"/><a:cs typeface="Microsoft YaHei"/></a:minorFont></a:fontScheme><a:fmtScheme name="Storyboard"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
}

function coreProps() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Storyboard Export</dc:title><dc:creator>Storyboard Generator</dc:creator><cp:lastModifiedBy>Storyboard Generator</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:modified></cp:coreProperties>`;
}

function appProps(slideCount: number) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Storyboard Generator</Application><PresentationFormat>On-screen Show (16:9)</PresentationFormat><Slides>${slideCount}</Slides></Properties>`;
}

function xmlEntry(path: string, xml: string): ZipEntry {
  return { path, data: new TextEncoder().encode(xml) };
}

function zipStore(entries: ZipEntry[]) {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  entries.forEach((entry) => {
    const name = new TextEncoder().encode(entry.path);
    const crc = crc32(entry.data);
    const local = concat([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(entry.data.length), u32(entry.data.length), u16(name.length), u16(0), name, entry.data,
    ]);
    chunks.push(local);
    central.push(
      concat([
        u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(entry.data.length), u32(entry.data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name,
      ]),
    );
    offset += local.length;
  });

  const centralData = concat(central);
  const end = concat([u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(centralData.length), u32(offset), u16(0)]);
  return concat([...chunks, centralData, end]);
}

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value: number) {
  return new Uint8Array([value & 255, (value >>> 8) & 255]);
}

function u32(value: number) {
  return new Uint8Array([value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]);
}

function concat(chunks: Uint8Array[]) {
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  chunks.forEach((chunk) => {
    out.set(chunk, offset);
    offset += chunk.length;
  });
  return out;
}

function base64ToBytes(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function downloadBlob(blob: Blob, name: string) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.appendChild(link);
  link.click();
  URL.revokeObjectURL(link.href);
  link.remove();
}

function chunk<T>(items: T[], size: number) {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) groups.push(items.slice(index, index + size));
  return groups;
}

function toEmu(value: number) {
  return Math.round(value * emu);
}

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
