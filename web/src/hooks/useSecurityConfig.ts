import { useQuery } from '@tanstack/react-query';
import { getSecurityConfig, type SecurityConfig } from '../api';

/**
 * Centralized hook for security configuration data.
 * Single source of truth for query key and configuration.
 */
export function useSecurityConfig() {
  return useQuery<SecurityConfig>({
    queryKey: ['security'],
    queryFn: getSecurityConfig,
    refetchInterval: 30_000,
    retry: 1,
  });
}
