import { useState, useRef, useEffect } from 'react';
import { getSystemLogs, type LogEntry } from '../api';
import { Button } from '../components';
import {
  type LogLevel,
  LOG_LEVELS,
  LOG_LEVEL_COLORS,
  LOG_LEVEL_BTN,
  LOG_PANEL_BASE,
  LOG_TOOLBAR,
  LOG_CONTENT,
  LOG_ENTRY_TIMESTAMP,
  LOG_ENTRY_SOURCE,
  LOG_AUTOSCROLL_BTN,
} from '../components/styles';

interface LogPanelProps {
  open: boolean;
  onClose: () => void;
}

export function LogPanel({ open, onClose }: LogPanelProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [activeLevels, setActiveLevels] = useState<Set<LogLevel>>(new Set(['info', 'warn', 'error']));
  const logContainerRef = useRef<HTMLDivElement>(null);
  const lastTimestampRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!open) return;
    let active = true;

    async function fetchLogs() {
      try {
        const newLogs = await getSystemLogs({ since: lastTimestampRef.current });
        if (!active) return;
        if (newLogs.length > 0) {
          setLogs((prev) => [...prev, ...newLogs].slice(-1000));
          lastTimestampRef.current = newLogs[newLogs.length - 1].timestamp;
        }
      } catch {
        // ignore
      }
    }

    fetchLogs();
    const interval = setInterval(fetchLogs, 2000);
    return () => { active = false; clearInterval(interval); };
  }, [open]);

  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  function handleScroll() {
    if (!logContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = logContainerRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 50);
  }

  function toggleLevel(level: LogLevel) {
    setActiveLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  }

  if (!open) return null;

  const filteredLogs = logs.filter((e) => activeLevels.has(e.level));

  return (
    <div className={LOG_PANEL_BASE}>
      {/* Toolbar */}
      <div className={LOG_TOOLBAR}>
        <div className="flex items-center gap-2">
          <span className="font-medium">System Log</span>
          <div className="flex items-center gap-0.5 ml-2">
            {LOG_LEVELS.map((level) => (
              <Button
                key={level}
                variant="ghost-dark"
                size="xs"
                onClick={() => toggleLevel(level)}
                className={`uppercase ${
                  activeLevels.has(level) ? LOG_LEVEL_BTN[level].active : LOG_LEVEL_BTN[level].inactive
                }`}
              >
                {level}
              </Button>
            ))}
          </div>
          <span className="text-gray-500 ml-2">{filteredLogs.length} entries</span>
        </div>
        <div className="flex items-center gap-3">
          {!autoScroll && (
            <Button variant="ghost-dark" size="xs" onClick={() => setAutoScroll(true)} className={LOG_AUTOSCROLL_BTN}>
              ↓ Auto-scroll
            </Button>
          )}
          <Button variant="ghost-dark" size="xs" onClick={() => { setLogs([]); lastTimestampRef.current = undefined; }}>
            Clear
          </Button>
          <Button variant="ghost-dark" size="xs" onClick={onClose}>
            ✕
          </Button>
        </div>
      </div>

      {/* Log content */}
      <div ref={logContainerRef} onScroll={handleScroll} className={LOG_CONTENT}>
        {filteredLogs.length === 0 ? (
          <p className="text-gray-500 py-4 text-center font-sans">No log entries matching the selected filters.</p>
        ) : (
          filteredLogs.map((entry, i) => (
            <div key={i} className="py-0.5 leading-tight">
              <span className={LOG_ENTRY_TIMESTAMP}>[{new Date(entry.timestamp).toLocaleTimeString()}]</span>{' '}
              <span className={LOG_ENTRY_SOURCE}>{entry.source}</span>{' '}
              <span className={LOG_LEVEL_COLORS[entry.level]}>{entry.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
