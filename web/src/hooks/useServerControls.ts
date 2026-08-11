import { useMutation, useQueryClient } from '@tanstack/react-query';
import { startServer, stopServer, reloadServer } from '../api';

/**
 * Encapsulates start/stop/reload mutations for the OPC UA runtime.
 * Handles cache invalidation on success.
 */
export function useServerControls() {
  const queryClient = useQueryClient();

  const invalidate = (): void => {
    queryClient.invalidateQueries({ queryKey: ['serverStatus'] });
    queryClient.invalidateQueries({ queryKey: ['server', 'clients'] });
  };

  const start = useMutation({
    mutationFn: startServer,
    onSuccess: invalidate,
  });

  const stop = useMutation({
    mutationFn: stopServer,
    onSuccess: invalidate,
  });

  const reload = useMutation({
    mutationFn: reloadServer,
    onSuccess: invalidate,
  });

  const isMutating = start.isPending || stop.isPending || reload.isPending;

  const error = start.error?.message ?? stop.error?.message ?? reload.error?.message ?? null;

  return { start, stop, reload, isMutating, error };
}
