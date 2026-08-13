"use client";

import { useEffect, useState } from "react";
import { browserNetworkStatus } from "../infrastructure/browser-platform-ports";

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(browserNetworkStatus.isOnline());
    const dispose = browserNetworkStatus.subscribe(setOnline);
    update();
    return dispose;
  }, []);
  return online;
}
