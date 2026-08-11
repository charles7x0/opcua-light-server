import { Card, CardHeader } from '../layout/Card';

interface CardPlaceholderProps {
  /** Title shown in the CardHeader */
  title: string;
  /** Message body — e.g., "Loading..." or "Unable to load data" */
  message: string;
  /** Whether to show a pulse animation (used for loading states) */
  animate?: boolean;
}

/**
 * A standardized empty/loading/error state for Card-based panels.
 * Eliminates duplicated Card+CardHeader+message patterns across dashboard panels.
 */
export function CardPlaceholder({ title, message, animate = false }: CardPlaceholderProps) {
  return (
    <Card>
      <CardHeader>{title}</CardHeader>
      <p className={`text-sm text-gray-400 ${animate ? 'animate-pulse' : ''}`}>
        {message}
      </p>
    </Card>
  );
}
