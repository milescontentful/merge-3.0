# Merge 3.0 — Contentful Entry Merge App

A Contentful App Framework app (Vite + React + TypeScript) that merges an entry **and its full dependency graph** (referenced entries + assets) from one environment to another — either immediately with a visual diff preview, or later via a persistent merge queue.

## How it works

Everything runs client-side against the CMA (rate-limited to 18 req/s), using a CMA token you provide in the app config. Merged content is always created as **drafts** — publish with Contentful's native bulk-publish when you're ready.

### Merge Now (entry sidebar → "View Diff")

1. Recursively resolves the entry's references (entries + assets, depth 5, cycle-safe)
2. Diffs every item against the target environment (add vs. update)
3. Detects content types missing in the target
4. Opens a full-page preview: side-by-side FROM/TO field diff, environment pickers (with inline create/delete), and an option to copy missing content types
5. Conflicting fields are click-to-resolve: choose per field whether the FROM value merges or the TO value is kept
6. A "what's changing" summary sits above the diff — the ✨ AI summary explains the merge in plain English via a Contentful AI Action (no external keys)
7. On confirm: copies content types if requested, then merges assets first, entries second — with live progress

### Compare & Merge (Page app → first tab)

The management hub: diff **everything** — content types, entries, and assets — between any source environment and any target environment **in any space** your token can reach (like Contentful's official Merge app, but not limited to content types). Search the diff, select what to move, and merge as drafts. Content types are copied first, then assets, then entries.

### Bulk "Add to Merge Queue" (content list toolbar)

Select any number of entries in Contentful's content list and use the **Add to Merge Queue** bulk action (an `Entries.v1.0` App Action, next to Run AI Action). All selected entries land in the merge queue via a Contentful-hosted App Function.

### Merge Later (entry sidebar → "Merge Later")

Adds the entry + its dependency IDs to a **merge queue** persisted in a dedicated `mergeQueueData` entry (auto-created, with optimistic locking so concurrent users can't clobber each other). The **Merge Queue page** (app Page location) lets you search/filter the queue, expand items to inspect and select dependencies, create/delete environments, and merge items individually or in bulk. Queue merges are additive only — anything already in the target is skipped, never overwritten.

## App locations

| Location | Component | Purpose |
|---|---|---|
| App config | `ConfigScreen` | CMA token + default source/target environments |
| Entry sidebar | `Sidebar` | View Diff (merge now) and Merge Later actions |
| Dialog | `Dialog` → `MergePreviewDialog` | Full-page merge preview |
| Page | `Page` | Management hub: Compare & Merge (cross-space) + Merge Queue |

## Quick install

If the app definition already exists in your organization (ID `7sdD9OYisX97jP5HGPslFD`), install it into a space with the deeplink:

**[→ Install Merge 3.0](https://app.contentful.com/deeplink?link=apps&id=7sdD9OYisX97jP5HGPslFD)**

Then add your CMA token in the config screen and enable the sidebar per content type (see below).

## Setup

### Prerequisites

- Node.js 18+
- A Contentful space with multiple environments
- A CMA token with read/write access to that space

### Install & run

```bash
npm install
npm run dev        # http://localhost:3000
```

Create the app definition (first time only) and upload a build:

```bash
npm run create-app-definition
npm run build
npm run upload
```

### Configure in Contentful

1. **Settings → Apps → Custom Apps** → install/configure the app
2. Enter your **CMA token** and (optionally) default source/target environments

### ⚠️ Critical: enable the sidebar per content type

The app will **not** appear in entry sidebars until you enable it for each content type:

1. **Content model → [content type] → Sidebar** tab
2. Add **Entry Merge App** to the sidebar (drag to position)
3. Save — repeat for every content type you want to merge from

This is Contentful-by-design and the most commonly missed step.

## Project structure

```
src/
  locations/     ConfigScreen, Sidebar, Dialog, Page (tabs: EnvironmentCompare + MergeQueue)
  components/    MergePreviewDialog, ProgressTracker, LocalhostWarning
  services/      dependencyResolver, conflictDetector, mergeExecutor,
                 contentTypeMigrator, queueService, aiSummarizer
  hooks/         useContentfulClient (CMA plain client)
  utils/         environmentHelpers (env + alias merging), rateLimiter
  types/         shared interfaces
```

## AI merge summary (App Function + AI Action)

The ✨ Summarize button in the merge preview runs entirely inside Contentful:

```
Preview dialog → App Action "aiMergeSummary" → App Function (Contentful-hosted)
              → AI Action "Suggest merge summary" (Suggestion output) → summary
```

- The **App Function** (`functions/aiMergeSummary.ts`) is bundled with the app and runs with App Identity — no tokens to configure.
- The **AI Action** is auto-created and published in the space on first use (`Suggestion` output type, anchored to the entry being merged, so it also surfaces in the entry sidebar's AI suggestions).
- Rebuild + redeploy with `npm run build && npm run upload` (functions are bundled from `contentful-app-manifest.json`); `npm run upsert-actions` syncs the App Action definition.

## Notes & limitations

- The merge queue is stored in a dedicated entry (content type `mergeQueueData`, auto-created on first use) with version-checked writes — concurrent edits by multiple users retry safely instead of overwriting each other.
- Updates in "Merge Now" mode overwrite the target by default, but any conflicting field can be flipped to "keep target" in the preview.
- No auto-publish, by design.
