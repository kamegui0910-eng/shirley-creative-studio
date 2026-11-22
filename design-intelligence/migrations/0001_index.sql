CREATE TABLE brands (
 tenant_id TEXT NOT NULL, brand_id TEXT NOT NULL, rules TEXT NOT NULL CHECK(json_valid(rules)),
 PRIMARY KEY(tenant_id,brand_id)
);
CREATE TABLE assets (
 tenant_id TEXT NOT NULL, brand_id TEXT NOT NULL, asset_id TEXT NOT NULL, drive_id TEXT NOT NULL,
 name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('reference','component')),
 version TEXT NOT NULL, rights TEXT NOT NULL CHECK(rights IN ('reference_only','unverified','restricted','commercial_ready')),
 review TEXT NOT NULL CHECK(review IN ('pending','indexed','approved')), evidence TEXT,
 PRIMARY KEY(tenant_id,brand_id,asset_id), UNIQUE(tenant_id,brand_id,drive_id),
 FOREIGN KEY(tenant_id,brand_id) REFERENCES brands,
 CHECK(rights <> 'commercial_ready' OR (review = 'approved' AND length(trim(coalesce(evidence,''))) > 0))
);
CREATE TABLE asset_variants (
 tenant_id TEXT NOT NULL, brand_id TEXT NOT NULL, asset_id TEXT NOT NULL, variant_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('thumbnail','preview','vector')), drive_id TEXT, cache_key TEXT, mime_type TEXT,
 PRIMARY KEY(tenant_id,brand_id,variant_id),
 FOREIGN KEY(tenant_id,brand_id,asset_id) REFERENCES assets,
 CHECK(drive_id IS NOT NULL OR cache_key IS NOT NULL)
);
CREATE TABLE styles (id TEXT PRIMARY KEY NOT NULL, label TEXT NOT NULL);
CREATE TABLE categories (id TEXT PRIMARY KEY NOT NULL, label TEXT NOT NULL);
CREATE TABLE asset_tags (
 tenant_id TEXT NOT NULL, brand_id TEXT NOT NULL, asset_id TEXT NOT NULL, style_id TEXT REFERENCES styles,
 category_id TEXT REFERENCES categories, tag TEXT NOT NULL,
 PRIMARY KEY(tenant_id,brand_id,asset_id,tag),
 FOREIGN KEY(tenant_id,brand_id,asset_id) REFERENCES assets,
 CHECK((style_id IS NULL) <> (category_id IS NULL))
);
CREATE INDEX tags_style ON asset_tags(tenant_id,brand_id,style_id,asset_id);
CREATE INDEX tags_category ON asset_tags(tenant_id,brand_id,category_id,asset_id);
CREATE INDEX assets_search ON assets(tenant_id,brand_id,kind,rights,asset_id);
CREATE TABLE palettes (
 tenant_id TEXT NOT NULL, brand_id TEXT NOT NULL, style_id TEXT NOT NULL REFERENCES styles,
 colors TEXT NOT NULL, tokens TEXT NOT NULL, token_source TEXT, token_compatibility TEXT,
 PRIMARY KEY(tenant_id,brand_id,style_id), FOREIGN KEY(tenant_id,brand_id) REFERENCES brands
);
CREATE TABLE components (
 tenant_id TEXT NOT NULL, brand_id TEXT NOT NULL, asset_id TEXT NOT NULL, logical_path TEXT NOT NULL,
 physical_path TEXT NOT NULL, style_id TEXT NOT NULL REFERENCES styles,
 PRIMARY KEY(tenant_id,brand_id,asset_id), UNIQUE(tenant_id,brand_id,style_id,logical_path),
 FOREIGN KEY(tenant_id,brand_id,asset_id) REFERENCES assets
);
CREATE TABLE asset_sources (
 tenant_id TEXT NOT NULL, brand_id TEXT NOT NULL, asset_id TEXT NOT NULL,
 source_kind TEXT NOT NULL, source_key TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)),
 PRIMARY KEY(tenant_id,brand_id,source_kind,source_key),
 FOREIGN KEY(tenant_id,brand_id,asset_id) REFERENCES assets
);
CREATE TABLE asset_lineage (
 tenant_id TEXT NOT NULL, brand_id TEXT NOT NULL, asset_id TEXT NOT NULL, source_id TEXT NOT NULL,
 relation TEXT NOT NULL, PRIMARY KEY(tenant_id,brand_id,asset_id,source_id),
 FOREIGN KEY(tenant_id,brand_id,asset_id) REFERENCES assets,
 FOREIGN KEY(tenant_id,brand_id,source_id) REFERENCES assets(tenant_id,brand_id,asset_id)
);
CREATE TABLE sync_state (
 tenant_id TEXT NOT NULL, brand_id TEXT NOT NULL, source TEXT NOT NULL, state TEXT NOT NULL,
 PRIMARY KEY(tenant_id,brand_id,source), FOREIGN KEY(tenant_id,brand_id) REFERENCES brands
);
CREATE TABLE classification_queue (
 tenant_id TEXT NOT NULL, brand_id TEXT NOT NULL, asset_id TEXT NOT NULL, state TEXT NOT NULL,
 evidence TEXT NOT NULL CHECK(json_valid(evidence)),
 PRIMARY KEY(tenant_id,brand_id,asset_id), FOREIGN KEY(tenant_id,brand_id,asset_id) REFERENCES assets
);
CREATE TABLE design_recipes (
 tenant_id TEXT NOT NULL, brand_id TEXT NOT NULL, id TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
 document TEXT NOT NULL CHECK(json_valid(document)), updated_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,brand_id,id), FOREIGN KEY(tenant_id,brand_id) REFERENCES brands
);
