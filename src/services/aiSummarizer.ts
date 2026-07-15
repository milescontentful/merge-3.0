import { PlainClientAPI } from 'contentful-management';
import { ChangeItem } from '../types';

/**
 * "What changed" summaries for the merge preview.
 *
 * The AI path calls the app's "aiMergeSummary" App Action → a Contentful-
 * hosted App Function → the "Suggest merge summary" AI Action. Everything
 * runs inside Contentful — no external API keys.
 */

// Deterministic fallback, always available.
export function buildBasicSummary(changes: ChangeItem[]): string {
  const creates = changes.filter((c) => c.changeType === 'add');
  const updates = changes.filter((c) => c.changeType === 'update');
  const changedFields = new Set<string>();
  for (const item of updates) {
    const source = item.sourceData?.fields || {};
    const target = item.targetData?.fields || {};
    for (const field of new Set([...Object.keys(source), ...Object.keys(target)])) {
      if (JSON.stringify(source[field]) !== JSON.stringify(target[field])) {
        changedFields.add(field);
      }
    }
  }
  const parts = [
    `${creates.length} new item(s) will be created`,
    `${updates.length} existing item(s) will be updated`,
  ];
  if (changedFields.size > 0) {
    parts.push(`fields touched: ${[...changedFields].slice(0, 12).join(', ')}`);
  }
  return parts.join(' · ');
}

// Compact digest of the diff for the AI Action.
function buildDiffDigest(changes: ChangeItem[]): string {
  const truncate = (v: any) => {
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return s && s.length > 150 ? s.slice(0, 150) + '…' : s;
  };

  const lines: string[] = [];
  for (const item of changes.slice(0, 30)) {
    lines.push(`${item.changeType === 'add' ? 'NEW' : 'UPDATE'} ${item.type} "${item.title || item.id}" (${item.contentType || 'asset'})`);
    if (item.changeType === 'update') {
      const source = item.sourceData?.fields || {};
      const target = item.targetData?.fields || {};
      for (const field of new Set([...Object.keys(source), ...Object.keys(target)])) {
        if (JSON.stringify(target[field]) !== JSON.stringify(source[field])) {
          lines.push(`  field "${field}": ${truncate(target[field]) ?? '(empty)'} -> ${truncate(source[field]) ?? '(empty)'}`);
        }
      }
    }
  }
  if (changes.length > 30) lines.push(`…and ${changes.length - 30} more items`);
  return lines.join('\n');
}

// Suggestion AI Actions anchor to a real entry field — find one on the root entry.
function findEntryPath(changes: ChangeItem[], entryId: string): string | null {
  const item = changes.find((c) => c.id === entryId) || changes[0];
  const fields = item?.sourceData?.fields;
  if (!fields) return null;
  const fieldName = Object.keys(fields)[0];
  const locale = fieldName && Object.keys(fields[fieldName] || {})[0];
  return fieldName && locale ? `fields.${fieldName}.${locale}` : null;
}

export async function summarizeChanges(
  cma: PlainClientAPI,
  appDefinitionId: string,
  spaceId: string,
  environmentId: string,
  entryId: string,
  changes: ChangeItem[],
  sourceEnv: string,
  targetEnv: string
): Promise<string> {
  const entryPath = findEntryPath(changes, entryId);
  if (!entryPath) throw new Error('Could not determine an entry field to anchor the summary to');

  const call = await cma.appActionCall.createWithResponse(
    { spaceId, environmentId, appDefinitionId, appActionId: 'aiMergeSummary' },
    {
      parameters: {
        digest: buildDiffDigest(changes),
        entryId,
        entryPath,
        sourceEnvironment: sourceEnv,
        targetEnvironment: targetEnv,
      },
    }
  );

  const body = typeof call.response.body === 'string' ? JSON.parse(call.response.body) : call.response.body;
  if (!body?.ok) throw new Error(body?.error || 'AI summary failed');
  return body.summary;
}
