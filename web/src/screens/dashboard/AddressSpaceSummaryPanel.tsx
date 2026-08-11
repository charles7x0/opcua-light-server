import { useQuery } from '@tanstack/react-query';
import { getNodes, getNamespaces } from '../../api';
import { Card, CardHeader, InfoRow, CardPlaceholder } from '../../components';

export function AddressSpaceSummaryPanel() {
  const { data: nodes = [], isLoading: loadingNodes, isError: errorNodes } = useQuery({
    queryKey: ['nodes'],
    queryFn: getNodes,
  });

  const { data: namespaces = [], isLoading: loadingNs, isError: errorNs } = useQuery({
    queryKey: ['namespaces'],
    queryFn: getNamespaces,
  });

  const isLoading = loadingNodes || loadingNs;
  const isError = errorNodes || errorNs;

  if (isLoading) {
    return <CardPlaceholder title="Address Space" message="Loading..." animate />;
  }

  if (isError) {
    return <CardPlaceholder title="Address Space" message="Unable to load address space" />;
  }

  return (
    <Card>
      <CardHeader>Address Space</CardHeader>
      <div className="space-y-3">
        <InfoRow label="Nodes">{nodes.length}</InfoRow>
        <InfoRow label="Namespaces">{namespaces.length}</InfoRow>
      </div>
    </Card>
  );
}
