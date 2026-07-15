# Merge 3.0 — Contentful Entry Merge App

A Contentful App Framework app (Vite + React + TypeScript) that merges an entry **and its full dependency graph** (referenced entries + assets) from one environment to another — either immediately with a visual diff preview, or later via a persistent merge queue.

## How it works

Everything runs client-side against the CMA (rate-limited to 18 req/s), using a CMA token you provide in the app config. Merged content is always created as **drafts** — publish with Contentful's native bulk-publish when you're ready.

### Merge Now (entry sidebar → "View Diff")

1. Recursively resolves the entry's references (entries + assets, depth 5, cycle-safe)
2. Diffs every item against the target environment (add vs. update)
3. Detects content types missing in the target
4. Opens a full-page preview: side-by-side FROM/TO field diff, environment pickers (with inline create/delete), and an option to copy missing content types
5. On confirm: copies content types if requested, then merges assets first, entries second — with live progress

### Merge Later (entry sidebar → "Merge Later")

Adds the entry + its dependency IDs to a **merge queue** persisted in the app's installation parameters. The **Merge Queue page** (app Page location) lets you search/filter the queue, expand items to inspect and select dependencies, create/delete environments, and merge items individually or in bulk. Queue merges are additive only — anything already in the target is skipped, never overwritten.

## App locations

| Location | Component | Purpose |
|---|---|---|
| App config | `ConfigScreen` | CMA token + default source/target environments |
| Entry sidebar | `Sidebar` | View Diff (merge now) and Merge Later actions |
| Dialog | `Dialog` → `MergePreviewDialog` | Full-page merge preview |
| Page | `Page` | Merge queue management |

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
  locations/     ConfigScreen, Sidebar, Dialog, Page (merge queue)
  components/    MergePreviewDialog, ProgressTracker, LocalhostWarning
  services/      dependencyResolver, conflictDetector, mergeExecutor,
                 contentTypeMigrator, queueService
  hooks/         useContentfulClient (CMA plain client)
  utils/         environmentHelpers (env + alias merging), rateLimiter
  types/         shared interfaces
```

## Notes & limitations

- The merge queue lives in app installation parameters — concurrent edits by multiple users can race.
- Updates in "Merge Now" mode overwrite the target version (auto-resolved); queue mode never overwrites.
- No auto-publish, by design.
