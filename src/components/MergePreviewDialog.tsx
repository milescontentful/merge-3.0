import React, { useState, useMemo, useEffect } from 'react';
import {
  Button,
  Flex,
  Text,
  Badge,
  Box,
  Table,
  Select,
  FormControl,
  Note,
  Checkbox,
  Spinner,
} from '@contentful/f36-components';
import { ChangeItem } from '../types';
import { useSDK } from '@contentful/react-apps-toolkit';
import { DialogAppSDK } from '@contentful/app-sdk';
import { useContentfulClient } from '../hooks/useContentfulClient';
import { ContentTypeMigrator } from '../services/contentTypeMigrator';
import { EnvironmentWithAlias, getEnvironmentsWithAliases } from '../utils/environmentHelpers';

interface FieldResolution {
  entryId: string;
  fieldName: string;
  useSource: boolean; // true = use FROM, false = use TO
}

interface MissingContentType {
  id: string;
  name: string;
  existsInSource: boolean;
  existsInTarget: boolean;
}

interface MergePreviewDialogProps {
  changes: ChangeItem[];
  sourceEnv: string;
  targetEnv: string;
  entryTitle: string;
  environments: EnvironmentWithAlias[];
  missingContentTypes: MissingContentType[];
  onConfirm: (resolutions: FieldResolution[], sourceEnv?: string, targetEnv?: string, copyContentTypes?: boolean) => void;
  onCancel: () => void;
}

