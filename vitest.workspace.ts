import { defineWorkspace } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineWorkspace([
  {
    test: {
      name: 'unit',
      include: ['tests/unit/**/*.test.ts'],
      globals: true,
    },
  },
  {
    test: {
      name: 'property',
      include: ['tests/property/**/*.test.ts'],
      globals: true,
      testTimeout: 30000,
    },
  },
  {
    test: {
      name: 'integration',
      include: ['tests/integration/**/*.test.ts'],
      globals: true,
      testTimeout: 60000,
    },
  },
  {
    plugins: [react()],
    resolve: {
      alias: {
        'react': path.resolve(__dirname, 'node_modules/react'),
        'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
        '@tanstack/react-query': path.resolve(__dirname, 'node_modules/@tanstack/react-query'),
      },
    },
    test: {
      name: 'components',
      include: ['tests/components/**/*.test.tsx'],
      globals: true,
      environment: 'jsdom',
      setupFiles: ['tests/components/setup.ts'],
    },
  },
]);
