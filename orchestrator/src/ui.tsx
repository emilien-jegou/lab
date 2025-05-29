import { RedisClient } from 'bun';
import { render } from 'ink';
import React, { useState, useEffect } from 'react';
import type { FlowEntity } from './utils/tracer';
import { getFlowStorage } from './utils/tracer';

// Use dynamic imports for problematic packages
const { Box, Text, useInput, useApp } = await import('ink');
//const Spinner = (await import('ink-spinner')).default;

interface TerminalSize {
  width: number;
  height: number;
}

const useTerminalSize = (): TerminalSize => {
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

export const App: React.FC = () => {
  const { exit } = useApp();
  const [keys, setKeys] = useState<Record<string, FlowEntity>>({});

  useEffect(() => {
    let p: any;
    (async () => {
      const client = new RedisClient();
      const flowStorage = getFlowStorage(client);

      const elems = await flowStorage.getAll();
      setKeys(Object.fromEntries(elems.map((e) => [e.id, e])));

      p = await flowStorage.subscribe(async (id) => {
        const newEntity = await flowStorage.getById(id);
        if (!newEntity) return console.error('flow not found, id:', id);
        setKeys((v) => ({ ...v, [id]: newEntity }));
      });
    })();
    return () => {
      if (p) p();
    };
  }, []);

  //const availableHeight: number = height - 3;

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
      <Text>Keys:</Text>
      {Object.entries(keys).map(([id, value]) => (
        <Text key={id} bold>
          {value.name}
        </Text>
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
