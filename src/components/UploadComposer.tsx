import React, { useId, useMemo, useState } from 'react';
import {
  CalendarClock,
  Film,
  FolderOpen,
  Send,
  Trash2,
  Upload,
} from 'lucide-react';
import type {
  ConnectedAccountsState,
  CreateUploadJobPayload,
  MediaFileSelection,
  Platform,
  YouTubePrivacy,
} from '../types/shared';

interface UploadComposerProps {
  accounts: ConnectedAccountsState;
  onCreateJob: (payload: CreateUploadJobPayload) => Promise<void>;
}

function getDefaultScheduleLocalValue(): string {
  const future = new Date(Date.now() + 60 * 60 * 1000); // +1 hour from now
  future.setSeconds(0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(
    future.getDate()
  )}T${pad(future.getHours())}:${pad(future.getMinutes())}`;
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const UploadComposer: React.FC<UploadComposerProps> = ({
  accounts,
  onCreateJob,
}) => {
  const formId = useId();
  const localTimeZone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    []
  );

  const [media, setMedia] = useState<MediaFileSelection | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const [platforms, setPlatforms] = useState<Platform[]>(['youtube', 'facebook']);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tagsRaw, setTagsRaw] = useState('');
  const [youtubePrivacy, setYoutubePrivacy] = useState<YouTubePrivacy>('private');
  const [publishMode, setPublishMode] = useState<'schedule' | 'now'>('schedule');
  const [scheduledLocal, setScheduledLocal] = useState<string>(
    getDefaultScheduleLocalValue
  );

  const [titleError, setTitleError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const parsedTags = useMemo(
    () =>
      tagsRaw
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    [tagsRaw]
  );

  const togglePlatform = (platform: Platform) => {
    setFormError(null);
    setPlatforms((prev) =>
      prev.includes(platform) ? prev.filter((p) => p !== platform) : [...prev, platform]
    );
  };

  const handleBrowseFile = async () => {
    setFormError(null);
    try {
      const picked = await window.desktopApi.pickMediaFile();
      if (picked) {
        setMedia(picked);
        if (!title.trim()) {
          const baseName = picked.fileName.replace(/\.[^.]+$/, '');
          setTitle(baseName.slice(0, 100));
          setTitleError(null);
        }
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    setFormError(null);

    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    try {
      const localPath = window.desktopApi.resolveDroppedFilePath(file);
      const inspected = await window.desktopApi.inspectMediaPath(localPath);
      setMedia(inspected);
      if (!title.trim()) {
        const baseName = inspected.fileName.replace(/\.[^.]+$/, '');
        setTitle(baseName.slice(0, 100));
        setTitleError(null);
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleTitleBlur = () => {
    if (!title.trim()) {
      setTitleError('Enter a title for your video or post.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!title.trim()) {
      setTitleError('Enter a title for your video or post.');
      return;
    }

    if (platforms.length === 0) {
      setFormError('Select at least one destination platform (YouTube or Facebook).');
      return;
    }

    if (platforms.includes('youtube') && !media) {
      setFormError('YouTube requires a video file. Drop a video or uncheck YouTube for a Facebook text post.');
      return;
    }

    const scheduledAtIso =
      publishMode === 'now'
        ? new Date().toISOString()
        : new Date(scheduledLocal).toISOString();

    setSubmitting(true);
    try {
      await onCreateJob({
        title: title.trim(),
        description: description.trim(),
        tags: parsedTags,
        platforms,
        youtubePrivacy,
        mediaPath: media?.filePath ?? null,
        publishImmediately: publishMode === 'now',
        scheduledAtIso,
      });

      // Reset form after queuing
      setMedia(null);
      setTitle('');
      setDescription('');
      setTagsRaw('');
      setScheduledLocal(getDefaultScheduleLocalValue());
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section
      aria-labelledby={`${formId}-heading`}
      className="rounded-2xl border border-studio-border bg-studio-panel p-6 shadow-lg"
    >
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id={`${formId}-heading`} className="text-base font-semibold text-slate-100">
            Compose &amp; Schedule Upload
          </h2>
          <p className="text-xs text-slate-400">
            Large 4K/8K videos stream directly from disk using 8 MB resumable chunks
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        {formError && (
          <div
            role="alert"
            aria-live="polite"
            className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-200"
          >
            {formError}
          </div>
        )}

        {/* Drag-and-Drop Media Zone */}
        <div>
          {!media ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => void handleDrop(e)}
              className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-7 text-center transition ${
                isDragging
                  ? 'border-indigo-400 bg-indigo-500/10'
                  : 'border-slate-700 bg-studio-card/50 hover:border-slate-500'
              }`}
            >
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-indigo-500/15 text-indigo-400">
                <Upload className="h-6 w-6" aria-hidden="true" />
              </div>
              <p className="text-sm font-medium text-slate-200">
                Drag &amp; drop a video file here
              </p>
              <p className="mt-1 text-xs text-slate-400">
                MP4, MOV, MKV, WebM, M4V, AVI (optional if publishing a text post to Facebook)
              </p>
              <button
                type="button"
                onClick={() => void handleBrowseFile()}
                className="mt-4 inline-flex items-center gap-2 rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-100 transition hover:bg-slate-700"
              >
                <FolderOpen className="h-4 w-4 text-indigo-400" aria-hidden="true" />
                <span>Browse Local Video</span>
              </button>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-studio-border bg-studio-card">
              <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-[240px_1fr]">
                <video
                  controls
                  width={640}
                  height={360}
                  src={media.previewUrl}
                  className="aspect-video w-full rounded-lg bg-black object-contain"
                />

                <div className="flex flex-col justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-xs font-medium text-indigo-300">
                      <Film className="h-4 w-4" aria-hidden="true" />
                      <span>Ready for Resumable Chunked Streaming</span>
                    </div>
                    <p className="mt-1 break-all text-sm font-semibold text-slate-100">
                      {media.fileName}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {formatFileSize(media.sizeBytes)} • {media.mimeType}
                    </p>
                    <p className="mt-1 break-all font-mono text-[11px] text-slate-500">
                      {media.filePath}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void handleBrowseFile()}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
                    >
                      <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Replace Video</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setMedia(null)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/20"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Remove Video</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Target Platforms (Multi-select checkboxes) */}
        <fieldset className="space-y-2">
          <legend className="text-xs font-semibold text-slate-300">
            Destination Platforms (Required)
          </legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="choice-pill flex cursor-pointer items-center justify-between rounded-xl border border-studio-border bg-studio-card px-4 py-3">
              <div className="flex items-center gap-2.5">
                <input
                  type="checkbox"
                  name="platform-youtube"
                  checked={platforms.includes('youtube')}
                  onChange={() => togglePlatform('youtube')}
                  className="h-4 w-4 rounded"
                />
                <span className="text-sm font-medium text-slate-100">YouTube</span>
              </div>
              <span
                className={`text-[11px] ${
                  accounts.google.connected ? 'text-emerald-400' : 'text-amber-400'
                }`}
              >
                {accounts.google.connected ? 'Account Ready' : 'Sign-in Needed'}
              </span>
            </label>

            <label className="choice-pill flex cursor-pointer items-center justify-between rounded-xl border border-studio-border bg-studio-card px-4 py-3">
              <div className="flex items-center gap-2.5">
                <input
                  type="checkbox"
                  name="platform-facebook"
                  checked={platforms.includes('facebook')}
                  onChange={() => togglePlatform('facebook')}
                  className="h-4 w-4 rounded"
                />
                <span className="text-sm font-medium text-slate-100">Facebook Page</span>
              </div>
              <span
                className={`text-[11px] ${
                  accounts.facebook.connected ? 'text-emerald-400' : 'text-amber-400'
                }`}
              >
                {accounts.facebook.connected
                  ? accounts.facebook.selectedPageName || 'Connected'
                  : 'Sign-in Needed'}
              </span>
            </label>
          </div>
        </fieldset>

        {/* Title */}
        <div>
          <label
            htmlFor={`${formId}-title`}
            className="mb-1.5 block text-xs font-semibold text-slate-300"
          >
            Video / Post Title (Required)
          </label>
          <input
            id={`${formId}-title`}
            name="title"
            type="text"
            required
            maxLength={100}
            aria-describedby={titleError ? `${formId}-title-err` : `${formId}-title-hint`}
            placeholder="e.g. Building a Cross-Platform Studio App in 2026"
            value={title}
            onBlur={handleTitleBlur}
            onChange={(e) => {
              setTitle(e.target.value);
              if (titleError) setTitleError(null);
            }}
            className="w-full rounded-xl border border-studio-border bg-studio-card px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-500"
          />
          {titleError ? (
            <p id={`${formId}-title-err`} className="mt-1 text-xs text-red-400">
              {titleError}
            </p>
          ) : (
            <p id={`${formId}-title-hint`} className="mt-1 text-[11px] text-slate-400">
              {title.length}/100 characters (YouTube maximum title limit)
            </p>
          )}
        </div>

        {/* Description */}
        <div>
          <label
            htmlFor={`${formId}-desc`}
            className="mb-1.5 block text-xs font-semibold text-slate-300"
          >
            Description / Post Caption
          </label>
          <textarea
            id={`${formId}-desc`}
            name="description"
            maxLength={5000}
            placeholder="Write your YouTube video description and Facebook Page post message..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="auto-grow-textarea w-full rounded-xl border border-studio-border bg-studio-card px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-500"
          />
        </div>

        {/* Tags & YouTube Privacy */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div>
            <label
              htmlFor={`${formId}-tags`}
              className="mb-1.5 block text-xs font-semibold text-slate-300"
            >
              Tags / Hashtags (Comma-separated)
            </label>
            <input
              id={`${formId}-tags`}
              name="tags"
              type="text"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="vlog, coding, electron, react"
              value={tagsRaw}
              onChange={(e) => setTagsRaw(e.target.value)}
              className="w-full rounded-xl border border-studio-border bg-studio-card px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-500"
            />
            {parsedTags.length > 0 && (
              <ul aria-label="Parsed tags" className="mt-2 flex flex-wrap gap-1.5">
                {parsedTags.map((tag) => (
                  <li
                    key={tag}
                    className="rounded-md bg-indigo-500/15 px-2 py-0.5 text-[11px] text-indigo-300"
                  >
                    #{tag}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {platforms.includes('youtube') && (
            <fieldset className="space-y-1.5">
              <legend className="text-xs font-semibold text-slate-300">
                YouTube Visibility
              </legend>
              <div className="grid grid-cols-3 gap-2">
                {(['private', 'unlisted', 'public'] as YouTubePrivacy[]).map((option) => (
                  <label
                    key={option}
                    className="choice-pill flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-studio-border bg-studio-card px-3 py-2.5 text-xs font-medium capitalize text-slate-200"
                  >
                    <input
                      type="radio"
                      name="youtubePrivacy"
                      value={option}
                      checked={youtubePrivacy === option}
                      onChange={() => setYoutubePrivacy(option)}
                    />
                    <span>{option}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </div>

        {/* Publish Timing (Radio selection + Schedule DateTime) */}
        <fieldset className="space-y-3 rounded-xl border border-studio-border bg-studio-card/50 p-4">
          <legend className="px-1 text-xs font-semibold text-slate-300">
            Delivery Timing
          </legend>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="choice-pill flex cursor-pointer items-center gap-2.5 rounded-xl border border-studio-border bg-studio-card px-4 py-2.5 text-xs font-medium text-slate-200">
              <input
                type="radio"
                name="publishMode"
                value="schedule"
                checked={publishMode === 'schedule'}
                onChange={() => setPublishMode('schedule')}
              />
              <CalendarClock className="h-4 w-4 text-indigo-400" aria-hidden="true" />
              <span>Schedule for Specific Date &amp; Time</span>
            </label>

            <label className="choice-pill flex cursor-pointer items-center gap-2.5 rounded-xl border border-studio-border bg-studio-card px-4 py-2.5 text-xs font-medium text-slate-200">
              <input
                type="radio"
                name="publishMode"
                value="now"
                checked={publishMode === 'now'}
                onChange={() => setPublishMode('now')}
              />
              <Send className="h-4 w-4 text-emerald-400" aria-hidden="true" />
              <span>Upload Immediately Now</span>
            </label>
          </div>

          {publishMode === 'schedule' && (
            <div className="pt-1">
              <label
                htmlFor={`${formId}-datetime`}
                className="mb-1 block text-xs font-medium text-slate-300"
              >
                Scheduled Publish Time ({localTimeZone})
              </label>
              <input
                id={`${formId}-datetime`}
                name="scheduledLocal"
                type="datetime-local"
                required={publishMode === 'schedule'}
                value={scheduledLocal}
                onChange={(e) => setScheduledLocal(e.target.value)}
                className="rounded-lg border border-slate-700 bg-studio-bg px-3.5 py-2 text-sm text-slate-100"
              />
            </div>
          )}
        </fieldset>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md transition hover:bg-indigo-500 disabled:opacity-50"
          >
            {publishMode === 'now' ? (
              <>
                <Send className="h-4 w-4" aria-hidden="true" />
                <span>{submitting ? 'Starting Upload...' : 'Start Resumable Upload Now'}</span>
              </>
            ) : (
              <>
                <CalendarClock className="h-4 w-4" aria-hidden="true" />
                <span>{submitting ? 'Saving Schedule...' : 'Schedule Automatic Upload'}</span>
              </>
            )}
          </button>
        </div>
      </form>
    </section>
  );
};

