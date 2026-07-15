import { useMemo } from 'react';
import { createClient, PlainClientAPI } from 'contentful-management';
import { AppInstallationParameters } from '../types';

export const useContentfulClient = (
  parameters: AppInstallationParameters | null
): PlainClientAPI | null => {
  return useMemo(() => {
    
    if (!parameters?.cmaToken) {
      return null;
    }

    try {
      const client = createClient(
        {
          accessToken: parameters.cmaToken,
        },
        {
          type: 'plain',
        }
      );
      return client;
    } catch (error) {
      console.error('❌ [useContentfulClient] Error creating Contentful client:', error);
      return null;
    }
  }, [parameters?.cmaToken]);
};

