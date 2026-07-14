"use client";

import {
  ArrowRight,
  Clipboard,
  Crop,
  Download,
  ImagePlus,
  Lock,
  LockOpen,
  MousePointer2,
  Plus,
  Save,
  Square,
  Trash2,
  Type,
  Upload,
} from "lucide-react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { exportStoryboardPptx } from "@/lib/exportPptx";
import { canParseTableFile, extractTableFile } from "@/lib/tableImport";
import type { StoryboardShot } from "@/types/storyboard";
import type { ImageAnnotation } from "@/types/storyboard";

type ViewMode = "original" | "current" | "scene";
type AssetType = "scene" | "character" | "prop";
type ShotStatus = "draft" | "prompt_copied" | "image_generated" | "image_filled" | "confirmed";
type SelectBox = { left: number; top: number; width: number; height: number };
type CropRect = { x: number; y: number; width: number; height: number };
type CropHandle = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
type AnnotationTool = "select" | "text" | "arrow" | "rect";
type GridCropBox = CropRect & { id: string; index: number; confidence: number; source: "auto-detect" | "manual-adjust" };
type GridCropFrame = CropRect & { confidence: number; source: "auto-detect" | "manual-adjust" };
type LibTvGridState = { imageUrl: string; width: number; height: number; frame: GridCropFrame; autoFrame: GridCropFrame; targetShotIds: string[]; warning: string };
type PromptParts = {
  imageType?: string;
  subject?: string;
  scene?: string;
  environment?: string;
  props?: string;
  layout?: string;
  composition?: string;
  lighting?: string;
  style?: string;
  negative?: string;
};

type WorkShot = StoryboardShot & {
  originalIndex: number;
  currentIndex: number;
  originalShotNo: string;
  currentShotNo: string;
  propsText: string;
  dialogue: string;
  status: ShotStatus;
  isLocked: boolean;
  imageLocked: boolean;
  copiedAt?: string;
  generatedAt?: string;
  confirmedAt?: string;
};

type Asset = {
  id: string;
  type: AssetType;
  name: string;
  coreRequirements: string;
  templatePrompt?: string;
  aiPrompt?: string;
  activePromptMode?: "template" | "ai";
  imagePrompt?: string;
  isLocked: boolean;
};

type CharacterRole = {
  id: string;
  name: string;
  aliases: string[];
};

type SceneGroup = {
  sceneName: string;
  shots: WorkShot[];
  batches: Array<{ id: string; index: number; shots: WorkShot[] }>;
};

type AppSnapshot = {
  projectName: string;
  shots: WorkShot[];
  assets: Asset[];
  characterRoles: CharacterRole[];
  activeId: string | null;
  selectedIds: string[];
  viewMode: ViewMode;
  assetTab: AssetType;
  storyboardRatio: string;
};

type XlsxPreviewRow = {
  originalShotNo: string;
  currentShotNo: string;
  originalIndex: number;
  currentIndex: number;
  scene: string;
  characters: string;
  propsText: string;
  shotSize: string;
  scriptText: string;
  dialogue: string;
  cameraMove: string;
  notes: string;
  imagePath: string;
  imageUrl: string;
  status: string;
};

type ProjectState = {
  id: string;
  name: string;
  shots: WorkShot[];
  assets: Asset[];
  characterRoles: CharacterRole[];
  activeShotId: string | null;
  selectedShotIds: string[];
  viewMode: ViewMode;
  assetTab: AssetType;
  storyboardRatio: string;
  selectedImageShotId: string | null;
  editorState: {
    scrollTop: number;
    currentStep: string;
  };
  createdAt: string;
  updatedAt: string;
  version: number;
};

const storageKey = "libtv-storyboard-workbench-v1";
const currentProjectKey = "libtv-storyboard-current-project-id-v2";

const statusLabels: Record<ShotStatus, string> = {
  draft: "草稿",
  prompt_copied: "已复制",
  image_generated: "已生图",
  image_filled: "已回填",
  confirmed: "已确认",
};

