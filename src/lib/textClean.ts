const cjk = "\\u3400-\\u9fff";
const chinesePunctuation = "，。！？；：、（）《》“”‘’";

export function cleanPdfItemText(text: string) {
  return normalizeInlineText(text.replace(/[\u0000-\u001f\u007f]/g, " "));
}

export function normalizeCellText(text: string) {
  return normalizeExtractedScriptText(text, { joinSoftBreaks: true });
}

export function normalizeExtractedScriptText(text: string, options: { joinSoftBreaks?: boolean } = {}) {
  const shouldJoinSoftBreaks = options.joinSoftBreaks ?? false;
  let next = text
    .replace(/\r/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((line) => normalizeInlineText(line).trim())
    .filter(Boolean)
    .join("\n");

  if (shouldJoinSoftBreaks) {
    next = joinSoftLineBreaks(next);
  }

  return next.replace(/\n{3,}/g, "\n\n").trim();
}

export function normalizeInlineText(text: string) {
  return text
    .replace(/[ \t]+/g, " ")
    .replace(new RegExp(`([${cjk}])\\s+(?=[${cjk}])`, "g"), "$1")
    .replace(new RegExp(`([${cjk}])\\s+(?=[${chinesePunctuation}])`, "g"), "$1")
    .replace(new RegExp(`([${chinesePunctuation}])\\s+(?=[${cjk}A-Za-z0-9])`, "g"), "$1")
    .replace(new RegExp(`([${cjk}])\\s+(?=[,.;:!?])`, "g"), "$1")
    .replace(new RegExp(`([,.;:!?])\\s+(?=[${cjk}])`, "g"), "$1")
    .replace(/\s+([，。！？；：、）】》”’])/g, "$1")
    .replace(/([（【《“‘])\s+/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function joinSoftLineBreaks(text: string) {
  const lines = text.split("\n");
  const merged: string[] = [];

  for (const line of lines) {
    const previous = merged[merged.length - 1];
    if (!previous || shouldKeepLineBreak(previous, line)) {
      merged.push(line);
      continue;
    }

    const glue = needsSpaceBetween(previous, line) ? " " : "";
    merged[merged.length - 1] = `${previous}${glue}${line}`;
  }

  return merged.join("\n");
}

function shouldKeepLineBreak(previous: string, next: string) {
  if (!previous.trim() || !next.trim()) return true;
  if (/^\d{1,3}([.、，:]|\s|$)/.test(next)) return true;
  if (/^(Shot|分镜|镜头)\s*\d+/i.test(next)) return true;
  if (/^(VO|OS|SFX|字幕|备注|产品|镜头|景别|画面|旁白|对白)\s*[:：]/i.test(next)) return true;
  if (/[。！？!?；;：:]$/.test(previous)) return true;
  return false;
}

function needsSpaceBetween(previous: string, next: string) {
  return /[A-Za-z0-9]$/.test(previous) && /^[A-Za-z0-9]/.test(next);
}
