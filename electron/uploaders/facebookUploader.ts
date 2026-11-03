import fs from 'node:fs';
import path from 'node:path';

const FB_GRAPH_VERSION = 'v21.0';
const FB_GRAPH_BASE = `https://graph.facebook.com/${FB_GRAPH_VERSION}`;
const FB_GRAPH_VIDEO_BASE = `https://graph-video.facebook.com/${FB_GRAPH_VERSION}`;
const MAX_CHUNK_RETRIES = 4;

export interface FacebookPublishParams {
  pageId: string;
  pageAccessToken: string;
  title: string;
  description: string;
  tags: string[];
  filePath: string | null;
  mimeType: string | null;
  onProgress: (info: { bytesUploaded: number; totalBytes: number; phase: string }) => void;
}

export interface FacebookPublishResult {
  postId: string;
  postUrl: string;
  totalBytes: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatMessageWithHashtags(title: string, description: string, tags: string[]): string {
  const hashtags = tags
    .map((t) => t.trim().replace(/^#+/, '').replace(/\s+/g, ''))
    .filter(Boolean)
    .map((t) => `#${t}`)
    .join(' ');

  const parts = [description.trim() || title.trim()];
  if (hashtags) {
    parts.push(hashtags);
  }
  return parts.filter(Boolean).join('\n\n');
}

export async function publishToFacebookPage(
  params: FacebookPublishParams
): Promise<FacebookPublishResult> {
  // Mode A: Text / Status Post (no video file attached)
  if (!params.filePath) {
    params.onProgress({
      bytesUploaded: 0,
      totalBytes: 1,
      phase: 'Publishing text post to Facebook Page...',
    });

    const message = formatMessageWithHashtags(params.title, params.description, params.tags);
    const feedRes = await fetch(`${FB_GRAPH_BASE}/${params.pageId}/feed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        access_token: params.pageAccessToken,
      }),
    });

    const feedJson = (await feedRes.json()) as {
      id?: string;
      error?: { message?: string };
    };

    if (!feedRes.ok || !feedJson.id) {
      throw new Error(
        `Facebook Page feed post failed: ${feedJson.error?.message || feedRes.statusText}`
      );
    }

    params.onProgress({
      bytesUploaded: 1,
      totalBytes: 1,
      phase: 'Facebook Page post published!',
    });

    return {
      postId: feedJson.id,
      postUrl: `https://www.facebook.com/${feedJson.id}`,
      totalBytes: 1,
    };
  }

  // Mode B: 3-Phase Resumable Chunked Video Upload (start -> transfer -> finish)
  const stat = await fs.promises.stat(params.filePath);
  const totalBytes = stat.size;
  if (totalBytes <= 0) {
    throw new Error('Selected video file is empty (0 bytes).');
  }

  const fileName = path.basename(params.filePath);
  const videoEndpoint = `${FB_GRAPH_VIDEO_BASE}/${params.pageId}/videos`;

  // Phase 1: START
  params.onProgress({
    bytesUploaded: 0,
    totalBytes,
    phase: 'Starting Facebook Graph Video resumable session...',
  });

  const startForm = new FormData();
  startForm.set('upload_phase', 'start');
  startForm.set('file_size', String(totalBytes));
  startForm.set('access_token', params.pageAccessToken);

  const startRes = await fetch(videoEndpoint, {
    method: 'POST',
    body: startForm,
  });

  const startJson = (await startRes.json()) as {
    upload_session_id?: string;
    video_id?: string;
    start_offset?: string;
    end_offset?: string;
    error?: { message?: string };
  };

  if (
    !startRes.ok ||
    !startJson.upload_session_id ||
    !startJson.video_id ||
    startJson.start_offset === undefined ||
    startJson.end_offset === undefined
  ) {
    throw new Error(
      `Facebook video upload start phase failed: ${startJson.error?.message || startRes.statusText}`
    );
  }

  const uploadSessionId = startJson.upload_session_id;
  const videoId = startJson.video_id;
  let startOffset = Number(startJson.start_offset);
  let endOffset = Number(startJson.end_offset);

  // Phase 2: TRANSFER CHUNKS
  const fileHandle = await fs.promises.open(params.filePath, 'r');
  try {
    while (startOffset < endOffset && startOffset < totalBytes) {
      const chunkLength = endOffset - startOffset;
      const chunkBuffer = Buffer.allocUnsafe(chunkLength);
      const { bytesRead } = await fileHandle.read(chunkBuffer, 0, chunkLength, startOffset);

      if (bytesRead <= 0) {
        throw new Error(
          `Unexpected EOF while reading video chunk for Facebook at byte ${startOffset}.`
        );
      }

      const sliceView = new Uint8Array(chunkBuffer.buffer, chunkBuffer.byteOffset, bytesRead);
      const chunkBlob = new Blob([sliceView], {
        type: params.mimeType || 'video/mp4',
      });

      let attempt = 0;
      let chunkTransferred = false;

      while (!chunkTransferred) {
        try {
          params.onProgress({
            bytesUploaded: startOffset,
            totalBytes,
            phase: `Transferring chunk (${Math.round((startOffset / totalBytes) * 100)}%) to Facebook...`,
          });

          const transferForm = new FormData();
          transferForm.set('upload_phase', 'transfer');
          transferForm.set('upload_session_id', uploadSessionId);
          transferForm.set('start_offset', String(startOffset));
          transferForm.set('access_token', params.pageAccessToken);
          transferForm.set('video_file_chunk', chunkBlob, fileName);

          const transferRes = await fetch(videoEndpoint, {
            method: 'POST',
            body: transferForm,
          });

          const transferJson = (await transferRes.json()) as {
            start_offset?: string;
            end_offset?: string;
            error?: {
              message?: string;
              error_data?: { start_offset?: number; end_offset?: number };
            };
          };

          if (!transferRes.ok || transferJson.start_offset === undefined) {
            // Honor Meta's recovery byte offsets if provided in error_data
            const recoveryStart = transferJson.error?.error_data?.start_offset;
            const recoveryEnd = transferJson.error?.error_data?.end_offset;
            if (typeof recoveryStart === 'number' && typeof recoveryEnd === 'number') {
              startOffset = recoveryStart;
              endOffset = recoveryEnd;
              chunkTransferred = true;
              continue;
            }
            throw new Error(
              transferJson.error?.message || `Facebook chunk transfer HTTP ${transferRes.status}`
            );
          }

          startOffset = Number(transferJson.start_offset);
          endOffset = Number(transferJson.end_offset ?? startOffset);
          chunkTransferred = true;

          params.onProgress({
            bytesUploaded: Math.min(startOffset, totalBytes),
            totalBytes,
            phase: `Transferred ${Math.round((Math.min(startOffset, totalBytes) / totalBytes) * 100)}% to Facebook`,
          });
        } catch (err) {
          attempt += 1;
          if (attempt > MAX_CHUNK_RETRIES) {
            throw err;
          }
          const backoffMs = 1500 * 2 ** (attempt - 1);
          params.onProgress({
            bytesUploaded: startOffset,
            totalBytes,
            phase: `Retrying Facebook chunk (${attempt}/${MAX_CHUNK_RETRIES})...`,
          });
          await sleep(backoffMs);
        }
      }
    }
  } finally {
    await fileHandle.close();
  }

  // Phase 3: FINISH & PUBLISH
  params.onProgress({
    bytesUploaded: totalBytes,
    totalBytes,
    phase: 'Finalizing Facebook video publication...',
  });

  const finishForm = new FormData();
  finishForm.set('upload_phase', 'finish');
  finishForm.set('upload_session_id', uploadSessionId);
  finishForm.set('access_token', params.pageAccessToken);
  finishForm.set('title', params.title);
  finishForm.set(
    'description',
    formatMessageWithHashtags(params.title, params.description, params.tags)
  );

  const finishRes = await fetch(videoEndpoint, {
    method: 'POST',
    body: finishForm,
  });

  const finishJson = (await finishRes.json()) as {
    success?: boolean;
    error?: { message?: string };
  };

  if (!finishRes.ok || !finishJson.success) {
    throw new Error(
      `Facebook video finish phase failed: ${finishJson.error?.message || finishRes.statusText}`
    );
  }

  params.onProgress({
    bytesUploaded: totalBytes,
    totalBytes,
    phase: 'Facebook Page video published!',
  });

  return {
    postId: videoId,
    postUrl: `https://www.facebook.com/${params.pageId}/videos/${videoId}`,
    totalBytes,
  };
}

