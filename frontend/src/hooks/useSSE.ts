import { useEffect, useRef, useState, useCallback } from 'react';
import type { ProgressEvent } from '../types';

/**
 * Hook that subscribes to SSE progress events for a given document.
 */
export function useSSE(documentId: string | null) {
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  const connect = useCallback(() => {
    if (!documentId) return;

    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const evtSource = new EventSource(`/api/progress/${documentId}`);
    eventSourceRef.current = evtSource;

    evtSource.onopen = () => {
      setIsConnected(true);
    };

    evtSource.addEventListener('progress', (event) => {
      try {
        const data: ProgressEvent = JSON.parse(event.data);
        setProgress(data);
      } catch (e) {
        console.error('Failed to parse SSE event:', e);
      }
    });

    evtSource.addEventListener('done', () => {
      evtSource.close();
      setIsConnected(false);
    });

    evtSource.onerror = () => {
      evtSource.close();
      setIsConnected(false);
    };
  }, [documentId]);

  useEffect(() => {
    connect();
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [connect]);

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
      setIsConnected(false);
    }
  }, []);

  return { progress, isConnected, disconnect, reconnect: connect };
}
