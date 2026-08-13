import { readdir, stat, access } from 'fs/promises';
import { join } from 'path';
import { pathToFileURL } from 'url';

import { logService } from '../log/index.js';
import { Connector, ConnectorType, ConnectorMetadata } from './types.js';

const LOG_SOURCE = 'PluginLoader';

/** Result of the plugin loading process. */
export interface LoadResult {
  loaded: PluginInfo[];
  skipped: SkippedPlugin[];
}

export interface PluginInfo {
  type: ConnectorType;
  displayName: string;
  source: 'built-in' | 'external';
  connector: Connector;
  metadata: ConnectorMetadata;
}

export interface SkippedPlugin {
  directory: string;
  reason: string;
}

/**
 * Validate that a dynamically imported module exports a valid connector.
 * Uses lightweight duck-typing: checks for getType() and getMetadata() methods.
 */
export function validateConnectorModule(
  mod: Record<string, unknown>
): { valid: true; ConnectorClass: new () => Connector } | { valid: false; reason: string } {
  // Look for default export or any named export that is a class/function
  const candidates: unknown[] = [];

  if (mod.default != null) {
    candidates.push(mod.default);
  }

  for (const [key, value] of Object.entries(mod)) {
    if (key === 'default') continue;
    if (typeof value === 'function') {
      candidates.push(value);
    }
  }

  if (candidates.length === 0) {
    return { valid: false, reason: 'no valid Connector export found' };
  }

  for (const candidate of candidates) {
    if (typeof candidate !== 'function') continue;

    let instance: unknown;
    try {
      instance = new (candidate as new () => unknown)();
    } catch {
      // Not instantiable, try next candidate
      continue;
    }

    // Duck-type check: must have getType() method
    if (typeof (instance as Record<string, unknown>).getType !== 'function') {
      continue;
    }

    // Duck-type check: must have getMetadata() method
    if (typeof (instance as Record<string, unknown>).getMetadata !== 'function') {
      return { valid: false, reason: 'missing getMetadata method' };
    }

    return { valid: true, ConnectorClass: candidate as new () => Connector };
  }

  // If we found candidates but none had getType, check if any had getType without getMetadata
  for (const candidate of candidates) {
    if (typeof candidate !== 'function') continue;

    let instance: unknown;
    try {
      instance = new (candidate as new () => unknown)();
    } catch {
      continue;
    }

    if (typeof (instance as Record<string, unknown>).getType === 'function') {
      if (typeof (instance as Record<string, unknown>).getMetadata !== 'function') {
        return { valid: false, reason: 'missing getMetadata method' };
      }
    }
  }

  return { valid: false, reason: 'no valid Connector export found' };
}

/**
 * Scan a single directory for connector plugins.
 */
async function scanDirectory(
  dir: string,
  source: 'built-in' | 'external',
  registeredTypes: Map<ConnectorType, string>,
  loaded: PluginInfo[],
  skipped: SkippedPlugin[]
): Promise<void> {
  let entries: string[];
  try {
    const dirEntries = await readdir(dir, { withFileTypes: true });
    entries = dirEntries
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logService.warn(LOG_SOURCE, `Cannot read directory "${dir}": ${message}`);
    return;
  }

  for (const name of entries) {
    const subDir = join(dir, name);
    const entryPoint = join(subDir, 'index.js');

    // Check if index.js exists
    try {
      await access(entryPoint);
    } catch {
      skipped.push({ directory: name, reason: 'no entry point found' });
      logService.debug(LOG_SOURCE, `Skipped "${name}": no entry point found`);
      continue;
    }

    // Dynamic import
    let mod: Record<string, unknown>;
    try {
      const fileUrl = pathToFileURL(entryPoint).href;
      mod = await import(fileUrl) as Record<string, unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      skipped.push({ directory: name, reason: `failed to import: ${message}` });
      logService.warn(LOG_SOURCE, `Skipped "${name}": failed to import: ${message}`);
      continue;
    }

    // Validate module exports
    const validation = validateConnectorModule(mod);
    if (!validation.valid) {
      skipped.push({ directory: name, reason: validation.reason });
      logService.warn(LOG_SOURCE, `Skipped "${name}": ${validation.reason}`);
      continue;
    }

    // Instantiate the connector
    let connector: Connector;
    try {
      connector = new validation.ConnectorClass();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      skipped.push({ directory: name, reason: `failed to instantiate: ${message}` });
      logService.warn(LOG_SOURCE, `Skipped "${name}": failed to instantiate: ${message}`);
      continue;
    }

    // Get metadata
    let metadata: ConnectorMetadata;
    try {
      metadata = (connector as unknown as { getMetadata(): ConnectorMetadata }).getMetadata();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      skipped.push({ directory: name, reason: `getMetadata() threw: ${message}` });
      logService.warn(LOG_SOURCE, `Skipped "${name}": getMetadata() threw: ${message}`);
      continue;
    }

    const connectorType = connector.getType();

    // Check for duplicate types (first-registered wins)
    if (registeredTypes.has(connectorType)) {
      const existingDir = registeredTypes.get(connectorType)!;
      skipped.push({
        directory: name,
        reason: `type '${connectorType}' already registered by '${existingDir}'`,
      });
      logService.warn(
        LOG_SOURCE,
        `Skipped "${name}": type '${connectorType}' already registered by '${existingDir}'`
      );
      continue;
    }

    // Register the connector
    registeredTypes.set(connectorType, name);
    loaded.push({
      type: connectorType,
      displayName: metadata.displayName,
      source,
      connector,
      metadata,
    });
    logService.info(LOG_SOURCE, `Loaded ${source} plugin "${name}" (type: ${connectorType})`);
  }
}

/**
 * Scan directories for connector plugins, validate exports,
 * instantiate connectors, and return load results.
 *
 * @param builtInDir - Path to built-in connectors (src/connectors/)
 * @param externalDir - Optional path from CONNECTOR_PLUGINS_DIR env var
 * @returns LoadResult with loaded plugins and skipped entries
 */
export async function loadPlugins(
  builtInDir: string,
  externalDir?: string
): Promise<LoadResult> {
  const loaded: PluginInfo[] = [];
  const skipped: SkippedPlugin[] = [];
  const registeredTypes = new Map<ConnectorType, string>();

  // Scan built-in directory first (takes precedence)
  await scanDirectory(builtInDir, 'built-in', registeredTypes, loaded, skipped);

  // Scan external directory if provided
  if (externalDir) {
    // Check if external directory exists and is readable
    try {
      const dirStat = await stat(externalDir);
      if (!dirStat.isDirectory()) {
        logService.warn(LOG_SOURCE, `External plugins path "${externalDir}" is not a directory`);
      } else {
        await scanDirectory(externalDir, 'external', registeredTypes, loaded, skipped);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logService.warn(
        LOG_SOURCE,
        `External plugins directory "${externalDir}" not accessible: ${message}`
      );
    }
  }

  logService.info(
    LOG_SOURCE,
    `Plugin loading complete: ${loaded.length} loaded, ${skipped.length} skipped`
  );

  return { loaded, skipped };
}
