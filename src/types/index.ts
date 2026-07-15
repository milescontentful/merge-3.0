import { Entry, Asset, Link } from 'contentful-management';

export interface AppInstallationParameters {
  cmaToken?: string;
  defaultSourceEnvironment?: string;
  defaultTargetEnvironment?: string;
  autoPublish?: boolean;
}

export interface DependencyNode {
  id: string;
  type: 'Entry' | 'Asset';
  contentType?: string;
  title?: string;
  environment: string;
  depth: number;
  children: DependencyNode[];
  isCircular?: boolean;
}

export interface FieldChange {
  field: string;
  description: string;
  oldValue?: any;
  newValue?: any;
}

export interface ChangeItem {
  id: string;
  type: 'Entry' | 'Asset';
  changeType: 'add' | 'update' | 'delete';
  contentType?: string;
  title?: string;
  hasConflict?: boolean;
  sourceData?: any;
  targetData?: any;
  changes?: FieldChange[];
}

export interface ConflictResolution {
  id: string;
  action: 'overwrite' | 'skip';
}

export interface MergeProgress {
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  currentItem?: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  errors: Array<{ id: string; message: string }>;
}

export interface EnvironmentInfo {
  id: string;
  name: string;
}

export type LinkType = 'Entry' | 'Asset';

export interface ContentfulLink {
  sys: {
    type: 'Link';
    linkType: LinkType;
    id: string;
  };
}

