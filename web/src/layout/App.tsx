import { useState, useEffect } from 'react';
import { Dashboard } from '../screens/dashboard';
import { AddressSpaceSection } from '../screens/address-space/AddressSpaceSection';
import { SecuritySettings } from '../screens/security/SecuritySettings';
import { ConnectorsManager } from '../screens/connectors/ConnectorsManager';
import { NavBar, NavButton } from './NavBar';
import { StatusBar } from './StatusBar';
import { useSSE } from '../hooks/useSSE';

type Section = 'dashboard' | 'address-space' | 'security' | 'connectors';

const NAV_ITEMS: Array<{ id: Section; label: string; icon: string }> = [
  { id: 'dashboard', label: 'Dashboard', icon: '📊' },
  { id: 'address-space', label: 'Address Space', icon: '🌐' },
  { id: 'security', label: 'Security', icon: '🔒' },
  { id: 'connectors', label: 'Connectors', icon: '🔌' },
];

function App() {
  const { connectionState } = useSSE();
  const [activeSection, setActiveSection] = useState<Section>('dashboard');

  const backendDown = connectionState === 'disconnected';

  // Listen for custom navigation events (e.g., from S7 link in NodeForm)
  useEffect(() => {
    const handler = (e: Event) => {
      const section = (e as CustomEvent).detail as Section;
      if (section) setActiveSection(section);
    };
    window.addEventListener('navigate', handler);
    return () => window.removeEventListener('navigate', handler);
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 pb-6">
      <NavBar title="OPC UA Light Server">
        {NAV_ITEMS.map((item) => (
          <NavButton
            key={item.id}
            icon={item.icon}
            label={item.label}
            active={activeSection === item.id}
            onClick={() => setActiveSection(item.id)}
          />
        ))}
      </NavBar>

      {/* Stale data warning banner when backend is unreachable */}
      {backendDown && (
        <div
          role="alert"
          className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-center text-sm text-amber-800"
        >
          <span className="font-medium">Connection lost</span> — The data displayed may be outdated. Reconnecting to server...
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 py-8">
        {activeSection === 'dashboard' && <Dashboard />}
        {activeSection === 'address-space' && <AddressSpaceSection />}
        {activeSection === 'security' && <SecuritySettings />}
        {activeSection === 'connectors' && <ConnectorsManager />}
      </main>

      <StatusBar connectionState={connectionState} />
    </div>
  );
}

export default App;
