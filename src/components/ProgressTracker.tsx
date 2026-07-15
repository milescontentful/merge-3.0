import React from 'react';
import {
  Box,
  Stack,
  Text,
  Flex,
  Badge,
  Note,
} from '@contentful/f36-components';
import { MergeProgress } from '../types';
import { css } from 'emotion';

interface ProgressTrackerProps {
  progress: MergeProgress;
}

const progressBarStyle = css({
  width: '100%',
  height: '6px',
  backgroundColor: '#e5ebed',
  borderRadius: '3px',
  overflow: 'hidden',
});

const progressFillStyle = (percentage: number, status: string) => css({
  height: '100%',
  width: `${percentage}%`,
  backgroundColor: 
    status === 'error' ? '#d32f2f' : 
    status === 'completed' ? '#00875a' : 
    '#0073e6',
  transition: 'width 0.3s ease-in-out',
});

export const ProgressTracker: React.FC<ProgressTrackerProps> = ({ progress }) => {
  const percentage = progress.total > 0 
    ? Math.round((progress.processed / progress.total) * 100) 
    : 0;

  // If completed, just show the completion message
  if (progress.status === 'completed') {
    return (
      <Box>
        <Note variant={progress.failed === 0 ? "positive" : "warning"}>
          <Text fontSize="fontSizeS">
            {progress.failed === 0 
              ? "✓ Merge complete" 
              : `✓ Merge complete (${progress.failed} error(s))`}
          </Text>
        </Note>
        {progress.errors.length > 0 && (
          <Box style={{ maxHeight: '100px', overflowY: 'auto', marginTop: '8px' }}>
            {progress.errors.map((error, index) => (
              <Text key={index} fontSize="fontSizeS" fontColor="red600" style={{ marginTop: '4px' }}>
                {error.id}: {error.message}
              </Text>
            ))}
          </Box>
        )}
      </Box>
    );
  }

  // While merging, show progress
  return (
    <Box>
      <Stack spacing="spacingXs">
        <Flex justifyContent="space-between" alignItems="center">
          <Text fontSize="fontSizeS" fontWeight="fontWeightDemiBold">Progress</Text>
          <Text fontSize="fontSizeS" fontWeight="fontWeightMedium">
            {percentage}%
          </Text>
        </Flex>

        <Box className={progressBarStyle}>
          <Box className={progressFillStyle(percentage, progress.status)} />
        </Box>

        <Flex justifyContent="space-between" alignItems="center">
          <Text fontSize="fontSizeS" fontColor="gray600">
            {progress.processed} / {progress.total}
          </Text>
          <Flex gap="spacingXs">
            <Text fontSize="fontSizeS" fontColor="green600">
              ✓ {progress.succeeded}
            </Text>
            {progress.failed > 0 && (
              <Text fontSize="fontSizeS" fontColor="red600">
                ✗ {progress.failed}
              </Text>
            )}
          </Flex>
        </Flex>

        {progress.currentItem && (
          <Text fontSize="fontSizeS" fontColor="gray600" style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}>
            {progress.currentItem}
          </Text>
        )}
      </Stack>
    </Box>
  );
};

export default ProgressTracker;

