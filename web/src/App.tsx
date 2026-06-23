import { useState, useEffect } from 'react';
import { Dashboard } from './screens/dashboard/Dashboard';
import { AddressSpaceSection } from './screens/address-space/AddressSpaceSection';
import { SecuritySettings } from './screens/security/SecuritySettings';
import { S7ConnectionManager } from './screens/s7/S7ConnectionManager';
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
      {/* Header with navigation */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center justify-between h-16">
            <h1 className="text-xl font-semibold text-gray-900">
              OPC UA Light Server
            </h1>
            <nav className="flex gap-1" aria-label="Main navigation">
              {NAV_ITEMS.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setActiveSection(item.id)}
                  className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    activeSection === item.id
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                  }`}
                  aria-current={activeSection === item.id ? 'page' : undefined}
                >
                  <span className="mr-1.5" aria-hidden="true">{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </nav>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        {activeSection === 'dashboard' && <Dashboard />}
        {activeSection === 'address-space' && <AddressSpaceSection />}
        {activeSection === 'security' && <SecuritySettings />}
        {activeSection === 's7' && <S7ConnectionManager />}
      </main>

      {/* Status bar */}
      <StatusBar />
    </div>
  );
}

export default App;
