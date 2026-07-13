import { useState } from 'react';
import { exportConnectorMappingsCsv, importConnectorMappingsCsv, ConnectorMappingImportResult } from '../../api';
import { Button, Alert, FileButton } from '../../components';
import { downloadTextAsFile } from '../../utils/downloadFile';

interface CsvImportExportProps {
  onImportComplete: () => void;
}

export function CsvImportExport({ onImportComplete }: CsvImportExportProps) {
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<ConnectorMappingImportResult | null>(null);
  const [importError, setImportError] = useState('');

  async function handleExport(): Promise<void> {
    setIsExporting(true);
    try {
      const csv = await exportConnectorMappingsCsv();
      downloadTextAsFile(csv, 'connector-mappings.csv');
    } catch (e) {
      alert('Export failed: ' + (e instanceof Error ? e.message : 'Unknown error'));
    } finally {
      setIsExporting(false);
    }
  }

  async function handleImport(file: File): Promise<void> {
    setIsImporting(true);
    setImportResult(null);
    setImportError('');
    try {
      const text = await file.text();
      const result = await importConnectorMappingsCsv(text);
      setImportResult(result);
      onImportComplete();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" onClick={handleExport} disabled={isExporting}>
          {isExporting ? 'Exporting...' : '📥 Export Mappings CSV'}
        </Button>
        <FileButton accept=".csv,text/csv" disabled={isImporting} size="sm" onFileSelect={handleImport}>
          {isImporting ? 'Importing...' : '📤 Import Mappings CSV'}
        </FileButton>
      </div>

      {importResult && (
        <Alert variant={importResult.summary.failed > 0 ? 'warning' : 'success'} onDismiss={() => setImportResult(null)}>
          Import complete: {importResult.summary.succeeded} succeeded, {importResult.summary.failed} failed out of {importResult.summary.total} rows.
          {importResult.summary.failed > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs max-h-32 overflow-y-auto">
              {importResult.results.filter((r) => !r.success).map((r) => (
                <li key={r.row}>Row {r.row}{r.deviceAddress ? ` (${r.deviceAddress})` : ''}: {r.error}</li>
              ))}
            </ul>
          )}
        </Alert>
      )}
      {importError && <Alert variant="error" onDismiss={() => setImportError('')}>{importError}</Alert>}
    </div>
  );
}