export default function Home() {
  const [projectId, setProjectId] = useState("");
  const [createdAt, setCreatedAt] = useState("");
  const [lastSavedAt, setLastSavedAt] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [projectName, setProjectName] = useState("半自动分镜脚本整理与回填导出工具");
  const [shots, setShots] = useState<WorkShot[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [characterRoles, setCharacterRoles] = useState<CharacterRole[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("original");
  const [assetTab, setAssetTab] = useState<AssetType>("scene");
  const [storyboardRatio, setStoryboardRatio] = useState("16:9");
  const [pptxPreviewShots, setPptxPreviewShots] = useState<WorkShot[] | null>(null);
  const [xlsxPreviewRows, setXlsxPreviewRows] = useState<XlsxPreviewRow[] | null>(null);
  const [libTvGrid, setLibTvGrid] = useState<LibTvGridState | null>(null);
  const [selectedImageShotId, setSelectedImageShotId] = useState<string | null>(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [optimizingPromptId, setOptimizingPromptId] = useState<string | null>(null);
  const [notice, setNotice] = useState("导入 xlsx 或 csv 后开始整理分镜");
  const historyRef = useRef<AppSnapshot[]>([]);
  const lastHistoryKeyRef = useRef("");
  const restoringHistoryRef = useRef(false);
  const hydratingRef = useRef(true);
  const savingRef = useRef(false);

  const activeShot = useMemo(() => shots.find((shot) => shot.id === activeId) ?? shots[0] ?? null, [activeId, shots]);
  const sceneGroups = useMemo(() => buildSceneGroups(shots, assets), [assets, shots]);
  const orderedShots = useMemo(() => sortShots(shots, viewMode === "current" ? "currentIndex" : "originalIndex"), [shots, viewMode]);
  const selectedShots = useMemo(
    () => sortShots(shots.filter((shot) => selectedIds.includes(shot.id)), "originalIndex"),
    [selectedIds, shots],
  );
  const selectedCopyShots = useMemo(
    () => visibleShotsForSelection(orderedShots, sceneGroups, viewMode).filter((shot) => selectedIds.includes(shot.id)),
    [orderedShots, sceneGroups, selectedIds, viewMode],
  );
  const currentBatch = useMemo(() => findBatchForShot(sceneGroups, activeShot?.id), [activeShot?.id, sceneGroups]);

  useEffect(() => {
    let cancelled = false;
    async function loadProjectOnPageOpen() {
      hydratingRef.current = true;
      const url = new URL(window.location.href);
      const urlProjectId = url.searchParams.get("projectId");
      const fallbackProjectId = localStorage.getItem(currentProjectKey);
      const nextProjectId = urlProjectId || fallbackProjectId || createProjectId();
      const savedProject = await loadProjectFromIndexedDB(nextProjectId).catch(() => null);
      if (cancelled) return;
      if (savedProject) {
        restoreProjectState(savedProject);
        setNotice("已恢复保存的项目进度");
        requestAnimationFrame(() => window.scrollTo(0, savedProject.editorState?.scrollTop || 0));
      } else {
        const sharedProject = urlProjectId ? await loadProjectFromSharedStore(nextProjectId).catch(() => null) : null;
        if (cancelled) return;
        const legacyProject = !urlProjectId && !fallbackProjectId ? loadLegacyProject(nextProjectId) : null;
        const nextProject = sharedProject || legacyProject || createEmptyProjectState(nextProjectId);
        restoreProjectState(nextProject);
        if (sharedProject) await saveProjectToIndexedDB(nextProject).catch(() => undefined);
        setNotice(sharedProject ? "已从飞书项目链接载入分镜项目" : legacyProject ? "已恢复旧版本地项目，请点击保存写入新项目库" : "已创建新的空项目");
      }
      localStorage.setItem(currentProjectKey, nextProjectId);
      if (!urlProjectId) {
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.set("projectId", nextProjectId);
        window.history.replaceState(null, "", nextUrl.toString());
      }
      hydratingRef.current = false;
    }
    void loadProjectOnPageOpen();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (hydratingRef.current || savingRef.current || !projectId) return;
    setIsDirty(true);
  }, [activeId, assetTab, assets, characterRoles, projectId, projectName, selectedIds, selectedImageShotId, shots, storyboardRatio, viewMode]);

  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (!isDirty) return;
      event.preventDefault();
      event.returnValue = "当前项目有未保存内容，确定要离开吗？";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  useEffect(() => {
    const snapshot: AppSnapshot = { projectName, shots, assets, characterRoles, activeId, selectedIds, viewMode, assetTab, storyboardRatio };
    const key = JSON.stringify(snapshot);
    if (restoringHistoryRef.current) {
      restoringHistoryRef.current = false;
      lastHistoryKeyRef.current = key;
      return;
    }
    if (lastHistoryKeyRef.current === key) return;
    historyRef.current.push(cloneSnapshot(snapshot));
    lastHistoryKeyRef.current = key;
    if (historyRef.current.length > 80) historyRef.current.shift();
  }, [activeId, assetTab, assets, characterRoles, projectName, selectedIds, shots, storyboardRatio, viewMode]);

  useEffect(() => {
    function handleDeleteKey(event: KeyboardEvent) {
      if ((event.key !== "Delete" && event.key !== "Backspace") || isTypingTarget(document.activeElement)) return;
      if (selectedImageShotId) {
        event.preventDefault();
        deleteShotImage(selectedImageShotId);
        return;
      }
      if (!selectedIds.length) return;
      event.preventDefault();
      deleteSelectedShots();
    }
    window.addEventListener("keydown", handleDeleteKey);
    return () => window.removeEventListener("keydown", handleDeleteKey);
  }, [selectedIds, selectedImageShotId, shots]);

  useEffect(() => {
    function handleUndoKey(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== "z" || event.shiftKey || !(event.metaKey || event.ctrlKey) || isTypingTarget(document.activeElement)) return;
      event.preventDefault();
      restorePreviousSnapshot();
    }
    window.addEventListener("keydown", handleUndoKey);
    return () => window.removeEventListener("keydown", handleUndoKey);
  }, []);

  useEffect(() => {
    function handlePaste(event: ClipboardEvent) {
      if (!activeShot || isTypingTarget(document.activeElement)) return;
      const files = Array.from(event.clipboardData?.files || []).filter((file) => file.type.startsWith("image/"));
      if (!files.length) return;
      event.preventDefault();
      if (files.length === 1) {
        void fillShotImage(activeShot.id, files[0], "paste");
      } else if (currentBatch) {
        void fillBatchImages(currentBatch.shots, files, "paste");
      }
    }
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [activeShot, currentBatch]);

  async function handleFile(file: File) {
    if (!canParseTableFile(file)) {
      setNotice("文件格式不支持。请上传 xlsx 或 csv 格式的脚本表格。");
      return;
    }
    setBusy(true);
    try {
      const result = await extractTableFile(file);
      if (!result.shots.length) {
        setNotice("表格中没有可解析的镜头内容，请检查后重新导入。");
        return;
      }
      const nextShots = result.shots.map(toWorkShot);
      const nextRoles = deriveCharacterRoles(nextShots, []);
      setProjectName(file.name.replace(/\.[^.]+$/, "") || "分镜项目");
      setShots(nextShots);
      setAssets(deriveAssets(nextShots, []));
      setCharacterRoles(nextRoles);
      setActiveId(nextShots[0]?.id ?? null);
      setSelectedIds([]);
      setViewMode("original");
      setNotice(`已导入 ${nextShots.length} 个镜头，并整理出场景 / 人物 / 道具要求`);
    } catch (error) {
      setNotice(error instanceof Error ? `导入失败：${error.message}` : "导入失败。请确认表格没有损坏，或另存为 csv 后再试。");
    } finally {
      setBusy(false);
    }
  }

  function updateShot(id: string, patch: Partial<WorkShot>) {
    setShots((current) => {
      const next = current.map((shot) => {
        if (shot.id !== id) return shot;
        const patchKeys = Object.keys(patch);
        const imagePatch = patchKeys.length > 0 && patchKeys.every((key) => ["imageUrl", "imageLocked", "status", "annotations", "annotatedImage"].includes(key));
        if (shot.isLocked && !Object.prototype.hasOwnProperty.call(patch, "isLocked") && !imagePatch) return shot;
        return { ...shot, ...patch };
      });
      setAssets((currentAssets) => deriveAssets(next, currentAssets));
      return next;
    });
  }

function updateAsset(id: string, patch: Partial<Asset>) {
    const previous = assets.find((asset) => asset.id === id);
    setAssets((current) => current.map((asset) => (asset.id === id ? { ...asset, ...patch } : asset)));
    if (previous?.type === "scene" && typeof patch.name === "string") {
      const oldName = previous.name.trim();
      const newName = patch.name.trim();
      if (oldName && newName && oldName !== newName) {
        setShots((current) => current.map((shot) => ((shot.scene || "").trim() === oldName ? { ...shot, scene: newName } : shot)));
      }
    }
  }

  function generateTemplatePromptForAsset(asset: Asset) {
    const templatePrompt = generateTemplatePrompt(asset.type, asset.name, asset.coreRequirements);
    console.log("当前生成模式:", "template");
    console.log("AI 输入核心词:", asset.coreRequirements);
    console.log("模板生成结果:", templatePrompt);
    console.log("最终显示结果:", templatePrompt);
    updateAsset(asset.id, {
      templatePrompt,
      activePromptMode: "template",
    });
    setNotice(`已用模板生成“${asset.name}”的生图词。`);
  }

  function addAsset(type: AssetType) {
    const name = type === "scene" ? uniqueAssetName(assets, "scene", "新场景") : "新条目";
    setAssets((current) => [...current, newAsset(type, name)]);
  }

  function addShot(afterId?: string) {
    const insertIndex = afterId ? shots.findIndex((shot) => shot.id === afterId) + 1 : shots.length;
    const baseIndex = shots.length + 1;
    const shot: WorkShot = {
      id: crypto.randomUUID(),
      shotNumber: baseIndex,
      shotLabel: String(baseIndex),
      originalIndex: baseIndex,
      currentIndex: insertIndex + 1,
      originalShotNo: String(baseIndex),
      currentShotNo: String(baseIndex),
      scene: activeShot?.scene || "",
      characters: activeShot?.characters || "",
      propsText: activeShot?.propsText || "",
      shotSize: "",
      scriptText: "",
      dialogue: "",
      cameraMove: "",
      notes: "",
      reference: "",
      copy: "",
      product: "",
      imagePrompt: "",
      referenceImages: [],
      imageUrl: "",
      annotations: [],
      annotatedImage: "",
      canvasElements: [],
      status: "draft",
      isLocked: false,
      imageLocked: false,
    };
    setShots((current) => renumberCurrent([...current.slice(0, insertIndex), shot, ...current.slice(insertIndex)]));
    setActiveId(shot.id);
    setNotice("已新增一个镜头");
  }

  function duplicateShot(shot: WorkShot) {
    const copy: WorkShot = {
      ...shot,
      id: crypto.randomUUID(),
      originalIndex: Math.max(0, ...shots.map((item) => item.originalIndex)) + 1,
      currentIndex: shot.currentIndex + 1,
      originalShotNo: `${shot.originalShotNo}-复制`,
      currentShotNo: `${shot.currentShotNo}-复制`,
      imageUrl: "",
      annotations: [],
      annotatedImage: "",
      status: "draft",
      isLocked: false,
      imageLocked: false,
      copiedAt: undefined,
      generatedAt: undefined,
      confirmedAt: undefined,
    };
    const index = shots.findIndex((item) => item.id === shot.id);
    setShots((current) => renumberCurrent([...current.slice(0, index + 1), copy, ...current.slice(index + 1)]));
    setActiveId(copy.id);
    setNotice("已复制镜头，图片未复制");
  }

  function deleteShot(id: string) {
    const shot = shots.find((item) => item.id === id);
    if (shot?.isLocked) {
      setNotice("该镜头已锁定，请先解锁后再删除。");
      return;
    }
    setShots((current) => renumberCurrent(current.filter((item) => item.id !== id)));
    setSelectedIds((current) => current.filter((item) => item !== id));
    if (activeId === id) setActiveId(shots.find((item) => item.id !== id)?.id ?? null);
    setNotice("已删除镜头");
  }

  function deleteSelectedShots() {
    const ids = new Set(selectedIds);
    if (!ids.size) return;
    const lockedCount = shots.filter((shot) => ids.has(shot.id) && shot.isLocked).length;
    const deletableIds = new Set(shots.filter((shot) => ids.has(shot.id) && !shot.isLocked).map((shot) => shot.id));
    if (!deletableIds.size) {
      setNotice("选中的镜头都已锁定，请先解锁后再删除。");
      return;
    }
    const nextShots = renumberCurrent(shots.filter((shot) => !deletableIds.has(shot.id)));
    setShots(nextShots);
    setSelectedIds((current) => current.filter((id) => !deletableIds.has(id)));
    if (activeId && deletableIds.has(activeId)) setActiveId(nextShots[0]?.id ?? null);
    setNotice(`已删除 ${deletableIds.size} 个选中镜头${lockedCount ? `，跳过 ${lockedCount} 个锁定镜头` : ""}`);
  }

  function restorePreviousSnapshot() {
    const history = historyRef.current;
    if (history.length <= 1) {
      setNotice("没有可撤回的上一步。");
      return;
    }
    history.pop();
    const previous = cloneSnapshot(history[history.length - 1]);
    restoringHistoryRef.current = true;
    setProjectName(previous.projectName);
    setShots(previous.shots);
    setAssets(previous.assets);
    setCharacterRoles(previous.characterRoles);
    setActiveId(previous.activeId);
    setSelectedIds(previous.selectedIds);
    setViewMode(previous.viewMode);
    setAssetTab(previous.assetTab);
    setStoryboardRatio(previous.storyboardRatio);
    setNotice("已返回上一步");
  }

  function reorderShot(draggedId: string, targetId?: string, targetScene?: string) {
    const current = sortShots(shots, "currentIndex");
    const fromIndex = current.findIndex((shot) => shot.id === draggedId);
    if (fromIndex < 0) return;
    const draggedShot = current[fromIndex];
    const cleanTargetScene = targetScene?.trim();
    let toIndex = targetId ? current.findIndex((shot) => shot.id === targetId) : -1;
    if (toIndex < 0 && cleanTargetScene) {
      const sceneIndexes = current
        .map((shot, index) => ({ shot, index }))
        .filter(({ shot }) => (shot.scene?.trim() || "未识别场景") === cleanTargetScene)
        .map(({ index }) => index);
      toIndex = sceneIndexes.length ? sceneIndexes[sceneIndexes.length - 1] + 1 : current.length;
    }
    if (toIndex < 0 || (draggedId === targetId && (!cleanTargetScene || cleanTargetScene === (draggedShot.scene?.trim() || "未识别场景")))) return;
    const next = [...current];
    const [dragged] = next.splice(fromIndex, 1);
    if (cleanTargetScene) dragged.scene = cleanTargetScene === "未识别场景" ? "" : cleanTargetScene;
    if (fromIndex < toIndex) toIndex -= 1;
    next.splice(toIndex, 0, dragged);
    const order = new Map(next.map((shot, index) => [shot.id, index + 1]));
    const sourceScene = draggedShot.scene?.trim() || "未识别场景";
    const targetSceneName = dragged.scene?.trim() || "未识别场景";
    setShots((all) => {
      const updated = all.map((shot) => (shot.id === draggedId ? { ...shot, scene: dragged.scene, currentIndex: order.get(shot.id) ?? shot.currentIndex } : { ...shot, currentIndex: order.get(shot.id) ?? shot.currentIndex }));
      const sourceStillUsed = updated.some((shot) => (shot.scene?.trim() || "未识别场景") === sourceScene);
      if (sourceScene !== targetSceneName && sourceScene !== "未识别场景" && !sourceStillUsed) {
        setAssets((currentAssets) => currentAssets.filter((asset) => asset.type !== "scene" || asset.isLocked || asset.name.trim() !== sourceScene));
      }
      return updated;
    });
    if (viewMode !== "scene") setViewMode("current");
    setNotice(cleanTargetScene && cleanTargetScene !== (draggedShot.scene?.trim() || "未识别场景") ? `已移动到场景：${cleanTargetScene}` : "已调整镜头顺序");
  }

  function deleteShotImage(shotId: string) {
    const shot = shots.find((item) => item.id === shotId);
    if (!shot?.imageUrl) {
      setSelectedImageShotId(null);
      return;
    }
    if (shot.imageLocked) {
      setNotice("该镜头图片已锁定，请先解锁图片后再删除。");
      return;
    }
    updateShot(shotId, { imageUrl: "", annotations: [], annotatedImage: "", status: "draft" });
    setSelectedImageShotId(null);
    setNotice(`已删除镜头 ${shot.originalShotNo} 的图片`);
  }

  async function fillShotImage(shotId: string, file: File, source: "upload" | "paste" | "drag_drop" | "batch_upload") {
    const shot = shots.find((item) => item.id === shotId);
    if (!shot) return;
    if (shot.imageLocked && !window.confirm("该镜头图片已锁定，是否覆盖？")) return;
    const imageUrl = await fileToDataUrl(file);
    updateShot(shotId, { imageUrl, annotations: [], annotatedImage: "", status: "image_filled" });
    setNotice(`镜头 ${shot.originalShotNo} 已${source === "paste" ? "粘贴" : "回填"}图片`);
  }

  async function fillBatchImages(batchShots: WorkShot[], files: File[], source: "upload" | "paste" | "drag_drop" | "batch_upload") {
    if (!batchShots.length) return;
    if (files.length !== batchShots.length) {
      setNotice(`图片数量 ${files.length} 与当前组镜头数量 ${batchShots.length} 不一致。第一版原型将按较少数量顺序回填，请检查未匹配项。`);
    }
    const pairs = batchShots.slice(0, files.length).map((shot, index) => [shot, files[index]] as const);
    const locked = pairs.filter(([shot]) => shot.imageLocked);
    if (locked.length && !window.confirm(`有 ${locked.length} 个镜头图片已锁定，是否覆盖？`)) return;
    const updates = await Promise.all(pairs.map(async ([shot, file]) => ({ id: shot.id, imageUrl: await fileToDataUrl(file) })));
    setShots((current) =>
      current.map((shot) => {
        const update = updates.find((item) => item.id === shot.id);
        return update ? { ...shot, imageUrl: update.imageUrl, annotations: [], annotatedImage: "", status: "image_filled" } : shot;
      }),
    );
    setNotice(`已按顺序回填 ${updates.length} 张图片`);
  }

  async function openLibTvGridCrop(file: File) {
    const imageUrl = await fileToDataUrl(file);
    const size = await imageSizeFromDataUrl(imageUrl).catch(() => ({ width: 0, height: 0 }));
    if (!size.width || !size.height) {
      setNotice("九宫格图片读取失败，请换一张图片重试。");
      return;
    }
    const detected = await detectLibTvGridFrame(imageUrl, size.width, size.height);
    const targetShots = selectedCopyShots.length ? selectedCopyShots : currentBatch?.shots?.length ? currentBatch.shots : activeShot ? [activeShot] : [];
    if (!targetShots.length) {
      setNotice("请先选择需要回填的镜头。");
      return;
    }
    setLibTvGrid({
      imageUrl,
      width: size.width,
      height: size.height,
      frame: detected.frame,
      autoFrame: detected.frame,
      targetShotIds: targetShots.slice(0, 9).map((shot) => shot.id),
      warning: detected.warning,
    });
  }

  async function confirmLibTvGridCrop(state: LibTvGridState) {
    const cropped = await cropImageByGridFrame(state.imageUrl, state.frame);
    const pairs = state.targetShotIds.slice(0, cropped.length).map((id, index) => ({ id, imageUrl: cropped[index] }));
    setShots((current) =>
      current.map((shot) => {
        const update = pairs.find((item) => item.id === shot.id);
        return update ? { ...shot, imageUrl: update.imageUrl, annotations: [], annotatedImage: "", status: "image_filled" } : shot;
      }),
    );
    setLibTvGrid(null);
    setNotice(`已从 LibTV 九宫格裁切并回填 ${pairs.length} 张图片。`);
  }

  async function copySinglePrompt(shot: WorkShot) {
    const prompt = buildSinglePrompt(shot, assets);
    const ok = await copyText(prompt);
    updateShot(shot.id, { status: "prompt_copied", copiedAt: new Date().toISOString(), imagePrompt: prompt });
    setNotice(ok ? `镜头 ${shot.originalShotNo} 提示词已复制` : "自动复制失败，请手动复制弹出的提示词");
  }

  async function copyShotsPrompt(targetShots: WorkShot[], label: string) {
    if (!targetShots.length) {
      setNotice("请至少选择一个镜头。");
      return;
    }
    const prompt = buildBatchPrompt(targetShots, assets);
    const ok = await copyText(prompt);
    const ids = new Set(targetShots.map((shot) => shot.id));
    setShots((current) =>
      current.map((shot) =>
        ids.has(shot.id) ? { ...shot, status: "prompt_copied", copiedAt: new Date().toISOString(), imagePrompt: prompt } : shot,
      ),
    );
    setNotice(ok ? `${label}提示词已复制，共 ${targetShots.length} 个镜头` : "自动复制失败，请检查浏览器剪贴板权限。");
  }

  async function copyScriptContent(targetShots: WorkShot[], label: string, ratio = storyboardRatio) {
    if (!targetShots.length) {
      setNotice("请至少选择一个镜头。");
      return;
    }
    const text = buildScriptContentBlock(targetShots, ratio);
    const ok = await copyText(text);
    const countTip = label === "选中" && targetShots.length !== 9 ? `，当前选择 ${targetShots.length} 个，九宫格建议选择 9 个` : "";
    setNotice(ok ? `${label}脚本内容已复制，共 ${targetShots.length} 个镜头${countTip}` : "脚本内容复制失败，请检查浏览器剪贴板权限。");
  }

  function markSelected(status: ShotStatus) {
    const ids = new Set(selectedIds);
    setShots((current) =>
      current.map((shot) =>
        ids.has(shot.id)
          ? {
              ...shot,
              status,
              generatedAt: status === "image_generated" ? new Date().toISOString() : shot.generatedAt,
              confirmedAt: status === "confirmed" ? new Date().toISOString() : shot.confirmedAt,
            }
          : shot,
      ),
    );
    setNotice(`已标记 ${selectedIds.length} 个镜头为${statusLabels[status]}`);
  }

  function resetCurrentOrder() {
    setShots((current) => current.map((shot) => ({ ...shot, currentIndex: shot.originalIndex })));
    setViewMode("original");
    setNotice("已恢复原脚本顺序");
  }

  async function previewXlsx() {
    const preparedShots = await shotsWithAnnotatedImages(sortShots(shots, "originalIndex"));
    setShots((current) => current.map((shot) => preparedShots.find((item) => item.id === shot.id) || shot));
    setXlsxPreviewRows(preparedShots.map(shotToXlsxPreviewRow));
    setNotice("已生成 XLSX 预览，可修改后导出。");
  }

  async function exportXlsx(rows = xlsxPreviewRows) {
    if (!rows?.length) return;
    await downloadStoryboardXlsx(rows, `${safeName(projectName)}_分镜表_${timestamp()}.xlsx`);
    setNotice("已导出 XLSX 分镜表。");
  }

  async function exportXlsxDirect() {
    if (!shots.length) return;
    const preparedShots = await shotsWithAnnotatedImages(sortShots(shots, "originalIndex"));
    setShots((current) => current.map((shot) => preparedShots.find((item) => item.id === shot.id) || shot));
    await downloadStoryboardXlsx(preparedShots.map(shotToXlsxPreviewRow), `${safeName(projectName)}_分镜表_${timestamp()}.xlsx`);
    setNotice("已导出 XLSX 分镜表。");
  }

  async function previewPptx() {
    const preparedShots = await shotsWithAnnotatedImages(sortShots(shots, "originalIndex"));
    setShots((current) => current.map((shot) => preparedShots.find((item) => item.id === shot.id) || shot));
    setPptxPreviewShots(preparedShots.map((shot) => ({ ...shot })));
    setNotice("已生成 PPTX 预览，可修改后导出。");
  }

  function exportPptx(previewShots = pptxPreviewShots) {
    if (!previewShots?.length) return;
    void exportStoryboardPptx(previewShots, storyboardRatio).then(() => setNotice("已导出 PPTX。"));
  }

  async function exportPptxDirect() {
    if (!shots.length) return;
    const preparedShots = await shotsWithAnnotatedImages(sortShots(shots, "originalIndex"));
    setShots((current) => current.map((shot) => preparedShots.find((item) => item.id === shot.id) || shot));
    await exportStoryboardPptx(preparedShots, storyboardRatio);
    setNotice("已导出 PPTX。");
  }

  async function analyzeAssetsWithAi() {
    if (!shots.length) return;
    const assetsForAi = syncCharacterAssetsWithRoles(assets, characterRoles);
    const unlockedCount = assetsForAi.filter((asset) => !asset.isLocked).length;
    if (!unlockedCount) {
      setNotice("所有核心要求都已锁定，没有可更新的条目。");
      return;
    }

    setAiBusy(true);
    setNotice("AI 正在分析全部镜头，整理场景 / 人物 / 道具核心要求");
    try {
      const response = await fetch("/api/analyze-assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shots: shots.map((shot) => ({
            originalShotNo: shot.originalShotNo,
            scene: shot.scene || "",
            characters: normalizeCharactersForRoles(shot.characters || "", characterRoles),
            rawCharacters: shot.characters || "",
            propsText: shot.propsText || "",
            shotSize: shot.shotSize || "",
            scriptText: shot.scriptText || "",
            dialogue: shot.dialogue || shot.copy || "",
            cameraMove: shot.cameraMove || "",
            notes: shot.notes || "",
          })),
          assets: assetsForAi,
          characterRoles,
        }),
      });

      if (!response.ok) {
        const message = response.status === 503 ? "缺少 OpenAI API Key，无法进行 AI 分析。" : "AI 分析失败，请稍后重试。";
        throw new Error(message);
      }

      const result = (await response.json()) as { assets: Array<{ type: AssetType; name: string; coreRequirements: string; imagePrompt?: string }> };
      const analyzed = new Map(result.assets.map((asset) => [assetKey(asset.type, asset.name), asset.coreRequirements]));
      let updatedCount = 0;
      const nextAssets = syncCharacterAssetsWithRoles(assets, characterRoles).map((asset) => {
          if (asset.isLocked) return asset;
          const nextRequirements = analyzed.get(assetKey(asset.type, asset.name));
          if (!nextRequirements) return asset;
          updatedCount += 1;
          const templatePrompt = generateTemplatePrompt(asset.type, asset.name, nextRequirements);
          return {
            ...asset,
            coreRequirements: nextRequirements,
            templatePrompt,
            activePromptMode: asset.activePromptMode || "template",
          };
        });
      setAssets(nextAssets);
      setNotice(
        updatedCount
          ? `AI 已更新 ${updatedCount} 个未锁定核心要求`
          : "AI 返回了结果，但没有匹配到当前条目。请检查条目名称是否为空，或重新导入后再试。",
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "AI 分析失败，请稍后重试。");
    } finally {
      setAiBusy(false);
    }
  }

  async function optimizeAssetPromptWithAi(asset: Asset) {
    if (!asset.coreRequirements.trim()) {
      setNotice("请先填写核心要求，再优化生图词。");
      return;
    }
    setOptimizingPromptId(asset.id);
    setNotice(asset.type === "scene" ? `正在调用场景生图提示词 skill，根据“${asset.name}”的核心词生成提示词。` : `AI 正在根据“${asset.name}”的核心要求生成生图词，不会重新分析脚本。`);
    try {
      const rulePrompt = getAssetTemplatePrompt(asset);
      console.log("当前生成模式:", "ai");
      console.log("AI 输入核心词:", asset.coreRequirements);
      console.log("模板生成结果:", rulePrompt);
      const result = await generateAIPrompt(asset, rulePrompt);
      const nextPrompt = (result.imagePrompt || "").trim();
      if (!nextPrompt) throw new Error("AI 返回为空");
      console.log("AI 原始返回:", result);
      console.log("最终显示结果:", nextPrompt);
      updateAsset(asset.id, {
        aiPrompt: nextPrompt,
        activePromptMode: "ai",
      });
      const sourceTip = result.source === "local"
        ? "未检测到可用 AI Key，已先用本地智能改写生成。"
        : asset.type === "scene"
          ? `已通过场景生图提示词 skill 生成“${asset.name}”的生图词。`
          : `已根据“${asset.name}”的核心要求生成 AI 生图词。`;
      setNotice(sourceTip);
    } catch (error) {
      console.log("AI 原始返回:", error);
      console.log("最终显示结果:", getAssetTemplatePrompt(asset));
      setNotice("AI 生成失败，已保留模板提示词，请检查 API Key、接口地址或网络。");
    } finally {
      setOptimizingPromptId(null);
    }
  }

  async function generateAIPrompt(asset: Asset, templatePrompt: string) {
    const response = await fetch("/api/optimize-image-prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: asset.type,
        name: asset.name,
        coreRequirements: asset.coreRequirements,
        currentPrompt: getActiveAssetPrompt(asset),
        rulePrompt: templatePrompt,
      }),
    });
    if (!response.ok) {
      throw new Error("AI 生成失败");
    }
    return (await response.json()) as { imagePrompt: string; source?: "ai" | "local" };
  }

  function applyCharacterRolesToShots() {
    if (!characterRoles.length) {
      setNotice("请先在人物区建立标准角色表。");
      return;
    }
    setShots((current) => {
      const next = current.map((shot) => ({
        ...shot,
        characters: normalizeCharactersForRoles(shot.characters || "", characterRoles),
      }));
      setAssets((currentAssets) => syncCharacterAssetsWithRoles(deriveAssets(next, currentAssets), characterRoles));
      return next;
    });
    setNotice("已按标准角色表归一镜头人物。");
  }

  function selectShot(id: string) {
    setActiveId(id);
    setSelectedImageShotId(null);
  }

  function collectCurrentProjectState(id = projectId, projectShots = shots): ProjectState {
    const now = new Date().toISOString();
    return {
      id,
      name: projectName || "未命名项目",
      shots: projectShots,
      assets,
      characterRoles,
      activeShotId: activeId,
      selectedShotIds: selectedIds,
      viewMode,
      assetTab,
      storyboardRatio,
      selectedImageShotId,
      editorState: {
        scrollTop: typeof window === "undefined" ? 0 : window.scrollY,
        currentStep: shots.length ? "editing" : "empty",
      },
      createdAt: createdAt || now,
      updatedAt: now,
      version: 1,
    };
  }

  function restoreProjectState(project: ProjectState) {
    const restoredShots = (project.shots || []).map(sanitizeShotScene);
    setProjectId(project.id);
    setCreatedAt(project.createdAt || new Date().toISOString());
    setLastSavedAt(project.updatedAt || "");
    setProjectName(project.name || "未命名项目");
    setShots(restoredShots);
    setAssets(project.assets?.length ? project.assets : deriveAssets(restoredShots, []));
    setCharacterRoles(project.characterRoles?.length ? project.characterRoles : deriveCharacterRoles(restoredShots, []));
    setActiveId(project.activeShotId || restoredShots[0]?.id || null);
    setSelectedIds(project.selectedShotIds || []);
    setViewMode(project.viewMode || "original");
    setAssetTab(project.assetTab || "scene");
    setStoryboardRatio(project.storyboardRatio || "16:9");
    setSelectedImageShotId(project.selectedImageShotId || null);
    setIsDirty(false);
  }

  async function saveCurrentProject() {
    if (!projectId) return;
    savingRef.current = true;
    try {
      const preparedShots = await shotsWithAnnotatedImages(shots);
      setShots(preparedShots);
      const projectState = collectCurrentProjectState(projectId, preparedShots);
      await saveProjectToIndexedDB(projectState);
      localStorage.setItem(currentProjectKey, projectState.id);
      setLastSavedAt(projectState.updatedAt);
      setIsDirty(false);
      setNotice("已保存当前项目和页面进度。");
    } catch (error) {
      console.error("保存项目失败：", error);
      setNotice("保存失败，请重试。");
    } finally {
      savingRef.current = false;
    }
  }

  async function handleCreateNewProject() {
    if (isDirty && !window.confirm("当前项目尚未保存，是否继续新建？")) return;
    const nextProjectId = createProjectId();
    const newProject = createEmptyProjectState(nextProjectId);
    await saveProjectToIndexedDB(newProject).catch(() => undefined);
    const url = new URL(window.location.href);
    url.searchParams.set("projectId", nextProjectId);
    window.open(url.toString(), "_blank");
  }

  return (
    <main className="min-h-screen bg-[#f6f3ed] text-[#202124]">
      <header className="sticky top-0 z-30 border-b border-[#d7d1c7] bg-[#fbfaf7] px-5 py-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-[260px]">
            <input
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              className="w-full bg-transparent text-xl font-semibold outline-none"
            />
            <p className="mt-1 text-xs text-[#667085]">{notice}</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <FileButton busy={busy} onFile={handleFile} />
            <ToolbarButton onClick={() => void handleCreateNewProject()}>新建项目</ToolbarButton>
            {shots.length ? (
              <>
                <IconButton onClick={() => void saveCurrentProject()} icon={<Save className="h-4 w-4" />} label={isDirty ? "保存 *" : lastSavedAt ? "已保存" : "保存"} />
                <div className="relative">
                  <IconButton onClick={() => setExportMenuOpen((open) => !open)} icon={<Download className="h-4 w-4" />} label="导出" />
                  {exportMenuOpen ? (
                    <div className="absolute right-0 top-full z-40 mt-2 grid min-w-36 border border-[#d7d1c7] bg-white py-1 text-sm shadow-lg">
                      <button className="px-3 py-2 text-left hover:bg-[#f6f3ed]" onClick={() => { setExportMenuOpen(false); void previewXlsx(); }}>预览 XLSX</button>
                      <button className="px-3 py-2 text-left hover:bg-[#f6f3ed]" onClick={() => { setExportMenuOpen(false); void exportXlsxDirect(); }}>导出 XLSX</button>
                      <button className="px-3 py-2 text-left hover:bg-[#f6f3ed]" onClick={() => { setExportMenuOpen(false); void previewPptx(); }}>预览 PPTX</button>
                      <button className="px-3 py-2 text-left hover:bg-[#f6f3ed]" onClick={() => { setExportMenuOpen(false); void exportPptxDirect(); }}>导出 PPTX</button>
                    </div>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
        </div>
        {shots.length ? (
          <div className="mt-3 flex flex-wrap gap-4 text-xs text-[#667085]">
            <span>{isDirty ? "未保存" : lastSavedAt ? `已保存 ${formatSaveTime(lastSavedAt)}` : "未保存"}</span>
            <span>镜头 {shots.length}</span>
            <span>已回填 {shots.filter((shot) => shot.imageUrl).length}</span>
            <span>已选择 {selectedIds.length}</span>
            <span>场景 {assets.filter((asset) => asset.type === "scene").length}</span>
            <span>人物 {assets.filter((asset) => asset.type === "character").length}</span>
            <span>道具 {assets.filter((asset) => asset.type === "prop").length}</span>
          </div>
        ) : null}
      </header>

      {!shots.length ? (
        <section className="mx-auto grid max-w-3xl gap-5 px-6 py-14">
          <div
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const file = Array.from(event.dataTransfer.files).find((item) => canParseTableFile(item));
              if (file) void handleFile(file);
              else setNotice("请拖入 xlsx 或 csv 格式的脚本表格。");
            }}
            className="border border-dashed border-[#b7aea0] bg-white p-10 text-center"
          >
            <Upload className="mx-auto h-10 w-10 text-[#0f766e]" />
            <h1 className="mt-4 text-2xl font-semibold">导入脚本表格</h1>
            <p className="mt-2 text-sm text-[#667085]">支持 xlsx / csv。可点击导入，也可把文件拖到这里。</p>
            <div className="mt-6"><FileButton busy={busy} onFile={handleFile} large /></div>
          </div>
        </section>
      ) : (
        <div className="grid h-[calc(100vh-96px)] grid-cols-[320px_minmax(420px,1fr)_360px]">
          <aside className="storyboard-scrollbar overflow-y-auto border-r border-[#d7d1c7] bg-[#eee9df] p-3">
            <button onClick={() => addShot(activeShot?.id)} className="mb-3 flex w-full items-center justify-center gap-2 border border-[#0f766e] bg-white px-3 py-2 text-sm font-semibold text-[#0f766e] hover:bg-[#eef7f6]">
              <Plus className="h-4 w-4" /> 新增镜头
            </button>
            <div className="mb-3 border border-[#d7d1c7] bg-white p-2">
              <p className="mb-2 text-xs font-semibold text-[#667085]">查看方式</p>
              <div className="grid grid-cols-2 gap-1">
                <button className={`px-2 py-1.5 text-xs font-semibold ${viewMode === "original" ? "bg-[#202124] text-white" : "bg-[#f6f3ed]"}`} onClick={() => setViewMode("original")}>原始顺序</button>
                <button className={`px-2 py-1.5 text-xs font-semibold ${viewMode === "scene" ? "bg-[#202124] text-white" : "bg-[#f6f3ed]"}`} onClick={() => setViewMode("scene")}>按场景分组</button>
              </div>
            </div>
            {viewMode === "scene" ? (
              <SceneList
                groups={sceneGroups}
                activeId={activeShot?.id || null}
                selectedIds={selectedIds}
                onSelect={selectShot}
                onToggleSelect={(id) => toggleSelected(id, setSelectedIds)}
                onBoxSelect={setSelectedIds}
                onReorder={reorderShot}
                onBatchUpload={(batchShots, files) => void fillBatchImages(batchShots, files, "batch_upload")}
              />
            ) : (
              <ShotList
                shots={orderedShots}
                activeId={activeShot?.id || null}
                selectedIds={selectedIds}
                onSelect={selectShot}
                onToggleSelect={(id) => toggleSelected(id, setSelectedIds)}
                onBoxSelect={setSelectedIds}
                onReorder={reorderShot}
                onDelete={deleteShot}
              />
            )}
          </aside>

          <section className="storyboard-scrollbar overflow-y-auto bg-[#f8f6f1] p-4">
            {activeShot ? (
              <ShotEditor
                shot={activeShot}
                assets={assets}
                currentBatch={currentBatch?.shots || []}
                selectedCount={selectedIds.length}
                imageSelected={selectedImageShotId === activeShot.id}
                onChange={(patch) => updateShot(activeShot.id, patch)}
                defaultCropRatio={storyboardRatio}
                storyboardRatio={storyboardRatio}
                onStoryboardRatio={setStoryboardRatio}
                onCopySingleScript={() => void copyScriptContent([activeShot], "单颗")}
                onCopySelectedScript={() => void copyScriptContent(selectedCopyShots, "选中")}
                onDelete={() => deleteShot(activeShot.id)}
                onSelectImage={() => setSelectedImageShotId(activeShot.id)}
                onImage={(file) => void fillShotImage(activeShot.id, file, "upload")}
                onDropImages={(files) => void fillBatchImages(currentBatch?.shots || [activeShot], files, "drag_drop")}
                onLibTvGrid={(file) => void openLibTvGridCrop(file)}
                hasAnyAnnotations={shots.some((shot) => (shot.annotations || []).length > 0)}
                onClearAllAnnotations={() => setShots((current) => current.map((shot) => ({ ...shot, annotations: [], annotatedImage: "" })))}
              />
            ) : null}
          </section>

          <aside className="storyboard-scrollbar overflow-y-auto border-l border-[#d7d1c7] bg-white p-4">
            <AssetPanel
              assets={assets}
              tab={assetTab}
              onTab={setAssetTab}
              onChange={updateAsset}
              onAdd={addAsset}
              onCopy={(text) => void copyText(text).then((ok) => setNotice(ok ? "核心要求已复制" : "复制失败，请手动选择文本"))}
              onAnalyzeAi={() => void analyzeAssetsWithAi()}
              onGenerateTemplate={generateTemplatePromptForAsset}
              onOptimizePrompt={(asset) => void optimizeAssetPromptWithAi(asset)}
              aiBusy={aiBusy}
              optimizingPromptId={optimizingPromptId}
              characterRoles={characterRoles}
              onCharacterRolesChange={setCharacterRoles}
              onApplyCharacterRoles={applyCharacterRolesToShots}
              onRebuildCharacterRoles={() => {
                setCharacterRoles(deriveCharacterRoles(shots, characterRoles));
                setNotice("已根据当前镜头人物重建标准角色表，已保留同名角色的别名。");
              }}
            />
          </aside>

        </div>
      )}
      {pptxPreviewShots ? (
        <PptxPreviewModal
          shots={pptxPreviewShots}
          ratio={storyboardRatio}
          onRatio={setStoryboardRatio}
          onChange={(index, patch) => setPptxPreviewShots((current) => current?.map((shot, itemIndex) => (itemIndex === index ? { ...shot, ...patch } : shot)) ?? null)}
          onClose={() => setPptxPreviewShots(null)}
          onExport={() => exportPptx(pptxPreviewShots)}
        />
      ) : null}
      {xlsxPreviewRows ? (
        <XlsxPreviewModal
          rows={xlsxPreviewRows}
          onChange={(rowIndex, key, value) => setXlsxPreviewRows((current) => current?.map((row, index) => (index === rowIndex ? { ...row, [key]: value } : row)) ?? null)}
          onClose={() => setXlsxPreviewRows(null)}
          onExport={() => void exportXlsx(xlsxPreviewRows)}
        />
      ) : null}
      {libTvGrid ? (
        <LibTvGridCropModal
          state={libTvGrid}
          onChange={setLibTvGrid}
          onClose={() => setLibTvGrid(null)}
          onConfirm={() => void confirmLibTvGridCrop(libTvGrid)}
        />
      ) : null}
    </main>
  );
}

function ShotEditor({
  shot,
  currentBatch,
  selectedCount,
  imageSelected,
  onChange,
  defaultCropRatio,
  storyboardRatio,
  onStoryboardRatio,
  onCopySingleScript,
  onCopySelectedScript,
  onDelete,
  onSelectImage,
  onImage,
  onDropImages,
  onLibTvGrid,
  hasAnyAnnotations,
  onClearAllAnnotations,
}: {
  shot: WorkShot;
  assets: Asset[];
  currentBatch: WorkShot[];
  selectedCount: number;
  imageSelected: boolean;
  onChange: (patch: Partial<WorkShot>) => void;
  defaultCropRatio: string;
  storyboardRatio: string;
  onStoryboardRatio: (ratio: string) => void;
  onCopySingleScript: () => void;
  onCopySelectedScript: () => void;
  onDelete: () => void;
  onSelectImage: () => void;
  onImage: (file: File) => void;
  onDropImages: (files: File[]) => void;
  onLibTvGrid: (file: File) => void;
  hasAnyAnnotations: boolean;
  onClearAllAnnotations: () => void;
}) {
  const disabled = shot.isLocked;
  const imageBoxRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const cropDragRef = useRef<{ handle: CropHandle; startX: number; startY: number; startRect: CropRect } | null>(null);
  const annotationDragRef = useRef<
    | { mode: "move"; id: string; startX: number; startY: number; startAnnotation: ImageAnnotation }
    | { mode: "resize-rect"; id: string; startX: number; startY: number; startAnnotation: Extract<ImageAnnotation, { type: "rect" }> }
    | { mode: "arrow-start" | "arrow-end"; id: string; startX: number; startY: number; startAnnotation: Extract<ImageAnnotation, { type: "arrow" }> }
    | null
  >(null);
  const [isCropping, setIsCropping] = useState(false);
  const [cropRect, setCropRect] = useState<CropRect | null>(null);
  const [cropRatio, setCropRatio] = useState(defaultCropRatio);
  const [annotationTool, setAnnotationTool] = useState<AnnotationTool>("select");
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [imageDisplaySize, setImageDisplaySize] = useState({ width: 1, height: 1 });
  const [annotationFontSize, setAnnotationFontSize] = useState(24);
  const [annotationMoreOpen, setAnnotationMoreOpen] = useState(false);
  const annotations = shot.annotations || [];
  const selectedAnnotation = annotations.find((annotation) => annotation.id === selectedAnnotationId) || null;
  const canUseAnnotations = Boolean(shot.imageUrl) && !isCropping;
  const canEditFontSize = canUseAnnotations && (annotationTool === "text" || selectedAnnotation?.type === "text");

  useEffect(() => {
    if (!shot.imageUrl) {
      setIsCropping(false);
      setCropRect(null);
    }
  }, [shot.imageUrl]);

  useEffect(() => {
    if (!isCropping) setCropRatio(defaultCropRatio);
  }, [defaultCropRatio, isCropping]);

  useEffect(() => {
    if (!shot.imageUrl) {
      setSelectedAnnotationId(null);
      setAnnotationTool("select");
    }
  }, [shot.imageUrl]);

  useEffect(() => {
    function updateImageDisplaySize() {
      const image = imageRef.current;
      if (image) setImageDisplaySize({ width: image.clientWidth || 1, height: image.clientHeight || 1 });
    }
    updateImageDisplaySize();
    window.addEventListener("resize", updateImageDisplaySize);
    return () => window.removeEventListener("resize", updateImageDisplaySize);
  }, [shot.imageUrl]);

  useEffect(() => {
    if (!isCropping) return;
    function handlePointerMove(event: PointerEvent) {
      const drag = cropDragRef.current;
      const image = imageRef.current;
      if (!drag || !image) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      setCropRect(clampCropRect(resizeCropRect(drag.startRect, drag.handle, dx, dy, cropRatioValue(cropRatio)), image.clientWidth, image.clientHeight, cropRatioValue(cropRatio)));
    }
    function handlePointerUp() {
      cropDragRef.current = null;
    }
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [cropRatio, isCropping]);

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const drag = annotationDragRef.current;
      const image = imageRef.current;
      if (!drag || !image) return;
      const dx = (event.clientX - drag.startX) / image.clientWidth;
      const dy = (event.clientY - drag.startY) / image.clientHeight;
      if (drag.mode === "move") {
        updateAnnotation(drag.id, moveAnnotation(drag.startAnnotation, dx, dy));
      } else if (drag.mode === "resize-rect") {
        updateAnnotation(drag.id, clampAnnotationRect({ ...drag.startAnnotation, width: drag.startAnnotation.width + dx, height: drag.startAnnotation.height + dy }));
      } else if (drag.mode === "arrow-start") {
        updateAnnotation(drag.id, clampArrow({ ...drag.startAnnotation, startX: drag.startAnnotation.startX + dx, startY: drag.startAnnotation.startY + dy }));
      } else if (drag.mode === "arrow-end") {
        updateAnnotation(drag.id, clampArrow({ ...drag.startAnnotation, endX: drag.startAnnotation.endX + dx, endY: drag.startAnnotation.endY + dy }));
      }
    }
    function handlePointerUp() {
      annotationDragRef.current = null;
    }
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  });

  useEffect(() => {
    function handleAnnotationDelete(event: KeyboardEvent) {
      if (!selectedAnnotationId || isTypingTarget(document.activeElement)) return;
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setAnnotations(annotations.filter((annotation) => annotation.id !== selectedAnnotationId));
      setSelectedAnnotationId(null);
    }
    window.addEventListener("keydown", handleAnnotationDelete, true);
    return () => window.removeEventListener("keydown", handleAnnotationDelete, true);
  }, [annotations, selectedAnnotationId]);

  function enterCropMode() {
    const image = imageRef.current;
    if (!shot.imageUrl || !image?.complete || !image.naturalWidth) return;
    const initialRatio = cropRatio || defaultCropRatio;
    setCropRatio(initialRatio);
    setCropRect(centeredCropRect(image.clientWidth, image.clientHeight, cropRatioValue(initialRatio)));
    setIsCropping(true);
    onSelectImage();
  }

  function changeCropRatio(nextRatio: string) {
    setCropRatio(nextRatio);
    const image = imageRef.current;
    if (!image || !isCropping) return;
    setCropRect((current) => {
      const ratio = cropRatioValue(nextRatio);
      if (!current) return centeredCropRect(image.clientWidth, image.clientHeight, ratio);
      return clampCropRect(resizeCropToRatio(current, ratio), image.clientWidth, image.clientHeight, ratio);
    });
  }

  function startCropDrag(event: ReactPointerEvent, handle: CropHandle) {
    if (!cropRect) return;
    event.preventDefault();
    event.stopPropagation();
    cropDragRef.current = { handle, startX: event.clientX, startY: event.clientY, startRect: cropRect };
  }

  async function confirmCrop() {
    const image = imageRef.current;
    if (!image || !cropRect || !image.naturalWidth || !image.naturalHeight || !image.clientWidth || !image.clientHeight) return;
    const scaleX = image.naturalWidth / image.clientWidth;
    const scaleY = image.naturalHeight / image.clientHeight;
    const sourceX = Math.round(cropRect.x * scaleX);
    const sourceY = Math.round(cropRect.y * scaleY);
    const sourceWidth = Math.round(cropRect.width * scaleX);
    const sourceHeight = Math.round(cropRect.height * scaleY);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, sourceWidth);
    canvas.height = Math.max(1, sourceHeight);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
    onChange({ imageUrl: canvas.toDataURL("image/png"), annotations: [], annotatedImage: "", status: "image_filled" });
    setIsCropping(false);
    setCropRect(null);
  }

  function setAnnotations(nextAnnotations: ImageAnnotation[]) {
    onChange({ annotations: nextAnnotations, annotatedImage: "" });
  }

  function updateAnnotation(id: string, nextAnnotation: ImageAnnotation) {
    setAnnotations(annotations.map((annotation) => (annotation.id === id ? nextAnnotation : annotation)));
  }

  function imagePoint(event: ReactPointerEvent) {
    const image = imageRef.current;
    if (!image) return null;
    const rect = image.getBoundingClientRect();
    return {
      x: clamp01((event.clientX - rect.left) / rect.width),
      y: clamp01((event.clientY - rect.top) / rect.height),
    };
  }

  function handleAnnotationLayerPointerDown(event: ReactPointerEvent) {
    if (!shot.imageUrl || isCropping) return;
    const point = imagePoint(event);
    if (!point) return;
    onSelectImage();
    if (annotationTool === "select") {
      setSelectedAnnotationId(null);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (annotationTool === "text") {
      const annotation: ImageAnnotation = {
        id: crypto.randomUUID(),
        type: "text",
        x: point.x,
        y: point.y,
        width: 0.22,
        height: 0.08,
        text: "请输入文字",
        fontSize: annotationFontSize / 1000,
        color: "#ef4444",
      };
      setAnnotations([...annotations, annotation]);
      setSelectedAnnotationId(annotation.id);
      setAnnotationTool("select");
      return;
    }
    if (annotationTool === "arrow") {
      const annotation: ImageAnnotation = {
        id: crypto.randomUUID(),
        type: "arrow",
        x: point.x,
        y: point.y,
        width: 0,
        height: 0,
        startX: point.x,
        startY: point.y,
        endX: clamp01(point.x + 0.18),
        endY: point.y,
        color: "#ef4444",
        strokeWidth: 4,
      };
      setAnnotations([...annotations, annotation]);
      setSelectedAnnotationId(annotation.id);
      annotationDragRef.current = { mode: "arrow-end", id: annotation.id, startX: event.clientX, startY: event.clientY, startAnnotation: annotation };
      setAnnotationTool("select");
      return;
    }
    if (annotationTool === "rect") {
      const annotation: ImageAnnotation = {
        id: crypto.randomUUID(),
        type: "rect",
        x: point.x,
        y: point.y,
        width: 0.16,
        height: 0.12,
        color: "#ef4444",
        strokeWidth: 4,
      };
      setAnnotations([...annotations, annotation]);
      setSelectedAnnotationId(annotation.id);
      annotationDragRef.current = { mode: "resize-rect", id: annotation.id, startX: event.clientX, startY: event.clientY, startAnnotation: annotation };
      setAnnotationTool("select");
    }
  }

  function startAnnotationMove(event: ReactPointerEvent, annotation: ImageAnnotation) {
    if (annotationTool !== "select") return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedAnnotationId(annotation.id);
    annotationDragRef.current = { mode: "move", id: annotation.id, startX: event.clientX, startY: event.clientY, startAnnotation: annotation };
  }

  function editTextAnnotation(annotation: Extract<ImageAnnotation, { type: "text" }>) {
    const nextText = window.prompt("修改标注文字", annotation.text);
    if (nextText === null) return;
    updateAnnotation(annotation.id, { ...annotation, text: nextText || "请输入文字" });
  }

  function changeSelectedFontSize(nextSize: string) {
    const fontSize = Number(nextSize) || 24;
    setAnnotationFontSize(fontSize);
    if (!selectedAnnotation || selectedAnnotation.type !== "text") return;
    updateAnnotation(selectedAnnotation.id, { ...selectedAnnotation, fontSize: fontSize / 1000 });
  }

  function clearCurrentAnnotations() {
    if (!annotations.length) return;
    if (!window.confirm("确定清空当前镜头的所有标注吗？")) return;
    setAnnotations([]);
    setSelectedAnnotationId(null);
    setAnnotationMoreOpen(false);
  }

  function clearAllAnnotations() {
    if (!hasAnyAnnotations) return;
    if (!window.confirm("确定清空全部镜头的所有标注吗？此操作不可恢复。")) return;
    onClearAllAnnotations();
    setSelectedAnnotationId(null);
    setAnnotationMoreOpen(false);
  }

  function restoreDefaultAnnotationFontSize() {
    setAnnotationFontSize(24);
    if (selectedAnnotation?.type === "text") updateAnnotation(selectedAnnotation.id, { ...selectedAnnotation, fontSize: 0.024 });
    setAnnotationMoreOpen(false);
  }

  return (
    <div className="grid gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-[#0f766e]">当前镜头</p>
          <h2 className="text-2xl font-semibold">镜头 {shot.originalShotNo}</h2>
          <p className="mt-1 text-xs text-[#667085]">原始顺序 {shot.originalIndex} · {statusLabels[shot.status]}</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <label className="inline-flex items-center gap-2 border border-[#d7d1c7] bg-white px-3 py-2 text-sm font-semibold">
            镜头比例
            <select value={storyboardRatio} onChange={(event) => onStoryboardRatio(event.target.value)} className="bg-white text-sm outline-none">
              <option value="16:9">16:9</option>
              <option value="9:16">9:16</option>
              <option value="1:1">1:1</option>
              <option value="4:3">4:3</option>
              <option value="3:4">3:4</option>
              <option value="2.39:1">2.39:1</option>
            </select>
          </label>
          <IconButton onClick={() => onChange({ isLocked: !shot.isLocked })} icon={shot.isLocked ? <Lock className="h-4 w-4" /> : <LockOpen className="h-4 w-4" />} label={shot.isLocked ? "解锁" : "锁定"} />
          <IconButton onClick={onDelete} icon={<Trash2 className="h-4 w-4" />} label="删除" />
        </div>
      </div>

      {shot.imageUrl ? (
        <div className={`flex items-center gap-1 border border-[#d7d1c7] bg-[#fbfaf7] px-2 py-1.5 ${canUseAnnotations ? "" : "opacity-55"}`}>
          <span className="mr-1 whitespace-nowrap text-xs font-semibold text-[#667085]">标注工具</span>
          <AnnotationToolButton disabled={!canUseAnnotations} active={annotationTool === "select"} onClick={() => setAnnotationTool("select")} label="选择" />
          <AnnotationToolButton disabled={!canUseAnnotations} active={annotationTool === "text"} onClick={() => setAnnotationTool("text")} label="文字" />
          <AnnotationToolButton disabled={!canUseAnnotations} active={annotationTool === "arrow"} onClick={() => setAnnotationTool("arrow")} label="箭头" />
          <AnnotationToolButton disabled={!canUseAnnotations} active={annotationTool === "rect"} onClick={() => setAnnotationTool("rect")} label="方框" />
          <label className="ml-1 inline-flex h-8 items-center gap-1 border border-[#d7d1c7] bg-white px-2 text-xs font-semibold">
            字号
            <select disabled={!canEditFontSize} value={selectedAnnotation?.type === "text" ? Math.round(selectedAnnotation.fontSize * 1000) : annotationFontSize} onChange={(event) => changeSelectedFontSize(event.target.value)} className="bg-white outline-none disabled:opacity-50">
              <option value="24">24</option>
              <option value="32">32</option>
              <option value="40">40</option>
              <option value="52">52</option>
              <option value="64">64</option>
            </select>
          </label>
          <div className="relative ml-auto">
            <AnnotationToolButton disabled={!canUseAnnotations} active={annotationMoreOpen} onClick={() => setAnnotationMoreOpen((open) => !open)} label="更多" />
            {annotationMoreOpen ? (
              <div className="absolute right-0 top-full z-30 mt-1 grid min-w-44 border border-[#d7d1c7] bg-white py-1 text-xs shadow-lg">
                <button disabled={!annotations.length} className="px-3 py-2 text-left hover:bg-[#f6f3ed] disabled:opacity-40" onClick={clearCurrentAnnotations}>清空当前镜头标注</button>
                <button disabled={!hasAnyAnnotations} className="px-3 py-2 text-left hover:bg-[#f6f3ed] disabled:opacity-40" onClick={clearAllAnnotations}>清空全部镜头标注</button>
                <button className="px-3 py-2 text-left hover:bg-[#f6f3ed]" onClick={restoreDefaultAnnotationFontSize}>恢复默认字号</button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div
        role="button"
        tabIndex={0}
        onClick={onSelectImage}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const files = Array.from(event.dataTransfer.files).filter((file) => file.type.startsWith("image/"));
          if (files.length === 1) onImage(files[0]);
          if (files.length > 1) onDropImages(files);
        }}
        className={`grid min-h-[240px] place-items-center border border-dashed bg-white p-2 outline-none transition ${imageSelected ? "border-[#0f766e] ring-2 ring-[#0f766e]" : "border-[#b7aea0]"}`}
      >
        {shot.imageUrl ? (
          <div ref={imageBoxRef} className="relative inline-block max-h-[420px] max-w-full">
            <div className="absolute right-2 top-2 z-20 flex flex-wrap gap-1 bg-white/90 p-1 shadow">
              <IconButton disabled={isCropping} onClick={enterCropMode} icon={<Crop className="h-4 w-4" />} label="裁剪" />
              <IconButton onClick={() => onChange({ imageLocked: !shot.imageLocked })} icon={shot.imageLocked ? <Lock className="h-4 w-4" /> : <LockOpen className="h-4 w-4" />} label={shot.imageLocked ? "已锁" : "锁图"} />
              <label className="inline-flex cursor-pointer items-center gap-2 border border-[#d7d1c7] bg-white px-3 py-2 text-sm font-semibold hover:border-[#0f766e]">
                <ImagePlus className="h-4 w-4" /> 替换
                <input type="file" accept="image/*" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) onImage(file); event.currentTarget.value = ""; }} />
              </label>
              <IconButton disabled={shot.imageLocked} onClick={() => onChange({ imageUrl: "", annotations: [], annotatedImage: "", status: "draft" })} icon={<Trash2 className="h-4 w-4" />} label="删图" />
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img ref={imageRef} src={shot.imageUrl} alt="分镜图片" className="block max-h-[420px] max-w-full object-contain" onLoad={(event) => setImageDisplaySize({ width: event.currentTarget.clientWidth || 1, height: event.currentTarget.clientHeight || 1 })} />
            {!isCropping ? (
              <AnnotationOverlay
                annotations={annotations}
                selectedId={selectedAnnotationId}
                imageWidth={imageDisplaySize.width}
                imageHeight={imageDisplaySize.height}
                onLayerPointerDown={handleAnnotationLayerPointerDown}
                onMoveStart={startAnnotationMove}
                onEditText={editTextAnnotation}
                onRectResizeStart={(event, annotation) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setSelectedAnnotationId(annotation.id);
                  annotationDragRef.current = { mode: "resize-rect", id: annotation.id, startX: event.clientX, startY: event.clientY, startAnnotation: annotation };
                }}
                onArrowHandleStart={(event, annotation, handle) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setSelectedAnnotationId(annotation.id);
                  annotationDragRef.current = { mode: handle, id: annotation.id, startX: event.clientX, startY: event.clientY, startAnnotation: annotation };
                }}
              />
            ) : null}
            {isCropping && cropRect ? (
              <CropOverlay rect={cropRect} onDrag={startCropDrag} />
            ) : null}
          </div>
        ) : (
          <div className="p-8 text-center text-sm text-[#667085]">粘贴、拖拽或上传 LibTV 成图回填到当前镜头</div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <label className="inline-flex cursor-pointer items-center gap-2 border border-[#d7d1c7] bg-white px-3 py-2 text-sm font-semibold hover:border-[#0f766e]">
          <ImagePlus className="h-4 w-4" /> 上传图片
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(event) => {
              const files = Array.from(event.target.files || []);
              if (files.length === 1) onImage(files[0]);
              if (files.length > 1) onDropImages(files);
              event.currentTarget.value = "";
            }}
          />
        </label>
        <label className="inline-flex cursor-pointer items-center gap-2 border border-[#d7d1c7] bg-white px-3 py-2 text-sm font-semibold hover:border-[#0f766e]">
          <ImagePlus className="h-4 w-4" /> 九宫格裁切
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onLibTvGrid(file);
              event.currentTarget.value = "";
            }}
          />
        </label>
        {isCropping ? (
          <>
            <label className="inline-flex items-center gap-2 border border-[#d7d1c7] bg-white px-3 py-2 text-sm font-semibold">
              裁剪比例
              <select value={cropRatio} onChange={(event) => changeCropRatio(event.target.value)} className="bg-white outline-none">
                <option value="free">自由</option>
                <option value="16:9">16:9</option>
                <option value="9:16">9:16</option>
                <option value="1:1">1:1</option>
                <option value="4:3">4:3</option>
                <option value="3:4">3:4</option>
                <option value="2.39:1">2.39:1</option>
              </select>
            </label>
            <IconButton onClick={() => void confirmCrop()} icon={<Crop className="h-4 w-4" />} label="确认裁剪" strong />
            <ToolbarButton onClick={() => { setIsCropping(false); setCropRect(null); }}>取消</ToolbarButton>
          </>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Input label="原始镜号" value={shot.originalShotNo} disabled={disabled} onChange={(value) => onChange({ originalShotNo: value, shotLabel: value })} />
        <Input label="当前镜号" value={shot.currentShotNo} disabled={disabled} onChange={(value) => onChange({ currentShotNo: value })} />
        <Input label="场景" value={shot.scene || ""} disabled={disabled} onChange={(value) => onChange({ scene: value })} />
        <Input label="人物" value={shot.characters || ""} disabled={disabled} onChange={(value) => onChange({ characters: value })} />
        <Input label="核心道具" value={shot.propsText || ""} disabled={disabled} onChange={(value) => onChange({ propsText: value, product: value })} />
        <Input label="景别" value={shot.shotSize || ""} disabled={disabled} onChange={(value) => onChange({ shotSize: value })} />
        <Textarea className="col-span-2" label="画面内容" value={shot.scriptText || ""} disabled={disabled} rows={5} onChange={(value) => onChange({ scriptText: value })} />
        <Textarea label="台词 / 旁白 / 同期声" value={shot.dialogue || shot.copy || ""} disabled={disabled} rows={4} onChange={(value) => onChange({ dialogue: value, copy: value })} />
        <Textarea label="镜头运动" value={shot.cameraMove || ""} disabled={disabled} rows={4} onChange={(value) => onChange({ cameraMove: value })} />
        <Textarea className="col-span-2" label="备注" value={shot.notes || ""} disabled={disabled} rows={3} onChange={(value) => onChange({ notes: value })} />
      </div>
      <div className="flex flex-wrap gap-2">
        <IconButton onClick={onCopySingleScript} icon={<Clipboard className="h-4 w-4" />} label="复制单颗故事版脚本" />
        <IconButton onClick={onCopySelectedScript} icon={<Clipboard className="h-4 w-4" />} label={`复制选中镜头${selectedCount ? `(${selectedCount})` : ""}`} />
      </div>
    </div>
  );
}

