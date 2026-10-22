"use client";
import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

export function PageViewTracker({ gaId }: { gaId: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  useEffect(() => {
    const url = pathname + (searchParams?.toString() ? `?${searchParams}` : "");
    (window as unknown as { gtag?: (...a: unknown[]) => void }).gtag?.("config", gaId, {
      page_path: url,
    });
  }, [pathname, searchParams, gaId]);
  return null;
}
