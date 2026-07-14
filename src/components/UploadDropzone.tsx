"use client";

import { FileUp } from "lucide-react";

type Props = {
  busy: boolean;
  onFile: (file: File) => void;
};

export function UploadDropzone({ busy, onFile }: Props) {
  return (
    <label className="flex min-h-[168px] cursor-pointer flex-col items-center justify-center border border-dashed border-stone-400 bg-white px-6 text-center transition hover:border-teal hover:bg-stone-50">
      <FileUp className="mb-4 h-8 w-8 text-teal" />
      <span className="text-base font-semibold text-ink">
        {busy ? "正在解析文件..." : "上传剧本表格 / PDF"}
      </span>
      <span className="mt-2 max-w-md text-sm leading-6 text-stone-600">
        优先支持 .xlsx、.csv、飞书表格导出的 Excel；PDF 会先识别表格网格。支持后续单条编辑、重排和导出 PDF。
      </span>
      <input
        className="hidden"
        type="file"
        accept=".pdf,.xlsx,.csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
        disabled={busy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          event.currentTarget.value = "";
        }}
      />
    </label>
  );
}
