import { describe, it, expect } from 'vitest';
import { DependencyResolver } from './dependencyResolver';
import { DependencyNode } from '../types';

// Smoke test for the pure part of the resolver: flattening a dependency
// tree into a deduplicated item list (the input to every merge).
describe('DependencyResolver.flattenDependencies', () => {
  const node = (id: string, type: 'Entry' | 'Asset', children: DependencyNode[] = []): DependencyNode =>
    ({ id, type, title: id, contentType: 'test', children } as DependencyNode);

  it('flattens nested children and dedupes repeated references', () => {
    const shared = node('asset-1', 'Asset');
    const tree = node('root', 'Entry', [
      node('child-1', 'Entry', [shared]),
      node('child-2', 'Entry', [shared]), // same asset referenced twice
    ]);

    const resolver = new DependencyResolver({} as any, 'space', 'master');
    const items = resolver.flattenDependencies(tree);

    expect(items).toHaveLength(4); // root, child-1, child-2, asset-1 (once)
    expect(items.filter((i) => i.id === 'asset-1')).toHaveLength(1);
    expect(items.find((i) => i.id === 'root')?.type).toBe('Entry');
  });
});
