# API 字段映射（Muse → Codex / Claude）

版本：2026-11-22。状态：**dev-index v2 → 公开 catalog → App studio-index 的映射已验证**；Codex D1 / openapi.json 一栏待补——Codex 的 `design-intelligence/openapi.json` 与 `migrations/0001_index.sql` 尚未读到（2026-11-22 12:30 读取授权超时，未重试），Codex 看到本文件后请直接补上 D1 列。

## 1. 记录标识

| 概念 | dev-index v2（私有，325 条） | 公开 catalog（94 条） | App studio-index | D1（Codex 补） |
|---|---|---|---|---|
| 资产 ID | `id` = `drive:<driveFileId>` | `id` = `<kit>:<category>:<basename>`，如 `ins:icons:heart`、`px:frames:calendar` | `id` = `drive:<driveFileId>`（与 dev-index 一致） | 待补 |
| Drive 文件 ID | `driveFileId`（私有） | **不含**——公开仓库不放 Drive ID | 仅作 `thumbnailFileId` 的来源；本文件不含 | 待补（私有 D1 字段） |
| 来源 | `source`（`catalog-ins.json` / `catalog-px.json` / `library-index.json` / `studio-library-index.json` / `classification-72`） | 同左 | — | 待补 |
| 所属库 | `library` = `ref` / `ui` | 隐含在 `kit`（ins/px 均为 ui） | — | 待补 |

注意：同名不同款必须用完整 `kit:category:basename` 区分。已验证：`px:frames:calendar` 与 `px:icons:calendar` 是两版；`heart` 有 `ins:icons:heart`、`ins:stickers:heart`、`px:icons:heart` 三版。

## 2. 内容字段

| 字段 | dev-index v2 | 公开 catalog | App / UI 消费 | 缺失值处理（Claude） |
|---|---|---|---|---|
| `name` | 文件名 | 同左 | 列表标题 | 必有 |
| `category` | `icon` / `sticker` / `frame` / `layout-page` / `brand-board` / `flow` / `component` / `dashboard` / `poster` / `state` / `background` | 同左（仅前三类） | Style × Category 浏览、筛选 | 缺失 → 归入 `uncategorized`，不隐藏 |
| `style` | `S1`–`S6` + `styleConfidence`（`catalog` / `visual` / `low`） | 同左；S1=INS 套件，S2=像素套件 | 风格筛选 | `styleConfidence=low` 或 S6 桶（177 条）→ 显示“风格待确认”标记，不参与风格筛选默认值 |
| `palette` | hex 数组（图面读出或 catalog token） | 同左 | 色板切换、详情页色块 | `[]` → 隐藏色板区，不用占位色 |
| `preview` | 本地渲染 PNG 相对路径 | `design-intelligence/public/previews/<kit>/<cat>/<name>.png`（仓库内路径） | 懒加载预览图 | 缺失 → 占位图 + “预览生成中”；不阻塞列表 |
| `viewBox` / `catalogSize` | SVG viewBox / catalog 尺寸（如 `220×64`） | 同左 | 详情页尺寸信息 | `viewBox=null` → 用 `catalogSize`；两者皆无 → 不显示尺寸行 |
| `summary` | 人工目视摘要（仅 72 分类与参考图） | **不含**（私有） | 详情页描述 | 私有，UI 不消费 |
| `md5Checksum` / `size` / `modifiedTime` / `thumbnailLink` | 私有校验与 Drive 元数据 | **不含** | — | — |

## 3. 权利与审核（最重要的一组）

| 字段 | 取值 | 含义 | UI / API 行为 |
|---|---|---|---|
| `rights` | `reference-only`（189） / `unverified`（54，INS 套件） / `original-vector`（40，像素套件） / `restricted`（32） / `needs-review`（10） | 见第 4 节 | `restricted` 绝不在公开预览/导出流程出现；`unverified` 显示“授权未验证”徽标；只有 `original-vector` 可进商用候选，且仍需人工确认授权声明 |
| `rightsDetail` | 原文（如像素 catalog 的 referencePolicy） | 权利依据原文 | 详情页“权利依据”折叠区 |
| `reviewStatus` | `audited` / `classified-unreviewed`（72 项） | 72 项为人工目视分类、未经第二人复核 | `classified-unreviewed` 显示“待复核”徽标；不隐藏，但默认筛选排除在“已确认可用”之外 |