function CropOverlay({ rect, onDrag }: { rect: CropRect; onDrag: (event: ReactPointerEvent, handle: CropHandle) => void }) {
  const handles: Array<{ key: CropHandle; className: string }> = [
    { key: "nw", className: "-left-1.5 -top-1.5 cursor-nwse-resize" },
    { key: "n", className: "left-1/2 -top-1.5 -translate-x-1/2 cursor-ns-resize" },
    { key: "ne", className: "-right-1.5 -top-1.5 cursor-nesw-resize" },
    { key: "e", className: "-right-1.5 top-1/2 -translate-y-1/2 cursor-ew-resize" },
    { key: "se", className: "-bottom-1.5 -right-1.5 cursor-nwse-resize" },
    { key: "s", className: "-bottom-1.5 left-1/2 -translate-x-1/2 cursor-ns-resize" },
    { key: "sw", className: "-bottom-1.5 -left-1.5 cursor-nesw-resize" },
    { key: "w", className: "-left-1.5 top-1/2 -translate-y-1/2 cursor-ew-resize" },
  ];
  const maskColor = "rgba(0,0,0,0.48)";
  return (
    <div className="absolute inset-0 z-10">
      <div className="absolute left-0 right-0 top-0" style={{ height: rect.y, background: maskColor }} />
      <div className="absolute left-0" style={{ top: rect.y, width: rect.x, height: rect.height, background: maskColor }} />
      <div className="absolute right-0" style={{ top: rect.y, left: rect.x + rect.width, height: rect.height, background: maskColor }} />
      <div className="absolute bottom-0 left-0 right-0" style={{ top: rect.y + rect.height, background: maskColor }} />
      <div
        className="absolute cursor-move border-2 border-white shadow-[0_0_0_1px_rgba(15,118,110,0.9)]"
        style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
        onPointerDown={(event) => onDrag(event, "move")}
      >
        <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
          {Array.from({ length: 9 }).map((_, index) => <div key={index} className="border border-white/40" />)}
        </div>
        {handles.map((handle) => (
          <button
            key={handle.key}
            type="button"
            className={`absolute h-3 w-3 border border-[#0f766e] bg-white ${handle.className}`}
            onPointerDown={(event) => onDrag(event, handle.key)}
            aria-label={`裁剪控制点 ${handle.key}`}
          />
        ))}
      </div>
    </div>
  );
}

