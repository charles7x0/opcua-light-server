import { render, screen, within } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { ConnectedClientsTable } from '../../web/src/screens/dashboard/ConnectedClientsTable';
import { ClientSession } from '../../web/src/api';

/**
 * Feature: connected-clients-dashboard, Property 2: Session Rendering Completeness
 * Validates: Requirements 4.1, 4.2
 *
 * For any valid array of client sessions, the rendered ConnectedClientsTable component
 * SHALL display exactly one table row per session, and each row SHALL contain the
 * applicationName, applicationUri, securityPolicyUri, clientAddress, and sessionState
 * values from the corresponding session object, plus a non-empty formatted connectTime.
 */

const SESSION_STATES: ClientSession['sessionState'][] = ['Created', 'Activated', 'Closing'];

/** Generator for a valid ClientSession object */
const arbClientSession: fc.Arbitrary<ClientSession> = fc.record({
  applicationName: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
  applicationUri: fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
  securityPolicyUri: fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
  clientAddress: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
  connectTime: fc.date({
    min: new Date('2020-01-01T00:00:00Z'),
    max: new Date(Date.now() - 2000),
  }).map(d => d.toISOString()),
  sessionState: fc.constantFrom(...SESSION_STATES),
});

/** Generator for a valid session array (1-10 sessions to keep tests fast) */
const arbSessionArray: fc.Arbitrary<ClientSession[]> = fc.array(arbClientSession, { minLength: 1, maxLength: 10 });

describe('Feature: connected-clients-dashboard, Property 2: Session Rendering Completeness', () => {
  it('renders exactly one row per session in the table body', () => {
    fc.assert(
      fc.property(arbSessionArray, (sessions) => {
        const { container } = render(<ConnectedClientsTable sessions={sessions} />);
        const tbody = container.querySelector('tbody');
        expect(tbody).not.toBeNull();
        const rows = tbody!.querySelectorAll('tr');
        expect(rows.length).toBe(sessions.length);
      }),
      { numRuns: 100 }
    );
  });

  it('each row contains applicationName, applicationUri, securityPolicyUri, clientAddress, and sessionState', () => {
    fc.assert(
      fc.property(arbSessionArray, (sessions) => {
        const { container } = render(<ConnectedClientsTable sessions={sessions} />);
        const tbody = container.querySelector('tbody');
        expect(tbody).not.toBeNull();
        const rows = tbody!.querySelectorAll('tr');

        sessions.forEach((session, index) => {
          const row = rows[index];
          const rowElement = row as HTMLElement;
          const rowScope = within(rowElement);

          // Each text field should appear in the row
          expect(rowElement.textContent).toContain(session.applicationName);
          expect(rowElement.textContent).toContain(session.applicationUri);
          expect(rowElement.textContent).toContain(session.securityPolicyUri);
          expect(rowElement.textContent).toContain(session.clientAddress);
          expect(rowElement.textContent).toContain(session.sessionState);
        });
      }),
      { numRuns: 100 }
    );
  });

  it('each row contains a non-empty formatted connectTime value', () => {
    fc.assert(
      fc.property(arbSessionArray, (sessions) => {
        const { container } = render(<ConnectedClientsTable sessions={sessions} />);
        const tbody = container.querySelector('tbody');
        expect(tbody).not.toBeNull();
        const rows = tbody!.querySelectorAll('tr');

        sessions.forEach((session, index) => {
          const row = rows[index];
          // The "Connected" column is the 5th td (index 4)
          const cells = row.querySelectorAll('td');
          expect(cells.length).toBeGreaterThanOrEqual(5);
          const connectedCell = cells[4];
          // Should have some non-empty text (formatted duration)
          expect(connectedCell.textContent!.trim().length).toBeGreaterThan(0);
        });
      }),
      { numRuns: 100 }
    );
  });
});


// ─── Unit Tests ───────────────────────────────────────────────────────────────

import { vi, beforeEach } from 'vitest';

// Mock formatRelativeDuration to verify it's being used for the Connected column
vi.mock('../../web/src/utils/formatRelativeDuration', () => ({
  formatRelativeDuration: vi.fn((iso: string) => `formatted(${iso})`),
}));

import { formatRelativeDuration } from '../../web/src/utils/formatRelativeDuration';

const mockedFormatRelativeDuration = vi.mocked(formatRelativeDuration);

