"use client";

import { useState, useEffect } from "react";
import type { Platform } from "@/lib/admin/types";

export function usePlatforms(category: "social" | "ads") {
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/content/platforms?for=${category}`)
      .then((res) => res.json())
      .then((json) => {
        if (!cancelled && json.success) setPlatforms(json.data || []);
      })
      .catch(() => { /* silent */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [category]);

  return { platforms, names: platforms.map((p) => p.name), loading };
}
