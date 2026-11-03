import React from 'react';
import { UploadCloud } from 'lucide-react';
import type { UploadProgressEvent } from '../types/shared';

interface ActiveUploadsBannerProps {
  activeProgressMap: Record<string, UploadProgressEvent>;
}

function formatMegabytes(bytes: number): string {
  if (bytes <= 1) return '0 MB';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const ActiveUploadsBanner: React.FC<ActiveUploadsBannerProps> = ({
  activeProgressMap,
}) => {
  const entries = Object.values(activeProgressMap);
  if (entries.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="Active Chunked Uploads"
      aria-live="polite"
      className="space-y-3 rounded-xl border border-indigo-500/40 bg-indigo-950/30 p-4"
    >
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-indigo-300">
        <UploadCloud className="h-4 w-4 animate-pulse" aria-hidden="true" />
        <span>Live Resumable Chunk Transfer</span>
      </div>

      <div className="space-y-3">
        {entries.map((item) => {
          const key = `${item.jobId}:${item.platform}`;
          const progressId = `progress-${key}`;
          const hue = item.percent >= 100 ? 145 : item.platform === 'youtube' ? 0 : 220;

          return (
            <div
              key={key}
              className="rounded-lg border border-studio-border bg-studio-panel p-3"
            >
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                <label htmlFor={progressId} className="font-medium text-slate-200">
                  <span className="mr-2 rounded bg-slate-800 px-2 py-0.5 text-[11px] uppercase text-slate-300">
                    {item.platform}
                  </span>
                  {item.phase}
                </label>

                <span className="font-mono text-slate-300">
                  {formatMegabytes(item.bytesUploaded)} / {formatMegabytes(item.totalBytes)} (
                  {item.percent}%)
                </span>
              </div>

              <progress
                id={progressId}
                className="upload-progress-bar"
                value={item.percent}
                max={100}
                style={{ '--brand-hue': hue } as React.CSSProperties}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
};

