export type ArrowMotion = "straight" | "curveUp" | "curveRight" | "推" | "拉" | "摇左" | "摇右" | "上移" | "下移";

export type CanvasElement =
  | {
      id: string;
      type: "label";
      text: string;
      x: number;
      y: number;
      scale?: number;
      rotation?: number;
      flipX?: boolean;
      flipY?: boolean;
    }
  | {
      id: string;
      type: "rect";
      x: number;
      y: number;
      width: number;
      height: number;
      scale?: number;
      rotation?: number;
      flipX?: boolean;
      flipY?: boolean;
    }
  | {
      id: string;
      type: "arrow";
      motion: ArrowMotion;
      x1?: number;
      y1?: number;
      x2?: number;
      y2?: number;
      x?: number;
      y?: number;
      width?: number;
      height?: number;
      scale?: number;
      rotation?: number;
      flipX?: boolean;
      flipY?: boolean;
    };

export type ImageAnnotation =
  | {
      id: string;
      type: "text";
      x: number;
      y: number;
      width: number;
      height: number;
      text: string;
      fontSize: number;
      color: string;
      strokeWidth?: number;
    }
  | {
      id: string;
      type: "arrow";
      x: number;
      y: number;
      width: number;
      height: number;
      color: string;
      strokeWidth: number;
      startX: number;
      startY: number;
      endX: number;
      endY: number;
    }
  | {
      id: string;
      type: "rect";
      x: number;
      y: number;
      width: number;
      height: number;
      color: string;
      strokeWidth: number;
    };

export type StoryboardShot = {
  id: string;
  shotNumber: number;
  shotLabel?: string;
  scene?: string;
  characters?: string;
  scriptText: string;
  shotSize: string;
  reference: string;
  cameraMove: string;
  copy: string;
  notes: string;
  flowerText?: string;
  product?: string;
  imagePrompt: string;
  referenceImages: string[];
  imageUrl: string;
  annotations?: ImageAnnotation[];
  annotatedImage?: string;
  canvasElements: CanvasElement[];
  sourceTable?: {
    headers: string[];
    cells: string[];
    referenceColumnIndex: number;
  };
};