function resizeCropRect(start: CropRect, handle: CropHandle, dx: number, dy: number, ratio?: number) {
  if (handle === "move") return { ...start, x: start.x + dx, y: start.y + dy };
  let { x, y, width, height } = start;
  if (handle.includes("w")) {
    x += dx;
    width -= dx;
  }
  if (handle.includes("e")) width += dx;
  if (handle.includes("n")) {
    y += dy;
    height -= dy;
  }
  if (handle.includes("s")) height += dy;
  if (ratio) {
    if (handle === "n" || handle === "s") {
      const nextWidth = height * ratio;
      x -= (nextWidth - width) / 2;
      width = nextWidth;
    } else {
      const nextHeight = width / ratio;
      y -= (nextHeight - height) / 2;
      height = nextHeight;
    }
  }
  return { x, y, width, height };
}

function clampCropRect(rect: CropRect, maxWidth: number, maxHeight: number, ratio?: number) {
  const minSize = 48;
  let width = Math.min(Math.max(rect.width, minSize), maxWidth);
  let height = Math.min(Math.max(rect.height, minSize), maxHeight);
  if (ratio) {
    const fitted = fitSizeToBounds(width, height, maxWidth, maxHeight, ratio);
    width = fitted.width;
    height = fitted.height;
  }
  let x = rect.x;
  let y = rect.y;
  x = Math.min(Math.max(0, x), Math.max(0, maxWidth - width));
  y = Math.min(Math.max(0, y), Math.max(0, maxHeight - height));
  if (x + width > maxWidth) width = maxWidth - x;
  if (y + height > maxHeight) height = maxHeight - y;
  return { x, y, width, height };
}

function cropRatioValue(value: string) {
  if (value === "free") return undefined;
  const [w, h] = value.split(":").map(Number);
  return w && h ? w / h : undefined;
}

function centeredCropRect(maxWidth: number, maxHeight: number, ratio?: number) {
  const fitted = fitSizeToBounds(maxWidth * 0.8, maxHeight * 0.8, maxWidth, maxHeight, ratio);
  return {
    x: (maxWidth - fitted.width) / 2,
    y: (maxHeight - fitted.height) / 2,
    width: fitted.width,
    height: fitted.height,
  };
}

function resizeCropToRatio(rect: CropRect, ratio?: number) {
  if (!ratio) return rect;
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  const fitted = fitSizeToBounds(rect.width, rect.height, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, ratio);
  return {
    x: centerX - fitted.width / 2,
    y: centerY - fitted.height / 2,
    width: fitted.width,
    height: fitted.height,
  };
}

function fitSizeToBounds(width: number, height: number, maxWidth: number, maxHeight: number, ratio?: number) {
  if (!ratio) return { width: Math.min(width, maxWidth), height: Math.min(height, maxHeight) };
  let nextWidth = width;
  let nextHeight = nextWidth / ratio;
  if (nextHeight > height) {
    nextHeight = height;
    nextWidth = nextHeight * ratio;
  }
  if (nextWidth > maxWidth) {
    nextWidth = maxWidth;
    nextHeight = nextWidth / ratio;
  }
  if (nextHeight > maxHeight) {
    nextHeight = maxHeight;
    nextWidth = nextHeight * ratio;
  }
  return { width: Math.max(48, nextWidth), height: Math.max(48, nextHeight) };
}