function createSession(overrides: Partial<ClientSession> = {}): ClientSession {
  return {
    applicationName: 'UaExpert',
    applicationUri: 'urn:UnifiedAutomation:UaExpert',
    securityPolicyUri: 'http://opcfoundation.org/UA/SecurityPolicy#None',
    clientAddress: '192.168.1.50:54321',
    connectTime: '2024-01-15T10:30:00.000Z',
    sessionState: 'Activated',
    ...overrides,
  };
}

describe('ConnectedClientsTable - Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('empty state', () => {
    it('shows "No clients connected" message when sessions array is empty', () => {
      render(<ConnectedClientsTable sessions={[]} />);
      expect(screen.getByText('No clients connected')).toBeInTheDocument();
    });

    it('does not render a table when sessions array is empty', () => {
      render(<ConnectedClientsTable sessions={[]} />);
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });
  });

  describe('table column rendering', () => {
    it('renders all column headers', () => {
      render(<ConnectedClientsTable sessions={[createSession()]} />);

      expect(screen.getByText('App Name')).toBeInTheDocument();
      expect(screen.getByText('App URI')).toBeInTheDocument();
      expect(screen.getByText('Security Policy')).toBeInTheDocument();
      expect(screen.getByText('Address')).toBeInTheDocument();
      expect(screen.getByText('Connected')).toBeInTheDocument();
      expect(screen.getByText('State')).toBeInTheDocument();
    });

    it('renders all column values for a single session', () => {
      const session = createSession({
        applicationName: 'TestClient',
        applicationUri: 'urn:test:client',
        securityPolicyUri: 'http://opcfoundation.org/UA/SecurityPolicy#Basic256Sha256',
        clientAddress: '10.0.0.1:12345',
        sessionState: 'Created',
      });

      render(<ConnectedClientsTable sessions={[session]} />);

      expect(screen.getByText('TestClient')).toBeInTheDocument();
      expect(screen.getByText('urn:test:client')).toBeInTheDocument();
      expect(screen.getByText('http://opcfoundation.org/UA/SecurityPolicy#Basic256Sha256')).toBeInTheDocument();
      expect(screen.getByText('10.0.0.1:12345')).toBeInTheDocument();
      expect(screen.getByText('Created')).toBeInTheDocument();
    });

    it('renders multiple sessions as separate rows', () => {
      const sessions = [
        createSession({ applicationName: 'Client A', clientAddress: '10.0.0.1:1111' }),
        createSession({ applicationName: 'Client B', clientAddress: '10.0.0.2:2222' }),
      ];

      render(<ConnectedClientsTable sessions={sessions} />);

      expect(screen.getByText('Client A')).toBeInTheDocument();
      expect(screen.getByText('Client B')).toBeInTheDocument();
      expect(screen.getByText('10.0.0.1:1111')).toBeInTheDocument();
      expect(screen.getByText('10.0.0.2:2222')).toBeInTheDocument();
    });
  });

  describe('duration formatting', () => {
    it('calls formatRelativeDuration with the connectTime value', () => {
      const session = createSession({ connectTime: '2024-03-20T14:00:00.000Z' });
      render(<ConnectedClientsTable sessions={[session]} />);

      expect(mockedFormatRelativeDuration).toHaveBeenCalledWith('2024-03-20T14:00:00.000Z');
    });

    it('displays the formatted duration output instead of raw ISO timestamp', () => {
      const session = createSession({ connectTime: '2024-03-20T14:00:00.000Z' });
      render(<ConnectedClientsTable sessions={[session]} />);

      expect(screen.getByText('formatted(2024-03-20T14:00:00.000Z)')).toBeInTheDocument();
      expect(screen.queryByText('2024-03-20T14:00:00.000Z')).not.toBeInTheDocument();
    });

    it('calls formatRelativeDuration once per session', () => {
      const sessions = [
        createSession({ connectTime: '2024-01-01T00:00:00.000Z' }),
        createSession({ connectTime: '2024-06-15T12:30:00.000Z', clientAddress: '10.0.0.2:2222' }),
      ];

      render(<ConnectedClientsTable sessions={sessions} />);

      expect(mockedFormatRelativeDuration).toHaveBeenCalledTimes(2);
      expect(mockedFormatRelativeDuration).toHaveBeenCalledWith('2024-01-01T00:00:00.000Z');
      expect(mockedFormatRelativeDuration).toHaveBeenCalledWith('2024-06-15T12:30:00.000Z');
    });
  });
});
