import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getNamespaces,
  getObjectNodeTree,
  Namespace,
  ObjectNode,
  OpcUaNode,
} from '../api';

/**
 * Resolves full display paths for OPC UA nodes by walking the object-node tree.
 * Returns a `getNodePath` function that produces "Namespace / Object / NodeName" strings.
 */
export function useNodePaths(): {
  namespaces: Namespace[];
  getNodePath: (node: OpcUaNode) => string;
} {
  const { data: namespaces = [] } = useQuery<Namespace[]>({
    queryKey: ['namespaces'],
    queryFn: getNamespaces,
  });

  const [objPaths, setObjPaths] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    async function load(): Promise<void> {
      const paths = new Map<string, string>();
      for (const ns of namespaces) {
        try {
          const tree = await getObjectNodeTree(ns.id);
          function walk(nodes: ObjectNode[], prefix: string): void {
            for (const n of nodes) {
              const p = prefix ? `${prefix} / ${n.name}` : n.name;
              paths.set(n.id, `${ns.name} / ${p}`);
              if (n.children) walk(n.children, p);
            }
          }
          walk(tree, '');
        } catch { /* ignore */ }
      }
      setObjPaths(paths);
    }
    if (namespaces.length > 0) load();
  }, [namespaces]);

  function getNodePath(node: OpcUaNode): string {
    const ns = namespaces.find((n) => n.id === node.namespaceId);
    const nsName = ns?.name ?? '';
    if (node.objectNodeId) {
      const op = objPaths.get(node.objectNodeId);
      return op ? `${op} / ${node.name}` : `${nsName} / ${node.name}`;
    }
    return `${nsName} / ${node.name}`;
  }

  return { namespaces, getNodePath };
}
