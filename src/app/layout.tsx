import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "半自动分镜脚本整理与回填导出工具",
  description: "导入脚本表格，整理分镜提示词，回填 LibTV 成图并导出 PPTX / XLS 表格。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
