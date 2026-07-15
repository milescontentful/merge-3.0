# Changelog

## [3.3.0] - 2026-07-14

### 🗂 The management hub

- **Compare & Merge page** — new first tab on the Page location: full diff of content types + entries + assets between any source environment and any target space/environment (cross-space!). Search, select, merge as drafts. Content types copy first, then assets and entries via the merge executor.
- **Bulk "Add to Merge Queue"** — an `Entries.v1.0` App Action in the content list's bulk-selection toolbar (next to Run AI Action), backed by a Contentful-hosted App Function that writes to the same optimistically-locked queue as the app. This completes what the abandoned pre-3.0 bulk-actions scaffolding started.
- Merge Queue moved to the second tab of the Page location (unchanged otherwise)

---

## [3.2.2] - 2026-07-14

### 🐛 AI summary 403 fix

- App Identity tokens are not authorized to invoke AI Actions (403 AccessDenied, actor: app-function) — the App Function now authenticates with the CMA token from the app's installation parameters, with App Identity as fallback
- Function switched to a lightweight fetch-based CMA helper; error messages trimmed to status + reason

---

## [3.2.1] - 2026-07-14

### 🐛 Live-diff fixes (found in first hands-on test)

- **Changing environments in the merge preview now re-runs the analysis** — previously the diff table kept showing the result computed before the dialog opened (an original-codebase TODO)
- **Merges execute against the environment picked in the dialog** — fixed a stale-state bug where the executor used the pre-dialog target
- **Content-type copy re-detects against the final environments** on confirm
- Clear empty-state message when source and target content is identical; Proceed is disabled while re-analyzing or when there's nothing to merge

---

## [3.2.0] - 2026-07-14

### 🤖 Contentful-native AI summary

- **AI summary now runs entirely inside Contentful** — App Action → Contentful-hosted App Function → AI Action ("Suggest merge summary", Suggestion output). No Anthropic API key, no external hosting.
- The AI Action is auto-created and published in the space on first use; suggestions anchor to the entry being merged
- Removed the `@anthropic-ai/sdk` dependency and the Anthropic API key config field
- Added `contentful-app-manifest.json` (function + app action definitions) and non-interactive build/upsert scripts

---

## [3.1.0] - 2026-07-14

### ✨ Feature Release

- **Per-field conflict resolution, for real this time** — conflicting fields in the merge preview are click-to-choose: FROM merges or TO is kept, applied field-by-field by the merge executor
- **AI "what changed" summary** — optional Anthropic API key in app config; the preview dialog can summarize the diff in plain English (deterministic summary shown otherwise)
- **Race-proof merge queue** — queue moved from installation parameters to a dedicated `mergeQueueData` entry with optimistic locking (version-conflict retry). Note: existing queued items in installation parameters are not migrated
- **Zero TypeScript errors** — fixed all 16 pre-existing `tsc` errors
- **Config screen fix** — `targetState` no longer writes a bogus "sidebar" content type assignment on save
- **Quick-install deeplink** added to the README

---

## [3.0.0] - 2026-07-14

### 🧹 The Big Cleanup

- **Removed all dead code** from abandoned iterations:
  - CDA/Preview-API "fast path" (disabled since Nov 2025 — CMA-only now)
  - Unwired bulk-actions scaffolding (`api/`, `functions/`, `bulkActionsService`, `appActionHandler`, `vercel.json`) — these imported an uninstalled dependency and never shipped
  - Unused components (`MergePreviewModal`, `ConflictResolver`, `DependencyTree`)
  - Template stubs (`Home`, `Field`, `EntryEditor`) and broken template tests
- **Bug fixes:**
  - Sidebar no longer sets a nonexistent `'dependencies'` view state on merge failure
  - Removed the non-functional per-field resolution UI plumbing (it always returned empty)
  - `RateLimiter.processQueue` return type corrected to `Promise<void>`
- **Stripped 246 debug `console.log` statements** (errors/warnings kept)
- **Docs consolidated** — 10 markdown files → this changelog + README
- Version unified to 3.0.0 (previously 0.1.0 / 1.0.0 / 1.2.0 / "2.0" depending on where you looked)

---

## [1.2.0] - 2025-11-11

### 📚 Documentation Update - Critical Setup Step

#### What Changed
- **Added critical setup step to all documentation** - Must enable app in Content Type sidebar settings!
- Created `CRITICAL_SETUP_NOTE.md` with visual guide
- Updated `GET_STARTED.md`, `SETUP.md`, and `DEPLOYMENT_INSTRUCTIONS.md`
- Clarified that this step is REQUIRED, not optional

#### Why This Matters
The app won't appear in entry sidebars until explicitly enabled for each content type. This is by Contentful design (apps must be enabled per content type), but was easy to miss in the original documentation.

---

## [1.1.0] - 2025-11-11

### ✨ Improved Environment Selection

#### What Changed
- **Environment dropdowns now automatically load from CMA** - No more typing environment names!
- Both the sidebar and configuration screen now fetch all available environments from your Contentful space
- Dropdowns are populated with all accessible environments

#### Entry Sidebar Improvements
- ✅ Automatic environment loading on app initialization
- ✅ Loading spinner while fetching environments
- ✅ Current environment marked with "(current)" label
- ✅ Helper text explaining source vs target
- ✅ Both source and target required before proceeding
- ✅ Better error messages if environments can't be loaded
- ✅ Current environment auto-selected as default source

#### Configuration Screen Improvements
- ✅ Environment dropdowns instead of text inputs
- ✅ Loads after CMA token is entered
- ✅ Shows all available environments in the space
- ✅ Clear "None" option to skip defaults
- ✅ Helpful text explaining each setting

### 🎯 User Experience

**Before:**
```
Source Environment: [text input - type "develop"]
Target Environment: [text input - type "master"]
```

**After:**
```
Source Environment: [dropdown with all environments]
  - develop
  - staging  
  - master (current)
  - production

Target Environment: [dropdown with all environments]
  - develop
  - staging
  - master (current)
  - production
```

### 🔧 Technical Details

**Sidebar (`Sidebar.tsx`)**
- Added `loadingEnvironments` state
- Fetches environments via `cma.environment.getMany()`
- Shows spinner during load
- Warns if no environments found
- Auto-selects current environment as source

**Config Screen (`ConfigScreen.tsx`)**
- Added `environments` state and loading state
- Dynamically loads environments when CMA token is provided
- Converts text inputs to Select dropdowns
- Maintains backward compatibility with existing configurations

### 📊 Benefits

1. **No More Typos** - Select from a list instead of typing
2. **Faster Setup** - See all available environments at a glance
3. **Better UX** - Clear indication of current environment
4. **Fewer Errors** - Can't select non-existent environments
5. **Visual Clarity** - Helper text explains each selection

---

## [1.0.0] - 2025-11-11

### 🎉 Initial Release

#### Core Features
- Entry sidebar location for easy access
- Recursive dependency resolution (entries + assets)
- Conflict detection and resolution UI
- Real-time progress tracking
- Visual dependency tree
- Auto-publish option
- Configuration screen for CMA token and defaults

#### Components
- `DependencyTree` - Visual tree of dependencies
- `ConflictResolver` - Modal for conflict resolution
- `ProgressTracker` - Real-time merge progress

#### Services
- `DependencyResolver` - Analyzes entry dependencies
- `ConflictDetector` - Detects conflicts between environments
- `MergeExecutor` - Executes merge with proper ordering

#### Documentation
- Complete README with architecture
- Setup guide for local testing
- Quick reference for commands
- Deployment instructions
- Project summary

