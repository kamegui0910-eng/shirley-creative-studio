# Grok, Muse and Claude integration

Use the same [Design API origin](https://shirley-design-intelligence-test.shirley-agent-gateway.workers.dev/) and [OpenAPI contract](../openapi.json) for all three hosts. Give each host its own credential from the private access handoff. The test credentials are bound to tenant `studio`, brand `shirley`, with `write: false`. The operator credential is separate and intended for the Preview editor. No Agent needs a Cloudflare token, a Gateway coordinator credential or direct D1 access.

| Check | Request | Expected |
| --- | --- | --- |
| Identity | `GET /session` | `{"tenantId":"studio","brandId":"shirley","write":false}` |
| Brand rules | `GET /brands/shirley/design-rules` | Scoped sandbox rules |
| Taxonomy | `GET /styles`, then `GET /categories?style=pink-black-ins` | Style and category IDs |
| Find components | `GET /assets/search?style=pink-black-ins&category=icon&limit=12` | Scoped page and cursor |
| Read recipe | `GET /design-recipes/demo-recipe` | Versioned document with component IDs |
| Check publication | `GET /design-recipes/demo-recipe/publication-check` | `allowed: false` for the synthetic seed |
| Write or foreign scope | Recipe `PUT` or `GET /assets/probe-tenant` | 403 or 404 respectively |

Send `Authorization: Bearer <host's Design token>`. Resolve shortlists progressively, and keep bearer values out of prompts, handoff references, tool outputs and issue bodies.

## Gateway compatibility

Gateway [PR #3](https://github.com/kamegui0910-eng/shirley-agent-gateway/pull/3) transports an opaque `payloadRef`. Use `design-recipe:demo-recipe` in that field. It fits the Gateway validation. A credentialed host resolves it against the separately configured Design API origin. Its Gateway claim, start and result sequence remains the existing sequence.

Gateway [PR #2](https://github.com/kamegui0910-eng/shirley-agent-gateway/pull/2) relays reviewed text via its fallback assignment endpoints. For a manual Claude session, a trusted host can run the resolver below and put its minimal JSON into the existing reviewed packet. When the host supports authenticated HTTPS calls directly, use the same REST contract. A reviewed packet carries context and references. It never carries a Design or Gateway credential.

```sh
node tools/agent-context.mjs design-recipe:demo-recipe
```

Configure `DESIGN_API_BASE` and `DESIGN_API_TOKEN` in the host's secret/environment configuration. Pass `-` to read a Gateway JSON object with `payloadRef` from stdin. The resolver verifies read-only scope via `/session` and fetches brand rules, the recipe and publication status. It rejects arbitrary URL references and does not follow redirects. Its output can be included in an approved packet as text. No Gateway deployment is required to call REST directly.

The cloud smoke verifies all three credentials using HTTP, including the collaboration reference shape and the fallback packet's input. Installation of secrets into the actual Agent hosts is a separate host-side action.
