import React, { useEffect, useState, useMemo } from 'react';
import {
  Box,
  Button,
  Stack,
  Text,
  Flex,
  Badge,
  Heading,
  Note,
  Spinner,
  TextInput,
  Select,
  Table,
  Checkbox,
  Menu,
} from '@contentful/f36-components';
import { SearchIcon, ChevronDownIcon, ChevronRightIcon, AssetIcon } from '@contentful/f36-icons';
import { PageAppSDK } from '@contentful/app-sdk';
import { useSDK } from '@contentful/react-apps-toolkit';
import { QueueService, QueueItem } from '../services/queueService';
import { AppInstallationParameters, MergeProgress, ConflictResolution, ChangeItem } from '../types';
import { useContentfulClient } from '../hooks/useContentfulClient';
import { DependencyResolver } from '../services/dependencyResolver';
import { ConflictDetector } from '../services/conflictDetector';
import { MergeExecutor } from '../services/mergeExecutor';
import { ContentTypeMigrator } from '../services/contentTypeMigrator';
import ProgressTracker from '../components/ProgressTracker';
import { getEnvironmentsWithAliases, EnvironmentWithAlias } from '../utils/environmentHelpers';

const Page = () => {
  
  const sdk = useSDK<PageAppSDK>();
  
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState<Set<string>>(new Set());
  const [parameters, setParameters] = useState<AppInstallationParameters | null>(null);
  const [mergeProgress, setMergeProgress] = useState<MergeProgress | null>(null);
  const [mergingItem, setMergingItem] = useState<QueueItem | null>(null);
  
  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [filterContentType, setFilterContentType] = useState('all');
  const [filterEnvironment, setFilterEnvironment] = useState('all');
  
  // Expandable dependencies state
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [dependenciesData, setDependenciesData] = useState<Map<string, any[]>>(new Map());
  const [loadingDependencies, setLoadingDependencies] = useState<Set<string>>(new Set());
  
  // Selection state
  const [selectedEntries, setSelectedEntries] = useState<Set<string>>(new Set());
  const [selectedDependencies, setSelectedDependencies] = useState<Map<string, Set<string>>>(new Map());
  
  // Validation state
  const [validating, setValidating] = useState(false);
  const [validationResults, setValidationResults] = useState<Map<string, any>>(new Map());
  // Track validation errors per dependency (item.id -> dep.id -> error message)
  const [dependencyErrors, setDependencyErrors] = useState<Map<string, Map<string, string>>>(new Map());
  
  // Environment management state
  const [environments, setEnvironments] = useState<EnvironmentWithAlias[]>([]);
  const [creatingEnv, setCreatingEnv] = useState(false);
  const [deletingEnv, setDeletingEnv] = useState(false);

  const cma = useContentfulClient(parameters);

  useEffect(() => {
    const loadParameters = async () => {
      const params = sdk.parameters.installation as AppInstallationParameters;
      setParameters(params);
    };
    loadParameters();
  }, [sdk]);

  // Load environments with aliases
  useEffect(() => {
    const loadEnvironments = async () => {
      if (!cma) return;
      
      try {
        const envs = await getEnvironmentsWithAliases(cma, sdk.ids.space);
        
        setEnvironments(envs);
      } catch (err) {
        console.error('❌ [Queue Page] Failed to load environments:', err);
      }
    };
    
    loadEnvironments();
  }, [cma, sdk.ids.space]);

  // Use current environment for queue (queue is saved per environment)
  const currentEnv = sdk.ids.environment || parameters?.defaultSourceEnvironment;
  

  useEffect(() => {
    
    if (!cma || !currentEnv) {
      setLoading(false);
      return;
    }
    
    const loadQueueData = async () => {
      const queueService = new QueueService(cma, sdk.ids.space, currentEnv, sdk);
      
      try {
        setLoading(true);
        const items = await queueService.getQueue();
        setQueueItems(items);
        setError(null);
      } catch (err: any) {
        console.error('❌ [Queue Page] Failed to load queue:', err);
        console.error('❌ [Queue Page] Error message:', err.message);
        setError(err.message || 'Failed to load queue');
      } finally {
        setLoading(false);
      }
    };
    
    loadQueueData();
  }, [cma, currentEnv, sdk.ids.space, parameters]);

  const getQueueService = () => {
    if (!cma || !currentEnv) return null;
    return new QueueService(cma, sdk.ids.space, currentEnv, sdk);
  };

  const loadQueue = async () => {
    const queueService = getQueueService();
    if (!queueService) return;
    
    try {
      setLoading(true);
      const items = await queueService.getQueue();
      setQueueItems(items);
      setError(null);
    } catch (err: any) {
      console.error('Failed to load queue:', err);
      setError(err.message || 'Failed to load queue');
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveItem = async (itemId: string) => {
    const queueService = getQueueService();
    if (!queueService) return;
    
    try {
      await queueService.removeFromQueue(itemId);
      await loadQueue();
      sdk.notifier.success('Item removed from queue');
    } catch (err: any) {
      console.error('Failed to remove item:', err);
      sdk.notifier.error('Failed to remove item');
    }
  };

  const handleClearQueue = async () => {
    const queueService = getQueueService();
    if (!queueService) return;
    
    const confirmed = await sdk.dialogs.openConfirm({
      title: 'Clear Queue',
      message: 'Are you sure you want to clear all items from the queue?',
      confirmLabel: 'Clear All',
      cancelLabel: 'Cancel',
    });

    if (confirmed) {
      try {
        await queueService.clearQueue();
        await loadQueue();
        sdk.notifier.success('Queue cleared');
      } catch (err: any) {
        console.error('Failed to clear queue:', err);
        sdk.notifier.error('Failed to clear queue');
      }
    }
  };

  // Helper function to check and copy missing content types
  const checkAndCopyContentTypes = async (
    detectedChanges: ChangeItem[],
    sourceEnv: string,
    targetEnv: string
  ): Promise<boolean> => {
    if (!cma) return false;
    
    const migrator = new ContentTypeMigrator(cma, sdk.ids.space, sourceEnv, targetEnv);
    
    const entriesWithContentTypes = detectedChanges
      .filter(c => c.type === 'Entry')
      .map(c => c.sourceData);
    
    const missingContentTypes = await migrator.detectMissingContentTypes(entriesWithContentTypes);
    
    if (missingContentTypes.length > 0) {
      console.warn('⚠️ [Queue Merge] Found', missingContentTypes.length, 'missing content types');
      sdk.notifier.warning(`Found ${missingContentTypes.length} missing content type(s)`);
      
      // Ask user if they want to copy content types
      const shouldCopy = await sdk.dialogs.openConfirm({
        title: 'Missing Content Types',
        message: `The following content types don't exist in ${targetEnv}:\n\n${missingContentTypes.map(ct => `• ${ct.name} (${ct.id})`).join('\n')}\n\nDo you want to copy them before merging?`,
        confirmLabel: 'Copy Content Types',
        cancelLabel: 'Cancel Merge',
      });
      
      if (!shouldCopy) {
        sdk.notifier.error('Merge cancelled');
        return false;
      }
      
      // Copy content types
      sdk.notifier.success(`Copying ${missingContentTypes.length} content type(s)...`);
      
      const contentTypeIds = missingContentTypes.map(ct => ct.id);
      const copyResult = await migrator.copyContentTypes(contentTypeIds);
      
      if (copyResult.failed.length > 0) {
        console.error('❌ [Queue Merge] Failed to copy', copyResult.failed.length, 'content types');
        sdk.notifier.error(`Failed to copy ${copyResult.failed.length} content type(s). Merge cancelled.`);
        return false;
      }
      
      sdk.notifier.success(`Successfully copied ${copyResult.success.length} content type(s)!`);
    } else {
    }
    
    return true;
  };

  const handleMergeItem = async (item: QueueItem) => {
    const queueService = getQueueService();
    if (!queueService || !cma) return;
    
    setProcessing(prev => new Set(prev).add(item.id));
    setMergingItem(item);
    
    
    try {
      // Step 1: Resolve dependencies
      const resolver = new DependencyResolver(cma, sdk.ids.space, item.sourceEnv, 5);
      const tree = await resolver.resolveEntryDependencies(item.entryId);
      const items = resolver.flattenDependencies(tree);
      
      // Step 2: Detect conflicts
      const detector = new ConflictDetector(cma, sdk.ids.space, item.sourceEnv, item.targetEnv);
      const detectedChanges = await detector.detectChanges(items);
      
      // Filter to only include items that don't exist in target (add only, no overwrites)
      // This ensures we only add new content, not overwrite existing content
      const changesToMerge = detectedChanges.filter((c) => c.changeType === 'add');
      const skippedItems = detectedChanges.filter((c) => c.changeType === 'update');
      
      
      if (skippedItems.length > 0) {
        const skippedTitles = skippedItems.map(s => s.title || s.id).slice(0, 5);
        sdk.notifier.warning(`Skipping ${skippedItems.length} item(s) that already exist in target`);
      }
      
      if (changesToMerge.length === 0) {
        sdk.notifier.success(`${item.entryTitle}: All content already exists in ${item.targetEnv}`);
        
        // Remove from queue since there's nothing to do
        await queueService.removeFromQueue(item.id);
        await loadQueue();
        
        setProcessing(prev => {
          const next = new Set(prev);
          next.delete(item.id);
          return next;
        });
        setMergingItem(null);
        setMergeProgress(null);
        return;
      }
      
      // Step 2.5: Check for missing content types (only for items we're actually merging)
      const canProceed = await checkAndCopyContentTypes(changesToMerge, item.sourceEnv, item.targetEnv);
      
      if (!canProceed) {
        setProcessing(prev => {
          const next = new Set(prev);
          next.delete(item.id);
          return next;
        });
        setMergingItem(null);
        setMergeProgress(null);
        return;
      }
      
      // No conflicts to resolve since we're only adding new items
      const autoResolutions: ConflictResolution[] = [];
      
      // Step 3: Execute merge (only new items, no overwrites)
      const executor = new MergeExecutor(
        cma,
        sdk.ids.space,
        item.targetEnv,
        false, // Always create as drafts - users can bulk publish in Contentful UI
        setMergeProgress
      );
      
      const finalProgress = await executor.executeMerge(changesToMerge, autoResolutions);
      setMergeProgress(finalProgress);
      
      
      // Remove from queue after successful merge
      await queueService.removeFromQueue(item.id);
      await loadQueue();
      
      if (finalProgress.failed === 0) {
        const skippedMsg = skippedItems.length > 0 
          ? ` (${skippedItems.length} existing item(s) skipped)` 
          : '';
        sdk.notifier.success(
          `${item.entryTitle}: Added ${finalProgress.succeeded} new item(s) to ${item.targetEnv}${skippedMsg}`
        );
      } else {
        sdk.notifier.warning(`${item.entryTitle}: Added ${finalProgress.succeeded} item(s), ${finalProgress.failed} failed`);
      }
      
      // Keep progress visible for 3 seconds
      setTimeout(() => {
        setMergeProgress(null);
        setMergingItem(null);
      }, 3000);
      
    } catch (err: any) {
      console.error('❌ [Queue Merge] Failed to merge item:', err);
      console.error('❌ [Queue Merge] Error:', err.message);
      sdk.notifier.error(`Failed to merge ${item.entryTitle}: ${err.message}`);
      setMergeProgress(null);
      setMergingItem(null);
    } finally {
      setProcessing(prev => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  };

  const handleRemoveSelected = async () => {
    const itemsToRemove = queueItems.filter(item => 
      selectedEntries.has(item.id) || selectedDependencies.has(item.id)
    );

    const confirmed = await sdk.dialogs.openConfirm({
      title: 'Remove Selected',
      message: `Are you sure you want to remove ${itemsToRemove.length} ${itemsToRemove.length === 1 ? 'item' : 'items'} from the queue?`,
      confirmLabel: 'Remove',
      cancelLabel: 'Cancel',
    });

    if (confirmed) {
      for (const item of itemsToRemove) {
        await handleRemoveItem(item.id);
      }
      
      // Clear selections
      setSelectedEntries(new Set());
      setSelectedDependencies(new Map());
      
      sdk.notifier.success(`Removed ${itemsToRemove.length} items from queue`);
    }
  };

  const handleMergeSelected = async () => {
    const itemsToMerge = queueItems.filter(item => 
      selectedEntries.has(item.id) || selectedDependencies.has(item.id)
    );

    const confirmed = await sdk.dialogs.openConfirm({
      title: 'Merge Selected',
      message: `Are you sure you want to merge ${itemsToMerge.length} ${itemsToMerge.length === 1 ? 'item' : 'items'}?`,
      confirmLabel: 'Merge Selected',
      cancelLabel: 'Cancel',
    });

    if (confirmed) {
      sdk.notifier.success(`Starting merge of ${itemsToMerge.length} items...`);
      
      for (const item of itemsToMerge) {
        await handleMergeItem(item);
      }
      
      // Clear selections after merge
      setSelectedEntries(new Set());
      setSelectedDependencies(new Map());
    }
  };

  const handleMergeAll = async () => {
    const itemsToMerge = hasSelections() 
      ? queueItems.filter(item => 
          selectedEntries.has(item.id) || selectedDependencies.has(item.id)
        )
      : queueItems;

    const confirmed = await sdk.dialogs.openConfirm({
      title: hasSelections() ? 'Merge Selected' : 'Merge All',
      message: `Are you sure you want to merge ${itemsToMerge.length} ${itemsToMerge.length === 1 ? 'item' : 'items'}?`,
      confirmLabel: hasSelections() ? 'Merge Selected' : 'Merge All',
      cancelLabel: 'Cancel',
    });

    if (confirmed) {
      sdk.notifier.success(`Starting merge of ${itemsToMerge.length} items...`);
      
      for (const item of itemsToMerge) {
        // If specific dependencies are selected for this item, merge only those
        // Otherwise, merge the whole item with all dependencies
        if (selectedDependencies.has(item.id) && !selectedEntries.has(item.id)) {
          // Only specific dependencies selected - need custom merge logic
          // For now, we'll merge the whole item but could be enhanced later
          await handleMergeItem(item);
        } else {
          // Merge entire item (either explicitly selected or no specific deps selected)
          await handleMergeItem(item);
        }
      }
      
      // Clear selections after merge
      setSelectedEntries(new Set());
      setSelectedDependencies(new Map());
    }
  };

  // Handler for creating new environment
  const handleCreateEnvironment = async () => {
    if (!cma) return;
    
    setCreatingEnv(true);
    
    try {
      // Generate default name: test-YYYY-MM-DD-HHmmss
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const seconds = String(now.getSeconds()).padStart(2, '0');
      const defaultName = `test-${year}-${month}-${day}-${hours}${minutes}${seconds}`;
      
      // Prompt user for new environment ID
      const newEnvId = await sdk.dialogs.openPrompt({
        title: 'Create New Environment',
        message: 'Enter environment ID (max 40 chars, lowercase, no spaces):',
        defaultValue: defaultName.substring(0, 40),
      });
      
      if (!newEnvId) {
        setCreatingEnv(false);
        return;
      }
      
      // Validate and sanitize
      const sanitizedId = String(newEnvId)
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '-')
        .substring(0, 40);
      
      sdk.notifier.success(`Creating environment "${sanitizedId}"...`);
      
      // Create environment
      await cma.environment.createWithId(
        {
          spaceId: sdk.ids.space,
          environmentId: sanitizedId,
        },
        {
          name: sanitizedId,
        }
      );
      
      
      // Reload environments list with aliases
      const envs = await getEnvironmentsWithAliases(cma, sdk.ids.space);
      setEnvironments(envs);
      
      sdk.notifier.success(`Environment "${sanitizedId}" created!`);
      
    } catch (err: any) {
      console.error('❌ [Queue Page] Failed to create environment:', err);
      sdk.notifier.error(`Failed to create environment: ${err.message}`);
    } finally {
      setCreatingEnv(false);
    }
  };

  // Handler for deleting environment
  const handleDeleteEnvironment = async (envId: string) => {
    if (!cma || !envId) {
      return;
    }
    
    // Prompt user to type environment name to confirm
    const typedName = await sdk.dialogs.openPrompt({
      title: 'Delete Environment',
      message: `Type the environment name to confirm deletion: "${envId}" This action cannot be undone.`,
      defaultValue: '',
    });
    
    if (!typedName || typedName !== envId) {
      if (typedName) {
        sdk.notifier.warning('Environment name did not match. Deletion cancelled.');
      }
      return;
    }
    
    setDeletingEnv(true);
    
    try {
      sdk.notifier.success(`Deleting environment "${envId}"...`);
      
      // Delete environment
      await cma.environment.delete({
        spaceId: sdk.ids.space,
        environmentId: envId,
      });
      
      
      // Reload environments list with aliases
      const envs = await getEnvironmentsWithAliases(cma, sdk.ids.space);
      setEnvironments(envs);
      
      sdk.notifier.success(`Environment "${envId}" deleted!`);
      
    } catch (err: any) {
      console.error('❌ [Queue Page] Failed to delete environment:', err);
      sdk.notifier.error(`Failed to delete environment: ${err.message}`);
    } finally {
      setDeletingEnv(false);
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  // Helper to extract a human-readable title from an entry
  const extractEntryTitle = (entry: any, fallbackId: string): string => {
    // Try common title fields in order of preference
    const fields = entry.fields || {};
    const locales = ['en-US', 'en', 'de-DE', 'de', 'fr', 'es'];
    
    const titleFields = [
      'internalName',
      'title', 
      'name',
      'heading',
      'label',
      'displayName',
      'entryTitle',
      'pageName',
      'headline',
      'question', // For FAQ entries
      'text', // For short text entries
    ];
    
    // Try each title field with each locale
    for (const fieldName of titleFields) {
      if (fields[fieldName]) {
        for (const locale of locales) {
          const value = fields[fieldName][locale];
          if (value && typeof value === 'string' && value.trim()) {
            return value.trim();
          }
        }
        // If field exists but no locale match, try first available locale
        const firstLocale = Object.keys(fields[fieldName])[0];
        const value = fields[fieldName][firstLocale];
        if (value && typeof value === 'string' && value.trim()) {
          return value.trim();
        }
      }
    }
    
    // Fallback: show content type + shortened ID
    const contentType = entry.sys?.contentType?.sys?.id;
    if (contentType) {
      return `${contentType} (${fallbackId.substring(0, 8)}...)`;
    }
    
    return fallbackId;
  };

  // Helper to extract a human-readable title from an asset
  const extractAssetTitle = (asset: any, fallbackId: string): string => {
    const fields = asset.fields || {};
    const locales = ['en-US', 'en', 'de-DE', 'de', 'fr', 'es'];
    
    // Try title field with different locales
    if (fields.title) {
      for (const locale of locales) {
        const value = fields.title[locale];
        if (value && typeof value === 'string' && value.trim()) {
          return value.trim();
        }
      }
      // Try first available locale
      const firstLocale = Object.keys(fields.title)[0];
      const value = fields.title[firstLocale];
      if (value && typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    
    // Try file name as fallback
    if (fields.file) {
      for (const locale of locales) {
        const fileName = fields.file[locale]?.fileName;
        if (fileName && typeof fileName === 'string' && fileName.trim()) {
          return fileName.trim();
        }
      }
    }
    
    return `Asset (${fallbackId.substring(0, 8)}...)`;
  };

  const getStatusBadgeVariant = (status: string): 'positive' | 'warning' | 'secondary' | 'negative' | 'primary' => {
    switch (status) {
      case 'Published':
        return 'positive';
      case 'Changed':
        return 'warning';
      case 'Draft':
        return 'secondary';
      case 'Archived':
        return 'negative';
      case 'Not in target':
        return 'primary';
      case 'Queued':
        return 'secondary';
      default:
        return 'secondary';
    }
  };

  // Content type color mapping for consistency
  const getContentTypeColor = (contentType: string) => {
    const colors = [
      '#3C80CF', // blue
      '#7B61FF', // purple
      '#F05C4E', // red
      '#F7A23B', // orange
      '#22A565', // green
      '#E84C8B', // pink
      '#00A4B8', // cyan
      '#8F6CAB', // lavender
    ];
    
    // Use consistent hash for same content type
    let hash = 0;
    for (let i = 0; i < contentType.length; i++) {
      hash = contentType.charCodeAt(i) + ((hash << 5) - hash);
    }
    
    return colors[Math.abs(hash) % colors.length];
  };

  const handleSelectEntry = async (itemId: string, checked: boolean) => {
    if (checked) {
      // First, add the parent entry to selection
      setSelectedEntries(prev => new Set(prev).add(itemId));
      
      // Check if dependencies are already loaded
      const deps = dependenciesData.get(itemId);
      
      if (deps && deps.length > 0) {
        // Dependencies already loaded, auto-select them
        const childDeps = new Set<string>();
        deps.forEach(dep => {
          childDeps.add(dep.id); // Use dep.id, not dep.sys.id
        });
        setSelectedDependencies(prev => {
          const next = new Map(prev);
          next.set(itemId, childDeps);
          return next;
        });
      } else if (!deps) {
        // Dependencies not loaded yet, need to load them first
        const item = queueItems.find(q => q.id === itemId);
        if (item && cma) {
          
          // Expand row and show loading
          setLoadingDependencies(prev => new Set(prev).add(itemId));
          setExpandedRows(prev => new Set(prev).add(itemId));
          
          try {
            const loadedDeps: any[] = [];
            
            // Fetch dependencies one by one FROM SOURCE ENVIRONMENT
            for (const depId of item.dependencyIds) {
              if (depId === item.entryId) continue; // Skip self
              
              try {
                // Try to fetch as entry from SOURCE environment
                const entry = await cma.entry.get({
                  spaceId: sdk.ids.space,
                  environmentId: item.sourceEnv,  // ✅ Fetch from source, not target
                  entryId: depId,
                });

                const title = extractEntryTitle(entry, depId);

                // Determine status from entry metadata
                let status = 'Draft';
                if (entry.sys.publishedVersion) {
                  if (entry.sys.version > entry.sys.publishedVersion + 1) {
                    status = 'Changed';
                  } else {
                    status = 'Published';
                  }
                }
                if (entry.sys.archivedVersion) {
                  status = 'Archived';
                }

                loadedDeps.push({
                  id: depId,
                  sys: { id: depId, linkType: 'Entry' },
                  title,
                  contentType: entry.sys.contentType.sys.id,
                  status,
                });
            } catch (entryErr) {
              // If not an entry, try as asset FROM SOURCE ENVIRONMENT
              try {
                const asset = await cma.asset.get({
                  spaceId: sdk.ids.space,
                  environmentId: item.sourceEnv,  // ✅ Fetch from source, not target
                  assetId: depId,
                });

                  const title = extractAssetTitle(asset, depId);

                  let status = 'Draft';
                  if (asset.sys.publishedVersion) {
                    if (asset.sys.version > asset.sys.publishedVersion + 1) {
                      status = 'Changed';
                    } else {
                      status = 'Published';
                    }
                  }
                  if (asset.sys.archivedVersion) {
                    status = 'Archived';
                  }

                  loadedDeps.push({
                    id: depId,
                    sys: { id: depId, linkType: 'Asset' },
                    title,
                    contentType: 'Asset',
                    status,
                  });
                } catch (assetErr) {
                  console.warn(`⚠️ [Queue Page] Could not load dependency ${depId}:`, assetErr);
                }
              }
            }
            
            
            // Store dependencies
            setDependenciesData(prev => new Map(prev).set(itemId, loadedDeps));
            
            // Auto-select all loaded dependencies
            if (loadedDeps.length > 0) {
              const childDeps = new Set<string>();
              loadedDeps.forEach(dep => {
                childDeps.add(dep.id);
              });
              setSelectedDependencies(prev => {
                const next = new Map(prev);
                next.set(itemId, childDeps);
                return next;
              });
            }
            
          } catch (err: any) {
            console.error('❌ [Queue Page] Failed to load dependencies:', err);
            sdk.notifier.error('Failed to load dependencies');
          } finally {
            setLoadingDependencies(prev => {
              const next = new Set(prev);
              next.delete(itemId);
              return next;
            });
          }
        }
      }
    } else {
      // Uncheck: remove parent and all its dependencies
      setSelectedEntries(prev => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
      setSelectedDependencies(prev => {
        const next = new Map(prev);
        next.delete(itemId);
        return next;
      });
    }
  };

  const handleSelectDependency = (itemId: string, depId: string, checked: boolean) => {
    const newDepSelections = new Map(selectedDependencies);
    const currentDeps = newDepSelections.get(itemId) || new Set<string>();
    
    if (checked) {
      currentDeps.add(depId);
    } else {
      currentDeps.delete(depId);
    }
    
    if (currentDeps.size > 0) {
      newDepSelections.set(itemId, currentDeps);
    } else {
      newDepSelections.delete(itemId);
    }
    
    setSelectedDependencies(newDepSelections);
  };

  const isEntrySelected = (itemId: string) => {
    return selectedEntries.has(itemId);
  };

  const isDependencySelected = (itemId: string, depId: string) => {
    return selectedDependencies.get(itemId)?.has(depId) || false;
  };

  const getSelectionCount = () => {
    let count = selectedEntries.size;
    selectedDependencies.forEach((deps) => {
      count += deps.size;
    });
    return count;
  };

  const hasSelections = () => {
    return selectedEntries.size > 0 || selectedDependencies.size > 0;
  };

  const handleValidateSelected = async () => {
    if (!cma) return;
    
    const itemsToValidate = queueItems.filter(item => 
      selectedEntries.has(item.id) || selectedDependencies.has(item.id)
    );

    if (itemsToValidate.length === 0) {
      sdk.notifier.warning('Please select entries to validate');
      return;
    }

    setValidating(true);
    sdk.notifier.success(`Validating ${itemsToValidate.length} items...`);
    
      const results = new Map<string, any>();
      const depErrors = new Map<string, Map<string, string>>();
      let totalErrors = 0;
      let totalWarnings = 0;

      try {
        for (const item of itemsToValidate) {
          const itemErrors: string[] = [];
          const itemWarnings: string[] = [];
          const itemDepErrors = new Map<string, string>();

          try {
            // 1. Check if source entry exists
            try {
              const sourceEntry = await cma.entry.get({
                spaceId: sdk.ids.space,
                environmentId: item.sourceEnv,
                entryId: item.entryId,
              });
              
              // 2. Check if entry has required fields populated
              try {
                const contentType = await cma.contentType.get({
                  spaceId: sdk.ids.space,
                  environmentId: item.sourceEnv,
                  contentTypeId: sourceEntry.sys.contentType.sys.id,
                });
                
                const requiredFields = contentType.fields.filter(f => f.required);
                
                for (const field of requiredFields) {
                  if (!sourceEntry.fields[field.id]) {
                    itemErrors.push(`Missing required field: ${field.name || field.id}`);
                  }
                }
                
                // 3. Check if content type exists in target
                try {
                  await cma.contentType.get({
                    spaceId: sdk.ids.space,
                    environmentId: item.targetEnv,
                    contentTypeId: sourceEntry.sys.contentType.sys.id,
                  });
                } catch (err) {
                  itemErrors.push(`Content type "${sourceEntry.sys.contentType.sys.id}" does not exist in target environment`);
                }
              } catch (err: any) {
                itemWarnings.push(`Could not validate content type: ${err.message}`);
              }
              
              // 4. Check dependencies
              const deps = dependenciesData.get(item.id);
              if (deps && deps.length > 0) {
                const selectedDeps = selectedDependencies.get(item.id) || new Set<string>();
                for (const dep of deps) {
                  if (selectedDeps.has(dep.id)) {
                    try {
                      if (dep.sys.linkType === 'Entry') {
                        await cma.entry.get({
                          spaceId: sdk.ids.space,
                          environmentId: item.sourceEnv,
                          entryId: dep.id,
                        });
                      } else if (dep.sys.linkType === 'Asset') {
                        await cma.asset.get({
                          spaceId: sdk.ids.space,
                          environmentId: item.sourceEnv,
                          assetId: dep.id,
                        });
                      }
                    } catch (err) {
                      // Store error for this specific dependency
                      const errorMsg = `Not found in source`;
                      itemDepErrors.set(dep.id, errorMsg);
                      itemErrors.push(`Dependency ${dep.contentType} "${dep.title}" not found in source`);
                    }
                  }
                }
                
                // Warn about unselected dependencies
                const unselectedCount = deps.length - selectedDeps.size;
                if (unselectedCount > 0 && !selectedEntries.has(item.id)) {
                  itemWarnings.push(`${unselectedCount} dependencies are not selected and will not be merged`);
                }
              }
              
            } catch (err: any) {
              itemErrors.push(`Entry not found in source environment: ${err.message}`);
            }
            
          } catch (err: any) {
            itemErrors.push(`Validation failed: ${err.message}`);
          }

          results.set(item.id, {
            errors: itemErrors,
            warnings: itemWarnings,
            status: itemErrors.length > 0 ? 'error' : itemWarnings.length > 0 ? 'warning' : 'success'
          });
          
          // Store dependency-level errors
          if (itemDepErrors.size > 0) {
            depErrors.set(item.id, itemDepErrors);
          }

          totalErrors += itemErrors.length;
          totalWarnings += itemWarnings.length;
        }

        setValidationResults(results);
        setDependencyErrors(depErrors);
      
      // Show summary notification
      if (totalErrors > 0) {
        sdk.notifier.error(`Validation found ${totalErrors} errors and ${totalWarnings} warnings`);
      } else if (totalWarnings > 0) {
        sdk.notifier.warning(`Validation found ${totalWarnings} warnings`);
      } else {
        sdk.notifier.success('✓ All selected items passed validation!');
      }
      
    } catch (err: any) {
      console.error('❌ [Validation] Error:', err);
      sdk.notifier.error(`Validation failed: ${err.message}`);
    } finally {
      setValidating(false);
    }
  };

  const toggleRowExpansion = async (item: QueueItem) => {
    const isExpanded = expandedRows.has(item.id);
    
    if (isExpanded) {
      // Collapse row
      const newExpanded = new Set(expandedRows);
      newExpanded.delete(item.id);
      setExpandedRows(newExpanded);
    } else {
      // Expand row - fetch dependencies if not already loaded
      const newExpanded = new Set(expandedRows);
      newExpanded.add(item.id);
      setExpandedRows(newExpanded);

      if (!dependenciesData.has(item.id) && cma) {
        // Fetch dependencies
        setLoadingDependencies(prev => new Set(prev).add(item.id));
        
        try {
          const dependencies: any[] = [];
          
          // Fetch all dependency entries FROM SOURCE ENVIRONMENT
          for (const depId of item.dependencyIds) {
            try {
              const entry = await cma.entry.get({
                spaceId: sdk.ids.space,
                environmentId: item.sourceEnv,  // ✅ Fetch from source, not target
                entryId: depId,
              });

              const title = extractEntryTitle(entry, depId);

              // Determine status from entry metadata IN SOURCE ENVIRONMENT
              let status = 'Draft';
              if (entry.sys.publishedVersion) {
                if (entry.sys.version > entry.sys.publishedVersion + 1) {
                  status = 'Changed';
                } else {
                  status = 'Published';
                }
              }
              if (entry.sys.archivedVersion) {
                status = 'Archived';
              }

              dependencies.push({
                id: depId,
                title,
                contentType: entry.sys.contentType.sys.id,
                status,
                exists: true,
              });
            } catch (error: any) {
              // Entry doesn't exist in target
              if (error.status === 404) {
                dependencies.push({
                  id: depId,
                  title: depId,
                  contentType: 'Unknown',
                  status: 'Not in target',
                  exists: false,
                });
              }
            }
          }

          setDependenciesData(prev => new Map(prev).set(item.id, dependencies));
        } catch (error) {
          console.error('Failed to load dependencies:', error);
        } finally {
          setLoadingDependencies(prev => {
            const newSet = new Set(prev);
            newSet.delete(item.id);
            return newSet;
          });
        }
      }
    }
  };

  // Filter and search logic
  const filteredItems = useMemo(() => {
    return queueItems.filter((item) => {
      // Search filter - searches across ALL fields including dependencies
      const searchLower = searchQuery.toLowerCase();
      
      // Check if any dependency matches the search
      const dependencies = dependenciesData.get(item.id) || [];
      const dependencyMatches = dependencies.some(dep => 
        dep.title.toLowerCase().includes(searchLower) ||
        dep.contentType.toLowerCase().includes(searchLower) ||
        dep.status.toLowerCase().includes(searchLower) ||
        dep.id.toLowerCase().includes(searchLower)
      );
      
      const matchesSearch = searchQuery === '' || 
        item.entryTitle.toLowerCase().includes(searchLower) ||
        item.entryId.toLowerCase().includes(searchLower) ||
        item.contentType.toLowerCase().includes(searchLower) ||
        item.sourceEnv.toLowerCase().includes(searchLower) ||
        item.targetEnv.toLowerCase().includes(searchLower) ||
        item.dependencyIds.some(depId => depId.toLowerCase().includes(searchLower)) ||
        formatDate(item.addedAt).toLowerCase().includes(searchLower) ||
        `${item.dependencyCount} items`.toLowerCase().includes(searchLower) ||
        dependencyMatches;

      // Content type filter
      const matchesContentType = filterContentType === 'all' || 
        item.contentType === filterContentType;

      // Environment filter
      const matchesEnvironment = filterEnvironment === 'all' ||
        item.sourceEnv === filterEnvironment ||
        item.targetEnv === filterEnvironment;

      return matchesSearch && matchesContentType && matchesEnvironment;
    });
  }, [queueItems, searchQuery, filterContentType, filterEnvironment, dependenciesData]);

  // Get unique values for filters
  const contentTypes = useMemo(() => {
    const types = new Set(queueItems.map(item => item.contentType));
    return Array.from(types).sort();
  }, [queueItems]);

  const queueEnvironments = useMemo(() => {
    const envs = new Set<string>();
    queueItems.forEach(item => {
      envs.add(item.sourceEnv);
      envs.add(item.targetEnv);
    });
    return Array.from(envs).sort();
  }, [queueItems]);

  if (loading) {
    return (
      <Box padding="spacingXl">
        <Flex justifyContent="center" alignItems="center" style={{ minHeight: '400px' }}>
          <Spinner size="large" />
        </Flex>
      </Box>
    );
  }

  if (!currentEnv) {
    return (
      <Box padding="spacingXl">
        <Note variant="warning">
          <Stack spacing="spacingS">
            <Text fontWeight="fontWeightDemiBold">Environment Not Detected</Text>
            <Text fontSize="fontSizeM">
              The queue page couldn't detect which environment you're in. 
            </Text>
            <Text fontSize="fontSizeS" fontColor="gray700">
              <strong>SDK environment:</strong> {sdk.ids.environment || 'undefined'}
            </Text>
            <Text fontSize="fontSizeS" fontColor="gray700">
              <strong>Config environment:</strong> {parameters?.defaultSourceEnvironment || 'undefined'}
            </Text>
            <Text fontSize="fontSizeM" marginTop="spacingS">
              <strong>To fix:</strong> Try accessing the queue from within a specific environment (e.g., go to Content in an environment, then click Apps → Merge 3.0)
            </Text>
          </Stack>
        </Note>
      </Box>
    );
  }

  if (!cma) {
    return (
      <Box padding="spacingXl">
        <Note variant="warning">
          <Stack spacing="spacingS">
            <Text fontWeight="fontWeightDemiBold">CMA Token Required</Text>
            <Text fontSize="fontSizeM">
              Configure your CMA token in the app settings to use the queue.
            </Text>
          </Stack>
        </Note>
      </Box>
    );
  }

  return (
    <Box padding="spacingXl">
      {/* Header Section */}
      <Heading marginBottom="spacingXs">Merge Queue</Heading>
      <Flex justifyContent="space-between" alignItems="center" marginBottom="spacingS">
        <Text fontSize="fontSizeM" fontColor="gray600">
          {filteredItems.length} of {queueItems.length} {queueItems.length === 1 ? 'item' : 'items'}
        </Text>
        {hasSelections() && (
          <Badge variant="primary">
            {getSelectionCount()} selected
          </Badge>
        )}
      </Flex>

      {/* Search & Filter Section */}
      {queueItems.length > 0 && (
        <Box marginBottom="spacingL">
          <Stack spacing="spacingXs">
            <TextInput
              placeholder="Search by title, ID, or content type..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              icon={<SearchIcon />}
            />
            <Flex gap="spacingXs">
              <Select
                value={filterContentType}
                onChange={(e) => setFilterContentType(e.target.value)}
                size="small"
                style={{ flex: 1 }}
              >
                <Select.Option value="all">All Content Types</Select.Option>
                {contentTypes.map(type => (
                  <Select.Option key={type} value={type}>{type}</Select.Option>
                ))}
              </Select>
              <Select
                value={filterEnvironment}
                onChange={(e) => setFilterEnvironment(e.target.value)}
                size="small"
                style={{ flex: 1 }}
              >
                <Select.Option value="all">All Environments</Select.Option>
                {queueEnvironments.map(env => (
                  <Select.Option key={env} value={env}>{env}</Select.Option>
                ))}
              </Select>
            </Flex>
          </Stack>
        </Box>
      )}

      {error && (
        <Note variant="negative" style={{ marginBottom: '24px' }}>
          <Text>{error}</Text>
        </Note>
      )}

      {/* Merge Progress Display */}
      {mergingItem && mergeProgress && (
        <Note variant="primary" style={{ marginBottom: '24px' }}>
          <Stack spacing="spacingS">
            <Text fontWeight="fontWeightDemiBold">
              Merging: {mergingItem.entryTitle}
            </Text>
            <Text fontSize="fontSizeS" fontColor="gray700">
              {mergingItem.sourceEnv} → {mergingItem.targetEnv}
            </Text>
            <ProgressTracker progress={mergeProgress} />
          </Stack>
        </Note>
      )}

      {/* Queue Items - Table Layout (80% width) */}
      {queueItems.length === 0 ? (
        <Box style={{ 
          textAlign: 'center', 
          padding: '80px 20px',
          backgroundColor: '#f7f9fa',
          borderRadius: '8px',
          border: '1px dashed #d3dce0'
        }}>
          <Text fontSize="fontSizeL" fontWeight="fontWeightMedium" fontColor="gray700" marginBottom="spacingS">
            Queue is empty
          </Text>
          <Text fontSize="fontSizeM" fontColor="gray600">
            Use "Merge Later" from the entry sidebar to add items
          </Text>
        </Box>
      ) : filteredItems.length === 0 ? (
        <Box style={{ 
          textAlign: 'center', 
          padding: '80px 20px',
          backgroundColor: '#f7f9fa',
          borderRadius: '8px',
          border: '1px dashed #d3dce0'
        }}>
          <Text fontSize="fontSizeL" fontWeight="fontWeightMedium" fontColor="gray700" marginBottom="spacingS">
            No matching items
          </Text>
          <Text fontSize="fontSizeM" fontColor="gray600">
            Try adjusting your search or filters
          </Text>
        </Box>
      ) : (
        <Box>
          <Table>
            <Table.Head>
              <Table.Row>
                <Table.Cell style={{ width: '40px' }}></Table.Cell>
                <Table.Cell>Name</Table.Cell>
                <Table.Cell>Content Type</Table.Cell>
                <Table.Cell>Dependencies</Table.Cell>
                <Table.Cell>Environments</Table.Cell>
                <Table.Cell>Added</Table.Cell>
                <Table.Cell>Status</Table.Cell>
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {filteredItems.map((item) => {
                const isExpanded = expandedRows.has(item.id);
                const dependencies = dependenciesData.get(item.id) || [];
                const isLoadingDeps = loadingDependencies.has(item.id);
                
                return (
                  <React.Fragment key={item.id}>
                    {/* Main Row */}
                    <Table.Row>
                      <Table.Cell>
                        <Checkbox
                          isChecked={isEntrySelected(item.id)}
                          onChange={(e) => handleSelectEntry(item.id, e.target.checked)}
                        />
                      </Table.Cell>
                      <Table.Cell>
                        <Flex gap="spacingXs" alignItems="center">
                          <Button
                            variant="transparent"
                            size="small"
                            onClick={() => toggleRowExpansion(item)}
                            style={{ padding: 0, minHeight: 'auto' }}
                          >
                            {isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
                          </Button>
                          <Text fontWeight="fontWeightMedium">{item.entryTitle}</Text>
                        </Flex>
                      </Table.Cell>
                      <Table.Cell>
                        <Badge 
                          size="small"
                          style={{ 
                            backgroundColor: getContentTypeColor(item.contentType),
                            color: 'white'
                          }}
                        >
                          {item.contentType}
                        </Badge>
                      </Table.Cell>
                      <Table.Cell>
                        <Badge variant="secondary" size="small">{item.dependencyCount} items</Badge>
                      </Table.Cell>
                      <Table.Cell>
                        <Text fontSize="fontSizeS">{item.sourceEnv} → {item.targetEnv}</Text>
                      </Table.Cell>
                      <Table.Cell>
                        <Text fontSize="fontSizeS">{formatDate(item.addedAt)}</Text>
                      </Table.Cell>
                      <Table.Cell>
                        <Stack spacing="spacingXs">
                          <Badge variant={getStatusBadgeVariant('Queued')} size="small">Queued</Badge>
                          {validationResults.has(item.id) && (() => {
                            const result = validationResults.get(item.id);
                            if (result.status === 'error') {
                              return (
                                <Badge variant="negative" size="small">
                                  {result.errors.length} Error{result.errors.length > 1 ? 's' : ''}
                                </Badge>
                              );
                            } else if (result.status === 'warning') {
                              return (
                                <Badge variant="warning" size="small">
                                  {result.warnings.length} Warning{result.warnings.length > 1 ? 's' : ''}
                                </Badge>
                              );
                            } else {
                              return <Badge variant="positive" size="small">✓ Valid</Badge>;
                            }
                          })()}
                        </Stack>
                      </Table.Cell>
                    </Table.Row>
                    
                    {/* Expanded Dependencies Rows */}
                    {isExpanded && (
                      <>
                        {isLoadingDeps ? (
                          <Table.Row>
                            <Table.Cell colSpan={7} style={{ paddingLeft: '48px', backgroundColor: '#f7f9fa' }}>
                              <Spinner size="small" /> Loading dependencies...
                            </Table.Cell>
                          </Table.Row>
                        ) : dependencies.length > 0 ? (
                          dependencies.map((dep) => {
                            // Check if this dependency has a validation error
                            const hasError = dependencyErrors.get(item.id)?.has(dep.id);
                            const errorMessage = dependencyErrors.get(item.id)?.get(dep.id);
                            
                            return (
                              <Table.Row 
                                key={dep.id} 
                                style={{ 
                                  backgroundColor: hasError ? '#ffebee' : '#f7f9fa',
                                  borderLeft: hasError ? '3px solid #d32f2f' : '3px solid #d3dce0'
                                }}
                              >
                                <Table.Cell colSpan={2} style={{ paddingLeft: '64px' }}>
                                  <Flex gap="spacingXs" alignItems="center" flexDirection="column" style={{ alignItems: 'flex-start' }}>
                                    <Flex gap="spacingXs" alignItems="center">
                                      <Checkbox
                                        isChecked={isDependencySelected(item.id, dep.id)}
                                        onChange={(e) => handleSelectDependency(item.id, dep.id, e.target.checked)}
                                      />
                                      {dep.contentType === 'Asset' && (
                                        <AssetIcon variant="secondary" size="small" />
                                      )}
                                      <Text fontSize="fontSizeS" fontColor={hasError ? 'red600' : 'gray700'} fontWeight="fontWeightMedium">
                                        └─ {dep.title}
                                      </Text>
                                      {hasError && (
                                        <Badge variant="negative" size="small">
                                          ⚠ {errorMessage}
                                        </Badge>
                                      )}
                                    </Flex>
                                    <Text fontSize="fontSizeS" fontColor="gray500" style={{ paddingLeft: '32px', fontStyle: 'italic' }}>
                                      Referenced by: {item.entryTitle}
                                    </Text>
                                  </Flex>
                                </Table.Cell>
                                <Table.Cell>
                                  <Badge 
                                    size="small"
                                    variant={dep.contentType === 'Asset' ? 'positive' : 'primary'}
                                    style={ dep.contentType !== 'Asset' ? { 
                                      backgroundColor: getContentTypeColor(dep.contentType),
                                      color: 'white',
                                      textTransform: 'lowercase'
                                    } : { textTransform: 'lowercase' }}
                                  >
                                    {dep.contentType.toLowerCase()}
                                  </Badge>
                                </Table.Cell>
                                <Table.Cell>-</Table.Cell>
                                <Table.Cell>
                                  <Text fontSize="fontSizeS" fontColor="gray600">{item.sourceEnv}</Text>
                                </Table.Cell>
                                <Table.Cell>-</Table.Cell>
                                <Table.Cell>
                                  <Badge variant={getStatusBadgeVariant(dep.status)} size="small">
                                    {dep.status}
                                  </Badge>
                                </Table.Cell>
                              </Table.Row>
                            );
                          })
                        ) : (
                          <Table.Row>
                            <Table.Cell colSpan={7} style={{ paddingLeft: '48px', backgroundColor: '#f7f9fa' }}>
                              <Text fontSize="fontSizeS" fontColor="gray600">No dependencies</Text>
                            </Table.Cell>
                          </Table.Row>
                        )}
                        
                        {/* Validation Results Row - Only show parent entry errors (not dependency errors) */}
                        {validationResults.has(item.id) && (() => {
                          const result = validationResults.get(item.id);
                          // Filter out dependency-specific errors (already shown inline)
                          const parentErrors = result.errors.filter((e: string) => !e.startsWith('Dependency '));
                          
                          if (parentErrors.length > 0 || result.warnings.length > 0) {
                            return (
                              <Table.Row style={{ backgroundColor: '#fff9e6' }}>
                                <Table.Cell colSpan={7} style={{ paddingLeft: '48px' }}>
                                  <Stack spacing="spacingXs">
                                    {parentErrors.length > 0 && (
                                      <Box>
                                        <Text fontSize="fontSizeS" fontWeight="fontWeightMedium" fontColor="red600">
                                          Entry Errors:
                                        </Text>
                                        {parentErrors.map((error: string, idx: number) => (
                                          <Text key={idx} fontSize="fontSizeS" fontColor="red600" style={{ paddingLeft: '16px' }}>
                                            • {error}
                                          </Text>
                                        ))}
                                      </Box>
                                    )}
                                    {result.warnings.length > 0 && (
                                      <Box>
                                        <Text fontSize="fontSizeS" fontWeight="fontWeightMedium" fontColor="orange600">
                                          Warnings:
                                        </Text>
                                        {result.warnings.map((warning: string, idx: number) => (
                                          <Text key={idx} fontSize="fontSizeS" fontColor="orange600" style={{ paddingLeft: '16px' }}>
                                            • {warning}
                                          </Text>
                                        ))}
                                      </Box>
                                    )}
                                  </Stack>
                                </Table.Cell>
                              </Table.Row>
                            );
                          }
                          return null;
                        })()}
                      </>
                    )}
                  </React.Fragment>
                );
              })}
            </Table.Body>
          </Table>
        </Box>
      )}

      {/* Action Buttons - Bottom Right */}
      {queueItems.length > 0 && (
        <Flex justifyContent="flex-end" marginTop="spacingL" gap="spacingS">
          <Button
            variant="secondary"
            onClick={handleCreateEnvironment}
            isDisabled={creatingEnv || deletingEnv}
          >
            {creatingEnv ? 'Creating...' : 'Create Environment'}
          </Button>
          <Menu>
            <Menu.Trigger>
              <Button
                variant="negative"
                endIcon={<ChevronDownIcon />}
                isDisabled={deletingEnv || creatingEnv || environments.length === 0}
              >
                {deletingEnv ? 'Deleting...' : 'Delete Environment'}
              </Button>
            </Menu.Trigger>
            <Menu.List>
              {environments.map((env) => (
                <Menu.Item 
                  key={env.sys.id}
                  onClick={() => handleDeleteEnvironment(env.sys.id)}
                >
                  {env.displayName}
                </Menu.Item>
              ))}
            </Menu.List>
          </Menu>
          <Button
            variant="secondary"
            onClick={handleClearQueue}
            isDisabled={processing.size > 0}
          >
            Clear Queue
          </Button>
          {hasSelections() ? (
            <Button
              variant="primary"
              onClick={handleMergeSelected}
              isDisabled={processing.size > 0}
            >
              Merge Selected ({getSelectionCount()})
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={handleMergeAll}
              isDisabled={processing.size > 0}
            >
              Merge All ({queueItems.length})
            </Button>
          )}
        </Flex>
      )}
    </Box>
  );
};

export default Page;