function PptxPreviewModal({ shots, ratio, onRatio, onChange, onClose, onExport }: { shots: WorkShot[]; ratio: string; onRatio: (ratio: string) => void; onChange: (index: number, patch: Partial<WorkShot>) => void; onClose: () => void; onExport: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 p-5">
      <div className="mx-auto flex h-full max-w-6xl flex-col border border-[#d7d1c7] bg-[#fbfaf7] shadow-xl">
        <div className="flex items-center justify-between border-b border-[#d7d1c7] px-4 py-3">
          <div>
            <h2 className="text-lg font-semibold">预览 PPTX</h2>
            <p className="text-xs text-[#667085]">每页最多 8 个镜头，可修改文字后导出。</p>
          </div>
          <div className="flex items-center gap-2">
            <label className="inline-flex items-center gap-2 text-sm font-semibold">
              图片比例
              <select value={ratio} onChange={(event) => onRatio(event.target.value)} className="border border-[#d7d1c7] bg-white px-2 py-1.5">
                <option value="16:9">16:9</option>
                <option value="9:16">9:16</option>
                <option value="1:1">1:1</option>
                <option value="4:3">4:3</option>
                <option value="3:4">3:4</option>
                <option value="2.39:1">2.39:1</option>
              </select>
            </label>
            <IconButton onClick={onExport} icon={<Download className="h-4 w-4" />} label="导出 PPTX" strong />
            <ToolbarButton onClick={onClose}>关闭</ToolbarButton>
          </div>
        </div>
        <div className="storyboard-scrollbar grid flex-1 gap-4 overflow-y-auto p-4">
          {shots.map((shot, index) => (
            <section key={shot.id || index} className="grid grid-cols-[220px_minmax(0,1fr)] gap-4 border border-[#d7d1c7] bg-white p-3">
              <div className="grid place-items-center border border-dashed border-[#b7aea0] bg-[#f8f6f1]">
                {shot.annotatedImage || shot.imageUrl ? <img src={shot.annotatedImage || shot.imageUrl} alt="" className="max-h-40 w-full object-contain" /> : <span className="text-xs text-[#667085]">第 {index + 1} 页图片占位</span>}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input label="镜号" value={shot.originalShotNo} onChange={(value) => onChange(index, { originalShotNo: value, shotLabel: value })} />
                <Input label="场景" value={shot.scene || ""} onChange={(value) => onChange(index, { scene: value })} />
                <Input label="人物" value={shot.characters || ""} onChange={(value) => onChange(index, { characters: value })} />
                <Input label="核心道具" value={shot.propsText || ""} onChange={(value) => onChange(index, { propsText: value, product: value })} />
                <Input label="景别" value={shot.shotSize || ""} onChange={(value) => onChange(index, { shotSize: value })} />
                <Input label="镜头运动" value={shot.cameraMove || ""} onChange={(value) => onChange(index, { cameraMove: value })} />
                <Textarea className="col-span-2" label="画面内容" value={shot.scriptText || ""} rows={3} onChange={(value) => onChange(index, { scriptText: value })} />
                <Textarea label="台词 / 旁白 / 同期声" value={shot.dialogue || shot.copy || ""} rows={2} onChange={(value) => onChange(index, { dialogue: value, copy: value })} />
                <Textarea label="备注" value={shot.notes || ""} rows={2} onChange={(value) => onChange(index, { notes: value })} />
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

function LibTvGridCropModal({ state, onChange, onClose, onConfirm }: { state: LibTvGridState; onChange: (state: LibTvGridState) => void; onClose: () => void; onConfirm: () => void }) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ handle: CropHandle; startX: number; startY: number; startFrame: GridCropFrame; scaleX: number; scaleY: number } | null>(null);

  useEffect(() => {
    function handleMove(event: PointerEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = (event.clientX - drag.startX) / drag.scaleX;
      const dy = (event.clientY - drag.startY) / drag.scaleY;
      const nextFrame = clampGridBox(resizeCropRect(drag.startFrame, drag.handle, dx, dy), state.width, state.height);
      onChange({ ...state, frame: { ...nextFrame, confidence: state.frame.confidence, source: "manual-adjust" } });
    }
    function handleUp() {
      dragRef.current = null;
    }
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [onChange, state]);

  function startDrag(event: ReactPointerEvent, handle: CropHandle) {
    const image = imageRef.current;
    if (!image) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = {
      handle,
      startX: event.clientX,
      startY: event.clientY,
      startFrame: state.frame,
      scaleX: image.clientWidth / state.width,
      scaleY: image.clientHeight / state.height,
    };
  }

  async function redetect() {
    const detected = await detectLibTvGridFrame(state.imageUrl, state.width, state.height);
    onChange({ ...state, frame: detected.frame, autoFrame: detected.frame, warning: detected.warning });
  }

  const handles: CropHandle[] = ["nw", "ne", "se", "sw"];
  const cells = Array.from({ length: 9 }, (_, index) => index + 1);
  return (
    <div className="fixed inset-0 z-50 bg-black/55 p-5">
      <div className="mx-auto flex h-full max-w-6xl flex-col border border-[#d7d1c7] bg-[#fbfaf7] shadow-xl">
        <div className="flex items-center justify-between border-b border-[#d7d1c7] px-4 py-3">
          <div>
            <h2 className="text-lg font-semibold">九宫格裁切</h2>
            <p className="text-xs text-[#667085]">{state.warning || `将按编号回填到 ${state.targetShotIds.length} 个镜头。`}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ToolbarButton onClick={redetect}>重新识别</ToolbarButton>
            <ToolbarButton onClick={() => onChange({ ...state, frame: state.autoFrame, warning: "" })}>重置识别结果</ToolbarButton>
            <ToolbarButton onClick={() => onChange({ ...state, frame: fallbackGridFrame(state.width, state.height), warning: "已重置为标准九宫格外框，请检查裁切范围。" })}>标准九宫格</ToolbarButton>
            <IconButton onClick={onConfirm} icon={<Crop className="h-4 w-4" />} label="确认裁切并回填" strong />
            <ToolbarButton onClick={onClose}>取消</ToolbarButton>
          </div>
        </div>
        <div className="storyboard-scrollbar flex-1 overflow-auto p-4">
          <div className="mx-auto w-fit">
            <div className="relative inline-block max-w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img ref={imageRef} src={state.imageUrl} alt="LibTV 九宫格" className="block max-h-[72vh] max-w-full object-contain" />
              <div
                className="absolute border-2 border-[#0f766e] bg-[#0f766e]/10 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]"
                style={{
                  left: `${(state.frame.x / state.width) * 100}%`,
                  top: `${(state.frame.y / state.height) * 100}%`,
                  width: `${(state.frame.width / state.width) * 100}%`,
                  height: `${(state.frame.height / state.height) * 100}%`,
                }}
                onPointerDown={(event) => startDrag(event, "move")}
              >
                <div className="grid h-full w-full grid-cols-3 grid-rows-3">
                  {cells.map((cell) => (
                    <div key={cell} className="relative border border-white/75">
                      <span className="absolute left-1 top-1 rounded-sm bg-[#0f766e] px-1.5 py-0.5 text-xs font-bold text-white">{cell}</span>
                    </div>
                  ))}
                </div>
                {handles.map((handle) => (
                  <button
                    key={handle}
                    type="button"
                    aria-label="调整九宫格整体裁切框"
                    onPointerDown={(event) => startDrag(event, handle)}
                    className={`absolute h-4 w-4 border border-[#0f766e] bg-white ${
                      handle === "nw" ? "-left-2 -top-2 cursor-nwse-resize" : handle === "ne" ? "-right-2 -top-2 cursor-nesw-resize" : handle === "se" ? "-bottom-2 -right-2 cursor-nwse-resize" : "-bottom-2 -left-2 cursor-nesw-resize"
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AnnotationOverlay({
  annotations,
  selectedId,
  imageWidth,
  imageHeight,
  onLayerPointerDown,
  onMoveStart,
  onEditText,
  onRectResizeStart,
  onArrowHandleStart,
}: {
  annotations: ImageAnnotation[];
  selectedId: string | null;
  imageWidth: number;
  imageHeight: number;
  onLayerPointerDown: (event: ReactPointerEvent) => void;
  onMoveStart: (event: ReactPointerEvent, annotation: ImageAnnotation) => void;
  onEditText: (annotation: Extract<ImageAnnotation, { type: "text" }>) => void;
  onRectResizeStart: (event: ReactPointerEvent, annotation: Extract<ImageAnnotation, { type: "rect" }>) => void;
  onArrowHandleStart: (event: ReactPointerEvent, annotation: Extract<ImageAnnotation, { type: "arrow" }>, handle: "arrow-start" | "arrow-end") => void;
}) {
  const selectedClass = "outline outline-2 outline-[#0f766e]";
  return (
    <div className="absolute inset-0 z-[5] cursor-crosshair" onPointerDown={onLayerPointerDown}>
      <svg className="absolute inset-0 h-full w-full overflow-visible">
        <defs>
          <marker id="annotation-arrow-head" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto" markerUnits="strokeWidth">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#ef4444" />
          </marker>
        </defs>
        {annotations.filter((annotation) => annotation.type === "rect").map((annotation) => {
          const rect = annotation as Extract<ImageAnnotation, { type: "rect" }>;
          const selected = selectedId === rect.id;
          return (
            <g key={rect.id} onPointerDown={(event) => onMoveStart(event, rect)} className="cursor-move">
              <rect
                x={rect.x * imageWidth}
                y={rect.y * imageHeight}
                width={rect.width * imageWidth}
                height={rect.height * imageHeight}
                fill="transparent"
                stroke={rect.color}
                strokeWidth={rect.strokeWidth}
                strokeDasharray={selected ? "6 4" : undefined}
              />
              {selected ? (
                <rect
                  x={(rect.x + rect.width) * imageWidth - 5}
                  y={(rect.y + rect.height) * imageHeight - 5}
                  width="10"
                  height="10"
                  fill="white"
                  stroke="#0f766e"
                  strokeWidth="2"
                  className="cursor-nwse-resize"
                  onPointerDown={(event) => onRectResizeStart(event, rect)}
                />
              ) : null}
            </g>
          );
        })}
        {annotations.filter((annotation) => annotation.type === "arrow").map((annotation) => {
          const arrow = annotation as Extract<ImageAnnotation, { type: "arrow" }>;
          const selected = selectedId === arrow.id;
          return (
            <g key={arrow.id} onPointerDown={(event) => onMoveStart(event, arrow)} className="cursor-move">
              <line
                x1={arrow.startX * imageWidth}
                y1={arrow.startY * imageHeight}
                x2={arrow.endX * imageWidth}
                y2={arrow.endY * imageHeight}
                stroke={arrow.color}
                strokeWidth={arrow.strokeWidth}
                strokeLinecap="round"
                markerEnd="url(#annotation-arrow-head)"
              />
              {selected ? (
                <>
                  <circle cx={arrow.startX * imageWidth} cy={arrow.startY * imageHeight} r="6" fill="white" stroke="#0f766e" strokeWidth="2" className="cursor-pointer" onPointerDown={(event) => onArrowHandleStart(event, arrow, "arrow-start")} />
                  <circle cx={arrow.endX * imageWidth} cy={arrow.endY * imageHeight} r="6" fill="white" stroke="#0f766e" strokeWidth="2" className="cursor-pointer" onPointerDown={(event) => onArrowHandleStart(event, arrow, "arrow-end")} />
                </>
              ) : null}
            </g>
          );
        })}
      </svg>
      {annotations.filter((annotation) => annotation.type === "text").map((annotation) => {
        const text = annotation as Extract<ImageAnnotation, { type: "text" }>;
        const selected = selectedId === text.id;
        return (
          <div
            key={text.id}
            className={`absolute cursor-move whitespace-pre-wrap break-words px-1 font-bold leading-tight ${selected ? selectedClass : ""}`}
            style={{
              left: text.x * imageWidth,
              top: text.y * imageHeight,
              width: text.width * imageWidth,
              minHeight: text.height * imageHeight,
              color: text.color,
              fontSize: Math.max(10, text.fontSize * imageWidth),
              textShadow: "0 1px 2px rgba(255,255,255,0.9)",
            }}
            onPointerDown={(event) => onMoveStart(event, text)}
            onDoubleClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onEditText(text);
            }}
          >
            {text.text || "请输入文字"}
          </div>
        );
      })}
    </div>
  );
}

function XlsxPreviewModal({ rows, onChange, onClose, onExport }: { rows: XlsxPreviewRow[]; onChange: (rowIndex: number, key: keyof XlsxPreviewRow, value: string | number) => void; onClose: () => void; onExport: () => void }) {
  const columns: Array<{ key: keyof XlsxPreviewRow; label: string; width: string; rows?: number; image?: boolean }> = [
    { key: "originalShotNo", label: "镜号", width: "w-24" },
    { key: "scene", label: "场景", width: "w-36", rows: 4 },
    { key: "characters", label: "人物", width: "w-36", rows: 4 },
    { key: "propsText", label: "核心道具", width: "w-36", rows: 4 },
    { key: "shotSize", label: "景别", width: "w-28", rows: 3 },
    { key: "cameraMove", label: "运镜", width: "w-32", rows: 4 },
    { key: "scriptText", label: "画面描述", width: "w-96", rows: 7 },
    { key: "imageUrl", label: "画面示意", width: "w-[420px]", image: true },
    { key: "dialogue", label: "旁白VO", width: "w-72", rows: 7 },
    { key: "notes", label: "备注", width: "w-72", rows: 7 },
  ];
  return (
    <div className="fixed inset-0 z-50 bg-black/40 p-5">
      <div className="mx-auto flex h-full max-w-7xl flex-col border border-[#d7d1c7] bg-[#fbfaf7] shadow-xl">
        <div className="flex items-center justify-between border-b border-[#d7d1c7] px-4 py-3">
          <div>
            <h2 className="text-lg font-semibold">预览 XLSX</h2>
            <p className="text-xs text-[#667085]">可直接修改单元格内容，导出时使用当前预览表。</p>
          </div>
          <div className="flex items-center gap-2">
            <IconButton onClick={onExport} icon={<Download className="h-4 w-4" />} label="导出 XLSX" strong />
            <ToolbarButton onClick={onClose}>关闭</ToolbarButton>
          </div>
        </div>
        <div className="storyboard-scrollbar flex-1 overflow-auto p-4">
          <table className="min-w-[2000px] border-collapse bg-white text-sm">
            <thead>
              <tr>{columns.map(({ label, width }) => <th key={label} className={`sticky top-0 border border-[#d7d1c7] bg-[#eef0f2] px-3 py-3 text-center text-base font-semibold ${width}`}>{label}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="bg-white">
                  {columns.map(({ key, rows: textareaRows, image }) => (
                    <td key={key} className="h-44 border border-[#d7d1c7] p-2 align-middle">
                      {image ? (
                        row.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={row.imageUrl} alt="画面示意" className="mx-auto max-h-40 w-full object-contain" />
                        ) : (
                          <div className="grid h-40 place-items-center border border-dashed border-[#d7d1c7] text-xs text-[#667085]">未回填图片</div>
                        )
                      ) : (
                        <textarea
                          value={String(row[key] ?? "")}
                          rows={textareaRows ?? 2}
                          onChange={(event) => onChange(rowIndex, key, event.target.value)}
                          className="h-full w-full resize-none bg-transparent p-1 text-center leading-7 outline-[#0f766e]"
                        />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ShotList({ shots, activeId, selectedIds, onSelect, onToggleSelect, onBoxSelect, onReorder, onDelete }: { shots: WorkShot[]; activeId: string | null; selectedIds: string[]; onSelect: (id: string) => void; onToggleSelect: (id: string) => void; onBoxSelect: (ids: string[]) => void; onReorder: (draggedId: string, targetId?: string, targetScene?: string) => void; onDelete: (id: string) => void }) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const boxSelect = useShotBoxSelect(onBoxSelect);
  return (
    <div ref={boxSelect.ref} {...boxSelect.handlers} className="relative grid gap-2 select-none">
      {boxSelect.box ? <SelectionBox box={boxSelect.box} /> : null}
      {shots.map((shot) => (
        <ShotRow
          key={shot.id}
          shot={shot}
          active={shot.id === activeId}
          selected={selectedIds.includes(shot.id)}
          dragging={shot.id === draggingId}
          onSelect={onSelect}
          onToggleSelect={onToggleSelect}
          onDelete={onDelete}
          onDragStart={(id) => setDraggingId(id)}
          onDragEnd={() => setDraggingId(null)}
          onDropOn={(targetId) => {
            if (draggingId) onReorder(draggingId, targetId);
            setDraggingId(null);
          }}
        />
      ))}
    </div>
  );
}

function SceneList({ groups, activeId, selectedIds, onSelect, onToggleSelect, onBoxSelect, onReorder, onBatchUpload }: { groups: SceneGroup[]; activeId: string | null; selectedIds: string[]; onSelect: (id: string) => void; onToggleSelect: (id: string) => void; onBoxSelect: (ids: string[]) => void; onReorder: (draggedId: string, targetId?: string, targetScene?: string) => void; onBatchUpload: (shots: WorkShot[], files: File[]) => void }) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const boxSelect = useShotBoxSelect(onBoxSelect);
  return <div ref={boxSelect.ref} {...boxSelect.handlers} className="relative grid gap-4 select-none">{boxSelect.box ? <SelectionBox box={boxSelect.box} /> : null}{groups.map((group) => <section key={group.sceneName} onDragOver={(event) => { if (draggingId) event.preventDefault(); }} onDrop={(event) => { if (!draggingId) return; if ((event.target as HTMLElement).closest("[data-shot-id]")) return; event.preventDefault(); onReorder(draggingId, undefined, group.sceneName); setDraggingId(null); }} className="border border-[#d7d1c7] bg-white"><div className="border-b border-[#d7d1c7] px-3 py-2 font-semibold">{group.sceneName} <span className="text-xs font-normal text-[#667085]">{group.shots.length} 镜头</span></div><div className="grid gap-3 p-2">{group.batches.map((batch) => <div key={batch.id} className="border border-[#e4ded4] bg-[#fbfaf7] p-2"><div className="mb-2 flex items-center justify-between gap-2"><span className="text-xs font-semibold">第 {batch.index} 组 · {batch.shots.length} 镜头</span><label className="cursor-pointer border border-[#d7d1c7] bg-white px-2 py-1 text-xs font-semibold">上传图片<input type="file" accept="image/*" multiple className="hidden" onChange={(event) => { const files = Array.from(event.target.files || []); if (files.length) onBatchUpload(batch.shots, files); event.currentTarget.value = ""; }} /></label></div>{batch.shots.map((shot) => <ShotRow key={shot.id} shot={shot} active={shot.id === activeId} selected={selectedIds.includes(shot.id)} dragging={shot.id === draggingId} onSelect={onSelect} onToggleSelect={onToggleSelect} onDragStart={(id) => setDraggingId(id)} onDragEnd={() => setDraggingId(null)} onDropOn={(targetId) => { if (draggingId) onReorder(draggingId, targetId, group.sceneName); setDraggingId(null); }} />)}</div>)}</div></section>)}</div>;
}

function ShotRow({ shot, active, selected, dragging, onSelect, onToggleSelect, onDelete, onDragStart, onDragEnd, onDropOn }: { shot: WorkShot; active: boolean; selected: boolean; dragging?: boolean; onSelect: (id: string) => void; onToggleSelect: (id: string) => void; onDelete?: (id: string) => void; onDragStart?: (id: string) => void; onDragEnd?: () => void; onDropOn?: (id: string) => void }) {
  return <div data-shot-id={shot.id} draggable={Boolean(onDragStart)} onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", shot.id); onDragStart?.(shot.id); }} onDragOver={(event) => { if (onDropOn) event.preventDefault(); }} onDrop={(event) => { event.preventDefault(); onDropOn?.(shot.id); }} onDragEnd={onDragEnd} className={`cursor-move border p-2 transition ${dragging ? "opacity-45" : ""} ${active ? "border-[#0f766e] bg-white" : "border-[#d7d1c7] bg-[#fffdf8]"}`}><div className="flex items-start gap-2"><input type="checkbox" checked={selected} onChange={() => onToggleSelect(shot.id)} className="mt-1" /><button className="min-w-0 flex-1 text-left" onClick={() => onSelect(shot.id)}><div className="flex items-center justify-between gap-2"><span className="flex items-center gap-1 font-semibold">{shot.originalShotNo}{shot.isLocked ? <Lock className="h-3.5 w-3.5 text-[#667085]" /> : null}</span><span className="text-[11px] text-[#667085]">{statusLabels[shot.status]}</span></div><p className="mt-1 truncate text-xs text-[#667085]">{shot.scene || "未识别场景"} · {shot.scriptText || "未填写画面内容"}</p><div className="mt-2 flex gap-1 text-[11px]"><span className="bg-[#eef7f6] px-1.5 py-0.5 text-[#0f766e]">{shot.imageUrl ? "有图" : "未回填"}</span><span className="bg-white px-1.5 py-0.5 text-[#667085]">拖动排序</span></div></button></div>{onDelete ? <div className="mt-2 flex justify-end"><button className="border border-[#d7d1c7] bg-white px-2 py-1 text-xs" onClick={() => onDelete(shot.id)}>删除</button></div> : null}</div>;
}

function useShotBoxSelect(onBoxSelect: (ids: string[]) => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const [box, setBox] = useState<SelectBox | null>(null);

  function updateBox(clientX: number, clientY: number) {
    const container = ref.current;
    const start = startRef.current;
    if (!container || !start) return;
    const rect = container.getBoundingClientRect();
    const currentX = clientX - rect.left + container.scrollLeft;
    const currentY = clientY - rect.top + container.scrollTop;
    const nextBox = {
      left: Math.min(start.x, currentX),
      top: Math.min(start.y, currentY),
      width: Math.abs(currentX - start.x),
      height: Math.abs(currentY - start.y),
    };
    setBox(nextBox);
    const ids = Array.from(container.querySelectorAll<HTMLElement>("[data-shot-id]"))
      .filter((element) => {
        const item = element.getBoundingClientRect();
        const itemBox = {
          left: item.left - rect.left + container.scrollLeft,
          top: item.top - rect.top + container.scrollTop,
          width: item.width,
          height: item.height,
        };
        return boxesIntersect(nextBox, itemBox);
      })
      .map((element) => element.dataset.shotId)
      .filter(Boolean) as string[];
    onBoxSelect(ids);
  }

  return {
    ref,
    box,
    handlers: {
      onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        const target = event.target as HTMLElement;
        if (target.closest("button,input,label,[data-shot-id]")) return;
        const container = ref.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        startRef.current = { x: event.clientX - rect.left + container.scrollLeft, y: event.clientY - rect.top + container.scrollTop };
        event.currentTarget.setPointerCapture(event.pointerId);
        updateBox(event.clientX, event.clientY);
      },
      onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => {
        if (!startRef.current) return;
        updateBox(event.clientX, event.clientY);
      },
      onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => {
        if (!startRef.current) return;
        updateBox(event.clientX, event.clientY);
        startRef.current = null;
        setBox(null);
      },
      onPointerCancel: () => {
        startRef.current = null;
        setBox(null);
      },
    },
  };
}

function SelectionBox({ box }: { box: SelectBox }) {
  return <div className="pointer-events-none absolute z-20 border border-[#0f766e] bg-[#0f766e]/10" style={{ left: box.left, top: box.top, width: box.width, height: box.height }} />;
}

function AssetPanel({
  assets,
  tab,
  onTab,
  onChange,
  onAdd,
  onCopy,
  onAnalyzeAi,
  onGenerateTemplate,
  onOptimizePrompt,
  aiBusy,
  optimizingPromptId,
  characterRoles,
  onCharacterRolesChange,
  onApplyCharacterRoles,
  onRebuildCharacterRoles,
}: {
  assets: Asset[];
  tab: AssetType;
  onTab: (tab: AssetType) => void;
  onChange: (id: string, patch: Partial<Asset>) => void;
  onAdd: (type: AssetType) => void;
  onCopy: (text: string) => void;
  onAnalyzeAi: () => void;
  onGenerateTemplate: (asset: Asset) => void;
  onOptimizePrompt: (asset: Asset) => void;
  aiBusy: boolean;
  optimizingPromptId: string | null;
  characterRoles: CharacterRole[];
  onCharacterRolesChange: (roles: CharacterRole[]) => void;
  onApplyCharacterRoles: () => void;
  onRebuildCharacterRoles: () => void;
}) {
  const tabs: Array<[AssetType, string]> = [["scene", "场景"], ["character", "人物"], ["prop", "道具"]];
  const list = assets.filter((asset) => asset.type === tab);
  const updateRole = (id: string, patch: Partial<CharacterRole>) =>
    onCharacterRolesChange(characterRoles.map((role) => (role.id === id ? { ...role, ...patch } : role)));

  return (
    <div>
      <div className="mb-3 flex gap-2">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            className={`flex-1 border px-3 py-2 text-sm font-semibold ${tab === key ? "border-[#0f766e] bg-[#0f766e] text-white" : "border-[#d7d1c7] bg-white"}`}
            onClick={() => onTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mb-3 flex items-center gap-2">
        <button className="border border-[#202124] bg-[#202124] px-3 py-2 text-xs font-semibold text-white" onClick={() => onAdd(tab)}>
          + 新增{tabs.find(([key]) => key === tab)?.[1] || ""}
        </button>
        <button
          className="border border-[#d7d1c7] bg-white px-3 py-2 text-xs font-semibold disabled:opacity-40"
          disabled={aiBusy || !assets.some((asset) => !asset.isLocked)}
          onClick={onAnalyzeAi}
        >
          {aiBusy ? "AI 分析中..." : "重新 AI 整理"}
        </button>
      </div>

      {tab === "character" ? (
        <section className="mb-3 border border-[#d7d1c7] bg-[#fbfaf7] p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">标准角色表</h3>
            <button
              className="border border-[#d7d1c7] bg-white px-2 py-1 text-xs font-semibold"
              onClick={() => onCharacterRolesChange([...characterRoles, { id: crypto.randomUUID(), name: "新角色", aliases: [] }])}
            >
              新增角色
            </button>
          </div>
          <div className="grid gap-2">
            {characterRoles.map((role) => (
              <div key={role.id} className="border border-[#e4ded4] bg-white p-2">
                <input
                  value={role.name}
                  onChange={(event) => updateRole(role.id, { name: event.target.value })}
                  className="mb-2 w-full border border-[#d7d1c7] px-2 py-1 text-xs font-semibold"
                  placeholder="标准角色名，例如 怀孕妈妈"
                />
                <textarea
                  value={role.aliases.join("、")}
                  rows={2}
                  onChange={(event) => updateRole(role.id, { aliases: splitNames(event.target.value) })}
                  className="w-full resize-none border border-[#d7d1c7] px-2 py-1 text-xs leading-5"
                  placeholder="别名，用顿号分隔，例如 孕妈、宝妈、孕妇"
                />
                <button
                  className="mt-2 border border-[#d7d1c7] bg-white px-2 py-1 text-xs font-semibold"
                  onClick={() => onCharacterRolesChange(characterRoles.filter((item) => item.id !== role.id))}
                >
                  删除角色
                </button>
              </div>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button className="border border-[#202124] bg-[#202124] px-2 py-2 text-xs font-semibold text-white" onClick={onApplyCharacterRoles}>
              应用角色归一
            </button>
            <button className="border border-[#d7d1c7] bg-white px-2 py-2 text-xs font-semibold" onClick={onRebuildCharacterRoles}>
              从镜头重建
            </button>
          </div>
        </section>
      ) : null}

      <div className="grid gap-3">
        {list.map((asset) => (
          <div key={asset.id} className="border border-[#d7d1c7] bg-[#fbfaf7] p-3">
            <div className="mb-2 flex gap-2">
              <input value={asset.name} disabled={asset.isLocked} onChange={(event) => onChange(asset.id, { name: event.target.value })} className="min-w-0 flex-1 border border-[#d7d1c7] bg-white px-2 py-1 text-sm font-semibold" />
              <button onClick={() => onChange(asset.id, { isLocked: !asset.isLocked })} className="border border-[#d7d1c7] bg-white px-2">
                {asset.isLocked ? <Lock className="h-4 w-4" /> : <LockOpen className="h-4 w-4" />}
              </button>
            </div>
            <label className="grid gap-1">
              <span className="text-xs font-semibold text-[#667085]">核心要求</span>
              <textarea
                value={asset.coreRequirements}
                disabled={asset.isLocked}
                rows={7}
                onChange={(event) => {
                  const coreRequirements = event.target.value;
                  const templatePrompt = generateTemplatePrompt(asset.type, asset.name, coreRequirements);
                  onChange(asset.id, {
                    coreRequirements,
                    templatePrompt,
                    activePromptMode: "template",
                  });
                }}
                className="w-full resize-none border border-[#d7d1c7] bg-white px-2 py-2 text-xs leading-5"
              />
            </label>
            <div className="mt-2 flex">
              <button className="border border-[#d7d1c7] bg-white px-2 py-1 text-xs font-semibold" onClick={() => onCopy(asset.coreRequirements)}>复制核心</button>
            </div>
            <div className="mt-2 grid gap-1">
              <div className="flex items-center justify-between gap-2 text-xs font-semibold text-[#667085]">
                <span>生图提示词</span>
                <div className="flex items-center gap-1">
                  <span>{getAssetPromptMode(asset) === "ai" ? "当前：AI 生成" : "当前：模板生成"}</span>
                  <button
                    type="button"
                    className={`border px-1.5 py-0.5 ${getAssetPromptMode(asset) === "template" ? "border-[#0f766e] text-[#0f766e]" : "border-[#d7d1c7] text-[#667085]"}`}
                    onClick={() => onGenerateTemplate(asset)}
                  >
                    模板
                  </button>
                  <button
                    type="button"
                    disabled={asset.isLocked || optimizingPromptId === asset.id}
                    className={`border px-1.5 py-0.5 disabled:opacity-40 ${getAssetPromptMode(asset) === "ai" ? "border-[#0f766e] text-[#0f766e]" : "border-[#d7d1c7] text-[#667085]"}`}
                    onClick={() => onOptimizePrompt(asset)}
                  >
                    {optimizingPromptId === asset.id ? "AI生成中" : "AI"}
                  </button>
                </div>
              </div>
              <textarea
                value={getActiveAssetPrompt(asset)}
                disabled={asset.isLocked}
                rows={7}
                onChange={(event) => {
                  const mode = getAssetPromptMode(asset);
                  const value = event.target.value;
                  onChange(asset.id, mode === "ai" ? { aiPrompt: value, activePromptMode: "ai" } : { templatePrompt: value, activePromptMode: "template" });
                }}
                className="w-full resize-none border border-[#d7d1c7] bg-white px-2 py-2 text-xs leading-5"
              />
            </div>
            <div className="mt-2 flex gap-2">
              <button className="border border-[#d7d1c7] bg-white px-2 py-1 text-xs font-semibold" onClick={() => onCopy(getActiveAssetPrompt(asset) || asset.coreRequirements)}>复制生图词</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FileButton({ busy, onFile, large = false }: { busy: boolean; onFile: (file: File) => void; large?: boolean }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <>
      <button type="button" disabled={busy} onClick={() => inputRef.current?.click()} className={`inline-flex items-center gap-2 border border-[#d7d1c7] bg-white font-semibold hover:border-[#0f766e] disabled:opacity-50 ${large ? "px-5 py-3 text-base" : "px-3 py-2 text-sm"}`}>
        <Upload className="h-4 w-4" />{busy ? "导入中" : "导入脚本"}
      </button>
      <input ref={inputRef} type="file" accept=".xlsx,.csv" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void onFile(file); event.currentTarget.value = ""; }} />
    </>
  );
}

function ToolbarButton({ children, onClick, active, disabled }: { children: React.ReactNode; onClick: () => void; active?: boolean; disabled?: boolean }) {
  return <button type="button" disabled={disabled} onClick={onClick} className={`border px-3 py-2 text-sm font-semibold disabled:opacity-40 ${active ? "border-[#0f766e] bg-[#0f766e] text-white" : "border-[#d7d1c7] bg-white hover:border-[#0f766e]"}`}>{children}</button>;
}

function IconButton({ icon, label, onClick, disabled, strong }: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; strong?: boolean }) {
  return <button type="button" disabled={disabled} onClick={onClick} className={`inline-flex items-center gap-2 border px-3 py-2 text-sm font-semibold disabled:opacity-40 ${strong ? "border-[#202124] bg-[#202124] text-white" : "border-[#d7d1c7] bg-white hover:border-[#0f766e]"}`}>{icon}{label}</button>;
}

function AnnotationToolButton({ label, onClick, active, disabled }: { label: string; onClick: () => void; active?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`h-8 whitespace-nowrap border px-3 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-45 ${
        active ? "border-[#202124] bg-[#202124] text-white" : "border-[#d7d1c7] bg-white text-[#202124] hover:border-[#0f766e]"
      }`}
    >
      {label}
    </button>
  );
}

function Input({ label, value, onChange, disabled }: { label: string; value: string; onChange: (value: string) => void; disabled?: boolean }) {
  return <label className="grid gap-1 text-sm font-semibold"><span>{label}</span><input value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="border border-[#d7d1c7] bg-white px-3 py-2 text-sm font-normal outline-none focus:border-[#0f766e] disabled:bg-[#f0eee9]" /></label>;
}

function Textarea({ label, value, onChange, rows, disabled, className = "" }: { label: string; value: string; onChange: (value: string) => void; rows: number; disabled?: boolean; className?: string }) {
  return <label className={`grid gap-1 text-sm font-semibold ${className}`}><span>{label}</span><textarea value={value} disabled={disabled} rows={rows} onChange={(event) => onChange(event.target.value)} className="resize-none border border-[#d7d1c7] bg-white px-3 py-2 text-sm font-normal leading-6 outline-none focus:border-[#0f766e] disabled:bg-[#f0eee9]" /></label>;
}

function toWorkShot(shot: StoryboardShot, index: number): WorkShot {
  const label = shot.shotLabel || String(shot.shotNumber || index + 1);
  const propsText = shot.product || inferCorePropsFromShotText([shot.scriptText, shot.reference, shot.notes, shot.copy].filter(Boolean).join("\n"));
  return sanitizeShotScene({ ...shot, originalIndex: index + 1, currentIndex: index + 1, originalShotNo: label, currentShotNo: label, propsText, product: propsText, dialogue: shot.copy || "", annotations: shot.annotations || [], annotatedImage: shot.annotatedImage || "", status: "draft", isLocked: false, imageLocked: false });
}

function sanitizeShotScene<T extends WorkShot>(shot: T): T {
  const normalized = { ...shot, annotations: shot.annotations || [], annotatedImage: shot.annotatedImage || "" };
  const scene = normalized.scene?.trim() || "";
  if (scene && !isDurationLike(scene)) return normalized;
  const inferred = inferSceneNameFromShot(normalized);
  return inferred ? { ...normalized, scene: inferred } : { ...normalized, scene: "" };
}

function isDurationLike(value: string) {
  return /^\d+(\.\d+)?\s*(s|秒|秒钟)$/i.test(value.trim());
}

function inferSceneNameFromShot(shot: Pick<WorkShot, "scriptText" | "reference" | "notes" | "propsText">) {
  const text = [shot.scriptText, shot.reference, shot.notes, shot.propsText].filter(Boolean).join("\n");
  if (/母婴店|门店|店内|货架|导购|展示台|陈列|收银/.test(text)) return "母婴门店";
  if (/淡蓝色.*家居空间|家居空间.*淡蓝色|空背家居空间/.test(text)) return "淡蓝色家居空间";
  if (/大软包|软包/.test(text)) return "家居软包互动区";
  if (/客厅|沙发|茶几|地毯|电视柜/.test(text)) return "家庭客厅";
  if (/餐厅|餐桌|餐椅|儿童餐椅|辅食椅|用餐|辅食/.test(text)) return "家庭餐厅";
  if (/卧室|婴儿床|床头|哄睡|睡眠/.test(text)) return "家庭卧室";
  if (/厨房|冲奶|奶瓶|水壶|厨房台面|橱柜/.test(text)) return "家庭厨房";
  if (/浴室|洗澡|沐浴|浴盆|澡盆|洗护|毛巾/.test(text)) return "家庭浴室";
  if (/家居|家庭|家中|居家/.test(text)) return "家庭居家空间";
  return "";
}

function deriveAssets(shots: WorkShot[], existing: Asset[]) {
  const sceneNames = unique(shots.map((shot) => shot.scene?.trim()).filter(Boolean) as string[]);
  const sceneNameSet = new Set(sceneNames.map(normalizeRoleName));
  const next = new Map(existing.map((asset) => [`${asset.type}:${asset.name}`, asset]));
  const sceneContext = new Map<string, string>();
  sceneNames.forEach((sceneName) => {
    sceneContext.set(
      sceneName,
      shots
        .filter((shot) => normalizeRoleName(shot.scene || "") === normalizeRoleName(sceneName))
        .map((shot) => [shot.scriptText, shot.propsText, shot.shotSize, shot.cameraMove, shot.notes].filter(Boolean).join("，"))
        .filter(Boolean)
        .join("\n"),
    );
  });
  const add = (type: AssetType, name: string, context: string) => {
    const clean = name.trim();
    if (!clean || clean === "未识别场景") return;
    const key = `${type}:${clean}`;
    if (!next.has(key)) next.set(key, newAsset(type, clean, type === "scene" ? sceneContext.get(clean) || context : context));
  };
  shots.forEach((shot) => {
    add("scene", shot.scene || "", shot.scriptText);
    splitNames(shot.characters || "").forEach((name) => add("character", name, shot.scriptText));
    splitNames(shot.propsText || "").forEach((name) => add("prop", name, shot.scriptText));
  });
  return Array.from(next.values());
}

function deriveCharacterRoles(shots: WorkShot[], existing: CharacterRole[]) {
  const byName = new Map(existing.map((role) => [normalizeRoleName(role.name), role]));
  const names = unique(shots.flatMap((shot) => splitNames(shot.characters || "")));
  const preferred = ["怀孕妈妈", "爸爸", "育儿师", "宝宝", "妈妈", "孩子"];

  [...preferred.filter((name) => names.some((item) => normalizeRoleName(item) === normalizeRoleName(name))), ...names].forEach((name) => {
    const clean = name.trim();
    if (!clean || byName.has(normalizeRoleName(clean))) return;
    byName.set(normalizeRoleName(clean), {
      id: crypto.randomUUID(),
      name: clean,
      aliases: defaultAliasesForRole(clean),
    });
  });

  return Array.from(byName.values());
}

function syncCharacterAssetsWithRoles(assets: Asset[], roles: CharacterRole[]) {
  if (!roles.length) return assets;
  const roleKeys = new Set(roles.map((role) => normalizeRoleName(role.name)));
  const nonCharacterAssets = assets.filter((asset) => asset.type !== "character" || asset.isLocked || roleKeys.has(normalizeRoleName(asset.name)));
  const next = new Map(nonCharacterAssets.map((asset) => [assetKey(asset.type, asset.name), asset]));

  roles.forEach((role) => {
    const key = assetKey("character", role.name);
    if (!next.has(key)) {
      const existingByAlias = assets.find(
        (asset) =>
          asset.type === "character" &&
          [role.name, ...role.aliases].some((name) => normalizeRoleName(name) === normalizeRoleName(asset.name)),
      );
      next.set(key, existingByAlias ? { ...existingByAlias, name: role.name } : newAsset("character", role.name));
    }
  });

  return Array.from(next.values());
}

function normalizeCharactersForRoles(value: string, roles: CharacterRole[]) {
  const names = splitNames(value);
  if (!roles.length) return names.join("、");
  const normalized = names.map((name) => roleNameForCharacter(name, roles));
  return unique(normalized.filter(Boolean)).join("、");
}

function roleNameForCharacter(name: string, roles: CharacterRole[]) {
  const normalizedName = normalizeRoleName(name);
  const exact = roles.find((role) => normalizeRoleName(role.name) === normalizedName);
  if (exact) return exact.name;
  const alias = roles.find((role) => role.aliases.some((item) => normalizeRoleName(item) === normalizedName));
  if (alias) return alias.name;
  return name.trim();
}

function defaultAliasesForRole(name: string) {
  const defaults: Record<string, string[]> = {
    怀孕妈妈: ["孕妈", "孕妇", "怀孕女性", "准妈妈"],
    爸爸: ["父亲", "老公", "丈夫", "宝爸"],
    育儿师: ["育婴师", "护理师", "专家", "老师"],
    宝宝: ["婴儿", "小宝宝", "baby"],
    妈妈: ["母亲", "妈咪", "宝妈"],
    孩子: ["小孩", "儿童", "大宝"],
  };
  return defaults[name] ?? [];
}

function normalizeRoleName(value = "") {
  return value.replace(/\s/g, "").replace(/[：:]+$/, "");
}

function newAsset(type: AssetType, name: string, context = ""): Asset {
  const sceneCore = type === "scene" ? localSceneCoreTemplate(name, context) : "";
  const coreTemplates = {
    scene: sceneCore,
    character: `人物名称：\n${name}\n\n核心要求：\n1. 基础设定：符合角色身份的真实年龄段、性别、人物关系和气质。\n2. 服装发型：生活化、干净、有广告质感，同一角色服装、色系、体型、发型保持一致。\n3. 表情体态：自然放松，有亲和力，避免僵硬摆拍。\n4. 皮肤要求：真实皮肤纹理，自然毛孔、轻微瑕疵和细小肤色变化。\n5. 禁忌：不要明星脸，不要整容脸，不要塑料皮肤，不要卡通化，不要夸张美颜。`,
    prop: `道具名称：\n${name}\n\n基础材质：\n符合真实世界中该类道具的常见材质，表面干净，有自然纹理和适度反光。\n\n颜色风格：\n低饱和自然色，干净柔和，适合真实广告场景。\n\n视觉特征：\n${name}轮廓清晰，结构可辨，边缘细节真实，不默认加入破损、污渍或旧化痕迹。\n\n场景适配：\n风格需要和当前场景统一，适合真实广告画面，不要廉价棚拍感。`,
  } satisfies Record<AssetType, string>;
  const promptTemplates = {
    scene: generateTemplatePrompt("scene", name, sceneCore),
    character: `人物三视图角色设定图，真实人物商业广告摄影质感，角色为${name}。同一画面横向排列三个视图：正面视图、侧面视图、背面视图，必须是同一人物、同一年龄、同一体型、同一服装、同一发型、同一肤色，站姿自然直立，比例真实，浅灰或白色干净背景，光线均匀。真实年龄段和身份关系清晰，服装生活化、干净、有广告质感，色系统一，发型自然真实、有发丝细节，体态自然放松，气质亲和可信，表情温和自然。自然光下真实肤色，皮肤保留真实纹理、毛孔、轻微瑕疵和细小肤色变化，避免过度磨皮和塑料皮肤。不要明星脸，不要整容脸，不要卡通化，不要夸张美颜，不要换装，不要改变发型，不要出现多个人物身份，不要文字、水印、字幕、logo。`,
    prop: generateTemplatePrompt("prop", name, coreTemplates.prop),
  } satisfies Record<AssetType, string>;
  return { id: crypto.randomUUID(), type, name, coreRequirements: coreTemplates[type], templatePrompt: promptTemplates[type], aiPrompt: "", activePromptMode: "template", imagePrompt: promptTemplates[type], isLocked: false };
}

function generateTemplatePrompt(type: AssetType, name: string, coreRequirements: string) {
  return deriveImagePromptFromCore(type, name, coreRequirements);
}

function getAssetPromptMode(asset: Asset) {
  return asset.activePromptMode || (asset.aiPrompt ? "ai" : "template");
}

function getAssetTemplatePrompt(asset: Asset) {
  return asset.templatePrompt || asset.imagePrompt || generateTemplatePrompt(asset.type, asset.name, asset.coreRequirements);
}

function getActiveAssetPrompt(asset: Asset) {
  const mode = getAssetPromptMode(asset);
  if (mode === "ai") return asset.aiPrompt || "";
  return getAssetTemplatePrompt(asset);
}

function deriveImagePromptFromCore(type: AssetType, name: string, coreRequirements: string) {
  const normalizedCore = normalizeSceneCoreLabels(coreRequirements);
  const cleanCore = sceneCoreBody(normalizedCore);

  if (type === "scene") {
    const visualPrompt = sceneVisualPromptText(normalizedCore);
    const negative = sceneNegativePromptText();
    const scenePrompt = visualPrompt.replace(/[。！？]$/, "");
    return normalizePromptLanguage(`场景叙述词：
${scenePrompt}，35mm 胶片质感，轻微胶片颗粒，真实镜头景深，有抓拍感

反向提示词：
${negative}`);
  }

  if (type === "character") {
    return `人物三视图角色设定图，真实人物商业广告摄影质感，角色为${name}。同一画面横向排列三个视图：正面视图、侧面视图、背面视图，必须是同一人物、同一年龄、同一体型、同一服装、同一发型、同一肤色，站姿自然直立，比例真实，浅灰或白色干净背景，光线均匀。人物设定：${cleanCore.replace(/\n+/g, "，")}。自然光下真实肤色，皮肤保留真实纹理、毛孔、轻微瑕疵和细小肤色变化，避免过度磨皮和塑料皮肤。表情自然克制，有亲和力，不要明星脸，不要整容脸，不要卡通化，不要夸张美颜，不要换装，不要改变发型，不要出现多个人物身份，不要文字、水印、字幕、logo。`;
  }

  return propImagePromptFromCore(name, normalizedCore);
}

function propImagePromptFromCore(name: string, coreRequirements: string) {
  const parts = propPromptPartsFromCore(name, coreRequirements);
  return `生成一张${parts.propName}白底六面图，道具风格需要符合${parts.sceneFit}。画面展示同一个道具的正面、背面、左侧面、右侧面、俯视和 45 度透视角，六个视图保持同一造型、颜色、材质和比例。道具基础材质为${parts.baseMaterial}，颜色为${parts.colorStyle}，视觉特征为${parts.visualFeatures}。白色干净背景，光感自然，有自然透视，真实颗粒感，真实摄影参考质感。

反向提示词：
${propNegativePrompt(parts.propName)}`;
}

function propPromptPartsFromCore(name: string, coreRequirements: string) {
  const value = (label: string) => propCoreValue(coreRequirements, label);
  return {
    propName: value("道具名称") || name,
    baseMaterial: value("基础材质") || "符合真实世界中该类道具的常见材质，表面干净，有自然纹理。",
    colorStyle: value("颜色风格") || "低饱和自然色，干净柔和，适合真实广告场景。",
    visualFeatures: value("视觉特征") || `${name}轮廓清晰，结构可辨，边缘细节真实。`,
    sceneFit: value("场景适配") || "当前场景的真实广告美术风格，干净、自然、不廉价。",
  };
}

function propCoreValue(coreRequirements: string, label: string) {
  const match = coreRequirements.match(new RegExp(`${label}[:：]\\s*([^\\n]+(?:\\n(?!\\S+[:：])[^\\n]+)*)`));
  return match?.[1]?.trim().replace(/[。；;]+$/, "") || "";
}

function propNegativePrompt(name: string) {
  const base = "不要塑料感，不要 3D 建模感，不要卡通感，不要可读文字，不要水印，不要字幕，不要明显品牌 logo，不要悬浮摆拍，不要过度光滑，不要廉价电商棚拍感";
  if (/大软包|软包/.test(name.replace(/\s/g, ""))) {
    return `${base}，不要变成塑料袋，不要变成包装袋，不要变成纸箱，不要变成普通靠枕，不要变成沙发，不要变成床垫，不要变成墙面软包`;
  }
  return base;
}

function localSceneCoreTemplate(name: string, context: string) {
  const text = `${name}\n${context}`;
  const has = (pattern: RegExp) => pattern.test(text);
  const objects = unique((text.match(/淡蓝色|空背|家居空间|大软包|软包|小象|尿布台|护理台|沙发|茶几|地毯|餐桌|餐椅|儿童餐椅|辅食椅|碗|勺|奶瓶|水杯|浴盆|澡盆|毛巾|洗护用品|货架|展示台|收银台|婴儿床|床|床头柜|橱柜|厨房台面|绿植|玩具|收纳篮|纸尿裤/g) || [])).join("、");
  const evidence = objects ? `脚本关联视觉元素：${objects}` : "无明确视觉依据";
  const noBasis = "无可输出：脚本未提供依据，且无法唯一推断";
  let inference = "无";
  let spaceType = noBasis;
  let structure = noBasis;
  let lighting = noBasis;
  let mood = noBasis;
  let details = objects ? `保留脚本明确出现的视觉元素：${objects}` : noBasis;
  let color = noBasis;
  let style = noBasis;

  if (has(/门店|店内|母婴店|货架|导购|收银|陈列|展示台|试用区|咨询区/)) {
    inference = "由“门店/货架/陈列/展示台/咨询/试用”等脚本信息唯一推断为母婴零售商业空间";
    spaceType = "真实母婴门店空间，带零售陈列和咨询服务区域";
    structure = "产品货架在侧后方形成纵深，展示台或咨询台位于中景，前景可有虚化商品陈列边缘";
    lighting = "明亮营业时段，店内顶光与柔和环境光结合，货架和展示台受光均匀";
    mood = "专业、安心、亲切、可信，有母婴门店服务感";
    details = `必须出现母婴用品陈列、货架、展示台/咨询台、清晰零售动线；脚本相关道具：${objects}`;
    color = "白色、浅木色、奶油色为主，少量低饱和母婴产品色点缀，整体明亮干净且专业";
    style = "写实商业广告摄影风格，空间清爽高级，产品陈列秩序明确，有真实门店质感";
  } else if (has(/尿布台|换尿布|护理台|抚触台|纸尿裤|收纳篮/)) {
    inference = "由“尿布台/护理台/换尿布/纸尿裤/收纳篮”等脚本信息唯一推断为婴儿护理区";
    spaceType = "真实家庭婴儿护理完整空间，围绕尿布台/护理台形成清晰功能空间";
    structure = "尿布台或护理台位于中景，纸尿裤、毛巾、护理用品在台面或侧边收纳区，床、柜体、墙面和地面共同形成完整空间纵深";
    mood = "安心、温暖、细致、柔和，有真实家庭照护感";
    details = `必须出现尿布台/护理台、纸尿裤、收纳或护理用品，空间安全干净；脚本相关道具：${objects}`;
    color = "暖白、米色、浅木色和柔和浅灰为主，低饱和、干净、适合母婴护理";
  } else if (has(/淡蓝色|空背|家居空间|大软包|软包|小象/)) {
    inference = "由“淡蓝色空背/家居空间/大软包/小象”等脚本信息唯一推断为家居互动拍摄空间；不新增客厅、卧室等脚本未限定功能空间";
    spaceType = has(/淡蓝色/) ? "淡蓝色空背家居空间，室内家居互动拍摄环境" : "室内家居互动拍摄空间";
    structure = "核心产品和大软包位于画面中景，前景和后景只保留能支撑家居空间感的简洁陈设，空间方向保持一致";
    lighting = "脚本未限定具体时间；仅可推断为适合室内实拍的均匀柔和光，避免强烈舞台光或夜景光";
    mood = has(/淡蓝色/) ? "淡蓝色、干净、轻松，符合儿童互动产品展示氛围" : "围绕脚本中的家居互动关系建立轻松、可亲近的空间氛围";
    details = `保留脚本明确出现的家居空间、大软包、小象或互动道具；脚本相关视觉元素：${objects}`;
    color = has(/淡蓝色/) ? "淡蓝色作为明确主色，其他颜色不得抢占主视觉" : noBasis;
    style = "室内实拍感产品互动场景，不新增脚本未出现的功能空间或关键道具";
  } else if (has(/沙发|茶几|地毯|客厅|电视柜|绿植|玩具/)) {
    inference = "由“客厅/沙发/茶几/地毯/玩具”等脚本信息唯一推断为家庭客厅";
    spaceType = "真实家庭客厅空间，温暖明亮，适合母婴家庭互动";
    structure = "沙发、茶几或地毯位于中景，玩具和育儿用品形成前中景生活细节，柜体、绿植或窗帘在后景";
    mood = "自然、温暖、放松、亲密，有家庭陪伴和照护感";
    details = `必须出现客厅家具和真实生活细节，例如沙发、茶几、地毯或玩具；脚本相关道具：${objects}`;
    color = "暖白、米色、浅木色、柔和灰绿或低饱和家居色，整体温暖生活化";
  } else if (has(/餐厅|餐桌|餐椅|辅食椅|儿童餐椅|碗|勺|吃饭|用餐|辅食/)) {
    inference = "由“餐桌/餐椅/儿童餐椅/碗勺/用餐/辅食”等脚本信息唯一推断为家庭餐桌区域";
    spaceType = "真实家庭餐厅或餐桌区域，带母婴家庭用餐和辅食细节";
    structure = "餐桌位于中景，儿童餐椅靠近桌边，碗勺、水杯或辅食用品在桌面前中景，餐边柜或开放厨房在后景";
    mood = "自然、轻松、温暖，有日常家庭照护感";
    details = `必须出现餐桌、餐椅/儿童餐椅、碗勺或辅食相关用品；脚本相关道具：${objects}`;
    color = "暖白、浅木色、米色餐桌材质为主，餐具和辅食用品用低饱和柔和色点缀";
  } else if (has(/浴室|洗澡|沐浴|洗护|浴盆|澡盆|毛巾|水汽|洗手台/)) {
    inference = "由“浴室/洗澡/沐浴/浴盆/毛巾/洗护”等脚本信息唯一推断为家庭洗护空间";
    spaceType = "真实家庭浴室或婴儿洗护区，干净温暖，空间不拥挤";
    structure = "浴盆或洗护台位于中景，毛巾和洗护用品在前中景，浴室墙面、台面和柔光反射在后景";
    mood = "温柔、安心、洁净，有母婴护理场景的亲密感";
    details = `必须出现浴盆/洗护台、毛巾、洗护用品和干净浴室材质；脚本相关道具：${objects}`;
    color = "白色、米色、柔和暖灰和浅色瓷砖为主，低饱和、干净清爽，反光柔和";
  } else if (has(/卧室|婴儿床|床头|哄睡|睡眠空间|夜灯|被子/)) {
    inference = "由“卧室/婴儿床/床头/哄睡/睡眠空间/夜灯/被子”等脚本信息唯一推断为家庭睡眠空间";
    spaceType = "真实家庭卧室或母婴睡眠空间，温暖安静，空间层次清晰";
    structure = "床、婴儿床或床边护理区位于中景，床品形成柔软前景层次，床头、灯光或柜体在后景";
    mood = "安静、柔和、亲密、放松，有家庭陪伴感";
    details = `必须出现床、床品、婴儿床或床边护理陈设；脚本相关道具：${objects}`;
    color = "暖白、米色、浅木色和柔和织物色为主，低对比、安静、温暖";
  } else if (has(/厨房|冲奶|奶瓶|水杯|水壶|厨房台面|橱柜/)) {
    inference = "由“厨房/冲奶/奶瓶/水壶/厨房台面/橱柜”等脚本信息唯一推断为家庭厨房空间";
    spaceType = "真实家庭厨房空间，干净明亮，带日常育儿生活细节";
    structure = "厨房台面位于中景，奶瓶、水杯或水壶在台面前中景，橱柜和家电轮廓在后景";
    mood = "自然、轻松、温暖，有真实家庭照护感";
    details = `必须出现厨房台面、橱柜、奶瓶/水杯/水壶等备餐用品；脚本相关道具：${objects}`;
    color = "暖白、浅木色、浅灰台面和低饱和厨房用品色，干净明亮不过曝";
  }
  const lightingLine = lighting === noBasis ? lighting : `${lighting}；光线方向和明暗关系仅按脚本已给或唯一推断的信息保持一致`;
  const colorLine = color === noBasis ? color : `${color}；整体氛围${mood}`;
  const detailsLine = details === noBasis ? details : cleanCoreSentence(details);
  const propLine = objects || "无明确核心道具";
  const photoLine = style === noBasis
    ? fullSpaceDesignRule()
    : `${fullSpaceDesignRule()}；${style}`;

  return `场景名称：
${name}

一、场景分析

* 脚本依据：${evidence}。
* 唯一推断：${inference}。

二、场景设计规范

* 场景定位：${spaceType}。
* 空间结构：${structure}。
* 光线环境：${lightingLine}。
* 色彩氛围：${colorLine}。
* 环境元素：${detailsLine}。
* 核心道具：${propLine}。
* 摄影需求：${photoLine}。
* 视觉约束：杂乱背景，脚本未要求的人物或身体局部，标志，水印，字幕，可读文字，卡通风，高动态范围过曝效果，过度装饰，影棚假景感，塑料感，三百六十度全景，七百二十度全景，虚拟现实环景，鱼眼视角，超广角畸变。`;
}

function normalizeSceneCoreLabels(value: string) {
  return value
    .replace(/光线要求/g, "光线环境")
    .replace(/摄影要求/g, "摄影需求")
    .replace(/避免内容/g, "视觉约束")
    .replace(/空间信息/g, "场景定位")
    .replace(/光影信息/g, "光线环境")
    .replace(/色彩信息/g, "色彩氛围")
    .replace(/重要道具/g, "核心道具");
}

function normalizePromptLanguage(value: string) {
  return value
    .replace(/画面提示词[:：][\s\S]*?(?=\n\s*反向提示词[:：]|$)/g, "")
    .replace(/AI\s*Prompt（中文）[:：]?/gi, "场景叙述词：")
    .replace(/AI\s*Prompt[:：]?/gi, "场景叙述词：")
    .replace(/生图提示词[:：]?/g, "场景叙述词：")
    .replace(/Negative\s*Prompt[:：]?/gi, "反向提示词：")
    .replace(/完整空间全景，?\s*wide shot，?\s*full room view，?\s*clear spatial depth，?\s*foreground midground background visible，?\s*不要房间一角，?\s*不要局部角落，?\s*不要裁切过近，?\s*不要只拍墙角，?/gi, "")
    .replace(/Logo/gi, "标志")
    .replace(/HDR/gi, "高动态范围过曝效果")
    .replace(/VR/gi, "虚拟现实")
    .replace(/360\s*度?/g, "三百六十度")
    .replace(/720\s*度?/g, "七百二十度");
}

function sceneCoreBody(coreRequirements: string) {
  return coreRequirements
    .replace(/^(场景|人物|道具)名称：[\s\S]*?(?=(二、场景设计规范|一、场景核心要求|场景核心要求|核心要求)：?|$)/, "")
    .replace(/^二、场景设计规范/m, "")
    .replace(/^一、场景核心要求/m, "")
    .replace(/^(场景核心要求|核心要求)：/m, "")
    .replace(/\n+/g, "；")
    .replace(/\s+/g, " ")
    .replace(/；?\*\s*[^：:]+[:：]无可输出：脚本未提供依据，且无法唯一推断。?/g, "")
    .trim();
}

function sceneVisualPromptText(coreRequirements: string) {
  return composeScenePromptParts(scenePromptPartsFromCore(coreRequirements));
}

function sceneNegativePromptText() {
  return "杂乱背景，不要卡通风，不要影棚假景感，不要塑料感，不要七百二十度全景，不要虚拟现实环景，不要鱼眼视角，不要超广角畸变";
}

function scenePromptPartsFromCore(coreRequirements: string): PromptParts {
  const value = (label: string) => cleanPromptPhrase(visualOnly(sceneCoreValue(coreRequirements, label)));
  return {
    imageType: "无人物真实广告场景图",
    subject: "完整空间环境",
    scene: value("场景定位"),
    environment: value("环境元素"),
    props: value("核心道具"),
    layout: value("空间结构"),
    composition: "普通影视全景构图",
    lighting: value("光线环境"),
    style: [value("色彩氛围"), "真实材质，轻微胶片颗粒，商业广告摄影质感"].filter(Boolean).join("，"),
    negative: sceneNegativePromptText(),
  };
}

function composeScenePromptParts(parts: PromptParts) {
  const clean = normalizePromptParts(parts);
  const sentences = [
    sentenceFrom(["生成一张", clean.imageType || "无人物真实广告场景图"]),
    clean.scene ? `画面呈现${clean.scene}。` : "",
    sceneEnvironmentSentence(clean.environment),
    scenePropsSentence(clean.props, clean.environment),
    clean.layout ? `空间结构上，${rewriteSceneClause(clean.layout)}。` : "",
    clean.composition ? `画面采用${clean.composition}，需要明确呈现地面、墙面、背景和空间纵深，前景、中景、后景关系完整。` : "",
    sceneLightStyleSentence(clean.lighting, clean.style),
  ];
  return cleanGeneratedPrompt(sentences.join(""));
}

function sceneEnvironmentSentence(environment: string) {
  const text = rewriteSceneClause(environment);
  if (!text) return "";
  if (/母婴用品|货架|展示台|咨询|零售动线/.test(text)) {
    return "空间中需要包含母婴用品陈列区、货架、展示台或咨询服务台，并能看到清晰的零售动线。";
  }
  if (/尿布台|护理台|纸尿裤|护理用品/.test(text)) {
    return "空间中需要包含尿布台或护理台，周围有纸尿裤、收纳用品和必要的护理用品，整体保持干净安全。";
  }
  if (/餐桌|餐椅|辅食|碗|勺/.test(text)) {
    return "空间中需要包含餐桌、餐椅或儿童餐椅，桌面保留碗勺、水杯和辅食用品等真实用餐细节。";
  }
  if (/浴盆|洗护台|毛巾|洗护用品/.test(text)) {
    return "空间中需要包含浴盆或洗护台，周围有毛巾、洗护用品和干净的浴室材质。";
  }
  return `空间环境中需要保留${text}。`;
}

function scenePropsSentence(props: string, environment: string) {
  const items = sceneItemList(`${props}、${environment}`);
  if (!items.length) return "";
  if (items.some((item) => /纸尿裤|奶瓶|婴儿床|玩具|母婴用品/.test(item))) {
    const babyItems = sceneItemList(items.filter((item) => /纸尿裤|奶瓶|婴儿床|玩具|母婴用品/.test(item)).join("、"));
    return `陈列商品包括${formatChineseList(babyItems)}等母婴用品。`;
  }
  return `画面中的核心道具包括${formatChineseList(items)}，摆放需要自然并符合真实空间比例。`;
}

function sceneLightStyleSentence(lighting: string, style: string) {
  const lightingText = rewriteSceneClause(lighting);
  const styleText = rewriteSceneClause(style);
  if (lightingText && styleText) return `光影色彩采用${lightingText}，整体呈现${styleText}。`;
  if (lightingText) return `光影色彩采用${lightingText}。`;
  if (styleText) return `整体呈现${styleText}。`;
  return "";
}

function rewriteSceneClause(value: string) {
  return cleanPromptPhrase(value)
    .replace(/必须出现/g, "")
    .replace(/保留明确出现的/g, "")
    .replace(/保留/g, "")
    .replace(/脚本相关(?:道具|视觉元素)?/g, "")
    .replace(/展示台\/咨询台/g, "展示台或咨询服务台")
    .replace(/餐椅\/儿童餐椅/g, "餐椅或儿童餐椅")
    .replace(/浴盆\/洗护台/g, "浴盆或洗护台")
    .replace(/尿布台\/护理台/g, "尿布台或护理台")
    .replace(/清晰零售动线/g, "清晰的零售动线")
    .replace(/展示台咨询台/g, "展示台或咨询服务台")
    .replace(/零售动线纸尿裤/g, "零售动线，纸尿裤")
    .replace(/母婴用品陈列/g, "母婴用品陈列区")
    .replace(/[：:]/g, "")
    .replace(/^[、，；]+|[、，；]+$/g, "")
    .trim();
}

function sceneItemList(value: string) {
  const known = value.match(/纸尿裤|奶瓶|婴儿床|玩具|货架|展示台|咨询服务台|咨询台|尿布台|护理台|收纳用品|护理用品|餐桌|餐椅|儿童餐椅|碗勺|水杯|浴盆|洗护台|毛巾|洗护用品|沙发|茶几|地毯/g) || [];
  return cleanListPhrase(known.join("、")).split("、").filter(Boolean);
}

function formatChineseList(items: string[]) {
  const clean = unique(items).filter(Boolean);
  if (clean.length <= 1) return clean[0] || "";
  return `${clean.slice(0, -1).join("、")}和${clean[clean.length - 1]}`;
}

function shotPromptParts(shot: WorkShot, assets: Asset[]): PromptParts {
  const sceneAsset = assets.find((asset) => asset.type === "scene" && normalizeName(asset.name) === normalizeName(shot.scene || ""));
  const sceneParts = sceneAsset ? scenePromptPartsFromCore(sceneAsset.coreRequirements) : {};
  const characters = splitNames(shot.characters || "").slice(0, 4).join("、");
  const props = splitNames(shot.propsText || "").slice(0, 4).join("、");
  return {
    imageType: "真人广告分镜图",
    subject: characters ? `${characters}作为画面主体` : "画面主体明确",
    scene: sceneParts.scene || cleanPromptPhrase(shot.scene || ""),
    environment: sceneParts.environment,
    props: props ? `${props}自然融入画面` : sceneParts.props,
    layout: inferShotAction(shot),
    composition: [cleanPromptPhrase(shot.shotSize || ""), cleanPromptPhrase(shot.cameraMove || "")].filter(Boolean).join("，"),
    lighting: sceneParts.lighting,
    style: "真人广告质感，画面干净自然，35mm 胶片质感，真实镜头景深",
    negative: "不要文字、水印、字幕、标志，不要明星脸，不要卡通风，不要塑料感",
  };
}

function composePromptParts(parts: PromptParts) {
  const clean = normalizePromptParts(parts);
  const noPeople = hasNoPeopleConstraint(clean);
  if (noPeople) {
    const sentences = [
      sentenceFrom(["生成一张", clean.imageType]),
      clean.scene ? `画面呈现${clean.scene}。` : "",
      clean.environment ? `空间环境中需要保留${rewriteSceneClause(clean.environment)}。` : "",
      clean.props ? `画面中景保留${clean.props}。` : "",
      clean.layout ? `前景和后景保留${clean.layout}。` : "",
      clean.composition ? `画面采用${clean.composition}，需要明确展示地面、墙面、背景和空间纵深，前景、中景、后景关系完整，空间方向清晰。` : "",
      clean.lighting ? `光影氛围为${clean.lighting}。` : "",
      clean.style ? `整体风格为${clean.style}。` : "",
      clean.negative ? `反向提示词：${clean.negative}。` : "",
    ];
    return cleanGeneratedPrompt(sentences.join(""));
  }
  const sentences = [
    sentenceFrom(["生成一张", clean.imageType]),
    sentenceFrom([clean.subject, clean.scene ? `位于${clean.scene}` : "", clean.environment]),
    clean.props ? `核心道具为${clean.props}。` : "",
    clean.layout ? `画面呈现${clean.layout}。` : "",
    clean.composition ? `构图景别为${clean.composition}。` : "",
    clean.lighting ? `光影氛围为${clean.lighting}。` : "",
    clean.style ? `整体风格为${clean.style}。` : "",
    clean.negative ? `限制条件：${clean.negative}。` : "",
  ];
  return cleanGeneratedPrompt(sentences.join(""));
}

function joinAsClause(values: Array<string | undefined>) {
  return values.map((value) => cleanPromptPhrase(value || "")).filter(Boolean).join("，");
}

function normalizePromptParts(parts: PromptParts): Required<PromptParts> {
  return {
    imageType: cleanPromptPhrase(parts.imageType || ""),
    subject: cleanPromptPhrase(parts.subject || ""),
    scene: cleanPromptPhrase(parts.scene || ""),
    environment: cleanPromptPhrase(parts.environment || ""),
    props: cleanListPhrase(parts.props || ""),
    layout: cleanPromptPhrase(parts.layout || ""),
    composition: cleanPromptPhrase(parts.composition || ""),
    lighting: cleanPromptPhrase(parts.lighting || ""),
    style: cleanPromptPhrase(parts.style || ""),
    negative: cleanListPhrase(parts.negative || ""),
  };
}

function hasNoPeopleConstraint(parts: Required<PromptParts>) {
  return /无人物|不要出现人物|脚本未要求的人物/.test(`${parts.imageType} ${parts.negative}`);
}

function sentenceFrom(values: string[]) {
  const text = values.map(cleanPromptPhrase).filter(Boolean).join("");
  return text ? `${text}。` : "";
}

function cleanListPhrase(value: string) {
  const items = value
    .split(/[、，,；;]+/)
    .map(cleanPromptPhrase)
    .filter((item) => item && !isEmptyPromptValue(item));
  return unique(items.filter((item, index, all) => {
    const longerDuplicate = all.some((other, otherIndex) => otherIndex !== index && other.length > item.length && other.includes(item));
    return !longerDuplicate;
  })).join("、");
}

function inferShotAction(shot: WorkShot) {
  const text = [shot.scriptText, shot.dialogue, shot.notes].filter(Boolean).join("，");
  const actions = unique((text.match(/展示|互动|对话|观察|行走|进入|坐下|拿起|放下|递给|拥抱|安抚|护理|换尿布|喂养|冲奶|试用|讲解|微笑|看向|触摸|玩耍/g) || []).slice(0, 4));
  if (actions.length) return `呈现${actions.join("、")}的自然动作关系`;
  const nouns = unique((text.match(/妈妈|爸爸|宝宝|孩子|育儿师|顾客|尿布台|沙发|餐桌|门店|家居|产品/g) || []).slice(0, 4));
  return nouns.length ? `围绕${nouns.join("、")}形成清晰画面关系` : "";
}

function cleanPromptPhrase(value: string) {
  return value
    .replace(/(?:镜号|景别|画面内容|台词|旁白|同期声|镜头运动|备注|场景|人物|核心道具|场景定位|空间结构|环境元素|光线环境|色彩氛围|摄影需求|视觉约束)[:：]/g, "")
    .replace(/AI实拍|实拍AI|AI\s*实拍|实拍\s*AI/gi, "真实摄影")
    .replace(/无可输出[^，。；]*/g, "")
    .replace(/未填写|无明确|无\/|\/|N\/A/gi, "")
    .replace(/家具、和人物/g, "家具和道具")
    .replace(/人物位置|人物分布|人物动作|主角|演员/g, "")
    .replace(/核心道具为或/g, "")
    .replace(/(?:^|[、，；])(?:或|和)(?=$|[、，；])/g, "")
    .replace(/空间方向$/g, "空间方向清晰")
    .replace(/^或$|^和$|^无$|^undefined$|^null$/gi, "")
    .replace(/展示$/g, "")
    .replace(/\s+/g, "")
    .replace(/[，；。]+$/g, "")
    .trim();
}

function cleanGeneratedPrompt(value: string) {
  let text = value
    .replace(/、、+/g, "、")
    .replace(/，，+/g, "，")
    .replace(/、，|，、/g, "，")
    .replace(/，。/g, "。")
    .replace(/展示，/g, "")
    .replace(/(?:^|[、，；。])(?:或|和)(?=$|[、，；。])/g, "")
    .replace(/人物位置|人物分布|人物动作|主角|演员/g, "")
    .replace(/家具、和人物/g, "家具和道具")
    .replace(/核心道具为或/g, "")
    .replace(/空间方向，/g, "空间方向清晰，");
  const sentences = text
    .replace(/(真人广告质感[，；]){2,}/g, "真人广告质感，")
    .replace(/(35mm胶片质感[，；]){2,}/g, "35mm胶片质感，")
    .split(/[。！？]+/)
    .map((sentence) => {
      const parts = sentence
        .split(/[，；]+/)
        .map(cleanPromptPhrase)
        .filter((part) => part && !isEmptyPromptValue(part));
      return unique(parts).join("，");
    })
    .filter(Boolean);
  text = unique(sentences).join("。");
  text = text.replace(/。+/g, "。").replace(/，+/g, "，").replace(/、+/g, "、");
  if (!/[。！？]$/.test(text)) text += "。";
  if (text.length > 220) text = `${text.slice(0, 218).replace(/[，；。][^，；。]*$/, "")}。`;
  return text;
}

function isEmptyPromptValue(value: string) {
  return !value || /^(\/|或|和|无|空间环境|undefined|null)$/i.test(value.trim());
}

function fullSpaceDesignRule() {
  return "采用普通影视全景构图，保留地面、墙面、背景和空间纵深，前景、中景、后景关系完整；家具和道具应分布在完整场景中，避免只呈现局部角落";
}

function cleanCoreSentence(value: string) {
  return value
    .replace(/；?\s*脚本相关(?:道具|视觉元素)[:：]\s*。?/g, "")
    .replace(/；?\s*脚本相关(?:道具|视觉元素)[:：]\s*$/g, "")
    .replace(/；{2,}/g, "；")
    .replace(/，{2,}/g, "，")
    .replace(/\s+/g, " ")
    .replace(/[；，]\s*。/g, "。")
    .replace(/[；，]$/g, "")
    .trim();
}

function visualOnly(value: string) {
  return value
    .replace(/无可输出：脚本未提供依据，且无法唯一推断/g, "")
    .replace(/仅根据[^，。；]*[，。；]?/g, "")
    .replace(/不重新分析脚本[，。；]?/g, "")
    .replace(/不新增[^，。；]*[，。；]?/g, "")
    .replace(/不遗漏[^，。；]*[，。；]?/g, "")
    .replace(/输出应[^，。；]*[，。；]?/g, "")
    .replace(/不得[^，。；]*[，。；]?/g, "")
    .replace(/根据[^，。；]*[，。；]?/g, "")
    .replace(/保持一致/g, "")
    .replace(/画面需清楚呈现/g, "")
    .replace(/脚本依据中的/g, "")
    .replace(/空间、道具和环境关系/g, "空间关系、环境")
    .replace(/空间与环境关系/g, "空间关系、环境")
    .replace(/小范围布景/g, "完整拍摄场景")
    .replace(/某个墙角/g, "完整墙面与空间结构")
    .replace(/房间一角/g, "房间整体")
    .replace(/空间一角/g, "空间整体")
    .replace(/场景一角/g, "场景整体")
    .replace(/角落/g, "完整空间")
    .replace(/墙边/g, "完整墙面与空间纵深")
    .replace(/沙发旁/g, "完整客厅空间")
    .replace(/床头区域/g, "完整卧室空间")
    .replace(/柜台一侧/g, "完整柜台和门店空间")
    .replace(/桌面/g, "完整空间中的桌面区域")
    .replace(/近景局部布景/g, "完整拍摄场景")
    .replace(/房间角落/g, "房间整体")
    .replace(/空间角落/g, "空间整体")
    .replace(/场景角落/g, "场景整体")
    .replace(/一隅/g, "整体空间")
    .replace(/局部区域/g, "整体区域")
    .replace(/局部空间/g, "整体空间")
    .replace(/局部场景/g, "整体场景")
    .replace(/由“[^”]*”[^，。；]*[，。；]?/g, "")
    .replace(/脚本相关[^，。；]*[:：]/g, "")
    .replace(/脚本关联[^，。；]*[:：]/g, "")
    .replace(/脚本中/g, "")
    .replace(/脚本/g, "")
    .replace(/依据/g, "")
    .replace(/推断/g, "")
    .replace(/出现/g, "")
    .replace(/例如/g, "")
    .replace(/等视觉元素/g, "")
    .replace(/等/g, "")
    .replace(/只保留/g, "")
    .replace(/脚本出现或唯一推断的/g, "")
    .replace(/核心产品/g, "")
    .replace(/产品互动道具/g, "")
    .replace(/互动道具/g, "")
    .replace(/小象/g, "")
    .replace(/产品/g, "")
    .replace(/道具/g, "")
    .replace(/不额外/g, "")
    .replace(/不/g, "")
    .replace(/无$/g, "")
    .replace(/\s+/g, "")
    .replace(/[；，。]+$/g, "")
    .trim();
}

function sceneCoreValue(coreRequirements: string, label: string) {
  const normalized = normalizeSceneCoreLabels(coreRequirements);
  const match = normalized.match(new RegExp(`\\*\\s*${label}[:：]([^\\n]+)`));
  return match?.[1]?.trim().replace(/[。；;]+$/, "") || "";
}

function buildSceneGroups(shots: WorkShot[], assets: Asset[]): SceneGroup[] {
  const grouped = new Map<string, WorkShot[]>();
  assets
    .filter((asset) => asset.type === "scene")
    .forEach((asset) => {
      const sceneName = asset.name.trim();
      if (sceneName && !grouped.has(sceneName)) grouped.set(sceneName, []);
    });
  sortShots(shots, "currentIndex").forEach((shot) => {
    const sceneName = shot.scene?.trim() || "未识别场景";
    grouped.set(sceneName, [...(grouped.get(sceneName) || []), shot]);
  });
  return Array.from(grouped.entries()).map(([sceneName, groupShots]) => ({ sceneName, shots: groupShots, batches: chunk(groupShots, 9).map((batchShots, index) => ({ id: `${sceneName}-${index + 1}`, index: index + 1, shots: batchShots })) }));
}

function visibleShotsForSelection(orderedShots: WorkShot[], groups: SceneGroup[], viewMode: ViewMode) {
  if (viewMode !== "scene") return orderedShots;
  return groups.flatMap((group) => group.batches.flatMap((batch) => batch.shots));
}

function findBatchForShot(groups: SceneGroup[], shotId?: string | null) {
  if (!shotId) return null;
  for (const group of groups) for (const batch of group.batches) if (batch.shots.some((shot) => shot.id === shotId)) return batch;
  return null;
}

function buildSinglePrompt(shot: WorkShot, assets: Asset[]) {
  return composePromptParts(shotPromptParts(shot, assets));
}

function buildBatchPrompt(shots: WorkShot[], assets: Asset[]) {
  return sortShots(shots, "originalIndex")
    .map((shot) => `镜头${shot.originalShotNo}：${composePromptParts(shotPromptParts(shot, assets))}`)
    .join("\n\n");
}

function buildScriptContentBlock(shots: WorkShot[], ratio: string) {
  const shotBlocks = shots
    .map(
      (shot) => `镜头 ${shot.originalShotNo}
场景：${shot.scene || ""}
人物：${shot.characters || ""}
核心道具：${shot.propsText || ""}
景别：${shot.shotSize || ""}
画面内容：${shot.scriptText || ""}
台词 / 旁白 / 同期声：${shot.dialogue || shot.copy || ""}
镜头运动：${shot.cameraMove || ""}
备注：${shot.notes || ""}`,
    )
    .join("\n\n");
  return `${shotBlocks}

生成 3×3 九宫格黑白分镜草稿图，共 9 个镜头，每格一个独立画面，按从左到右、从上到下排序，并添加镜头比例，画面比例为 ${ratio}。`;
}

function shotToXlsxPreviewRow(shot: WorkShot): XlsxPreviewRow {
  return {
    originalShotNo: shot.originalShotNo,
    currentShotNo: shot.currentShotNo,
    originalIndex: shot.originalIndex,
    currentIndex: shot.currentIndex,
    scene: shot.scene || "",
    characters: shot.characters || "",
    propsText: shot.propsText || "",
    shotSize: shot.shotSize || "",
    scriptText: shot.scriptText || "",
    dialogue: shot.dialogue || shot.copy || "",
    cameraMove: shot.cameraMove || "",
    notes: shot.notes || "",
    imagePath: shot.imageUrl ? "已回填图片" : "",
    imageUrl: shot.annotatedImage || shot.imageUrl || "",
    status: statusLabels[shot.status],
  };
}

function storyboardXlsxRowToCells(row: XlsxPreviewRow) {
  return [
    row.originalShotNo,
    row.scene,
    row.characters,
    row.propsText,
    row.shotSize,
    row.cameraMove,
    row.scriptText,
    row.imageUrl ? "" : row.imagePath,
    row.dialogue,
    row.notes,
  ];
}

function requirementsForAssets(assets: Asset[], type: AssetType, names: string[]) {
  const cleanNames = unique(names.map((name) => name.trim()).filter(Boolean));
  if (!cleanNames.length) return type === "scene" ? "未识别场景，请根据当前镜头内容保持统一。" : type === "character" ? "无明确人物。" : "无明确核心道具。";
  return cleanNames.map((name) => {
    const asset = assets.find((item) => item.type === type && item.name === name);
    return asset ? getActiveAssetPrompt(asset) || asset.coreRequirements || name : name;
  }).join("\n\n");
}

function splitNames(value: string) {
  return unique(value.split(/[、，,\/；;\n]+|和|及|与/g).map((item) => item.trim()).filter(Boolean));
}

function inferCorePropsFromShotText(text: string) {
  const props = text.match(/尿布台|护理台|抚触台|纸尿裤|尿不湿|奶瓶|水杯|水壶|婴儿床|沙发|茶几|地毯|餐桌|餐椅|儿童餐椅|辅食椅|碗|勺|浴盆|澡盆|毛巾|洗护用品|货架|展示台|咨询台|收银台|柜台|小象|大软包|软包|玩具|收纳篮|湿巾|推车|安全座椅|抱枕|窗帘|夜灯|绘本|奶粉罐|橱柜|厨房台面/g) || [];
  return unique(props).join("、");
}

function unique<T>(items: T[]) { return Array.from(new Set(items)); }
function normalizeName(value = "") { return value.replace(/\s/g, "").replace(/[：:]+$/, ""); }
function clamp01(value: number) { return Math.min(1, Math.max(0, value)); }
function clampAnnotationRect<T extends Extract<ImageAnnotation, { type: "rect" | "text" }>>(annotation: T): T {
  const width = Math.min(Math.max(annotation.width, 0.03), 1);
  const height = Math.min(Math.max(annotation.height, 0.03), 1);
  return {
    ...annotation,
    x: Math.min(Math.max(0, annotation.x), Math.max(0, 1 - width)),
    y: Math.min(Math.max(0, annotation.y), Math.max(0, 1 - height)),
    width,
    height,
  };
}
function clampArrow(annotation: Extract<ImageAnnotation, { type: "arrow" }>) {
  const startX = clamp01(annotation.startX);
  const startY = clamp01(annotation.startY);
  const endX = clamp01(annotation.endX);
  const endY = clamp01(annotation.endY);
  return {
    ...annotation,
    startX,
    startY,
    endX,
    endY,
    x: Math.min(startX, endX),
    y: Math.min(startY, endY),
    width: Math.abs(endX - startX),
    height: Math.abs(endY - startY),
  };
}
function moveAnnotation(annotation: ImageAnnotation, dx: number, dy: number): ImageAnnotation {
  if (annotation.type === "arrow") {
    const minX = Math.min(annotation.startX, annotation.endX);
    const maxX = Math.max(annotation.startX, annotation.endX);
    const minY = Math.min(annotation.startY, annotation.endY);
    const maxY = Math.max(annotation.startY, annotation.endY);
    const nextDx = Math.min(Math.max(dx, -minX), 1 - maxX);
    const nextDy = Math.min(Math.max(dy, -minY), 1 - maxY);
    return clampArrow({ ...annotation, startX: annotation.startX + nextDx, startY: annotation.startY + nextDy, endX: annotation.endX + nextDx, endY: annotation.endY + nextDy });
  }
  return clampAnnotationRect({ ...annotation, x: annotation.x + dx, y: annotation.y + dy });
}
function uniqueAssetName(assets: Asset[], type: AssetType, baseName: string) {
  const used = new Set(assets.filter((asset) => asset.type === type).map((asset) => asset.name.trim()));
  if (!used.has(baseName)) return baseName;
  for (let index = 2; index < 1000; index += 1) {
    const name = `${baseName}${index}`;
    if (!used.has(name)) return name;
  }
  return `${baseName}${Date.now()}`;
}
function assetKey(type: AssetType, name: string) { return `${type}:${name.replace(/\s/g, "").replace(/[：:]+$/, "")}`; }
function sortShots(shots: WorkShot[], key: "originalIndex" | "currentIndex") { return [...shots].sort((a, b) => a[key] - b[key]); }
function chunk<T>(items: T[], size: number) { const out: T[][] = []; for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size)); return out; }
function renumberCurrent(shots: WorkShot[]) { return shots.map((shot, index) => ({ ...shot, currentIndex: index + 1 })); }
function toggleSelected(id: string, setSelectedIds: React.Dispatch<React.SetStateAction<string[]>>) { setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); }
function boxesIntersect(a: SelectBox, b: SelectBox) { return a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top; }
function cloneSnapshot(snapshot: AppSnapshot) { return JSON.parse(JSON.stringify(snapshot)) as AppSnapshot; }
function stripLargeImage(shot: WorkShot) { return shot.imageUrl?.startsWith("data:image/") && shot.imageUrl.length > 350_000 ? { ...shot, imageUrl: "" } : shot; }
function fileToDataUrl(file: File) { return new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(file); }); }
async function copyText(text: string) { try { await navigator.clipboard.writeText(text); return true; } catch { const textarea = document.createElement("textarea"); textarea.value = text; document.body.appendChild(textarea); textarea.select(); const ok = document.execCommand("copy"); textarea.remove(); return ok; } }
function isTypingTarget(element: Element | null) { const tag = element?.tagName.toLowerCase(); return tag === "input" || tag === "textarea" || Boolean(element?.hasAttribute("contenteditable")); }
function safeName(value: string) { return (value || "分镜项目").replace(/[\\/:*?"<>|]/g, "-").slice(0, 60); }
function timestamp() { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}_${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`; }

async function shotsWithAnnotatedImages(shots: WorkShot[]) {
  return Promise.all(
    shots.map(async (shot) => {
      const annotations = shot.annotations || [];
      if (!shot.imageUrl || !annotations.length) return { ...shot, annotatedImage: "" };
      const annotatedImage = await generateAnnotatedImage(shot.imageUrl, annotations).catch(() => shot.annotatedImage || "");
      return { ...shot, annotatedImage };
    }),
  );
}

function createProjectId() {
  return `project_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function createEmptyProjectState(id = createProjectId()): ProjectState {
  const now = new Date().toISOString();
  return {
    id,
    name: "未命名项目",
    shots: [],
    assets: [],
    characterRoles: [],
    activeShotId: null,
    selectedShotIds: [],
    viewMode: "original",
    assetTab: "scene",
    storyboardRatio: "16:9",
    selectedImageShotId: null,
    editorState: {
      scrollTop: 0,
      currentStep: "empty",
    },
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}

function loadLegacyProject(id: string): ProjectState | null {
  const saved = localStorage.getItem(storageKey);
  if (!saved) return null;
  try {
    const parsed = JSON.parse(saved) as { projectName?: string; shots?: WorkShot[]; assets?: Asset[]; characterRoles?: CharacterRole[]; activeId?: string };
    const shots = parsed.shots?.map(sanitizeShotScene) || [];
    const now = new Date().toISOString();
    return {
      ...createEmptyProjectState(id),
      name: parsed.projectName || "分镜项目",
      shots,
      assets: parsed.assets || deriveAssets(shots, []),
      characterRoles: parsed.characterRoles?.length ? parsed.characterRoles : deriveCharacterRoles(shots, []),
      activeShotId: parsed.activeId || shots[0]?.id || null,
      createdAt: now,
      updatedAt: now,
    };
  } catch {
    localStorage.removeItem(storageKey);
    return null;
  }
}

function formatSaveTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function openProjectDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("libtv-storyboard-projects", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("projects")) db.createObjectStore("projects", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveProjectToIndexedDB(project: ProjectState) {
  const db = await openProjectDb();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction("projects", "readwrite");
    transaction.objectStore("projects").put(project);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      const error = transaction.error;
      db.close();
      reject(error);
    };
  });
}

async function loadProjectFromIndexedDB(id: string) {
  const db = await openProjectDb();
  return new Promise<ProjectState | null>((resolve, reject) => {
    const transaction = db.transaction("projects", "readonly");
    const request = transaction.objectStore("projects").get(id);
    request.onsuccess = () => {
      db.close();
      resolve((request.result as ProjectState | undefined) || null);
    };
    request.onerror = () => {
      const error = request.error;
      db.close();
      reject(error);
    };
  });
}

async function loadProjectFromSharedStore(id: string) {
  const response = await fetch(`/api/restore-project?id=${encodeURIComponent(id)}`);
  if (!response.ok) return null;
  return (await response.json()) as ProjectState;
}

async function downloadStoryboardXlsx(rows: XlsxPreviewRow[], name: string) {
  const headers = ["镜号", "场景", "人物", "核心道具", "景别", "运镜", "画面描述", "画面示意", "旁白VO", "备注"];
  const imageEntries = (await Promise.all(rows.map((row, index) => dataUrlToImageEntry(row.imageUrl, index + 1)))).filter(Boolean) as Array<{
    rowIndex: number;
    path: string;
    name: string;
    data: Uint8Array;
    ext: string;
    width: number;
    height: number;
  }>;
  const hasImages = imageEntries.length > 0;
  const sheetRows = [headers, ...rows.map(storyboardXlsxRowToCells)];
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <cols>
    <col min="1" max="1" width="8" customWidth="1"/>
    <col min="2" max="2" width="16" customWidth="1"/>
    <col min="3" max="3" width="16" customWidth="1"/>
    <col min="4" max="4" width="18" customWidth="1"/>
    <col min="5" max="5" width="10" customWidth="1"/>
    <col min="6" max="6" width="14" customWidth="1"/>
    <col min="7" max="7" width="42" customWidth="1"/>
    <col min="8" max="8" width="56" customWidth="1"/>
    <col min="9" max="9" width="28" customWidth="1"/>
    <col min="10" max="10" width="32" customWidth="1"/>
  </cols>
  <sheetData>
    ${sheetRows
      .map((row, rowIndex) => {
        const height = rowIndex === 0 ? 34 : 150;
        const style = rowIndex === 0 ? 1 : 2;
        return `<row r="${rowIndex + 1}" ht="${height}" customHeight="1">${row
          .map((cell, cellIndex) => {
            const ref = `${columnName(cellIndex + 1)}${rowIndex + 1}`;
            return `<c r="${ref}" s="${style}" t="inlineStr"><is><t>${escapeXml(String(cell ?? ""))}</t></is></c>`;
          })
          .join("")}</row>`;
      })
      .join("")}
  </sheetData>
  ${hasImages ? '<drawing r:id="rId1"/>' : ""}
</worksheet>`;

  const entries: Array<{ path: string; data: Uint8Array }> = [
    zipText("[Content_Types].xml", xlsxContentTypes(hasImages, imageEntries)),
    zipText("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    zipText("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="分镜表" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    zipText("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    zipText("xl/styles.xml", xlsxStyles()),
    zipText("xl/worksheets/sheet1.xml", sheet),
  ];

  if (hasImages) {
    entries.push(zipText("xl/worksheets/_rels/sheet1.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`));
    entries.push(zipText("xl/drawings/drawing1.xml", xlsxDrawing(imageEntries)));
    entries.push(zipText("xl/drawings/_rels/drawing1.xml.rels", xlsxDrawingRels(imageEntries)));
    imageEntries.forEach((image) => entries.push({ path: image.path, data: image.data }));
  }

  const blob = new Blob([zipStore(entries)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.appendChild(link);
  link.click();
  URL.revokeObjectURL(link.href);
  link.remove();
}

async function dataUrlToImageEntry(dataUrl: string, rowIndex: number) {
  if (!dataUrl?.startsWith("data:image/")) return null;
  const match = dataUrl.match(/^data:(image\/(?:png|jpe?g));base64,(.+)$/);
  if (!match) return null;
  const mime = match[1];
  const ext = mime.includes("png") ? "png" : "jpg";
  const size = await imageSizeFromDataUrl(dataUrl).catch(() => ({ width: 16, height: 9 }));
  const binary = atob(match[2]);
  const data = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) data[index] = binary.charCodeAt(index);
  return {
    rowIndex,
    path: `xl/media/image${rowIndex}.${ext}`,
    name: `image${rowIndex}.${ext}`,
    data,
    ext,
    width: size.width,
    height: size.height,
  };
}

function imageSizeFromDataUrl(dataUrl: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth || 16, height: image.naturalHeight || 9 });
    image.onerror = reject;
    image.src = dataUrl;
  });
}

async function detectLibTvGridFrame(imageUrl: string, width: number, height: number) {
  const image = await loadImageElement(imageUrl);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return { frame: fallbackGridFrame(width, height), warning: "自动识别失败，请手动调整九宫格整体裁切框。" };
  context.drawImage(image, 0, 0, width, height);
  const { data } = context.getImageData(0, 0, width, height);
  const bounds = detectContentBounds(data, width, height);
  const verticalLines = detectProjectionLines(data, width, height, bounds, "vertical");
  const horizontalLines = detectProjectionLines(data, width, height, bounds, "horizontal");
  const boxesFromLines = boxesFromGridLines(verticalLines, horizontalLines);
  if (boxesFromLines.length === 9) return { frame: frameFromBoxes(sortGridBoxes(boxesFromLines)), warning: "" };
  return {
    frame: frameFromBounds(bounds, "manual-adjust", 0.45),
    warning: "自动识别结果可能不准确，请手动调整九宫格整体裁切框。",
  };
}

function loadImageElement(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

async function generateAnnotatedImage(imageUrl: string, annotations: ImageAnnotation[] = []) {
  if (!imageUrl || !annotations.length) return imageUrl || "";
  const image = await loadImageElement(imageUrl);
  const width = image.naturalWidth || 1280;
  const height = image.naturalHeight || 720;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return imageUrl;
  context.drawImage(image, 0, 0, width, height);
  annotations.forEach((annotation) => drawAnnotation(context, annotation, width, height));
  return canvas.toDataURL("image/png");
}

function drawAnnotation(context: CanvasRenderingContext2D, annotation: ImageAnnotation, width: number, height: number) {
  context.save();
  if (annotation.type === "text") {
    const fontSize = Math.max(12, annotation.fontSize * width);
    context.font = `700 ${fontSize}px Arial, "Microsoft YaHei", sans-serif`;
    context.fillStyle = annotation.color;
    context.strokeStyle = "rgba(255,255,255,0.9)";
    context.lineWidth = Math.max(2, fontSize * 0.08);
    const x = annotation.x * width;
    let y = annotation.y * height + fontSize;
    const maxWidth = Math.max(20, annotation.width * width);
    wrapAnnotationText(annotation.text || "请输入文字", maxWidth, context).forEach((line) => {
      context.strokeText(line, x, y);
      context.fillText(line, x, y);
      y += fontSize * 1.18;
    });
  } else if (annotation.type === "rect") {
    context.strokeStyle = annotation.color;
    context.lineWidth = annotation.strokeWidth;
    context.strokeRect(annotation.x * width, annotation.y * height, annotation.width * width, annotation.height * height);
  } else if (annotation.type === "arrow") {
    drawCanvasArrow(context, annotation.startX * width, annotation.startY * height, annotation.endX * width, annotation.endY * height, annotation.color, annotation.strokeWidth);
  }
  context.restore();
}

function wrapAnnotationText(text: string, maxWidth: number, context: CanvasRenderingContext2D) {
  const lines: string[] = [];
  text.split(/\n/).forEach((paragraph) => {
    let line = "";
    Array.from(paragraph || " ").forEach((char) => {
      const next = `${line}${char}`;
      if (line && context.measureText(next).width > maxWidth) {
        lines.push(line);
        line = char;
      } else {
        line = next;
      }
    });
    lines.push(line);
  });
  return lines;
}

function drawCanvasArrow(context: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, strokeWidth: number) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const headLength = Math.max(12, strokeWidth * 4);
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = strokeWidth;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(x2, y2);
  context.stroke();
  context.beginPath();
  context.moveTo(x2, y2);
  context.lineTo(x2 - headLength * Math.cos(angle - Math.PI / 6), y2 - headLength * Math.sin(angle - Math.PI / 6));
  context.lineTo(x2 - headLength * Math.cos(angle + Math.PI / 6), y2 - headLength * Math.sin(angle + Math.PI / 6));
  context.closePath();
  context.fill();
}

function detectContentBounds(data: Uint8ClampedArray, width: number, height: number) {
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const gray = (r + g + b) / 3;
      const colorSpread = Math.max(r, g, b) - Math.min(r, g, b);
      if (gray < 238 || colorSpread > 18) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (minX >= maxX || minY >= maxY) return { x: 0, y: 0, width, height };
  const pad = Math.max(4, Math.round(Math.min(width, height) * 0.01));
  return {
    x: Math.max(0, minX - pad),
    y: Math.max(0, minY - pad),
    width: Math.min(width - Math.max(0, minX - pad), maxX - minX + pad * 2),
    height: Math.min(height - Math.max(0, minY - pad), maxY - minY + pad * 2),
  };
}

function detectProjectionLines(data: Uint8ClampedArray, width: number, height: number, bounds: CropRect, axis: "vertical" | "horizontal") {
  const start = axis === "vertical" ? Math.round(bounds.x) : Math.round(bounds.y);
  const end = axis === "vertical" ? Math.round(bounds.x + bounds.width) : Math.round(bounds.y + bounds.height);
  const otherStart = axis === "vertical" ? Math.round(bounds.y) : Math.round(bounds.x);
  const otherEnd = axis === "vertical" ? Math.round(bounds.y + bounds.height) : Math.round(bounds.x + bounds.width);
  const scores: Array<{ pos: number; score: number }> = [];
  for (let pos = start; pos < end; pos += 1) {
    let dark = 0;
    for (let other = otherStart; other < otherEnd; other += 1) {
      const x = axis === "vertical" ? pos : other;
      const y = axis === "vertical" ? other : pos;
      const index = (y * width + x) * 4;
      const gray = (data[index] + data[index + 1] + data[index + 2]) / 3;
      if (gray < 205) dark += 1;
    }
    scores.push({ pos, score: dark / Math.max(1, otherEnd - otherStart) });
  }
  const threshold = Math.max(0.18, scores.reduce((max, item) => Math.max(max, item.score), 0) * 0.45);
  const groups: Array<{ start: number; end: number; score: number }> = [];
  let current: { start: number; end: number; score: number } | null = null;
  scores.forEach((item) => {
    if (item.score >= threshold) {
      current = current ? { start: current.start, end: item.pos, score: Math.max(current.score, item.score) } : { start: item.pos, end: item.pos, score: item.score };
    } else if (current) {
      groups.push(current);
      current = null;
    }
  });
  if (current) groups.push(current);
  const linePositions = groups
    .filter((group) => group.end - group.start <= Math.max(18, (end - start) * 0.08))
    .map((group) => Math.round((group.start + group.end) / 2));
  return normalizeGridLines([start, ...linePositions, end], start, end);
}

function normalizeGridLines(lines: number[], start: number, end: number) {
  const sorted = unique(lines.map(Math.round)).sort((a, b) => a - b);
  const minGap = (end - start) * 0.12;
  const merged = sorted.reduce<number[]>((acc, line) => {
    if (!acc.length || line - acc[acc.length - 1] > minGap) acc.push(line);
    else acc[acc.length - 1] = Math.round((acc[acc.length - 1] + line) / 2);
    return acc;
  }, []);
  if (merged.length >= 4) return pickFourGridLines(merged, start, end);
  return [];
}

function pickFourGridLines(lines: number[], start: number, end: number) {
  if (lines.length === 4) return lines;
  const expected = [start, start + (end - start) / 3, start + ((end - start) * 2) / 3, end];
  return expected.map((value) => lines.reduce((best, line) => (Math.abs(line - value) < Math.abs(best - value) ? line : best), lines[0]));
}

function boxesFromGridLines(vertical: number[], horizontal: number[]) {
  if (vertical.length !== 4 || horizontal.length !== 4) return [];
  const boxes: GridCropBox[] = [];
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      const index = row * 3 + col + 1;
      boxes.push({
        id: crypto.randomUUID(),
        index,
        x: vertical[col],
        y: horizontal[row],
        width: vertical[col + 1] - vertical[col],
        height: horizontal[row + 1] - horizontal[row],
        confidence: 0.82,
        source: "auto-detect",
      });
    }
  }
  return boxes.filter((box) => box.width > 20 && box.height > 20);
}

function fallbackGridBoxes(width: number, height: number, bounds: CropRect = { x: 0, y: 0, width, height }) {
  const boxes: GridCropBox[] = [];
  const cellW = bounds.width / 3;
  const cellH = bounds.height / 3;
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      const index = row * 3 + col + 1;
      boxes.push({
        id: crypto.randomUUID(),
        index,
        x: bounds.x + col * cellW,
        y: bounds.y + row * cellH,
        width: cellW,
        height: cellH,
        confidence: 0.45,
        source: "manual-adjust",
      });
    }
  }
  return boxes;
}

function fallbackGridFrame(width: number, height: number) {
  const inset = Math.round(Math.min(width, height) * 0.04);
  return frameFromBounds({ x: inset, y: inset, width: Math.max(24, width - inset * 2), height: Math.max(24, height - inset * 2) }, "manual-adjust", 0.45);
}

function frameFromBounds(bounds: CropRect, source: GridCropFrame["source"], confidence: number): GridCropFrame {
  return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, source, confidence };
}

function frameFromBoxes(boxes: GridCropBox[]): GridCropFrame {
  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxX = Math.max(...boxes.map((box) => box.x + box.width));
  const maxY = Math.max(...boxes.map((box) => box.y + box.height));
  return frameFromBounds({ x: minX, y: minY, width: maxX - minX, height: maxY - minY }, "auto-detect", 0.82);
}

function sortGridBoxes(boxes: GridCropBox[]) {
  const rows = [...boxes]
    .sort((a, b) => a.y + a.height / 2 - (b.y + b.height / 2))
    .reduce<GridCropBox[][]>((acc, box) => {
      const centerY = box.y + box.height / 2;
      const row = acc.find((items) => Math.abs(items[0].y + items[0].height / 2 - centerY) < Math.max(items[0].height, box.height) * 0.6);
      if (row) row.push(box);
      else acc.push([box]);
      return acc;
    }, []);
  return rows
    .slice(0, 3)
    .flatMap((row, rowIndex) =>
      row
        .sort((a, b) => a.x + a.width / 2 - (b.x + b.width / 2))
        .slice(0, 3)
        .map((box, colIndex) => ({ ...box, index: rowIndex * 3 + colIndex + 1 })),
    )
    .sort((a, b) => a.index - b.index);
}

function clampGridBox(rect: CropRect, maxWidth: number, maxHeight: number) {
  const width = Math.min(Math.max(24, rect.width), maxWidth);
  const height = Math.min(Math.max(24, rect.height), maxHeight);
  const x = Math.min(Math.max(0, rect.x), Math.max(0, maxWidth - width));
  const y = Math.min(Math.max(0, rect.y), Math.max(0, maxHeight - height));
  return { x, y, width, height };
}

function gridBoxesFromFrame(frame: CropRect) {
  return fallbackGridBoxes(frame.width, frame.height).map((box) => ({
    ...box,
    x: frame.x + box.x,
    y: frame.y + box.y,
    source: "manual-adjust" as const,
    confidence: 0.8,
  }));
}

async function cropImageByGridFrame(imageUrl: string, frame: CropRect) {
  return cropImageByBoxes(imageUrl, gridBoxesFromFrame(frame));
}

async function cropImageByBoxes(imageUrl: string, boxes: GridCropBox[]) {
  const image = await loadImageElement(imageUrl);
  return boxes
    .sort((a, b) => a.index - b.index)
    .map((box) => {
      const inset = 4;
      const sourceX = Math.max(0, Math.round(box.x + inset));
      const sourceY = Math.max(0, Math.round(box.y + inset));
      const sourceWidth = Math.max(1, Math.round(box.width - inset * 2));
      const sourceHeight = Math.max(1, Math.round(box.height - inset * 2));
      const canvas = document.createElement("canvas");
      canvas.width = sourceWidth;
      canvas.height = sourceHeight;
      const context = canvas.getContext("2d");
      if (!context) return "";
      context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);
      return canvas.toDataURL("image/png");
    })
    .filter(Boolean);
}

function xlsxContentTypes(hasImages: boolean, images: Array<{ ext: string }>) {
  const imageDefaults = unique(images.map((image) => image.ext))
    .map((ext) => `<Default Extension="${ext}" ContentType="${ext === "png" ? "image/png" : "image/jpeg"}"/>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  ${imageDefaults}
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  ${hasImages ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' : ""}
</Types>`;
}

function xlsxStyles() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2"><font><sz val="11"/><name val="Microsoft YaHei"/></font><font><b/><sz val="12"/><name val="Microsoft YaHei"/></font></fonts>
  <fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEFF1F3"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD7DCE0"/></left><right style="thin"><color rgb="FFD7DCE0"/></right><top style="thin"><color rgb="FFD7DCE0"/></top><bottom style="thin"><color rgb="FFD7DCE0"/></bottom><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="3" borderId="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf></cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

function xlsxDrawing(images: Array<{ rowIndex: number; name: string; width: number; height: number }>) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  ${images
    .map((image, index) => {
      const sheetRow = image.rowIndex + 1;
      const fit = fitImageForXlsxCell(image.width, image.height);
      return `<xdr:oneCellAnchor>
    <xdr:from><xdr:col>7</xdr:col><xdr:colOff>${fit.offsetX}</xdr:colOff><xdr:row>${sheetRow - 1}</xdr:row><xdr:rowOff>${fit.offsetY}</xdr:rowOff></xdr:from>
    <xdr:ext cx="${fit.width}" cy="${fit.height}"/>
    <xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${index + 2}" name="${escapeXml(image.name)}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId${index + 1}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:ln><a:noFill/></a:ln></xdr:spPr></xdr:pic>
    <xdr:clientData/>
  </xdr:oneCellAnchor>`;
    })
    .join("")}
</xdr:wsDr>`;
}

function fitImageForXlsxCell(width: number, height: number) {
  const cellWidth = 3_650_000;
  const cellHeight = 1_830_000;
  const padding = 90_000;
  const maxWidth = cellWidth - padding * 2;
  const maxHeight = cellHeight - padding * 2;
  const ratio = width / height || 16 / 9;
  let fittedWidth = maxWidth;
  let fittedHeight = Math.round(fittedWidth / ratio);
  if (fittedHeight > maxHeight) {
    fittedHeight = maxHeight;
    fittedWidth = Math.round(fittedHeight * ratio);
  }
  return {
    width: fittedWidth,
    height: fittedHeight,
    offsetX: padding + Math.round((maxWidth - fittedWidth) / 2),
    offsetY: padding + Math.round((maxHeight - fittedHeight) / 2),
  };
}

function xlsxDrawingRels(images: Array<{ name: string }>) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${images.map((image, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${escapeXml(image.name)}"/>`).join("")}
</Relationships>`;
}

function escapeXml(value: string) { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;"); }

function columnName(index: number) {
  let name = "";
  let current = index;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - 1) / 26);
  }
  return name;
}

function zipText(path: string, text: string) {
  return { path, data: new TextEncoder().encode(text) };
}

function zipStore(entries: Array<{ path: string; data: Uint8Array }>) {
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
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value: number) { return new Uint8Array([value & 255, (value >>> 8) & 255]); }
function u32(value: number) { return new Uint8Array([value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]); }
function concat(chunks: Uint8Array[]) { const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0)); let offset = 0; chunks.forEach((chunk) => { out.set(chunk, offset); offset += chunk.length; }); return out; }
