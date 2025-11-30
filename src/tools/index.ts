import { Bash } from "./bash";
import { Read, Write, Glob, Grep, Edit, LS } from "./file";

// 导出所有工具
export const tools = [Bash, Read, Write, Glob, Grep, Edit, LS];

// 按名称导出
export { Bash, Read, Write, Glob, Grep, Edit, LS };

// 工具描述（用于帮助信息）
export const toolDescriptions = [
  { name: "Bash", description: "执行 shell 命令（大输出自动保存到临时文件）" },
  { name: "Read", description: "读取文件内容（支持分页）" },
  { name: "Write", description: "写入文件内容" },
  { name: "Edit", description: "编辑文件（字符串替换）" },
  { name: "Glob", description: "文件模式匹配搜索（如 **/*.ts）" },
  { name: "Grep", description: "在文件内容中搜索文本" },
  { name: "LS", description: "列出目录内容" },
];
