import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ConnectionForm } from '../../web/src/screens/connectors/ConnectionForm';
import type { ParamFieldSchema } from '../../web/src/api';

describe('ConnectionForm - Dynamic Schema Rendering', () => {
  const defaultProps = {
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
  };

  // ─── 1. Schema with text and number fields ────────────────────────────────

  describe('schema with text and number fields', () => {
    const schema: ParamFieldSchema[] = [
      { key: 'host', label: 'Host', type: 'text', required: true, placeholder: '192.168.1.10' },
      { key: 'port', label: 'Port', type: 'number', required: false, defaultValue: 502, min: 1, max: 65535 },
    ];

    it('renders text field with correct label', () => {
      render(<ConnectionForm type="test" paramsSchema={schema} {...defaultProps} />);
      expect(screen.getByLabelText('Host')).toBeInTheDocument();
    });

    it('renders number field with correct label', () => {
      render(<ConnectionForm type="test" paramsSchema={schema} {...defaultProps} />);
      expect(screen.getByLabelText('Port')).toBeInTheDocument();
    });

    it('renders text input with correct type', () => {
      render(<ConnectionForm type="test" paramsSchema={schema} {...defaultProps} />);
      const hostInput = screen.getByLabelText('Host');
      expect(hostInput).toHaveAttribute('type', 'text');
    });

    it('renders number input with correct type', () => {
      render(<ConnectionForm type="test" paramsSchema={schema} {...defaultProps} />);
      const portInput = screen.getByLabelText('Port');
      expect(portInput).toHaveAttribute('type', 'number');
    });
  });

  // ─── 2. Schema with select field ──────────────────────────────────────────

  describe('schema with select field', () => {
    const schema: ParamFieldSchema[] = [
      {
        key: 'baudRate',
        label: 'Baud Rate',
        type: 'select',
        required: true,
        options: [
          { value: '9600', label: '9600' },
          { value: '19200', label: '19200' },
          { value: '38400', label: '38400' },
        ],
      },
    ];

    it('renders a select dropdown', () => {
      render(<ConnectionForm type="test" paramsSchema={schema} {...defaultProps} />);
      const select = screen.getByLabelText('Baud Rate');
      expect(select.tagName).toBe('SELECT');
    });

    it('renders all options in the select', () => {
      render(<ConnectionForm type="test" paramsSchema={schema} {...defaultProps} />);
      expect(screen.getByRole('option', { name: '9600' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: '19200' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: '38400' })).toBeInTheDocument();
    });

    it('includes a default empty option', () => {
      render(<ConnectionForm type="test" paramsSchema={schema} {...defaultProps} />);
      expect(screen.getByRole('option', { name: '— Select —' })).toBeInTheDocument();
    });
  });

  // ─── 3. Schema with boolean field ─────────────────────────────────────────

  describe('schema with boolean field', () => {
    const schema: ParamFieldSchema[] = [
      { key: 'enableSsl', label: 'Enable SSL', type: 'boolean', required: false, defaultValue: false },
    ];

    it('renders a checkbox for boolean type', () => {
      render(<ConnectionForm type="test" paramsSchema={schema} {...defaultProps} />);
      const checkbox = screen.getByLabelText('Enable SSL');
      expect(checkbox).toHaveAttribute('type', 'checkbox');
    });

    it('checkbox is unchecked when defaultValue is false', () => {
      render(<ConnectionForm type="test" paramsSchema={schema} {...defaultProps} />);
      const checkbox = screen.getByLabelText('Enable SSL');
      expect(checkbox).not.toBeChecked();
    });

    it('checkbox is checked when defaultValue is true', () => {
      const schemaChecked: ParamFieldSchema[] = [
        { key: 'enableSsl', label: 'Enable SSL', type: 'boolean', required: false, defaultValue: true },
      ];
      render(<ConnectionForm type="test" paramsSchema={schemaChecked} {...defaultProps} />);
      const checkbox = screen.getByLabelText('Enable SSL');
      expect(checkbox).toBeChecked();
    });
  });

  // ─── 4. Pre-fills default values ──────────────────────────────────────────

  describe('pre-fills default values from schema', () => {
    const schema: ParamFieldSchema[] = [
      { key: 'host', label: 'Host', type: 'text', required: true, placeholder: '192.168.1.10' },
      { key: 'port', label: 'Port', type: 'number', required: false, defaultValue: 502 },
      { key: 'timeout', label: 'Timeout', type: 'number', required: false, defaultValue: 3000 },
    ];

    it('shows default value for port field', () => {
      render(<ConnectionForm type="test" paramsSchema={schema} {...defaultProps} />);
      const portInput = screen.getByLabelText('Port');
      expect(portInput).toHaveValue(502);
    });

    it('shows default value for timeout field', () => {
      render(<ConnectionForm type="test" paramsSchema={schema} {...defaultProps} />);
      const timeoutInput = screen.getByLabelText('Timeout');
      expect(timeoutInput).toHaveValue(3000);
    });

    it('text field without default shows empty', () => {
      render(<ConnectionForm type="test" paramsSchema={schema} {...defaultProps} />);
      const hostInput = screen.getByLabelText('Host');
      expect(hostInput).toHaveValue('');
    });
  });

  // ─── 5. Fallback to key-value editor when no schema ───────────────────────

  describe('fallback to key-value editor', () => {
    it('shows key-value editor when paramsSchema is undefined', () => {
      render(<ConnectionForm type="unknown-protocol" {...defaultProps} />);
      expect(screen.getByText('Parameters')).toBeInTheDocument();
      expect(screen.getByLabelText('Parameter key 1')).toBeInTheDocument();
      expect(screen.getByLabelText('Parameter value 1')).toBeInTheDocument();
    });

    it('shows key-value editor when paramsSchema is empty array', () => {
      render(<ConnectionForm type="unknown-protocol" paramsSchema={[]} {...defaultProps} />);
      expect(screen.getByText('Parameters')).toBeInTheDocument();
      expect(screen.getByLabelText('Parameter key 1')).toBeInTheDocument();
    });

    it('shows Add Parameter button in key-value mode', () => {
      render(<ConnectionForm type="unknown-protocol" {...defaultProps} />);
      expect(screen.getByText('+ Add Parameter')).toBeInTheDocument();
    });

    it('does not show key-value editor when schema is provided', () => {
      const schema: ParamFieldSchema[] = [
        { key: 'host', label: 'Host', type: 'text', required: true },
      ];
      render(<ConnectionForm type="test" paramsSchema={schema} {...defaultProps} />);
      expect(screen.queryByText('Parameters')).not.toBeInTheDocument();
      expect(screen.queryByText('+ Add Parameter')).not.toBeInTheDocument();
    });
  });

  // ─── 6. All schema fields rendered (4 different types) ────────────────────

  describe('all schema field types rendered together', () => {
    const mixedSchema: ParamFieldSchema[] = [
      { key: 'host', label: 'Host Address', type: 'text', required: true, placeholder: '10.0.0.1' },
      { key: 'port', label: 'Port Number', type: 'number', required: false, defaultValue: 8080 },
      { key: 'protocol', label: 'Protocol', type: 'select', required: true, options: [
        { value: 'tcp', label: 'TCP' },
        { value: 'udp', label: 'UDP' },
      ]},
      { key: 'secure', label: 'Use TLS', type: 'boolean', required: false, defaultValue: false },
    ];

    it('renders all 4 fields from the schema', () => {
      render(<ConnectionForm type="custom" paramsSchema={mixedSchema} {...defaultProps} />);

      expect(screen.getByLabelText('Host Address')).toBeInTheDocument();
      expect(screen.getByLabelText('Port Number')).toBeInTheDocument();
      expect(screen.getByLabelText('Protocol')).toBeInTheDocument();
      expect(screen.getByLabelText('Use TLS')).toBeInTheDocument();
    });

    it('text field has correct input type', () => {
      render(<ConnectionForm type="custom" paramsSchema={mixedSchema} {...defaultProps} />);
      expect(screen.getByLabelText('Host Address')).toHaveAttribute('type', 'text');
    });

    it('number field has correct input type', () => {
      render(<ConnectionForm type="custom" paramsSchema={mixedSchema} {...defaultProps} />);
      expect(screen.getByLabelText('Port Number')).toHaveAttribute('type', 'number');
    });

    it('select field renders as dropdown with options', () => {
      render(<ConnectionForm type="custom" paramsSchema={mixedSchema} {...defaultProps} />);
      const select = screen.getByLabelText('Protocol');
      expect(select.tagName).toBe('SELECT');
      expect(screen.getByRole('option', { name: 'TCP' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'UDP' })).toBeInTheDocument();
    });

    it('boolean field renders as checkbox', () => {
      render(<ConnectionForm type="custom" paramsSchema={mixedSchema} {...defaultProps} />);
      expect(screen.getByLabelText('Use TLS')).toHaveAttribute('type', 'checkbox');
    });
  });
});
