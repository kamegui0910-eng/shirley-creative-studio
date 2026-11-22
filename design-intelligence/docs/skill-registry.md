# Design Intelligence Skill Registry

| Candidate | Source checked | Decision |
| --- | --- | --- |
| Shirley Design Intelligence | Existing portable skill, editor, Worker and OpenAPI | Extend the existing skill in place. Claude keeps editor/visual QA context, Muse keeps classification/provenance context. |
| Drive resumable upload | Google Drive API upload contract, resumption using HTTP 308 and confirmed `Range` | Reuse the official protocol. No Google SDK package added. [Protocol](https://developers.google.com/workspace/drive/api/guides/manage-uploads) |
| img2ui | README, dependencies and upstream head `09370f2d` dated 2026-05-06. README declares MIT. | Reuse the extraction workflow. The Vue app, gallery and external model calls are outside the integration. [Source](https://github.com/NelsonChen1982/img2ui) |
| screenshot-to-design-system | MIT license, SKILL.md and installer. Head `030e3007` dated 2026-07-05. | Use the per-control review method for a future verified visual pass. Keep the local image analyzer and existing editor. [Source](https://github.com/WCF900905/screenshot-to-design-system) |
| Workers AI and Vectorize | Official model and pricing documentation, current account's Vectorize resource list | Defer hosted indexing pending an approved paid plan or an existing index. Use D1 and local visual features for the current set. |
| agents-video-editing-skills | MIT license and FFmpeg Essentials playbook. Head `eb105c74` dated 2026-11-11. | Reuse normalization, concat and ffprobe QA workflow with installed system binaries. [Source](https://github.com/iamaanahmad/agents-video-editing-skills) |
| Remotion skills | Router and license reference. Head `6f55706d` dated 2026-11-18. | Defer the runtime until a timeline needs React composition. License eligibility must be checked for the intended usage. [Source](https://github.com/remotion-dev/skills) |

No npm runtime dependency or paid service was added. Optional local tools are ImageMagick for image backfill, Tesseract (Apache-2.0) for the local text-region QA spot check, and FFmpeg/ffprobe with libass and libx264 for export. License terms follow the system packages; the tested FFmpeg build is GPL-enabled. No upstream installers were run.

**Agent handoff.** For the same approved UI sample, Claude and Muse should independently verify extracted colors, inspect controls, label uncertainty and return evidence-rich results in the existing Gateway workflow. A video evaluation should use the same scene list and source photos across candidate Agents, then compare source fidelity, caption legibility, continuity and technical QA. Host-side results are unverified until actual receipts exist. Grok is omitted for this round.
