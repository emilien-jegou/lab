import { render } from 'ink';
import React, { useState, useEffect } from 'react';
import { useFlows } from './hooks/use-flows';
import type { FlowEntity } from './utils/tracer';

// Use dynamic imports for problematic packages
const { Box, Text, useInput, useApp } = await import('ink');
const Table = (await import('ink-table')).default;
const Spinner = (await import('ink-spinner')).default;

interface TerminalSize {
  width: number;
  height: number;
}

const _useTerminalSize = (): TerminalSize => {
  const [size, setSize] = useState<TerminalSize>({
    width: process.stdout.columns || 80,
    height: process.stdout.rows || 24,
  });

  useEffect(() => {
    const updateSize = (): void => {
      setSize({
        width: process.stdout.columns || 80,
        height: process.stdout.rows || 24,
      });
    };

    process.stdout.on('resize', updateSize);
    return () => void process.stdout.off('resize', updateSize);
  }, []);

  return size;
};

//export type FlowEntity = {
//  id: string;
//  name: string;
//  trigger: TriggerTrace;
//  tasks: TaskTrace[];
//  status: ScriptStatus['kind'];
//};
type TaskStatus = 'success' | 'ongoing' | 'pending' | 'failure' | 'cancelled' | 'warning';

interface StatusIconProps {
  status: TaskStatus;
  showProgress?: boolean;
  progress?: number;
}

const StatusIcon: React.FC<StatusIconProps> = ({ status, showProgress, progress }) => {
  switch (status) {
    case 'success':
      return <Text color="green">✅</Text>;
    case 'ongoing':
      return (
        <Box>
          <Text color="blue">
            <Spinner type="dots" />
          </Text>
          {showProgress && progress !== undefined && <Text color="blue"> {progress}%</Text>}
        </Box>
      );
    case 'pending':
      return <Text color="light-gray">⏳</Text>;
    case 'failure':
      return <Text color="red">❌</Text>;
    case 'cancelled':
      return <Text color="gray">⏹️</Text>;
    case 'warning':
      return <Text color="yellow">⚠️</Text>;
    default:
      return <Text color="gray">⚪</Text>;
  }
};

//    <Table
//      data={Object.entries(flows).map(([_, { id, name, trigger, status }]) => ({
//        id,
//        name,
//        trigger: trigger.kind,
//        status: status,
//        startedAt: String(trigger.receivedAt),
//      }))}
//    />
const TaskRow: React.FC<{ flow: FlowEntity }> = ({ flow }) => (
  <Box flexDirection="row" gap={4}>
    <Box width={24}>
      <Text>{flow.id.slice(0, 6)}</Text>
    </Box>
    <Box width={12}>
      <Text>{String(flow.trigger.receivedAt)}</Text>
    </Box>
    <StatusIcon status={flow.status} />
  </Box>
);

export const App: React.FC = () => {
  const { exit } = useApp();
  const flows = useFlows();

  useInput((input: string, key: any) => {
    if (input === 'q' || key.escape) {
      return exit();
    } else if (input === 'h' || key.leftArrow) {
      //setActiveTab((prev) => Math.max(0, prev - 1));
    } else if (input === 'l' || key.rightArrow) {
      //setActiveTab((prev) => Math.min(4, prev + 1));
    }
  });

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={4}>
        <Box width={24}>
          <Text bold>ID</Text>
        </Box>
        <Box width={12}>
          <Text bold>StartedAt</Text>
        </Box>
        <Text bold>Status</Text>
      </Box>
      {Object.entries(flows).map(([_, flow]) => (
        <TaskRow key={flow.id} flow={flow} />
      ))}
    </Box>
  );
};

//<Box height={2} justifyContent="center" marginTop={1}>
//  <Text color="cyan" bold>
//    {'Nav: ↑↓/jk=select, Enter=details, /=search, s=sort, f=filter, q=quit'}
//  </Text>
//</Box>

render(<App />);
