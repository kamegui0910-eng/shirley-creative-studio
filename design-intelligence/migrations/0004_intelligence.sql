CREATE TABLE asset_analyses (
 tenant_id TEXT NOT NULL, brand_id TEXT NOT NULL, asset_id TEXT NOT NULL, file_version TEXT NOT NULL,
 model_version TEXT NOT NULL, result TEXT NOT NULL CHECK(json_valid(result)), created_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,brand_id,asset_id,file_version,model_version),
 FOREIGN KEY(tenant_id,brand_id,asset_id) REFERENCES assets
);
CREATE TABLE design_dna (
 tenant_id TEXT NOT NULL, brand_id TEXT NOT NULL, configuration TEXT NOT NULL CHECK(json_valid(configuration)),
 PRIMARY KEY(tenant_id,brand_id), FOREIGN KEY(tenant_id,brand_id) REFERENCES brands
);
CREATE TABLE drive_intake (
 tenant_id TEXT NOT NULL, brand_id TEXT NOT NULL, fingerprint TEXT NOT NULL, asset_id TEXT NOT NULL,
 PRIMARY KEY(tenant_id,brand_id,fingerprint), FOREIGN KEY(tenant_id,brand_id,asset_id) REFERENCES assets
);