**已验证为 0 的项，不要写成有**：已授权素材 0 个已验证；可商用成品 0 个已验证。INS 与像素均为原创重画属实，但均无商用授权声明。

## 4. 权利口径（审计结论，2026-11-22）

- `reference-only`：第三方参考图，仅供内部研究，不得转载、不得商用。
- `unverified`：INS 套件 54 个 SVG——原创重画属实，catalog 无 rights 字段，授权未验证。
- `original-vector`：像素套件 40 个 SVG——catalog 声明 original-vector，但 referencePolicy 为 reference-only / rights unverified，商用仍未验证。
- `restricted`：32 项——含明确禁二创/禁商用声明、水印作者作品、或“可商用素材包”为卖家自述未验证。
- `needs-review`：10 项——权利信息不足，需人工逐项确认。

## 5. 72 项分类摘要（完整记录在私有交付）

- 权利：restricted 32 / reference-only 30 / needs-review 10；licensed 0。
- 分类：layout-page 30、brand-board 13、flow 11、component 6、frame 5、dashboard 3、poster 2、state 1、background 1。
- 风格：S6 47、S5 15、S4 8、S1 2；S2/S3 为 0。**S6 桶共 177 条（含老索引），保留原值，不为追求 100% 风格分类重复目视。**
- 图面读出 hex：9 项。内容重复（画面相同、md5 不同）：6082/6083、6084/6085、6131/6132。
- 8 段 MOV：同一“鼻涕的韩系网页边框素材包”广告视频的不同预览页，见 `MOV_TODO.md`。

## 6. Codex D1 / openapi 映射（已读实测，2026-11-22）

来源：`codex/design-intelligence-phase1` 的 `design-intelligence/openapi.json`（Shirley Design API v1.1.0，OpenAPI 3.1.0，认证 `DesignToken`）与 `migrations/0001_index.sql`（D1）。导入脚本见 Codex 的 `tools/import.mjs`。

### 6.1 assets 表

| D1 列 | dev-index v2 来源 | 备注 |
|---|---|---|
| `tenant_id` / `brand_id` | 无对应字段 | **由 Codex 定**，导入时必填 |
| `asset_id` | 94 个 SVG → 公开 catalog 的 `id`（如 `ins:icons:heart`）；231 张参考图 → dev-index 的 `id`（即 `drive:<driveFileId>` 原样） | `UNIQUE(drive_id)` 与 dev-index 的 325 个唯一 Drive ID 一致 |
| `drive_id` | `driveFileId` | 私有，只进 D1，不进公开仓库 |
| `name` | `name` | |
| `kind` | ui 库 SVG → `component`；ref 库 → `reference` | dev-index 无 kind 字段，按 `library` 推导 |
| `version` | 无对应字段 | 建议首次导入填 `"1"`，由 Codex 确认 |
| `rights` | 见 6.2 | **存在分歧，见下** |
| `review` | 见 6.3 | |
| `evidence` | `auditEvidence` / `summary` | 文本；`commercial_ready` 要求它非空（无记录符合） |

### 6.2 rights 映射（含分歧）

| dev-index `rights` | D1 `rights` | 说明 |
|---|---|---|
| `reference-only`（189） | `reference_only` | 直接对应 |
| `unverified`（54） | `unverified` | 直接对应 |
| `restricted`（32） | `restricted` | 直接对应 |
| `original-vector`（40，像素套件） | **`unverified`**（evidence 注明 "catalog states original-vector; commercial use unverified"） | **D1 没有 original-vector 这一档**；绝不能写成 `commercial_ready`（D1 的 CHECK 要求 `review='approved'` 且 evidence 非空，且已验证可商用成品为 0） |
| `needs-review`（10） | **`unverified` + `review='pending'`** | 权利信息不足，按未验证 + 待复核处理 |

