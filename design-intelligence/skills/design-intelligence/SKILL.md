---
name: shirley-design-intelligence
description: Query Shirley Design API for style, category, reusable components, brand rules and existing design recipes. Intended for Codex, Claude, Grok and Muse.
---

# Shirley Design Intelligence

Use the configured Design API base URL and a brand-scoped read credential from the host's secret store. Keep bearer tokens out of prompts, task packets, logs and URLs.

1. Check `GET /session` for the expected brand and read-only permission. For brand work, read `GET /brands/{id}/design-rules`.
2. Resolve IDs with `GET /styles` and `GET /categories?style={id}`.
3. Retrieve a small page via `GET /assets/search?style={id}&category={id}&kind=component&limit=12`. Continue with `cursor` only when needed. Repeated style or category parameters mean any selected value on that axis.
4. Request `GET /assets/{id}` only for shortlisted results to inspect provenance, version and rights. Fetch `/preview` for thumbnails and `/vector` for editable SVG use in an authorized context.
5. Read structured recipes with `GET /design-recipes/{id}`; resolve component IDs as needed. For a proposed commercial use, request `GET /design-recipes/{id}/publication-check` and stop if blocked.

Use the existing Gateway's reviewed task intake for Grok and Muse. Include only the intended brand ID, selected asset or recipe IDs, the API base, and relevant endpoint instructions in task context. Where an agent cannot make authenticated requests directly, a trusted caller can fetch the scoped results and pass the minimum necessary response fields through the existing assignment flow. Claude and Codex can use the same REST contract from capable hosts.

Use `openapi.json` as the tool schema source. A future MCP adapter should call the existing scoped REST operations and preserve the same credential boundary and pagination. Shared Skill installation and live agent credentials are managed by each host.

Use the [Agent setup guide](../../docs/agent-setup.md) for test credentials, the Gateway collaboration reference and the reviewed fallback packet.

## Reuse-first intake and retrieval

- Use `POST /assets/recommend` for a scoped ranked shortlist. Pass `q`, optional `visual` from the local `pixels-v1` extractor, and `purpose`. Inspect the returned contribution signals before reusing a result.
- Read `GET /assets/{id}/analysis` for measured palette, layout geometry and provenance-aware versioning. Raster typography and automatic semantic components remain unverified. Request human verification instead of inventing labels.
- Read `GET /design-dna` for defaults and current brand rules. A brand write credential may set an override. Never promote rights from visual analysis.
- Add assets through the official Drive intake path in a configured private folder. Upload receipts authorize indexing only. Use the existing Recipe editor and keep marketing renders private unless the brand explicitly authorizes a connected publication flow.
- See [status and rollback](../../docs/reuse-first-status.md) and the [Skill Registry](../../docs/skill-registry.md) before re-evaluating external tools.
