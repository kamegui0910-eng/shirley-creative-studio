# Muse 集成报告（Shirley Design Intelligence）

日期：2026-11-22。分支：`muse/design-intelligence-integration-2026-11-22`（基于 `main`），PR 目标分支为 `main`（不直接推 Codex/Claude 的分支；Codex 的 Phase 1 分支另行合并，两个分支新增文件无重叠，可干净合并）。

## 交付内容（本 PR，只含可公开部分）

| 文件 | 内容 |
|---|---|
| `design-intelligence/data/asset-catalog-public.json` | 94 条原创 SVG 套件记录（INS S1 54 + 像素 S2 40），公开 ID 为 `kit:category:basename`，**不含 Drive ID、md5、缩略图链接、文件夹路径** |
| `design-intelligence/data/previews-manifest-public.json` | 94 条预览清单（kit/category/文件/字节/尺寸），同样去私有元数据 |
| `design-intelligence/public/previews/<kit>/<cat>/*.png` | 94 张 SVG 渲染预览（2x 白底 PNG，共约 468KB） | **注**：预览 PNG 是二进制文件，GitHub 连接器只推 UTF-8 文本，本 PR 改为携带清单 + `tools/render-svg-previews.py`（可字节一致重生成）；已渲染的 PNG 在私有交付 bundle 里 |
| `design-intelligence/tools/render-svg-previews.py` | 渲染脚本：SVG → 2x 白底 PNG（cairosvg），94 张已验证 | — |
| `design-intelligence/docs/API_FIELD_MAPPING.md` | 字段映射：dev-index v2 → 公开 catalog → App studio-index；含 Claude UI 缺失值处理；Codex D1 一栏待补 |
| `design-intelligence/docs/MOV_TODO.md` | 8 段 MOV 待处理清单（不阻塞图片/SVG 集成） |
| `design-intelligence/docs/MUSE_INTEGRATION_REPORT.md` | 本文件 |
| `design-intelligence/tools/validate-dev-index.py` | 校验脚本（21 项，见下） |

**不在本 PR 内**（私有交付 + Codex 受鉴权 D1）：325 条完整 dev-index（含 Drive ID、md5、人工摘要）、72 项完整分类记录、355 项 Drive inventory、参考原图。公开仓库不放完整私人 Drive 文件清单。

## 完整性结果（校验脚本 21/21 通过，2026-11-22）

- dev-index：325 条，ID 唯一，全部含 driveFileId + md5；72 项已分类在册；S6 桶 177 条原样保留，未重复目视。
- 公开 catalog：94 条，ID 唯一且符合命名空间；与 dev-index 的 94 个 SVG 一一对应（无缺失、无多余）；扫描确认无 Drive ID、md5、缩略图链接、文件夹路径。
- 预览：94/94 存在且为有效 PNG；清单 94 条一致。
- 本地 API（参考实现，127.0.0.1:8901）：/health 325 条；rights=restricted 32 条；分页 offset 0/125/250 合计 325；预览 200；缺失预览 404。
- 增量同步：最后一次实测（2026-11-22 11:52 ET）0 变更，pageToken 4085；inventory 仍最新。
- 密钥扫描：PR 树干净，无 token/key/私钥。

## 与 Codex、Claude 的交接状态

- **Codex**：其 Phase 1 分支已有 API、D1 迁移与 openapi.json；本 PR 基于 `main`，与 Codex 分支新增文件无重叠，可干净合并。字段映射文档第 6 节已按实测的 openapi.json（v1.1.0）与 `0001_index.sql` 写完，含两处分歧：`original-vector` 在 D1 无对应档（映射为 `unverified`，绝不能写 `commercial_ready`）；`approved` 无记录可直接导入。
- **Claude**：其预览编辑器分支基于同一 Phase 1 包，含演示索引与 UI；本 PR 的 94 条真实 catalog 可替换其演示索引。UI 缺失值处理已写入映射文档第 2、7 节，待 Claude 确认。
- **分歧处理**：接口以 `docs/API_FIELD_MAPPING.md` 为准；如 Codex 的 openapi 枚举与本文件不一致，双方确认后再改一边。

## 剩余阻塞

1. **GitHub Contents 写入权限已解决**：Shirley 安装了 Muse GitHub App（`meta-muse-ai`），分支已建、PR 已提交（见上）。
2. **私有 bundle 链接有时效**：完整私有交付包链接 2026-11-24 18:10 UTC 过期，需在过期前转给 Codex；或由 Codex 将 325 条完整索引导入受鉴权的 D1 后以 D1 为准。
3. **72 项待人工复核**：`reviewStatus=classified-unreviewed`，合进正式索引前需第二人复核；D1 中对应 `review='pending'` + `classification_queue`。
