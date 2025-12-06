import React from 'react';
import { ThemeProvider, darkTheme } from './utils/theme.js';
import { REPL } from './screens/REPL.js';

interface AppProps {
  initialModel: string;
  initialPrompt?: string;
}

export function App({ initialModel, initialPrompt }: AppProps): React.ReactNode {
  return (
    <ThemeProvider value={darkTheme}>
      <REPL initialModel={initialModel} initialPrompt={initialPrompt} />
    </ThemeProvider>
  );
}
