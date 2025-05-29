import { render } from 'ink';
import React, { useState, useEffect } from 'react';

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
  const { width, height } = useTerminalSize();

  const availableHeight: number = height - 3;

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
    <Box flexDirection="column" height={height}>
      <Box height={2} justifyContent="center" marginTop={1}>
        <Text color="cyan" bold>
          {'Nav: ↑↓/jk=select, Enter=details, /=search, s=sort, f=filter, q=quit'}
        </Text>
      </Box>
    </Box>
  );
};

export const renderApp = () => {
  render(<App />);
};
