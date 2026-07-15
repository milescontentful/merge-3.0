import React, { useState, useEffect } from 'react';
import {
  Stack,
  Button,
  Box,
  Note,
  Spinner,
  Text,
  Menu,
  Select,
  FormControl,
} from '@contentful/f36-components';
import { ChevronDownIcon } from '@contentful/f36-icons';
import { SidebarAppSDK } from '@contentful/app-sdk';
import { useSDK } from '@contentful/react-apps-toolkit';
import { AppInstallationParameters, DependencyNode, ChangeItem, ConflictResolution, FieldResolution, MergeProgress } from '../types';
import { useContentfulClient } from '../hooks/useContentfulClient';
import { DependencyResolver } from '../services/dependencyResolver';
import { ConflictDetector } from '../services/conflictDetector';
import { MergeExecutor } from '../services/mergeExecutor';
import { QueueService } from '../services/queueService';
import { ContentTypeMigrator, MissingContentType } from '../services/contentTypeMigrator';
import ProgressTracker from '../components/ProgressTracker';
import { getEnvironmentsWithAliases, EnvironmentWithAlias } from '../utils/environmentHelpers';

type ViewState = 'initial' | 'analyzing' | 'merging' | 'complete';

const Sidebar = () => {
  
  const sdk = useSDK<SidebarAppSDK>();
  const [parameters, setParameters] = useState<AppInstallationParameters | null>(null);
  const [sourceEnv, setSourceEnv] = useState<string>('');
  const [targetEnv, setTargetEnv] = useState<string>('');
  const [environments, setEnvironments] = useState<EnvironmentWithAlias[]>([]);
  const [loadingEnvs, setLoadingEnvs] = useState(false);
  const [viewState, setViewState] = useState<ViewState>('initial');
  const [dependencyTree, setDependencyTree] = useState<DependencyNode | null>(null);
  const [changes, setChanges] = useState<ChangeItem[]>([]);
  const [progress, setProgress] = useState<MergeProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missingContentTypes, setMissingContentTypes] = useState<MissingContentType[]>([]);

  const cma = useContentfulClient(parameters);

  useEffect(() => {
    
    (async () => {
      try {

        if (!sdk || !sdk.parameters) {
          console.error('❌ [Entry Merge] SDK or sdk.parameters is undefined!');
          setError('App SDK not initialized. Please ensure the app is properly installed.');
          return;
        }

        
        // In sidebar context, use sdk.parameters.installation instead of sdk.app.getParameters()
        const params = sdk.parameters.installation as AppInstallationParameters;
        
        
        setParameters(params || null);
        
        // Set source and target from config
        if (params?.defaultSourceEnvironment) {
          setSourceEnv(params.defaultSourceEnvironment);
        } else {
          // Fallback to current environment as source
          setSourceEnv(sdk.ids.environment);
        }
        
        if (params?.defaultTargetEnvironment) {
          setTargetEnv(params.defaultTargetEnvironment);
        }

      } catch (err: any) {
        console.error('❌ [Entry Merge] ERROR in useEffect:', err);
        console.error('❌ [Entry Merge] Error stack:', err.stack);
        setError(`Failed to load app configuration: ${err.message}`);
      }
    })();
  }, [sdk]);

  // Fetch environments when CMA client is available
  useEffect(() => {
    if (!cma) return;

    const fetchEnvironments = async () => {
      setLoadingEnvs(true);
      try {
        const envs = await getEnvironmentsWithAliases(cma, sdk.ids.space);
        
        setEnvironments(envs);
      } catch (err: any) {
        console.error('❌ [Sidebar] Failed to fetch environments:', err);
      } finally {
        setLoadingEnvs(false);
      }
    };

    fetchEnvironments();
  }, [cma, sdk.ids.space]);

  const handleAnalyzeDependencies = async () => {
    
    // Immediate feedback to user
    sdk.notifier.success('Starting merge analysis...');
    
    
    if (!cma || !sourceEnv || !targetEnv) {
      console.error('❌ [Sidebar] Missing required configuration');
      sdk.notifier.error('Please configure source and target environments');
      return;
    }

    if (sourceEnv === targetEnv) {
      sdk.notifier.error('Source and target environments must be different');
      return;
    }

    setViewState('analyzing');
    setError(null);

    try {
      let tree: DependencyNode;
      let items: Array<{ id: string; type: 'Entry' | 'Asset' }>;
      let detectedChanges: ChangeItem[];

      // Use CMA exclusively for reliability
      // CDA/Preview API requires separate Preview token and was causing 422 errors
      
      const resolver = new DependencyResolver(cma, sdk.ids.space, sourceEnv, 5);
      tree = await resolver.resolveEntryDependencies(sdk.ids.entry);
      setDependencyTree(tree);
      
      items = resolver.flattenDependencies(tree);
      sdk.notifier.success(`Found ${items.length} items to analyze`);
      
      const detector = new ConflictDetector(cma, sdk.ids.space, sourceEnv, targetEnv);
      detectedChanges = await detector.detectChanges(items);
      
      setChanges(detectedChanges);

      // Check for missing content types
      const migrator = new ContentTypeMigrator(cma, sdk.ids.space, sourceEnv, targetEnv);
      
      // Get all entries from changes
      const entriesWithContentTypes = detectedChanges
        .filter(c => c.type === 'Entry')
        .map(c => c.sourceData);
      
      const missing = await migrator.detectMissingContentTypes(entriesWithContentTypes);
      setMissingContentTypes(missing);
      
      if (missing.length > 0) {
        sdk.notifier.warning(`${missing.length} content type(s) missing in target environment`);
      }

      // Auto-resolve all conflicts as "overwrite"
      const conflictItems = detectedChanges.filter((c) => c.hasConflict);
      const autoResolutions: ConflictResolution[] = conflictItems.map((c) => ({
        id: c.id,
        action: 'overwrite',
      }));
      
      // Notify user we're opening the preview
      sdk.notifier.success('Opening merge preview...');
      
      // Show preview modal as full-page dialog
      
      const result = await sdk.dialogs.openCurrentApp({
        width: 'fullWidth',
        minHeight: '85vh',
        title: 'Merge Preview',
        parameters: {
          action: 'preview',
          changes: detectedChanges,
          sourceEnv,
          targetEnv,
          environments: environments, // Pass environments list
          missingContentTypes: missing, // Pass missing content types
          cmaToken: parameters?.cmaToken, // Pass CMA token for re-checking
          anthropicApiKey: parameters?.anthropicApiKey, // For the AI summary
          entryTitle: sdk.entry.fields.internalName?.getValue()?.toString() || 
                      sdk.entry.fields.title?.getValue()?.toString() || 
                      sdk.entry.fields.name?.getValue()?.toString() || 
                      sdk.ids.entry,
        } as any,
      });
      

      if (result && typeof result === 'object' && result.action === 'confirm') {
        // User confirmed, proceed with merge
        
        // Use environments from dialog if they were changed
        const finalSourceEnv = result.sourceEnv || sourceEnv;
        const finalTargetEnv = result.targetEnv || targetEnv;
        
        // Update state to reflect user's environment choice
        setSourceEnv(finalSourceEnv);
        setTargetEnv(finalTargetEnv);
        
        setViewState('merging');
        
        // If user wants to copy content types, do that first
        if (result.copyContentTypes && missingContentTypes.length > 0) {
          sdk.notifier.success(`Copying ${missingContentTypes.length} content type(s)...`);
          
          const ctMigrator = new ContentTypeMigrator(cma, sdk.ids.space, finalSourceEnv, finalTargetEnv);
          const contentTypeIds = missingContentTypes.map(ct => ct.id);
          
          const copyResult = await ctMigrator.copyContentTypes(contentTypeIds);
          
          if (copyResult.failed.length > 0) {
            sdk.notifier.error(`Failed to copy ${copyResult.failed.length} content type(s). Merge cancelled.`);
            setViewState('initial');
            return;
          }
          
          sdk.notifier.success(`Successfully copied ${copyResult.success.length} content type(s)!`);
        }
        
        await executeMerge(detectedChanges, autoResolutions, result.resolutions || []);
      } else {
        // User cancelled
        sdk.notifier.success('Merge cancelled');
        setViewState('initial');
      }
    } catch (err: any) {
      console.error('❌ [Sidebar] Error during merge preparation:', err);
      console.error('❌ [Sidebar] Error details:', {
        message: err.message,
        stack: err.stack,
        name: err.name,
      });
      
      const errorMessage = err.message || 'Failed to prepare merge';
      setError(errorMessage);
      setViewState('initial');
      
      sdk.notifier.error(`Merge preparation failed: ${errorMessage}`);
    }
  };

  // Removed - conflicts auto-resolved as overwrite

  const executeMerge = async (
    changesToMerge: ChangeItem[],
    resolutions: ConflictResolution[],
    fieldResolutions: FieldResolution[] = []
  ) => {
    if (!cma || !targetEnv) return;

    setViewState('merging');

    try {
      const executor = new MergeExecutor(
        cma,
        sdk.ids.space,
        targetEnv,
        false, // Always create as drafts - users can bulk publish in Contentful UI
        setProgress
      );

      const finalProgress = await executor.executeMerge(changesToMerge, resolutions, fieldResolutions);
      setProgress(finalProgress);
      setViewState('complete');

      if (finalProgress.failed === 0) {
        sdk.notifier.success('Merge completed successfully!');
      } else {
        sdk.notifier.warning(
          `Merge completed with ${finalProgress.failed} error(s)`
        );
      }
    } catch (err: any) {
      console.error('Error executing merge:', err);
      setError(err.message || 'Failed to execute merge');
      setViewState('initial');
      sdk.notifier.error('Failed to execute merge');
    }
  };

  const handleReset = () => {
    setViewState('initial');
    setDependencyTree(null);
    setChanges([]);
    setProgress(null);
    setError(null);
  };

  const handleMergeLater = async () => {
    
    // Immediate feedback
    sdk.notifier.success('Adding to queue...');
    
    
    if (!cma || !sourceEnv || !targetEnv) {
      console.error('❌ [Sidebar] Missing configuration');
      sdk.notifier.error('Environment configuration missing');
      return;
    }

    try {
      setViewState('analyzing');
      setError(null);

      let items: Array<{ id: string; type: 'Entry' | 'Asset' }>;
      
      // Use CMA exclusively
      
      const resolver = new DependencyResolver(cma, sdk.ids.space, sourceEnv, 5);
      const tree = await resolver.resolveEntryDependencies(sdk.ids.entry);
      items = resolver.flattenDependencies(tree);
      

      // Create queue service and add to queue
      const queueService = new QueueService(cma, sdk.ids.space, sourceEnv, sdk);
      
      const itemToAdd = {
        entryId: sdk.ids.entry,
        entryTitle: (sdk.entry.fields as any).internalName?.getValue() || sdk.ids.entry,
        contentType: sdk.entry.getSys().contentType.sys.id,
        sourceEnv,
        targetEnv,
        dependencyCount: items.length,
        dependencyIds: items.map(item => item.id),
      };
      
      await queueService.addToQueue(itemToAdd);

      sdk.notifier.success('Added to merge queue!');
      setViewState('initial');
    } catch (err: any) {
      console.error('❌ [Sidebar] Error adding to queue:', err);
      console.error('❌ [Sidebar] Error message:', err.message);
      console.error('❌ [Sidebar] Error stack:', err.stack);
      
      if (err.message === 'Entry already in queue') {
        sdk.notifier.warning('This entry is already in the queue');
      } else {
        setError(err.message || 'Failed to add to queue');
        sdk.notifier.error('Failed to add to queue');
      }
      setViewState('initial');
    }
  };

  // Don't return early - let useEffect run first to load parameters

  
  return (
    <Box padding="spacingS">
      <Stack spacing="spacingS">
        {viewState === 'initial' && (
          <>
            {parameters === null ? (
              <Box style={{ textAlign: 'center', padding: '16px 0' }}>
                <Spinner size="small" />
                <Text fontSize="fontSizeS" marginTop="spacingXs">
                  Loading configuration...
                </Text>
              </Box>
            ) : !parameters.cmaToken ? (
              <Note variant="warning">
                <Stack spacing="spacingXs">
                  <Text fontSize="fontSizeS" fontWeight="fontWeightDemiBold">
                    CMA Token Required
                  </Text>
                  <Text fontSize="fontSizeS">
                    Configure your CMA token in app settings.
                  </Text>
                </Stack>
              </Note>
            ) : !sourceEnv || !targetEnv ? (
              <Note variant="warning">
                <Stack spacing="spacingXs">
                  <Text fontSize="fontSizeS" fontWeight="fontWeightDemiBold">
                    Configuration Required
                  </Text>
                  <Text fontSize="fontSizeS">
                    Set default source and target environments in app settings.
                  </Text>
                </Stack>
              </Note>
            ) : (
              <Menu>
                <Menu.Trigger>
                  <Button
                    variant="positive"
                    isFullWidth
                    endIcon={<ChevronDownIcon />}
                  >
                    Merge
                  </Button>
                </Menu.Trigger>
                <Menu.List>
                  <Menu.Item 
                    onClick={() => {
                      handleAnalyzeDependencies();
                    }}
                  >
                    View Diff
                  </Menu.Item>
                  <Menu.Item 
                    onClick={() => {
                      handleMergeLater();
                    }}
                  >
                    Merge Later
                  </Menu.Item>
                </Menu.List>
              </Menu>
            )}
          </>
        )}

        {viewState === 'analyzing' && (
          <Stack spacing="spacingS" alignItems="center" style={{ padding: '24px 0' }}>
            <Spinner size="large" />
            <Text fontSize="fontSizeM" fontWeight="fontWeightMedium">
              Analyzing dependencies...
            </Text>
            <Text fontSize="fontSizeS" fontColor="gray600" style={{ textAlign: 'center' }}>
              Fetching all referenced entries and assets.
              This may take a few moments.
            </Text>
          </Stack>
        )}

        {/* Conflicts auto-resolved - no UI needed */}

        {viewState === 'merging' && progress && (
          <Box>
            <ProgressTracker progress={progress} />
          </Box>
        )}

        {viewState === 'complete' && progress && (
          <ProgressTracker progress={progress} />
        )}

        {error && (
          <Note variant="negative">
            <Text fontSize="fontSizeS">{error}</Text>
          </Note>
        )}
      </Stack>
    </Box>
  );
};

export default Sidebar;
