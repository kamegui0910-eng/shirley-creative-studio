CREATE TABLE asset_search_metadata (
 tenant_id TEXT NOT NULL, brand_id TEXT NOT NULL, asset_id TEXT NOT NULL,
 summary TEXT, colors TEXT NOT NULL CHECK(json_valid(colors)), keywords TEXT NOT NULL,
 PRIMARY KEY(tenant_id,brand_id,asset_id),
 FOREIGN KEY(tenant_id,brand_id,asset_id) REFERENCES assets
);
CREATE TABLE recipe_versions (
 tenant_id TEXT NOT NULL, brand_id TEXT NOT NULL, id TEXT NOT NULL, version INTEGER NOT NULL,
 document TEXT NOT NULL CHECK(json_valid(document)), updated_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,brand_id,id,version)
);
INSERT INTO recipe_versions SELECT tenant_id,brand_id,id,version,document,updated_at FROM design_recipes;
CREATE TRIGGER recipe_save_insert AFTER INSERT ON design_recipes BEGIN
 INSERT INTO recipe_versions VALUES (NEW.tenant_id,NEW.brand_id,NEW.id,NEW.version,NEW.document,NEW.updated_at);
END;
CREATE TRIGGER recipe_save_update AFTER UPDATE OF version ON design_recipes BEGIN
 INSERT INTO recipe_versions VALUES (NEW.tenant_id,NEW.brand_id,NEW.id,NEW.version,NEW.document,NEW.updated_at);
END;
