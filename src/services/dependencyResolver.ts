import { PlainClientAPI } from 'contentful-management';
import { DependencyNode, ContentfulLink } from '../types';
import { RateLimiter } from '../utils/rateLimiter';

export class DependencyResolver {
  private cma: PlainClientAPI;
  private spaceId: string;
  private environmentId: string;
  private visitedIds: Set<string>;
  private maxDepth: number;
  private rateLimiter: RateLimiter;

  constructor(
    cma: PlainClientAPI,
    spaceId: string,
    environmentId: string,
    maxDepth: number = 10
  ) {
    this.cma = cma;
    this.spaceId = spaceId;
    this.environmentId = environmentId;
    this.visitedIds = new Set();
    this.maxDepth = maxDepth;
    // Initialize rate limiter for CMA calls
    this.rateLimiter = new RateLimiter({
      maxRequestsPerSecond: 18,
      maxConcurrent: 10,
    });
  }

  async resolveEntryDependencies(entryId: string): Promise<DependencyNode> {
    this.visitedIds.clear();
    return this.resolveEntry(entryId, 0);
  }

  private async resolveEntry(
    entryId: string,
    depth: number
  ): Promise<DependencyNode> {
    // Check if already visited (circular reference)
    if (this.visitedIds.has(entryId)) {
      return {
        id: entryId,
        type: 'Entry',
        environment: this.environmentId,
        depth,
        children: [],
        isCircular: true,
      };
    }

    // Check max depth
    if (depth >= this.maxDepth) {
      return {
        id: entryId,
        type: 'Entry',
        environment: this.environmentId,
        depth,
        children: [],
      };
    }

    this.visitedIds.add(entryId);

    try {
      const entry = await this.rateLimiter.execute(() =>
        this.cma.entry.get({
          spaceId: this.spaceId,
          environmentId: this.environmentId,
          entryId: entryId,
        })
      );

      const node: DependencyNode = {
        id: entryId,
        type: 'Entry',
        contentType: entry.sys.contentType?.sys.id,
        title: this.extractTitle(entry),
        environment: this.environmentId,
        depth,
        children: [],
      };

      // Extract all links from entry fields
      const links = this.extractLinks(entry.fields);

      // Resolve all linked entries and assets
      const childPromises = links.map(async (link) => {
        if (link.sys.linkType === 'Entry') {
          return this.resolveEntry(link.sys.id, depth + 1);
        } else if (link.sys.linkType === 'Asset') {
          return this.resolveAsset(link.sys.id, depth + 1);
        }
        return null;
      });

      const children = await Promise.all(childPromises);
      node.children = children.filter((child) => child !== null) as DependencyNode[];

      return node;
    } catch (error) {
      console.error(`Error resolving entry ${entryId}:`, error);
      return {
        id: entryId,
        type: 'Entry',
        environment: this.environmentId,
        depth,
        children: [],
        title: 'Error loading entry',
      };
    }
  }

  private async resolveAsset(
    assetId: string,
    depth: number
  ): Promise<DependencyNode> {
    if (this.visitedIds.has(assetId)) {
      return {
        id: assetId,
        type: 'Asset',
        environment: this.environmentId,
        depth,
        children: [],
        isCircular: true,
      };
    }

    this.visitedIds.add(assetId);

    try {
      const asset = await this.rateLimiter.execute(() =>
        this.cma.asset.get({
          spaceId: this.spaceId,
          environmentId: this.environmentId,
          assetId: assetId,
        })
      );

      return {
        id: assetId,
        type: 'Asset',
        title: asset.fields?.title?.['en-US'] || asset.fields?.title?.[Object.keys(asset.fields.title || {})[0]] || 'Untitled Asset',
        environment: this.environmentId,
        depth,
        children: [],
      };
    } catch (error) {
      console.error(`Error resolving asset ${assetId}:`, error);
      return {
        id: assetId,
        type: 'Asset',
        environment: this.environmentId,
        depth,
        children: [],
        title: 'Error loading asset',
      };
    }
  }

  private extractLinks(fields: any): ContentfulLink[] {
    const links: ContentfulLink[] = [];

    const traverse = (obj: any) => {
      if (!obj || typeof obj !== 'object') return;

      // Check if this is a link object
      if (obj.sys?.type === 'Link' && (obj.sys.linkType === 'Entry' || obj.sys.linkType === 'Asset')) {
        links.push(obj as ContentfulLink);
        return;
      }

      // Traverse arrays and objects
      if (Array.isArray(obj)) {
        obj.forEach(traverse);
      } else {
        Object.values(obj).forEach(traverse);
      }
    };

    traverse(fields);
    return links;
  }

  private extractTitle(entry: any): string {
    // Common field names for title
    const titleFields = ['title', 'name', 'internalName', 'heading'];
    
    for (const fieldName of titleFields) {
      if (entry.fields?.[fieldName]) {
        const field = entry.fields[fieldName];
        // Get first available locale
        const locale = Object.keys(field)[0];
        if (field[locale]) {
          return String(field[locale]).substring(0, 100);
        }
      }
    }

    return entry.sys.id;
  }

  // Flatten dependency tree into a list of unique items
  public flattenDependencies(node: DependencyNode): Array<{ id: string; type: 'Entry' | 'Asset' }> {
    const items = new Map<string, { id: string; type: 'Entry' | 'Asset' }>();

    const traverse = (n: DependencyNode) => {
      if (!n.isCircular) {
        items.set(n.id, { id: n.id, type: n.type });
        n.children.forEach(traverse);
      }
    };

    traverse(node);
    return Array.from(items.values());
  }
}

