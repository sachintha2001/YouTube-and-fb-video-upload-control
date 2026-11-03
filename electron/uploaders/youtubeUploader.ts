import fs from 'node:fs';
import type { YouTubePrivacy } from '../types';

// YouTube Resumable API requires chunk size to be a multiple of 256 KB (except final chunk).
// 8 MB = 32 * 256 KB — low memory footprint + responsive progress updates + resilient recovery.
const YOUTUBE_CHUNK_SIZE_BYTES = 8 * 1024 * 1024;
const MAX_CHUNK_RETRIES = 5;

const YOUTUBE_RESUMABLE_INIT_URL =
  'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';

export interface YouTubeUploadParams {
  accessToken: string;
  filePath: string;
  mimeType: string;
  title: string;
  description: string;
  tags: string[];
  privacyStatus: YouTubePrivacy;
  onProgress: (info: { bytesUploaded: number; totalBytes: number; phase: string }) => void;
}

export interface YouTubeUploadResult {
  videoId: string;
  videoUrl: string;
  totalBytes: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseCommittedByteOffset(rangeHeader: string | null, fallbackNextOffset: number): number {
  if (!rangeHeader) {
    return fallbackNextOffset;
  }
  // Format: "bytes=0-8388607"
  const match = /bytes=\d+-(\d+)/i.exec(rangeHeader);
  if (!match) {
    return fallbackNextOffset;
  }
  return Number(match[1]) + 1;
}

function isTransientHttpStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

export async function uploadVideoToYouTubeResumable(
  params: YouTubeUploadParams
): Promise<YouTubeUploadResult> {
  const stat = await fs.promises.stat(params.filePath);
  const totalBytes = stat.size;
  if (totalBytes <= 0) {
    throw new Error('Selected video file is empty (0 bytes).');
  }

  params.onProgress({
    bytesUploaded: 0,
    totalBytes,
    phase: 'Initializing YouTube resumable session...',
  });

  // Step 1: Initiate Resumable Upload Session
  const metadataBody = {
    snippet: {
      title: params.title.slice(0, 100), // YouTube max title length is 100 chars
      description: params.description.slice(0, 5000),
      tags: params.tags.length > 0 ? params.tags : undefined,
      categoryId: '22', // People & Blogs default category
    },
    status: {
      privacyStatus: params.privacyStatus,
      selfDeclaredMadeForKids: false,
    },
  };

  const initRes = await fetch(YOUTUBE_RESUMABLE_INIT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(totalBytes),
      'X-Upload-Content-Type': params.mimeType || 'video/mp4',
    },
    body: JSON.stringify(metadataBody),
  });

  if (!initRes.ok) {
    const errText = await initRes.text();
    throw new Error(`YouTube resumable session init failed (HTTP ${initRes.status}): ${errText}`);
  }

  const sessionUri = initRes.headers.get('location');
  if (!sessionUri) {
    throw new Error('YouTube API did not return a resumable session Location header.');
  }

  // Step 2: Stream Fixed 8 MB Chunks with HTTP 308 Range Tracking & Exponential-Backoff Recovery
  const fileHandle = await fs.promises.open(params.filePath, 'r');
  const reusableBuffer = Buffer.allocUnsafe(YOUTUBE_CHUNK_SIZE_BYTES);

  try {
    let offset = 0;

    while (offset < totalBytes) {
      const remaining = totalBytes - offset;
      const chunkLength = Math.min(YOUTUBE_CHUNK_SIZE_BYTES, remaining);

      const { bytesRead } = await fileHandle.read(reusableBuffer, 0, chunkLength, offset);
      if (bytesRead <= 0) {
        throw new Error(`Unexpected EOF while reading video at byte ${offset}/${totalBytes}.`);
      }

      const endByte = offset + bytesRead - 1;
      const chunkSlice = new Uint8Array(
        reusableBuffer.buffer,
        reusableBuffer.byteOffset,
        bytesRead
      );

      let attempt = 0;
      let chunkDone = false;

      while (!chunkDone) {
        try {
          const chunkIndex = Math.floor(offset / YOUTUBE_CHUNK_SIZE_BYTES) + 1;
          const totalChunks = Math.ceil(totalBytes / YOUTUBE_CHUNK_SIZE_BYTES);

          params.onProgress({
            bytesUploaded: offset,
            totalBytes,
            phase: `Uploading chunk ${chunkIndex}/${totalChunks} to YouTube...`,
          });

          const putRes = await fetch(sessionUri, {
            method: 'PUT',
            headers: {
              'Content-Length': String(bytesRead),
              'Content-Range': `bytes ${offset}-${endByte}/${totalBytes}`,
              'Content-Type': params.mimeType || 'video/mp4',
            },
            body: chunkSlice,
          });

          // HTTP 308 Resume Incomplete -> Chunk committed, advance offset
          if (putRes.status === 308) {
            offset = parseCommittedByteOffset(putRes.headers.get('range'), endByte + 1);
            params.onProgress({
              bytesUploaded: offset,
              totalBytes,
              phase: `Uploaded ${Math.round((offset / totalBytes) * 100)}% to YouTube`,
            });
            chunkDone = true;
            continue;
          }

          // HTTP 200 or 201 -> Final chunk committed, upload finished!
          if (putRes.status === 200 || putRes.status === 201) {
            const createdJson = (await putRes.json()) as { id?: string };
            if (!createdJson.id) {
              throw new Error('YouTube upload succeeded, but response did not include a video ID.');
            }

            params.onProgress({
              bytesUploaded: totalBytes,
              totalBytes,
              phase: 'YouTube upload complete!',
            });

            return {
              videoId: createdJson.id,
              videoUrl: `https://youtu.be/${createdJson.id}`,
              totalBytes,
            };
          }

          if (isTransientHttpStatus(putRes.status) && attempt < MAX_CHUNK_RETRIES) {
            throw new Error(`Transient HTTP ${putRes.status} from YouTube upload server.`);
          }

          const fatalText = await putRes.text();
          throw new Error(`YouTube chunk upload failed (HTTP ${putRes.status}): ${fatalText}`);
        } catch (err) {
          attempt += 1;
          if (attempt > MAX_CHUNK_RETRIES) {
            throw err;
          }

          const backoffMs = Math.min(16_000, 1000 * 2 ** (attempt - 1));
          params.onProgress({
            bytesUploaded: offset,
            totalBytes,
            phase: `Network hiccup — probing YouTube resume offset (retry ${attempt}/${MAX_CHUNK_RETRIES})...`,
          });
          await sleep(backoffMs);

          // Query Google's resumable session to synchronize the exact committed byte offset
          try {
            const probeRes = await fetch(sessionUri, {
              method: 'PUT',
              headers: {
                'Content-Length': '0',
                'Content-Range': `bytes */${totalBytes}`,
              },
            });

            if (probeRes.status === 308) {
              offset = parseCommittedByteOffset(probeRes.headers.get('range'), 0);
              chunkDone = true; // Re-enter outer loop at exact server-confirmed offset
            } else if (probeRes.status === 200 || probeRes.status === 201) {
              const createdJson = (await probeRes.json()) as { id?: string };
              if (createdJson.id) {
                return {
                  videoId: createdJson.id,
                  videoUrl: `https://youtu.be/${createdJson.id}`,
                  totalBytes,
                };
              }
            }
          } catch {
            // If probe itself hits transient offline error, next retry iteration will retry
          }
        }
      }
    }

    throw new Error('YouTube upload loop exited unexpectedly before final confirmation.');
  } finally {
    await fileHandle.close();
  }
}

