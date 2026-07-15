import React from 'react';
import { DialogAppSDK } from '@contentful/app-sdk';
import { useSDK } from '@contentful/react-apps-toolkit';
import { MergePreviewDialog } from '../components/MergePreviewDialog';
import { ChangeItem } from '../types';

const Dialog = () => {
  const sdk = useSDK<DialogAppSDK>();
  const parameters = sdk.parameters.invocation as any;


  if (parameters?.action === 'preview') {
    const { changes, sourceEnv, targetEnv, entryTitle, environments, missingContentTypes } = parameters;
    

    return (
      <MergePreviewDialog
        changes={changes as ChangeItem[]}
        sourceEnv={sourceEnv}
        targetEnv={targetEnv}
        entryTitle={entryTitle}
        environments={environments || []}
        missingContentTypes={missingContentTypes || []}
        onConfirm={(resolutions, finalSourceEnv, finalTargetEnv, copyContentTypes) => {
          sdk.close({ action: 'confirm', resolutions, sourceEnv: finalSourceEnv, targetEnv: finalTargetEnv, copyContentTypes });
        }}
        onCancel={() => {
          sdk.close();
        }}
      />
    );
  }

  console.warn('🎬 [Dialog] No matching action found, returning null');
  return null;
};

export default Dialog;
