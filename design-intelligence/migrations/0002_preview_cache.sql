CREATE TABLE preview_cache (
 tenant_id TEXT NOT NULL, brand_id TEXT NOT NULL, cache_key TEXT NOT NULL,
 content_base64 TEXT NOT NULL CHECK(length(content_base64) BETWEEN 1 AND 98304),
 PRIMARY KEY(tenant_id, brand_id, cache_key),
 FOREIGN KEY(tenant_id, brand_id) REFERENCES brands
);
