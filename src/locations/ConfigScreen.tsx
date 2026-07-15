import { useCallback, useState, useEffect } from 'react';
import { ConfigAppSDK } from '@contentful/app-sdk';
import {
  Heading,
  Form,
  Paragraph,
  Flex,
  FormControl,
  TextInput,
  Checkbox,
  Note,
  Select,
  Spinner,
  Box,
} from '@contentful/f36-components';
import { css } from 'emotion';
import { useSDK } from '@contentful/react-apps-toolkit';
import { AppInstallationParameters } from '../types';
import { useContentfulClient } from '../hooks/useContentfulClient';
import { getEnvironmentsWithAliases, EnvironmentWithAlias } from '../utils/environmentHelpers';

const ConfigScreen = () => {
  const [parameters, setParameters] = useState<AppInstallationParameters>({
    cmaToken: '',
    defaultSourceEnvironment: '',
    defaultTargetEnvironment: 'master',
    autoPublish: false, // Always disabled - users can bulk publish in Contentful UI
  });
  const [environments, setEnvironments] = useState<EnvironmentWithAlias[]>([]);
  const [loadingEnvironments, setLoadingEnvironments] = useState<boolean>(false);
  const sdk = useSDK<ConfigAppSDK>();
  const cma = useContentfulClient(parameters);

  const onConfigure = useCallback(async () => {
    // Validate that CMA token is provided
    if (!parameters.cmaToken || parameters.cmaToken.trim() === '') {
      sdk.notifier.error('CMA Token is required');
      return false;
    }


    const currentState = await sdk.app.getCurrentState();

    // Preserve existing per-content-type sidebar assignments.
    // (Enabling the sidebar is done per content type in the Contentful UI.)
    const result = {
      parameters,
      targetState: currentState,
    };

    sdk.notifier.success('Configuration saved! You may need to refresh entry pages.');

    return result;
  }, [parameters, sdk]);

  useEffect(() => {
    sdk.app.onConfigure(() => onConfigure());
  }, [sdk, onConfigure]);

  useEffect(() => {
    (async () => {
      const currentParameters: AppInstallationParameters | null =
        await sdk.app.getParameters();

      if (currentParameters) {
        setParameters(currentParameters);
      }

      sdk.app.setReady();
    })();
  }, [sdk]);

  useEffect(() => {
    if (cma && sdk.ids.space) {
      loadEnvironments();
    }
  }, [cma, sdk.ids.space]);

  const loadEnvironments = async () => {
    if (!cma) return;
    
    setLoadingEnvironments(true);
    try {
      const envs = await getEnvironmentsWithAliases(cma, sdk.ids.space);
      setEnvironments(envs);
      setLoadingEnvironments(false);
    } catch (err: any) {
      console.error('Error loading environments:', err);
      setLoadingEnvironments(false);
    }
  };

  return (
    <Flex
      flexDirection="column"
      className={css({ margin: '80px', maxWidth: '800px' })}
    >
      <Form>
        <Heading>Entry Merge App Configuration</Heading>
        <Paragraph>
          Configure the app to merge entries and assets between environments.
        </Paragraph>

        <Note variant="primary" style={{ marginTop: '20px', marginBottom: '20px' }}>
          This app allows you to merge content (entries and their referenced assets)
          from one environment to another, with conflict detection and resolution.
        </Note>

        <FormControl isRequired>
          <FormControl.Label>CMA Token</FormControl.Label>
          <TextInput
            type="password"
            value={parameters.cmaToken || ''}
            onChange={(e) =>
              setParameters({ ...parameters, cmaToken: e.target.value })
            }
          />
          <FormControl.HelpText>
            Content Management API token with read/write access to all
            environments. Keep this token secure.
          </FormControl.HelpText>
        </FormControl>

        <FormControl>
          <FormControl.Label>Anthropic API Key (optional)</FormControl.Label>
          <TextInput
            type="password"
            value={parameters.anthropicApiKey || ''}
            onChange={(e) =>
              setParameters({ ...parameters, anthropicApiKey: e.target.value })
            }
          />
          <FormControl.HelpText>
            Enables the AI "what changed" summary in the merge preview. Leave
            blank to use the built-in summary instead.
          </FormControl.HelpText>
        </FormControl>

        {loadingEnvironments ? (
          <Box style={{ textAlign: 'center', padding: '20px 0' }}>
            <Spinner />
            <Paragraph style={{ marginTop: '8px', fontSize: '14px' }}>
              Loading environments...
            </Paragraph>
          </Box>
        ) : environments.length > 0 ? (
          <>
            <FormControl>
              <FormControl.Label>Default Source Environment</FormControl.Label>
              <Select
                value={parameters.defaultSourceEnvironment || ''}
                onChange={(e) =>
                  setParameters({
                    ...parameters,
                    defaultSourceEnvironment: e.target.value,
                  })
                }
              >
                <Select.Option value="">None (select manually each time)</Select.Option>
                {environments.map((env) => (
                  <Select.Option key={env.sys.id} value={env.sys.id}>
                    {env.displayName}
                  </Select.Option>
                ))}
              </Select>
              <FormControl.HelpText>
                Optional: Default environment to merge FROM (e.g., develop, staging).
              </FormControl.HelpText>
            </FormControl>

            <FormControl>
              <FormControl.Label>Default Target Environment</FormControl.Label>
              <Select
                value={parameters.defaultTargetEnvironment || ''}
                onChange={(e) =>
                  setParameters({
                    ...parameters,
                    defaultTargetEnvironment: e.target.value,
                  })
                }
              >
                <Select.Option value="">None (select manually each time)</Select.Option>
                {environments.map((env) => (
                  <Select.Option key={env.sys.id} value={env.sys.id}>
                    {env.displayName}
                  </Select.Option>
                ))}
              </Select>
              <FormControl.HelpText>
                Optional: Default environment to merge TO (e.g., master, production).
              </FormControl.HelpText>
            </FormControl>
          </>
        ) : (
          <Note variant="warning">
            Add your CMA token above to load available environments for default selection.
          </Note>
        )}

        <Note variant="primary">
          <Paragraph>
            <strong>Note:</strong> Merged content will be created as drafts. Use Contentful's built-in bulk publish feature to publish entries at scale.
          </Paragraph>
        </Note>
      </Form>
    </Flex>
  );
};

export default ConfigScreen;
