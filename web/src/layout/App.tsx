import { useState, useEffect } from 'react';
import { Dashboard } from '../screens/dashboard/Dashboard';
import { AddressSpaceSection } from '../screens/address-space/AddressSpaceSection';
import { SecuritySettings } from '../screens/security/SecuritySettings';
import { S7ConnectionManager } from '../screens/s7/S7ConnectionManager';
import { NavBar, NavButton } from './NavBar';
import { StatusBar } from './StatusBar';

type Section = 'dashboard' | 'address-space' | 'security' | 's7';

const NAV_ITEMS: Array<{ id: Section; label: string; icon: string }> = [
  { id: 'dashboard', label: 'Dashboard', icon: '📊' },
  { id: 'address-space', label: 'Address Space', icon: '🌐' },
  { id: 'security', label: 'Security', icon: '🔒' },
  { id: 's7', label: 'S7 Connector', icon: '🔌' },
];

function App() {
  const [activeSection, setActiveSection] = useState<Section>('dashboard');

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

      <main className="max-w-7xl mx-auto px-4 py-8">
        {activeSection === 'dashboard' && <Dashboard />}
        {activeSection === 'address-space' && <AddressSpaceSection />}
        {activeSection === 'security' && <SecuritySettings />}
        {activeSection === 's7' && <S7ConnectionManager />}
      </main>

      <StatusBar />
    </div>
  );
}

export default App;