export const MergePreviewDialog: React.FC<MergePreviewDialogProps> = ({
  changes,
  sourceEnv: initialSourceEnv,
  targetEnv: initialTargetEnv,
  entryTitle,
  environments: initialEnvironments,
  missingContentTypes: initialMissingContentTypes,
  onConfirm,
  onCancel,
}) => {
  const sdk = useSDK<DialogAppSDK>();
  const parameters = sdk.parameters.invocation as any;
  const cma = useContentfulClient(parameters);
  
  
  // State for environments (with fallback fetching if not provided)
  const [environments, setEnvironments] = useState<EnvironmentWithAlias[]>(initialEnvironments || []);
  
  // Fetch environments if not provided or empty
  useEffect(() => {
    if ((!initialEnvironments || initialEnvironments.length === 0) && cma) {
      const fetchEnvs = async () => {
        try {
          const envs = await getEnvironmentsWithAliases(cma, sdk.ids.space);
          setEnvironments(envs);
        } catch (err) {
          console.error('❌ [MergePreviewDialog] Failed to fetch environments:', err);
        }
      };
      fetchEnvs();
    } else {
      setEnvironments(initialEnvironments || []);
    }
  }, [initialEnvironments, cma, sdk.ids.space]);
  
  const totalItems = changes.length;
  const creates = changes.filter(c => c.changeType === 'add');
  const updates = changes.filter(c => c.changeType === 'update');

  // Track selected environments
  const [sourceEnv, setSourceEnv] = useState(initialSourceEnv);
  const [targetEnv, setTargetEnv] = useState(initialTargetEnv);
  
  // Track missing content types (dynamically updated)
  const [missingContentTypes, setMissingContentTypes] = useState<MissingContentType[]>(initialMissingContentTypes);
  const [checkingContentTypes, setCheckingContentTypes] = useState(false);
  
  // Track whether to copy content types
  const [copyContentTypes, setCopyContentTypes] = useState(initialMissingContentTypes.length > 0);
  
  // Track new environment creation
  const [creatingNewEnv, setCreatingNewEnv] = useState(false);
  const [deletingEnv, setDeletingEnv] = useState(false);
  const NEW_ENV_VALUE = '__CREATE_NEW__';

  // Handler for creating new environment
  const handleCreateNewEnvironment = async () => {
    if (!cma) return;
    
    setCreatingNewEnv(true);
    
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
      
      // Prompt user for new environment ID (max 40 chars, no spaces)
      const newEnvId = await sdk.dialogs.openPrompt({
        title: 'Create New Environment',
        message: 'Enter environment ID (max 40 chars, lowercase, no spaces):',
        defaultValue: defaultName.substring(0, 40), // Ensure default is within limit
      });
      
      if (!newEnvId) {
        setCreatingNewEnv(false);
        setTargetEnv(''); // Reset selection
        return;
      }
      
      // Validate and sanitize: lowercase, no spaces, max 40 chars
      const sanitizedId = newEnvId
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '-')
        .substring(0, 40);
      
      sdk.notifier.success(`Creating environment "${sanitizedId}"...`);
      
      // Create environment
      const newEnv = await cma.environment.createWithId(
        {
          spaceId: sdk.ids.space,
          environmentId: sanitizedId,
        },
        {
          name: sanitizedId, // Use ID as name for simplicity
        }
      );
      
      
      // Add to environments list so it appears in dropdown
      const newEnvironment = {
        sys: { id: sanitizedId },
        name: sanitizedId,
      };
      environments.push(newEnvironment);
      
      sdk.notifier.success(`Environment "${sanitizedId}" created!`);
      
      // Set the new environment as target
      setTargetEnv(sanitizedId);
      
      // Since it's a new environment, all content types will be missing
      // We'll auto-enable copying
      setCopyContentTypes(true);
      
    } catch (err: any) {
      console.error('❌ [MergePreview] Failed to create environment:', err);
      sdk.notifier.error(`Failed to create environment: ${err.message}`);
      setTargetEnv(''); // Reset selection
    } finally {
      setCreatingNewEnv(false);
    }
  };

  // Handler for deleting environment
  const handleDeleteEnvironment = async () => {
    if (!cma || !targetEnv) return;
    
    // Prompt user to type environment name to confirm
    const typedName = await sdk.dialogs.openPrompt({
      title: 'Delete Environment',
      message: `Type the environment name to confirm deletion: "${targetEnv}" This action cannot be undone.`,
      defaultValue: '',
    });
    
    if (!typedName || typedName !== targetEnv) {
      if (typedName) {
        sdk.notifier.warning('Environment name did not match. Deletion cancelled.');
      }
      return;
    }
    
    setDeletingEnv(true);
    
    try {
      sdk.notifier.success(`Deleting environment "${targetEnv}"...`);
      
      // Delete environment
      await cma.environment.delete({
        spaceId: sdk.ids.space,
        environmentId: targetEnv,
      });
      
      
      // Remove from environments list
      const index = environments.findIndex(env => env.sys.id === targetEnv);
      if (index !== -1) {
        environments.splice(index, 1);
      }
      
      sdk.notifier.success(`Environment "${targetEnv}" deleted!`);
      
      // Reset target environment selection
      setTargetEnv('');
      
    } catch (err: any) {
      console.error('❌ [MergePreview] Failed to delete environment:', err);
      sdk.notifier.error(`Failed to delete environment: ${err.message}`);
    } finally {
      setDeletingEnv(false);
    }
  };

  // Re-check content types when target environment changes
  useEffect(() => {
    // Skip if creating new env or special value
    if (targetEnv === NEW_ENV_VALUE || creatingNewEnv) {
      return;
    }
    
    if (!cma || !sourceEnv || !targetEnv || sourceEnv === targetEnv) {
      setMissingContentTypes([]);
      return;
    }

    const recheckContentTypes = async () => {
      setCheckingContentTypes(true);

      try {
        const migrator = new ContentTypeMigrator(cma, sdk.ids.space, sourceEnv, targetEnv);
        
        // Get all entries from changes
        const entriesWithContentTypes = changes
          .filter(c => c.type === 'Entry')
          .map(c => c.sourceData);
        
        const missing = await migrator.detectMissingContentTypes(entriesWithContentTypes);
        
        setMissingContentTypes(missing);
        setCopyContentTypes(missing.length > 0); // Auto-check if any are missing
      } catch (err) {
        console.error('❌ [MergePreview] Failed to check content types:', err);
        setMissingContentTypes([]);
      } finally {
        setCheckingContentTypes(false);
      }
    };

    recheckContentTypes();
  }, [sourceEnv, targetEnv, cma, sdk.ids.space, changes, creatingNewEnv, NEW_ENV_VALUE]);

  // Helper to extract title from an entry/asset
  const extractTitle = (data: any, fallbackId: string): string => {
    if (!data) return fallbackId;
    
    const fields = data.fields || {};
    const locales = ['en-US', 'en', 'de-DE', 'de', 'fr', 'es'];
    
    const titleFields = [
      'internalName', 'title', 'name', 'heading', 'label', 
      'displayName', 'entryTitle', 'pageName', 'headline', 'question'
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
        // Try first available locale
        const firstLocale = Object.keys(fields[fieldName])[0];
        const value = fields[fieldName][firstLocale];
        if (value && typeof value === 'string' && value.trim()) {
          return value.trim();
        }
      }
    }
    
    // For assets, try file name
    if (fields.file) {
      for (const locale of locales) {
        const fileName = fields.file[locale]?.fileName;
        if (fileName) return fileName;
      }
    }
    
    return fallbackId;
  };

  // Helper to look up linked entry/asset title
  const getLinkTitle = (linkId: string, linkType: string, itemData: any): string => {
    // Look in sourceData includes
    if (itemData?.includes) {
      const linked = itemData.includes[linkId];
      if (linked) {
        return extractTitle(linked, linkId);
      }
    }
    
    // Fallback to showing ID
    return linkId;
  };

  // Helper to render a field value with proper titles for links
  const renderValue = (value: any, itemData: any): React.ReactNode => {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    if (Array.isArray(value)) {
      if (value.length === 0) return null;
      
      // Render as indented list for links
      const hasLinks = value.some(item => item?.sys?.type === 'Link');
      
      if (hasLinks) {
        return (
          <Box style={{ paddingLeft: '8px', marginTop: '2px' }}>
            {value.map((item, idx) => {
              if (item?.sys?.type === 'Link') {
                const title = getLinkTitle(item.sys.id, item.sys.linkType, itemData);
                return (
                  <Text 
                    key={idx} 
                    fontSize="fontSizeS" 
                    fontColor="gray700"
                    style={{ display: 'block', marginBottom: '2px' }}
                  >
                    • {title}
                  </Text>
                );
              }
              return (
                <Text 
                  key={idx} 
                  fontSize="fontSizeS" 
                  fontColor="gray700"
                  style={{ display: 'block', marginBottom: '2px' }}
                >
                  • {String(item)}
                </Text>
              );
            })}
          </Box>
        );
      }
      
      // Non-link arrays as comma-separated
      return <Text fontSize="fontSizeS">{value.map(v => String(v)).join(', ')}</Text>;
    }

    if (typeof value === 'object') {
      if (value.nodeType === 'document') {
        return <Text fontSize="fontSizeS" fontColor="gray600">[Rich Text]</Text>;
      }
      if (value.sys?.type === 'Link') {
        const title = getLinkTitle(value.sys.id, value.sys.linkType, itemData);
        return <Text fontSize="fontSizeS" fontColor="gray700">{title}</Text>;
      }
      return <Text fontSize="fontSizeS" fontColor="gray600">[Object]</Text>;
    }

    return <Text fontSize="fontSizeS">{String(value)}</Text>;
  };

  // Get field value for first available locale
  const getFieldValue = (field: any) => {
    if (!field) return undefined;
    
    // Check if it's a localized field
    if (typeof field === 'object' && !Array.isArray(field) && !field.sys && !field.nodeType) {
      // Try common locales
      const locales = ['en-US', 'en', 'de-DE', 'de', 'fr', 'es'];
      for (const locale of locales) {
        if (field[locale] !== undefined) {
          return field[locale];
        }
      }
      // Return first available locale
      const firstLocale = Object.keys(field)[0];
      return field[firstLocale];
    }
    
    // Non-localized field
    return field;
  };

  return (
    <Box
      padding="spacingM"
      style={{
        height: '85vh',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <Flex justifyContent="space-between" alignItems="center" marginBottom="spacingM">
        <Flex gap="spacingS" alignItems="center">
          <Text fontWeight="fontWeightMedium" fontSize="fontSizeL">Merge Preview</Text>
          <Badge variant="primary">{totalItems} items</Badge>
          <Badge variant="positive">{creates.length} new</Badge>
          <Badge variant="warning">{updates.length} updates</Badge>
        </Flex>
        
        {/* Environment Selectors */}
        <Flex gap="spacingS" alignItems="center">
          <FormControl style={{ width: '180px' }}>
            <FormControl.Label style={{ fontSize: '12px', marginBottom: '4px' }}>
              From (Source)
            </FormControl.Label>
            <Select
              value={sourceEnv}
              onChange={(e) => setSourceEnv(e.target.value)}
              size="small"
              isDisabled={environments.length === 0}
            >
              {environments.length === 0 ? (
                <Select.Option value="">Loading environments...</Select.Option>
              ) : (
                environments.map((env) => (
                  <Select.Option key={env.sys.id} value={env.sys.id}>
                    {env.displayName}
                  </Select.Option>
                ))
              )}
            </Select>
          </FormControl>
          
          <Text fontColor="gray600" style={{ marginTop: '20px' }}>→</Text>
          
          <FormControl style={{ width: '180px' }}>
            <FormControl.Label style={{ fontSize: '12px', marginBottom: '4px' }}>
              To (Target)
            </FormControl.Label>
            <Select
                value={creatingNewEnv ? '' : targetEnv}
                onChange={(e) => {
                  setTargetEnv(e.target.value);
                }}
                size="small"
                isDisabled={creatingNewEnv || environments.length === 0}
              >
              {creatingNewEnv ? (
                <Select.Option value="">Creating...</Select.Option>
              ) : environments.length === 0 ? (
                <Select.Option value="">Loading environments...</Select.Option>
              ) : (
                <>
                  <Select.Option value="">Select environment...</Select.Option>
                  {environments.map((env) => (
                    <Select.Option key={env.sys.id} value={env.sys.id}>
                      {env.displayName}
                    </Select.Option>
                  ))}
                </>
              )}
            </Select>
          </FormControl>
        </Flex>
        
        <Flex justifyContent="flex-end" gap="spacingS">
          <Button onClick={onCancel} variant="secondary" size="small">
            Cancel
          </Button>
          <Button 
            onClick={handleCreateNewEnvironment} 
            variant="secondary" 
            size="small"
            isDisabled={creatingNewEnv}
          >
            {creatingNewEnv ? 'Creating...' : 'Create Environment'}
          </Button>
          <Button 
            onClick={handleDeleteEnvironment} 
            variant="negative" 
            size="small"
            isDisabled={!targetEnv || creatingNewEnv || deletingEnv}
          >
            {deletingEnv ? 'Deleting...' : 'Delete Environment'}
          </Button>
          <Button 
            onClick={() => onConfirm([], sourceEnv, targetEnv, copyContentTypes)}
            variant="positive"
            size="small"
            isDisabled={!sourceEnv || !targetEnv || sourceEnv === targetEnv || creatingNewEnv || deletingEnv}
          >
            Proceed with Merge
          </Button>
        </Flex>
      </Flex>

      {/* Missing Content Types Warning */}
      {checkingContentTypes && (
        <Note variant="neutral" style={{ marginBottom: '16px' }}>
          <Flex alignItems="center" gap="spacingS">
            <Spinner size="small" />
            <Text fontSize="fontSizeS">Checking content types in target environment...</Text>
          </Flex>
        </Note>
      )}
      
      {!checkingContentTypes && missingContentTypes.length > 0 && (
        <Note variant="warning" style={{ marginBottom: '16px' }}>
          <Flex flexDirection="column" gap="spacingXs">
            <Flex alignItems="center" gap="spacingXs">
              <Text fontWeight="fontWeightDemiBold" fontSize="fontSizeM">
                ⚠️ Missing Content Types in Target Environment
              </Text>
            </Flex>
            <Text fontSize="fontSizeS">
              The following content types don't exist in <strong>{targetEnv}</strong>:
            </Text>
            <Box style={{ paddingLeft: '16px', marginTop: '8px' }}>
              {missingContentTypes.map((ct) => (
                <Text key={ct.id} fontSize="fontSizeS" fontColor="gray700" style={{ display: 'block' }}>
                  • <strong>{ct.name}</strong> ({ct.id})
                </Text>
              ))}
            </Box>
            <Checkbox
              isChecked={copyContentTypes}
              onChange={(e) => setCopyContentTypes(e.target.checked)}
              style={{ marginTop: '8px' }}
            >
              <Text fontSize="fontSizeS">
                Automatically copy these content types from <strong>{sourceEnv}</strong> to <strong>{targetEnv}</strong> before merging entries
              </Text>
            </Checkbox>
          </Flex>
        </Note>
      )}

      {/* Compact Two-Column Table */}
      <Box
        style={{
          flex: 1,
          overflowY: 'auto',
          border: '1px solid #d3dce0',
          borderRadius: '4px',
        }}
      >
        <Table>
          <Table.Head isSticky>
            <Table.Row>
              <Table.Cell style={{ width: '25%', backgroundColor: '#fff' }}>
                <Text fontWeight="fontWeightMedium">Entry / Field</Text>
              </Table.Cell>
              <Table.Cell style={{ width: '37.5%', backgroundColor: '#e3f2fd', borderLeft: '2px solid #2196f3' }}>
                <Flex gap="spacingXs" alignItems="center">
                  <Badge variant="primary" size="small">FROM</Badge>
                  <Text fontWeight="fontWeightMedium" fontSize="fontSizeS">{sourceEnv}</Text>
                </Flex>
              </Table.Cell>
              <Table.Cell style={{ width: '37.5%', backgroundColor: '#fff3e0', borderLeft: '2px solid #ff9800' }}>
                <Flex gap="spacingXs" alignItems="center">
                  <Badge variant="warning" size="small">TO</Badge>
                  <Text fontWeight="fontWeightMedium" fontSize="fontSizeS">{targetEnv}</Text>
                </Flex>
              </Table.Cell>
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {changes.map((item) => {
              const isNew = item.changeType === 'add';
              const sourceFields = item.sourceData?.fields || {};
              const targetFields = item.targetData?.fields || {};

              // Get all field names
              const allFieldNames = Array.from(new Set([
                ...Object.keys(sourceFields),
                ...Object.keys(targetFields),
              ]));

              return (
                <React.Fragment key={item.id}>
                  {/* Entry Header Row */}
                  <Table.Row style={{ backgroundColor: '#f7f9fa' }}>
                    <Table.Cell colSpan={3}>
                      <Flex gap="spacingXs" alignItems="center">
                        <Text fontWeight="fontWeightDemiBold" fontSize="fontSizeM">
                          {item.title || item.id}
                        </Text>
                        <Badge variant="primary" size="small">
                          {item.contentType || item.type}
                        </Badge>
                        <Badge variant={isNew ? 'positive' : 'warning'} size="small">
                          {isNew ? 'New' : 'Update'}
                        </Badge>
                      </Flex>
                    </Table.Cell>
                  </Table.Row>

                  {/* Field Rows */}
                  {allFieldNames.map((fieldName) => {
                    const sourceField = sourceFields[fieldName];
                    const targetField = targetFields[fieldName];
                    const sourceValue = getFieldValue(sourceField);
                    const targetValue = getFieldValue(targetField);
                    
                    const hasConflict = !isNew && JSON.stringify(sourceValue) !== JSON.stringify(targetValue);

                    return (
                      <Table.Row 
                        key={`${item.id}-${fieldName}`}
                        style={{ 
                          backgroundColor: hasConflict ? '#fff9e6' : '#fff',
                        }}
                      >
                        {/* Field Name */}
                        <Table.Cell style={{ paddingLeft: '24px', verticalAlign: 'top' }}>
                          <Flex gap="spacingXs" alignItems="center">
                            <Text fontSize="fontSizeS" fontColor="gray700">
                              {fieldName}
                            </Text>
                            {hasConflict && (
                              <Badge variant="warning" size="small">!</Badge>
                            )}
                          </Flex>
                        </Table.Cell>

                        {/* FROM Value */}
                        <Table.Cell 
                          style={{ 
                            borderLeft: '2px solid #2196f3',
                            backgroundColor: hasConflict ? '#e3f2fd' : 'transparent',
                            verticalAlign: 'top',
                          }}
                        >
                          {renderValue(sourceValue, item.sourceData) || (
                            <Text fontSize="fontSizeS" fontColor="gray500">(empty)</Text>
                          )}
                        </Table.Cell>

                        {/* TO Value */}
                        <Table.Cell 
                          style={{ 
                            borderLeft: '2px solid #ff9800',
                            backgroundColor: targetValue ? 'transparent' : '#f7f9fa',
                            verticalAlign: 'top',
                          }}
                        >
                          {renderValue(targetValue, item.targetData) || (
                            <Text fontSize="fontSizeS" fontColor="gray500">(empty)</Text>
                          )}
                        </Table.Cell>
                      </Table.Row>
                    );
                  })}
                </React.Fragment>
              );
            })}
          </Table.Body>
        </Table>
      </Box>
    </Box>
  );
};
