import React, { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  Checkbox,
  Flex,
  Heading,
  Note,
  Select,
  Spinner,
  Table,
  Text,
  TextInput,
} from '@contentful/f36-components';
import { PageAppSDK } from '@contentful/app-sdk';
import { useSDK } from '@contentful/react-apps-toolkit';
import { PlainClientAPI } from 'contentful-management';
import { AppInstallationParameters, ChangeItem, ConflictResolution, MergeProgress } from '../types';
import { useContentfulClient } from '../hooks/useContentfulClient';
import { MergeExecutor } from '../services/mergeExecutor';
import ProgressTracker from '../components/ProgressTracker';
import { getEnvironmentsWithAliases, EnvironmentWithAlias } from '../utils/environmentHelpers';

/**
 * Compare & Merge — a full environment/space diff.
 *
 * Like Contentful's official Merge app, but for ALL content: content types,
 * entries, and assets. Source is an environment in this space; the target can
 * be any environment in any space the CMA token can reach. Select what to
 * move, merge as drafts.
 */

type Kind = 'contentType' | 'entry' | 'asset';

interface DiffItem {
  id: string;
  kind: Kind;
  title: string;
  contentType?: string;
  changeType: 'add' | 'update';
  sourceData: any;
  targetData?: any;
}

const LIST_CAP = 1000; // per collection, per side — plenty for demo spaces

