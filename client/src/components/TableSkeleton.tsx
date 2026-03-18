import { Skeleton } from "@/components/ui/skeleton";

interface TableSkeletonProps {
  /** Number of data rows to show (default 8) */
  rows?: number;
  /** Number of columns to show (default 10) */
  cols?: number;
  /** Title shown above the skeleton */
  title?: string;
  /** Whether to show a header row with column skeletons */
  showHeader?: boolean;
}

/**
 * Reusable skeleton loader for data tables.
 * Matches the visual structure of the planning grids (sticky first col, many month cols).
 */
export function TableSkeleton({ rows = 8, cols = 10, title, showHeader = true }: TableSkeletonProps) {
  return (
    <div className="space-y-3 animate-pulse">
      {/* Page title area */}
      <div className="flex items-center justify-between pb-2">
        <div className="space-y-1.5">
          {title ? (
            <div className="text-sm font-medium text-muted-foreground">{title}</div>
          ) : (
            <Skeleton className="h-6 w-48" />
          )}
          <Skeleton className="h-3.5 w-32" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-24 rounded-md" />
          <Skeleton className="h-8 w-24 rounded-md" />
        </div>
      </div>

      {/* Table skeleton */}
      <div className="rounded-lg border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            {showHeader && (
              <thead>
                <tr className="bg-muted/50 border-b">
                  {/* First two cols (SKU name + weight) */}
                  <th className="p-2 text-left w-48">
                    <Skeleton className="h-4 w-32" />
                  </th>
                  <th className="p-2 text-left w-20">
                    <Skeleton className="h-4 w-12" />
                  </th>
                  {/* Month columns */}
                  {Array.from({ length: cols - 2 }).map((_, i) => (
                    <th key={i} className="p-2 text-center w-20">
                      <Skeleton className="h-4 w-14 mx-auto" />
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {Array.from({ length: rows }).map((_, rowIdx) => (
                <tr
                  key={rowIdx}
                  className={rowIdx % 2 === 0 ? "bg-background" : "bg-muted/20"}
                >
                  {/* SKU name cell */}
                  <td className="p-2">
                    <Skeleton className={`h-4 ${rowIdx % 3 === 0 ? "w-40" : rowIdx % 3 === 1 ? "w-36" : "w-44"}`} />
                  </td>
                  {/* Weight / category cell */}
                  <td className="p-2">
                    <Skeleton className="h-4 w-10" />
                  </td>
                  {/* Data cells */}
                  {Array.from({ length: cols - 2 }).map((_, colIdx) => (
                    <td key={colIdx} className="p-2 text-center">
                      <Skeleton className="h-4 w-12 mx-auto" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-2 pt-1">
        <div className="h-2 w-2 rounded-full bg-primary/30 animate-ping" />
        <span className="text-xs text-muted-foreground">Loading data…</span>
      </div>
    </div>
  );
}

/**
 * Full-page loading overlay for initial page load.
 * Shows a centered spinner with a descriptive message.
 */
export function PageLoader({ message = "Loading…" }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4">
      <div className="relative">
        <div className="h-12 w-12 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-4 w-4 rounded-full bg-primary/30 animate-pulse" />
        </div>
      </div>
      <p className="text-sm text-muted-foreground font-medium">{message}</p>
    </div>
  );
}

/**
 * Inline row skeleton for when a single row is being refreshed.
 */
export function RowSkeleton({ cols = 10 }: { cols?: number }) {
  return (
    <tr className="animate-pulse">
      <td className="p-2"><Skeleton className="h-4 w-36" /></td>
      <td className="p-2"><Skeleton className="h-4 w-10" /></td>
      {Array.from({ length: cols - 2 }).map((_, i) => (
        <td key={i} className="p-2 text-center"><Skeleton className="h-4 w-12 mx-auto" /></td>
      ))}
    </tr>
  );
}

/**
 * Compact card skeleton for dashboard stat cards.
 */
export function StatCardSkeleton() {
  return (
    <div className="rounded-xl border bg-card p-4 space-y-3 animate-pulse">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-8 rounded-lg" />
      </div>
      <Skeleton className="h-8 w-16" />
      <Skeleton className="h-3 w-32" />
    </div>
  );
}