**`commercial_ready`：没有任何记录可以导入为该值。** 已验证已授权素材 0 个、可商用成品 0 个。

### 6.3 review 映射

| dev-index `reviewStatus` | D1 `review` | 说明 |
|---|---|---|
| `audited-indexed`（253） | `indexed` | 已审计入库，未经批准 |
| `classified-unreviewed`（72） | `pending` | 人工目视分类、未经第二人复核；同时进 `classification_queue` 表（state=pending，evidence=分类 JSON） |

**`approved`：没有任何记录可以直接导入为该值**，须人工签字确认后才升级。

### 6.4 其他表

- **styles / categories**：`style` S1–S6 → `styles(id, label)`；S1/S2 的 label 与色板已知（INS / 像素复古，见第 2 节）；S3–S6 的 label 未定义，由 Codex/Claude 定。`category` → `categories(id, label)`。
- **asset_tags**：每表行只能带 style 或 category 其中之一（`CHECK((style_id IS NULL) <> (category_id IS NULL))`），所以每条素材需写**两行**（一行 style、一行 category）；`tag` 的取值由 Codex 定（建议直接用 style/category 的 id）。
- **palettes**：S1/S2 的色板进 `palettes`（colors、tokens、`token_source`=catalog 文件名、`token_compatibility` 按 openapi `Style` 的同名字段）。
- **asset_variants**：`preview` → `cache_key`=仓库预览路径（渲染 PNG 不是 Drive 文件）；`vector` → `drive_id`=SVG 的 Drive 文件；`thumbnail` → `drive_id`=`thumbnailFileId`（23 个 SVG 无 Drive 缩略图，无此 variant）。
- **asset_sources**：`source_kind`=dev-index 的 `source`（如 `catalog-ins.json`），`source_key`=文件名，`payload`=catalog 条目 JSON。
- **asset_lineage**：成品 ← 来源参考图（INS ← IMG_5969 + IMG_5971–5976；像素 ← IMG_6047 + IMG_6051）；`relation` 的取值词表由 Codex 定。
- **sync_state**：`source`=`drive-library`，state JSON 存 `{pageToken: "4085", watermarkModifiedTime: "2026-11-22T05:04:33.488Z", inventorySha256: <见 sync-state.json>}`。
- **`status`（已做成品等）与 `styleConfidence`（unclassified 130 / keyword 20 / catalog 94 / classified 72 / curated 9）在 D1 无对应列**：须放进 `evidence` JSON 或 `asset_sources` payload，不得悄悄丢弃；S6 桶（177 条）与低置信度记录照原值导入，不重新打标。

### 6.5 openapi 对应关系

- `AssetSummary`：`assetId`、`driveFileId`、`name`、`kind`、`rights`、`review`、`version`、`hasPreview`、`id`、`title`、`summary`、`colors`、`styleIds`、`categoryIds`——与上表一致；`AssetDetail` 另有 `evidence`、`styles`、`categories`、`variants`、`lineage`、`sources`。
- 端点：`/assets/search`、`/assets/{id}`、`/assets/{id}/preview`、`/assets/{id}/vector`、`/styles`、`/categories`、`/brands/{id}/design-rules`、`/design-recipes/{id}` 及其 publication-check / history / restore。
- 私有 D1 的导入：325 条完整 dev-index（含 Drive ID、md5、摘要）只进**受鉴权的 D1**，不进公开仓库。

## 7. 待 Claude 确认（UI 字段消费）

- 详情弹窗是否需要 `rightsDetail` 原文？目前放在折叠区。
- `classified-unreviewed` 的 72 项在 UI 默认列表中是否出现？建议：出现，但带“待复核”徽标且默认不在“已确认可用”筛选内。
- `palette: []` 时色板区隐藏（已定，见第 2 节）。
- 预览加载失败时的占位与重试策略由 Claude 定。
