"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  browserOriginStoragePersistenceClient,
  type BrowserOriginStoragePersistenceClient,
  type BrowserOriginStoragePersistenceStatus,
} from "../../infrastructure/browser-origin-storage-persistence";

type BrowserStorageStatus = "checking" | BrowserOriginStoragePersistenceStatus;

export function useBrowserOriginStoragePersistence(): {
  status: BrowserStorageStatus;
  requesting: boolean;
  request: () => Promise<void>;
} {
  const clientRef = useRef<BrowserOriginStoragePersistenceClient>(browserOriginStoragePersistenceClient);
  const [status, setStatus] = useState<BrowserStorageStatus>("checking");
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    let active = true;
    void clientRef.current.readStatus().then((nextStatus) => {
      if (active) setStatus(nextStatus);
    });
    return () => {
      active = false;
    };
  }, []);

  const request = useCallback(async () => {
    setRequesting(true);
    setStatus(await clientRef.current.request());
    setRequesting(false);
  }, []);

  return { status, requesting, request };
}
