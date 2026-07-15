import Anthropic from '@anthropic-ai/sdk';
import { ChangeItem } from '../types';

/**
 * Builds a compact digest of the merge diff and asks Claude for a
 * plain-English "what changed" summary. Runs client-side with the
 * (optional) Anthropic API key from the app configuration.
 */

// Deterministic fallback shown when no API key is configured.
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

// Compact, token-bounded digest of the diff for the model.
function buildDiffDigest(changes: ChangeItem[]): string {
  const truncate = (v: any) => {
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return s && s.length > 200 ? s.slice(0, 200) + '…' : s;
  };

  const lines: string[] = [];
  for (const item of changes.slice(0, 40)) {
    lines.push(`${item.changeType === 'add' ? 'NEW' : 'UPDATE'} ${item.type} "${item.title || item.id}" (${item.contentType || 'asset'})`);
    if (item.changeType === 'update') {
      const source = item.sourceData?.fields || {};
      const target = item.targetData?.fields || {};
      for (const field of new Set([...Object.keys(source), ...Object.keys(target)])) {
        const from = JSON.stringify(target[field]);
        const to = JSON.stringify(source[field]);
        if (from !== to) {
          lines.push(`  field "${field}": ${truncate(target[field]) ?? '(empty)'} -> ${truncate(source[field]) ?? '(empty)'}`);
        }
      }
    }
  }
  if (changes.length > 40) lines.push(`…and ${changes.length - 40} more items`);
  return lines.join('\n');
}

export async function summarizeChanges(
  apiKey: string,
  changes: ChangeItem[],
  sourceEnv: string,
  targetEnv: string
): Promise<string> {
  const client = new Anthropic({
    apiKey,
    dangerouslyAllowBrowser: true, // key is user-supplied app config; app runs entirely in-browser
  });

  const response = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 1024,
    system:
      'You summarize Contentful content-merge previews for editors. Be concise and concrete: what is being added, what is being overwritten, and anything risky (large overwrites, emptied fields, many items). Plain prose, no headers, 2-5 sentences.',
    messages: [
      {
        role: 'user',
        content: `Merging from environment "${sourceEnv}" to "${targetEnv}". Diff digest (target value -> source value for updated fields):\n\n${buildDiffDigest(changes)}`,
      },
    ],
  });

  const block = response.content.find((b) => b.type === 'text');
  return block && block.type === 'text' ? block.text : 'No summary generated.';
}
