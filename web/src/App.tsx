import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dashboard } from './components/Dashboard';
import AddressSpaceTree, { SelectedNode } from './components/AddressSpaceTree';
import NodeDetailPanel from './components/NodeDetailPanel';
import { NodeForm } from './components/NodeForm';
import { NamespaceManager } from './components/NamespaceManager';
import { SecuritySettings } from './components/SecuritySettings';
import { S7ConnectionManager } from './components/S7ConnectionManager';
import { StatusBar } from './components/StatusBar';
import { deleteNode } from './api';

type Section = 'dashboard' | 'address-space' | 'security' | 's7';

const NAV_ITEMS: Array<{ id: Section; label: string; icon: string }> = [
  { id: 'dashboard', label: 'Dashboard', icon: '📊' },
  { id: 'address-space', label: 'Address Space', icon: '🌐' },
  { id: 'security', label: 'Security', icon: '🔒' },
  { id: 's7', label: 'S7 Connector', icon: '🔌' },
];

function CreateNodeSplitButton({
  onCreateVariable,
  onCreateObjectNode,
}: {
  onCreateVariable: () => void;
  onCreateObjectNode: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative inline-block">
      <div className="flex">
        <button
          onClick={onCreateVariable}
          className="rounded-l-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
        >
          Create Variable Node
        </button>
        <button
          onClick={() => setOpen(!open)}
          className="rounded-r-md bg-green-700 px-2 py-2 text-sm font-medium text-white hover:bg-green-800 border-l border-green-500"
          aria-label="More create options"
        >
          ▾
        </button>
      </div>
      {open && (
        <div className="absolute left-0 mt-1 w-56 rounded-md bg-white shadow-lg border border-gray-200 z-10">
          <button
            onClick={() => { onCreateVariable(); setOpen(false); }}
            className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
          >
            🔹 Create Variable Node
          </button>
          <button
            onClick={() => { onCreateObjectNode(); setOpen(false); }}
            className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
          >
            📦 Create Object Node (subfolder)
          </button>
        </div>
      )}
    </div>
  );
}

function AddressSpaceSection() {
  const [selectedNode, setSelectedNode] = useState<SelectedNode | null>(null);
  const [showNodeForm, setShowNodeForm] = useState(false);
  const [editingNode, setEditingNode] = useState<SelectedNode | null>(null);
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteNode(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nodes'] });
      queryClient.invalidateQueries({ queryKey: ['namespaces'] });
      setSelectedNode(null);
    },
  });

  function handleDeleteNode() {
    if (!selectedNode) return;
    if (confirm(`Delete variable node "${selectedNode.node.name}"? This cannot be undone.`)) {
      deleteMutation.mutate(selectedNode.node.id);
    }
  }

  return (
    <div className="space-y-6">
      <NamespaceManager />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Tree panel */}
        <div className="lg:col-span-1 bg-white rounded-lg border border-gray-200 overflow-hidden">
          <AddressSpaceTree
            onNodeSelect={(selection) => {
              setSelectedNode(selection);
              setShowNodeForm(false);
              setEditingNode(null);
            }}
            selectedNodeId={selectedNode?.node.id}
          />
        </div>

        {/* Detail / Form panel */}
        <div className="lg:col-span-2 bg-white rounded-lg border border-gray-200 overflow-hidden">
          {showNodeForm || editingNode ? (
            <div className="p-4">
              <NodeForm
                node={editingNode?.node}
                onSuccess={() => {
                  setShowNodeForm(false);
                  setEditingNode(null);
                  setSelectedNode(null);
                }}
                onCancel={() => {
                  setShowNodeForm(false);
                  setEditingNode(null);
                }}
              />
            </div>
          ) : (
            <>
              <NodeDetailPanel selection={selectedNode} />
              {selectedNode && (
                <div className="px-4 pb-4 flex gap-2">
                  <button
                    onClick={() => setEditingNode(selectedNode)}
                    className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
                  >
                    Edit Node
                  </button>
                  <button
                    onClick={handleDeleteNode}
                    disabled={deleteMutation.isPending}
                    className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {deleteMutation.isPending ? 'Deleting...' : 'Delete Node'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Create node split button */}
      {!showNodeForm && !editingNode && (
        <CreateNodeSplitButton
          onCreateVariable={() => {
            setShowNodeForm(true);
            setSelectedNode(null);
          }}
          onCreateObjectNode={() => {
            // Scroll to the tree where the inline "+" buttons are
            alert('Use the "+" button on a namespace or object node in the tree above to create an object node (subfolder).');
          }}
        />
      )}
    </div>
  );
}

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
