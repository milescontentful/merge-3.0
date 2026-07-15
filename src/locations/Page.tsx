import React, { useState } from 'react';
import { Box, Tabs } from '@contentful/f36-components';
import EnvironmentCompare from './EnvironmentCompare';
import MergeQueue from './MergeQueue';

// Page location — the management hub: full environment/space compare & merge,
// plus the persistent merge queue.
const Page = () => {
  const [tab, setTab] = useState('compare');

  return (
    <Box>
      <Tabs currentTab={tab} onTabChange={setTab}>
        <Tabs.List style={{ paddingLeft: '24px', paddingTop: '12px' }}>
          <Tabs.Tab panelId="compare">Compare &amp; Merge</Tabs.Tab>
          <Tabs.Tab panelId="queue">Merge Queue</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel id="compare">
          <EnvironmentCompare />
        </Tabs.Panel>
        <Tabs.Panel id="queue">
          <MergeQueue />
        </Tabs.Panel>
      </Tabs>
    </Box>
  );
};

export default Page;
