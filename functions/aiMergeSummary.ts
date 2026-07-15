import { FunctionTypeEnum } from '@contentful/node-apps-toolkit';
import type { AppActionRequest, FunctionEventHandler } from '@contentful/node-apps-toolkit';

/**
 * App Function (Contentful-hosted) behind the "aiMergeSummary" App Action.
 * Invokes the "Suggest merge summary" AI Action with the merge diff digest
 * and returns the generated summary text. Uses App Identity (context.cma) —
 * no tokens or external hosting involved.
 *
 * If the AI Action doesn't exist in the space yet, it is created and
 * published on first use.
 */

const AI_ACTION_NAME = 'Suggest merge summary';

// Payload used to auto-create the AI Action on first use in a space.
const AI_ACTION_DEFINITION = {
  name: AI_ACTION_NAME,
  description:
    "Summarizes a Merge 3.0 environment-merge diff in plain English — what's being added, what's being overwritten, and anything risky. Invoked by the Merge 3.0 app's function.",
  instruction: {
    template: `You summarize Contentful content-merge previews for editors. A merge is about to run from environment "{{var.sourceEnvironment}}" to environment "{{var.targetEnvironment}}". For updated fields the digest shows: target value -> source value.

Write a concise plain-prose suggestion (2-5 sentences, no headers, no markdown) covering:
1. What is being added
2. What is being overwritten
3. Anything risky: large overwrites, fields being emptied, unusually many items

Diff digest:
{{var.digest}}

Current content of the entry being merged (context only):
{{var.changes}}`,
    variables: [
      { id: 'changes', type: 'StandardInput' },
      { id: 'digest', name: 'Changes digest', description: 'Compact text digest of the merge diff', type: 'Text' },
      { id: 'sourceEnvironment', name: 'Source environment', description: 'Environment being merged FROM', type: 'Text' },
      { id: 'targetEnvironment', name: 'Target environment', description: 'Environment being merged TO', type: 'Text' },
    ],
  },
  configuration: {
    modelType: 'anthropic.claude-3-7-sonnet',
    modelTemperature: 0.2,
    outputType: 'Suggestion',
    scope: 'Entry',
  },
  testCases: [],
};

type Params = {
  digest: string;
  entryId: string;
  entryPath: string; // e.g. "fields.title.en-US" — anchors the Suggestion to the entry
  sourceEnvironment: string;
  targetEnvironment: string;
};

export const handler: FunctionEventHandler<FunctionTypeEnum.AppActionCall> = async (event, context) => {
  const { body } = event as AppActionRequest<'Custom', Params>;
  const cma = context.cma;
  if (!cma) {
    return { ok: false, error: 'CMA client not available in function context' };
  }

  const spaceBase = `/spaces/${context.spaceId}`;
  const envBase = `${spaceBase}/environments/${context.environmentId}`;

  try {
    // Find (or bootstrap) the AI Action
    const list = await cma.raw.get<{ items: any[] }>(`${spaceBase}/ai/actions`);
    let action = (list.items || []).find((a) => a.name === AI_ACTION_NAME);
    if (!action) {
      action = await cma.raw.post<any>(`${spaceBase}/ai/actions`, AI_ACTION_DEFINITION);
      await cma.raw.put(`${spaceBase}/ai/actions/${action.sys.id}/published`, undefined, {
        headers: { 'X-Contentful-Version': action.sys.version },
      });
    }
    const actionId = action.sys.id;

    // Invoke with the diff digest; StandardInput anchors the suggestion to the entry
    const invocation = await cma.raw.post<any>(`${envBase}/ai/actions/${actionId}/invoke`, {
      outputFormat: 'Suggestion',
      variables: [
        {
          id: 'changes',
          value: { entityType: 'Entry', entityId: body.entryId, entityPaths: [body.entryPath] },
        },
        { id: 'digest', value: body.digest },
        { id: 'sourceEnvironment', value: body.sourceEnvironment },
        { id: 'targetEnvironment', value: body.targetEnvironment },
      ],
    });

    // Poll until the invocation completes (typically ~5-10s)
    let status = invocation.sys.status;
    let result = invocation;
    for (let attempt = 0; attempt < 12 && status !== 'COMPLETED' && status !== 'FAILED'; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      result = await cma.raw.get<any>(`${envBase}/ai/actions/${actionId}/invocations/${invocation.sys.id}`);
      status = result.sys.status;
    }

    if (status !== 'COMPLETED') {
      return { ok: false, error: `AI Action invocation ${status === 'FAILED' ? 'failed' : 'timed out'}` };
    }

    const summary = (result.result?.content || [])
      .map((block: any) => block.text)
      .filter(Boolean)
      .join('\n');
    return { ok: true, summary };
  } catch (err: any) {
    return { ok: false, error: err.message || 'AI summary failed' };
  }
};
