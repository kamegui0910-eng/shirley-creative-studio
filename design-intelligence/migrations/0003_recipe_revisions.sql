CREATE TABLE design_recipe_revisions (
 tenant_id TEXT NOT NULL, brand_id TEXT NOT NULL, id TEXT NOT NULL, version INTEGER NOT NULL,
 document TEXT NOT NULL CHECK(json_valid(document)), updated_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id, brand_id, id, version),
 FOREIGN KEY(tenant_id, brand_id, id) REFERENCES design_recipes
);
