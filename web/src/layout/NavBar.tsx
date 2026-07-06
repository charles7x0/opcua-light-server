import { ReactNode } from 'react';

// ─── NavButton ────────────────────────────────────────────────────────────────

interface NavButtonProps {
  icon: string;
  label: string;
  active?: boolean;
  onClick: () => void;
}

export function NavButton({ icon, label, active = false, onClick }: NavButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
        active
          ? 'bg-blue-50 text-blue-700'
          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
      }`}
      aria-current={active ? 'page' : undefined}
    >
      <span className="mr-1.5" aria-hidden="true">{icon}</span>
      {label}
    </button>
  );
}

// ─── NavBar ───────────────────────────────────────────────────────────────────

interface NavBarProps {
  title: ReactNode;
  children: ReactNode;
}

/**
 * Application header with title and navigation slot.
 */
export function NavBar({ title, children }: NavBarProps) {
  return (
    <header className="bg-white shadow-sm border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <h1 className="text-xl font-semibold text-gray-900">
            {title}
          </h1>
          <nav className="flex gap-1" aria-label="Main navigation">
            {children}
          </nav>
        </div>
      </div>
    </header>
  );
}