// Pull a human title out of an entry/asset payload
function extractTitle(data: any, fallback: string): string {
  const fields = data?.fields || {};
  for (const name of ['internalName', 'title', 'name', 'headline', 'label']) {
    const field = fields[name];
    if (field) {
      const value = field[Object.keys(field)[0]];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  }
  const file = fields.file && fields.file[Object.keys(fields.file)[0]];
  if (file?.fileName) return file.fileName;
  return fallback;
}

// Diff two id-keyed collections into add/update items
function diffCollections(
  kind: Kind,
  source: any[],
  target: any[],
  comparable: (item: any) => any
): DiffItem[] {
  const targetById = new Map(target.map((t) => [t.sys.id, t]));
  const items: DiffItem[] = [];
  for (const s of source) {
    const t = targetById.get(s.sys.id);
    if (!t) {
      items.push({
        id: s.sys.id,
        kind,
        title: kind === 'contentType' ? s.name : extractTitle(s, s.sys.id),
        contentType: kind === 'entry' ? s.sys.contentType?.sys.id : undefined,
        changeType: 'add',
        sourceData: s,
      });
    } else if (JSON.stringify(comparable(s)) !== JSON.stringify(comparable(t))) {
      items.push({
        id: s.sys.id,
        kind,
        title: kind === 'contentType' ? s.name : extractTitle(s, s.sys.id),
        contentType: kind === 'entry' ? s.sys.contentType?.sys.id : undefined,
        changeType: 'update',
        sourceData: s,
        targetData: t,
      });
    }
  }
  return items;
}

async function listAll(fetchPage: (skip: number) => Promise<{ items: any[]; total: number }>): Promise<{ items: any[]; truncated: boolean }> {
  const items: any[] = [];
  let total = 0;
  do {
    const page = await fetchPage(items.length);
    items.push(...page.items);
    total = page.total;
  } while (items.length < Math.min(total, LIST_CAP) && items.length > 0);
  return { items, truncated: total > LIST_CAP };
}

const SECTION_META: Record<Kind, { label: string; order: number }> = {
  contentType: { label: 'Content Types', order: 0 },
  entry: { label: 'Entries', order: 1 },
  asset: { label: 'Assets', order: 2 },
};

const EnvironmentCompare = () => {
  const sdk = useSDK<PageAppSDK>();
  const parameters = (sdk.parameters.installation as AppInstallationParameters) || null;
  const cma: PlainClientAPI | null = useContentfulClient(parameters);

  const [spaces, setSpaces] = useState<{ id: string; name: string }[]>([]);
  const [sourceEnvs, setSourceEnvs] = useState<EnvironmentWithAlias[]>([]);
  const [targetEnvs, setTargetEnvs] = useState<EnvironmentWithAlias[]>([]);

  const [sourceEnv, setSourceEnv] = useState<string>(sdk.ids.environment);
  const [targetSpace, setTargetSpace] = useState<string>(sdk.ids.space);
  const [targetEnv, setTargetEnv] = useState<string>('');

  const [diff, setDiff] = useState<DiffItem[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<'all' | Kind>('all');
  const [changeFilter, setChangeFilter] = useState<'all' | 'add' | 'update'>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<MergeProgress | null>(null);
  const [merging, setMerging] = useState(false);

  // Load spaces + source envs once the client is ready
  useEffect(() => {
    if (!cma) return;
    (async () => {
      try {
        const [spaceList, envs] = await Promise.all([
          cma.space.getMany({ query: { limit: 100 } } as any),
          getEnvironmentsWithAliases(cma, sdk.ids.space),
        ]);
        setSpaces(spaceList.items.map((s: any) => ({ id: s.sys.id, name: s.name })));
        setSourceEnvs(envs);
      } catch (err: any) {
        sdk.notifier.error(`Failed to load spaces: ${err.message}`);
      }
    })();
  }, [cma, sdk.ids.space]);

  // Load target envs whenever the target space changes
  useEffect(() => {
    if (!cma || !targetSpace) return;
    (async () => {
      try {
        setTargetEnvs(await getEnvironmentsWithAliases(cma, targetSpace));
      } catch (err: any) {
        setTargetEnvs([]);
        sdk.notifier.error(`Failed to load environments for space ${targetSpace}: ${err.message}`);
      }
    })();
    setTargetEnv('');
    setDiff(null);
  }, [cma, targetSpace]);

  const sameTarget = targetSpace === sdk.ids.space && targetEnv === sourceEnv;

  const handleCompare = async () => {
    if (!cma || !sourceEnv || !targetEnv || sameTarget) return;
    setComparing(true);
    setDiff(null);
    setSelected(new Set());
    setProgress(null);
    try {
      const src = { spaceId: sdk.ids.space, environmentId: sourceEnv };
      const tgt = { spaceId: targetSpace, environmentId: targetEnv };

      const [srcCts, tgtCts, srcEntries, tgtEntries, srcAssets, tgtAssets] = await Promise.all([
        listAll((skip) => cma.contentType.getMany({ ...src, query: { limit: 100, skip } })),
        listAll((skip) => cma.contentType.getMany({ ...tgt, query: { limit: 100, skip } })),
        listAll((skip) => cma.entry.getMany({ ...src, query: { limit: 100, skip } })),
        listAll((skip) => cma.entry.getMany({ ...tgt, query: { limit: 100, skip } })),
        listAll((skip) => cma.asset.getMany({ ...src, query: { limit: 100, skip } })),
        listAll((skip) => cma.asset.getMany({ ...tgt, query: { limit: 100, skip } })),
      ]);

      const items = [
        ...diffCollections('contentType', srcCts.items, tgtCts.items, (ct) => ({
          name: ct.name,
          description: ct.description,
          displayField: ct.displayField,
          fields: ct.fields,
        })),
        ...diffCollections('entry', srcEntries.items, tgtEntries.items, (e) => e.fields),
        ...diffCollections('asset', srcAssets.items, tgtAssets.items, (a) => a.fields),
      ];
      setDiff(items);
      setTruncated([srcCts, tgtCts, srcEntries, tgtEntries, srcAssets, tgtAssets].some((r) => r.truncated));
      setSelected(new Set(items.map((i) => `${i.kind}:${i.id}`))); // select everything by default
    } catch (err: any) {
      sdk.notifier.error(`Compare failed: ${err.message}`);
    } finally {
      setComparing(false);
    }
  };

  const handleMerge = async () => {
    if (!cma || !diff) return;
    const chosen = diff.filter((i) => selected.has(`${i.kind}:${i.id}`));
    if (chosen.length === 0) return;
    setMerging(true);
    setProgress(null);
    try {
      // 1. Content types first — entries depend on them
      const cts = chosen.filter((i) => i.kind === 'contentType');
      for (const ct of cts) {
        const body = {
          name: ct.sourceData.name,
          description: ct.sourceData.description,
          displayField: ct.sourceData.displayField,
          fields: ct.sourceData.fields,
        };
        const params = { spaceId: targetSpace, environmentId: targetEnv, contentTypeId: ct.id };
        const saved =
          ct.changeType === 'add'
            ? await cma.contentType.createWithId(params, body)
            : await cma.contentType.update(params, { ...body, sys: ct.targetData.sys } as any);
        await cma.contentType.publish(params, saved);
      }
      if (cts.length > 0) sdk.notifier.success(`Copied ${cts.length} content type(s)`);

      // 2. Entries + assets via the merge executor (assets first, drafts only)
      const contentItems: ChangeItem[] = chosen
        .filter((i) => i.kind !== 'contentType')
        .map((i) => ({
          id: i.id,
          type: i.kind === 'entry' ? 'Entry' : 'Asset',
          changeType: i.changeType,
          title: i.title,
          contentType: i.contentType,
          hasConflict: i.changeType === 'update',
          sourceData: i.sourceData,
          targetData: i.targetData,
        }));
      if (contentItems.length > 0) {
        const resolutions: ConflictResolution[] = contentItems
          .filter((c) => c.hasConflict)
          .map((c) => ({ id: c.id, action: 'overwrite' }));
        // Executor only writes to its target — safe for cross-space merges
        const executor = new MergeExecutor(cma, targetSpace, targetEnv, false, setProgress);
        const final = await executor.executeMerge(contentItems, resolutions);
        if (final.failed > 0) {
          sdk.notifier.warning(`Merge finished with ${final.failed} error(s)`);
        } else {
          sdk.notifier.success(`Merged ${final.succeeded} item(s) into ${targetSpace}/${targetEnv} as drafts`);
        }
      }
      await handleCompare(); // refresh the diff
    } catch (err: any) {
      sdk.notifier.error(`Merge failed: ${err.message}`);
    } finally {
      setMerging(false);
    }
  };

  const visible = useMemo(() => {
    if (!diff) return [];
    const q = search.trim().toLowerCase();
    return diff
      .filter((i) => kindFilter === 'all' || i.kind === kindFilter)
      .filter((i) => changeFilter === 'all' || i.changeType === changeFilter)
      .filter(
        (i) =>
          !q ||
          i.title.toLowerCase().includes(q) ||
          i.id.toLowerCase().includes(q) ||
          (i.contentType || '').toLowerCase().includes(q)
      )
      .sort((a, b) => SECTION_META[a.kind].order - SECTION_META[b.kind].order || a.title.localeCompare(b.title));
  }, [diff, search, kindFilter, changeFilter]);

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });


  return (
    <Box padding="spacingL">
      <Heading>Compare & Merge</Heading>
      <Text fontColor="gray600">
        Diff everything — content types, entries, and assets — between environments, even across spaces. Select what to
        move; merged content lands as drafts.
      </Text>

      {/* Pickers */}
      <Flex gap="spacingM" alignItems="flex-end" marginTop="spacingL" marginBottom="spacingM">
        <Box style={{ width: 220 }}>
          <Text fontSize="fontSizeS" fontWeight="fontWeightMedium">From (this space)</Text>
          <Select value={sourceEnv} onChange={(e) => setSourceEnv(e.target.value)}>
            {sourceEnvs.map((env) => (
              <Select.Option key={env.sys.id} value={env.sys.id}>
                {env.displayName}
              </Select.Option>
            ))}
          </Select>
        </Box>
        <Text fontColor="gray600" style={{ paddingBottom: 10 }}>→</Text>
        <Box style={{ width: 260 }}>
          <Text fontSize="fontSizeS" fontWeight="fontWeightMedium">To space</Text>
          <Select value={targetSpace} onChange={(e) => setTargetSpace(e.target.value)}>
            {spaces.map((s) => (
              <Select.Option key={s.id} value={s.id}>
                {s.name} {s.id === sdk.ids.space ? '(this space)' : ''}
              </Select.Option>
            ))}
          </Select>
        </Box>
        <Box style={{ width: 220 }}>
          <Text fontSize="fontSizeS" fontWeight="fontWeightMedium">To environment</Text>
          <Select value={targetEnv} onChange={(e) => setTargetEnv(e.target.value)}>
            <Select.Option value="">Select…</Select.Option>
            {targetEnvs.map((env) => (
              <Select.Option key={env.sys.id} value={env.sys.id}>
                {env.displayName}
              </Select.Option>
            ))}
          </Select>
        </Box>
        <Button variant="primary" onClick={handleCompare} isDisabled={!targetEnv || sameTarget || comparing} isLoading={comparing}>
          Compare
        </Button>
      </Flex>
      {sameTarget && targetEnv && (
        <Note variant="warning" style={{ marginBottom: 16 }}>Source and target are the same environment.</Note>
      )}

      {comparing && (
        <Flex alignItems="center" gap="spacingS" marginTop="spacingL">
          <Spinner />
          <Text>Comparing content types, entries, and assets…</Text>
        </Flex>
      )}

      {progress && <ProgressTracker progress={progress} />}

      {diff && !comparing && (
        <>
          <Flex justifyContent="space-between" alignItems="center" marginBottom="spacingM">
            <Flex gap="spacingS" alignItems="center">
              <Badge variant="primary">{diff.length} difference(s)</Badge>
              <Badge variant="positive">{diff.filter((i) => i.changeType === 'add').length} new</Badge>
              <Badge variant="warning">{diff.filter((i) => i.changeType === 'update').length} changed</Badge>
              {truncated && <Badge variant="secondary">capped at {LIST_CAP}/collection</Badge>}
            </Flex>
            <Flex gap="spacingS">
              <TextInput
                placeholder="Search by title, ID, or content type…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ width: 320 }}
              />
              <Button
                variant="positive"
                onClick={handleMerge}
                isDisabled={merging || selected.size === 0}
                isLoading={merging}
              >
                Merge {selected.size} selected
              </Button>
            </Flex>
          </Flex>

          {diff.length === 0 ? (
            <Note variant="positive">Environments are identical — nothing to merge.</Note>
          ) : (
            <>
              {/* Kind + change filters */}
              <Flex gap="spacingS" alignItems="center" marginBottom="spacingM">
                <Flex gap="spacing2Xs">
                  {(['all', 'contentType', 'entry', 'asset'] as const).map((k) => {
                    const count = k === 'all' ? diff.length : diff.filter((i) => i.kind === k).length;
                    return (
                      <Button
                        key={k}
                        size="small"
                        variant={kindFilter === k ? 'primary' : 'secondary'}
                        onClick={() => setKindFilter(k)}
                      >
                        {k === 'all' ? 'Everything' : SECTION_META[k].label} ({count})
                      </Button>
                    );
                  })}
                </Flex>
                <Select
                  value={changeFilter}
                  onChange={(e) => setChangeFilter(e.target.value as any)}
                  size="small"
                  style={{ width: 150 }}
                >
                  <Select.Option value="all">New + Changed</Select.Option>
                  <Select.Option value="add">New only</Select.Option>
                  <Select.Option value="update">Changed only</Select.Option>
                </Select>
              </Flex>

              <Table>
                <Table.Head>
                  <Table.Row>
                    <Table.Cell style={{ width: 40 }}>
                      <Checkbox
                        isChecked={visible.length > 0 && visible.every((i) => selected.has(`${i.kind}:${i.id}`))}
                        onChange={() => {
                          const keys = visible.map((i) => `${i.kind}:${i.id}`);
                          const allOn = keys.every((k) => selected.has(k));
                          setSelected((prev) => {
                            const next = new Set(prev);
                            keys.forEach((k) => (allOn ? next.delete(k) : next.add(k)));
                            return next;
                          });
                        }}
                      />
                    </Table.Cell>
                    <Table.Cell>Title</Table.Cell>
                    <Table.Cell style={{ width: 140 }}>Kind</Table.Cell>
                    <Table.Cell style={{ width: 160 }}>Content type</Table.Cell>
                    <Table.Cell style={{ width: 200 }}>ID</Table.Cell>
                    <Table.Cell style={{ width: 100 }}>Change</Table.Cell>
                  </Table.Row>
                </Table.Head>
                <Table.Body>
                  {visible.length === 0 ? (
                    <Table.Row>
                      <Table.Cell colSpan={6}>
                        <Text fontColor="gray500">No items match the current filters</Text>
                      </Table.Cell>
                    </Table.Row>
                  ) : (
                    visible.map((item) => {
                      const key = `${item.kind}:${item.id}`;
                      return (
                        <Table.Row key={key}>
                          <Table.Cell>
                            <Checkbox isChecked={selected.has(key)} onChange={() => toggle(key)} />
                          </Table.Cell>
                          <Table.Cell>
                            <Text fontWeight="fontWeightMedium">{item.title}</Text>
                          </Table.Cell>
                          <Table.Cell>
                            <Badge
                              variant={item.kind === 'contentType' ? 'primary' : item.kind === 'entry' ? 'secondary' : 'featured'}
                              size="small"
                            >
                              {item.kind === 'contentType' ? 'Content type' : item.kind === 'entry' ? 'Entry' : 'Asset'}
                            </Badge>
                          </Table.Cell>
                          <Table.Cell>
                            <Text fontSize="fontSizeS" fontColor="gray600">{item.contentType || '—'}</Text>
                          </Table.Cell>
                          <Table.Cell>
                            <Text fontSize="fontSizeS" fontColor="gray600">{item.id}</Text>
                          </Table.Cell>
                          <Table.Cell>
                            <Badge variant={item.changeType === 'add' ? 'positive' : 'warning'} size="small">
                              {item.changeType === 'add' ? 'New' : 'Changed'}
                            </Badge>
                          </Table.Cell>
                        </Table.Row>
                      );
                    })
                  )}
                </Table.Body>
              </Table>
            </>
          )}
        </>
      )}
    </Box>
  );
};

export default EnvironmentCompare;
