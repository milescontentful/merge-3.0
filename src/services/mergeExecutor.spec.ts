import { describe, it, expect } from 'vitest';
import { MergeExecutor } from './mergeExecutor';
import { ChangeItem, FieldResolution } from '../types';

// Verifies per-field resolutions: fields marked "keep TO" retain the
// target value while everything else is overwritten from source.
describe('MergeExecutor field resolutions', () => {
  it('keeps target values for fields resolved as useSource=false', async () => {
    let captured: any = null;
    const fakeCma = {
      entry: {
        update: async (_params: any, payload: any) => {
          captured = payload;
          return payload;
        },
      },
    } as any;

    const change: ChangeItem = {
      id: 'entry-1',
      type: 'Entry',
      changeType: 'update',
      hasConflict: true,
      sourceData: {
        sys: { id: 'entry-1' },
        fields: {
          title: { 'en-US': 'source title' },
          body: { 'en-US': 'source body' },
        },
      },
      targetData: {
        sys: { id: 'entry-1', version: 3 },
        fields: {
          title: { 'en-US': 'target title' },
          body: { 'en-US': 'target body' },
        },
      },
    };

    const fieldResolutions: FieldResolution[] = [
      { entryId: 'entry-1', fieldName: 'title', useSource: false }, // keep TO
    ];

    const executor = new MergeExecutor(fakeCma, 'space', 'target-env', false);
    const progress = await executor.executeMerge(
      [change],
      [{ id: 'entry-1', action: 'overwrite' }],
      fieldResolutions
    );

    expect(progress.succeeded).toBe(1);
    expect(captured.fields.title['en-US']).toBe('target title'); // kept
    expect(captured.fields.body['en-US']).toBe('source body'); // overwritten
  });
});
