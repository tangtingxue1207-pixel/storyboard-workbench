"use client";

import { Clipboard, Download, ImagePlus } from "lucide-react";
import type { StoryboardShot } from "@/types/storyboard";

type Props = {
  shot: StoryboardShot;
  onChange: (patch: Partial<StoryboardShot>) => void;
  onReplaceImage: (file: File) => void;
  onUseReferenceImage: (imageUrl: string) => void;
  onDownloadImage: () => void;
  onCopyGptPrompt: () => void;
  onCopyBatchGptPrompt: () => void;
};

export function ShotEditor({
  shot,
  onChange,
  onReplaceImage,
  onUseReferenceImage,
  onDownloadImage,
  onCopyGptPrompt,
  onCopyBatchGptPrompt,
}: Props) {
  return (
    <section className="storyboard-scrollbar h-full overflow-y-auto border-r border-line bg-paper p-5">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase text-teal">当前分镜</p>
          <h2 className="mt-1 text-2xl font-semibold text-ink">Shot {shot.shotNumber}</h2>
        </div>
      </div>

      <div className="grid gap-4">
        <Field label="分镜号">
          <input
            value={shot.shotNumber}
            type="number"
            min={1}
            onChange={(event) => onChange({ shotNumber: Number(event.target.value) || 1 })}
            className="w-full border border-line bg-white px-3 py-2 text-sm outline-none focus:border-teal"
          />
        </Field>
        <Field label="场景">
          <input
            value={shot.scene ?? ""}
            onChange={(event) => onChange({ scene: event.target.value })}
            className="w-full border border-line bg-white px-3 py-2 text-sm outline-none focus:border-teal"
          />
        </Field>
        <Field label="人物">
          <input
            value={shot.characters ?? ""}
            onChange={(event) => onChange({ characters: event.target.value })}
            className="w-full border border-line bg-white px-3 py-2 text-sm outline-none focus:border-teal"
          />
        </Field>
        <Field label="画面描述">
          <textarea
            value={shot.scriptText}
            rows={7}
            onChange={(event) => onChange({ scriptText: event.target.value })}
            className="w-full resize-none border border-line bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-teal"
          />
        </Field>
        <Field label="景别">
          <input
            value={shot.shotSize}
            onChange={(event) => onChange({ shotSize: event.target.value, cameraMove: event.target.value })}
            placeholder="例如：中 / 近 / 特写 / 组"
            className="w-full border border-line bg-white px-3 py-2 text-sm outline-none focus:border-teal"
          />
        </Field>
        <Field label="花字">
          <textarea
            value={shot.copy}
            rows={3}
            onChange={(event) => onChange({ copy: event.target.value, flowerText: event.target.value })}
            className="w-full resize-none border border-line bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-teal"
          />
        </Field>
        <Field label="镜头运动/提示补充">
          <input
            value={shot.cameraMove}
            onChange={(event) => onChange({ cameraMove: event.target.value })}
            placeholder="例如：推 / 拉 / 摇左 / 上移"
            className="w-full border border-line bg-white px-3 py-2 text-sm outline-none focus:border-teal"
          />
        </Field>
        <Field label="画面参考图片">
          <textarea
            value={shot.reference}
            rows={3}
            onChange={(event) => onChange({ reference: event.target.value })}
            className="w-full resize-none border border-line bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-teal"
          />
        </Field>
        <Field label="商品">
          <input
            value={shot.product ?? ""}
            onChange={(event) => onChange({ product: event.target.value })}
            className="w-full border border-line bg-white px-3 py-2 text-sm outline-none focus:border-teal"
          />
        </Field>
        <Field label="备注">
          <textarea
            value={shot.notes}
            rows={4}
            onChange={(event) => onChange({ notes: event.target.value })}
            className="w-full resize-none border border-line bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-teal"
          />
        </Field>
        <Field label="线稿生成提示词">
          <textarea
            value={shot.imagePrompt}
            rows={5}
            onChange={(event) => onChange({ imagePrompt: event.target.value })}
            placeholder="用于生成黑白勾线分镜图，可单独微调"
            className="w-full resize-none border border-line bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-teal"
          />
        </Field>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <label className="inline-flex cursor-pointer items-center gap-2 border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:border-teal">
          <ImagePlus className="h-4 w-4" />
          从本地文件中选择
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onReplaceImage(file);
              event.currentTarget.value = "";
            }}
          />
        </label>
        <button
          type="button"
          disabled={!shot.imageUrl}
          onClick={onDownloadImage}
          className="inline-flex items-center gap-2 border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:border-teal disabled:cursor-not-allowed disabled:opacity-45"
        >
          <Download className="h-4 w-4" />
          下载当前图
        </button>
        <button
          type="button"
          onClick={onCopyGptPrompt}
          className="inline-flex items-center gap-2 border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:border-teal"
        >
          <Clipboard className="h-4 w-4" />
          复制本个镜头
        </button>
        <button
          type="button"
          onClick={onCopyBatchGptPrompt}
          className="inline-flex items-center gap-2 border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:border-teal"
        >
          <Clipboard className="h-4 w-4" />
          复制本组8镜头
        </button>
      </div>
      {shot.referenceImages.length ? (
        <div className="mt-4">
          <p className="text-xs font-medium text-stone-600">已添加 {shot.referenceImages.length} 张参考图</p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {shot.referenceImages.map((imageUrl, index) => (
              <button
                key={`${imageUrl.slice(0, 48)}-${index}`}
                type="button"
                title="将此参考图设为当前分镜图"
                onClick={() => onUseReferenceImage(imageUrl)}
                className="group overflow-hidden border border-line bg-white p-1 text-left hover:border-teal"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl} alt={`参考图 ${index + 1}`} className="aspect-video w-full object-cover" />
                <span className="mt-1 block text-center text-[11px] font-semibold text-stone-600 group-hover:text-teal">
                  用作当前图
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <p className="mt-3 text-xs leading-5 text-stone-600">
        可单张复制，也可复制当前开始的 8 个镜头。GPT 生成后逐张复制图片，回到对应 Shot 粘贴。
      </p>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold text-stone-700">{label}</span>
      {children}
    </label>
  );
}
