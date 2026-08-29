import { desktopCapturer } from 'electron';

let mediaRecorder: MediaRecorder | null = null;
let recordedChunks: Blob[] = [];
let recordingStartTime: number = 0;

/**
 * Start continuous desktop screen recording in Electron main/renderer environment
 */
export async function startDesktopRecording(
  userId: string = 'emp-101',
  orgId: string = 'org-101',
  taskTitle: string = 'Continuous Screen Recording Session'
) {
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen'] });
    if (!sources || sources.length === 0) {
      console.warn('[ScreenRecorder] No desktop capturer screen sources found.');
      return;
    }

    const primarySource = sources[0];

    // Capture desktop screen stream
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: primarySource.id,
          minWidth: 1280,
          maxWidth: 1920,
          minHeight: 720,
          maxHeight: 1080,
        },
      } as any,
    });

    recordedChunks = [];
    recordingStartTime = Date.now();

    // Select WebM codecs VP9 or VP8
    let mimeType = 'video/webm; codecs=vp9';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm';
    }

    mediaRecorder = new MediaRecorder(stream, { mimeType });

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        recordedChunks.push(e.data);
      }
    };

    mediaRecorder.onstop = async () => {
      try {
        if (recordedChunks.length === 0) {
          console.warn('[ScreenRecorder] Recorded chunks empty on stop.');
          return;
        }

        const durationMs = Date.now() - recordingStartTime;
        const durationSec = Math.max(1, Math.round(durationMs / 1000));

        const blob = new Blob(recordedChunks, { type: 'video/webm' });
        const arrayBuffer = await blob.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        console.log(`[ScreenRecorder] Recording stopped. Total chunks: ${recordedChunks.length}, Size: ${(buffer.length / (1024 * 1024)).toFixed(2)} MB, Duration: ${durationSec}s`);

        await uploadVideoRecordingBuffer(buffer, userId, orgId, taskTitle, durationSec);
      } catch (err) {
        console.error('[ScreenRecorder] Error building recording buffer on stop:', err);
      }
    };

    // Request data every 1000ms to collect video chunks continuously and avoid empty 0.1 MB files
    mediaRecorder.start(1000);
    console.log(`[ScreenRecorder] MediaRecorder started with 1000ms chunk intervals on stream source: ${primarySource.name}`);

  } catch (err) {
    console.error('[ScreenRecorder] Failed to start desktop screen recording stream:', err);
  }
}

/**
 * Stop active desktop screen recording session
 */
export function stopDesktopRecording(): void {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
    console.log('[ScreenRecorder] Requested MediaRecorder stop.');
  }
}

/**
 * Upload complete video recording buffer to backend API endpoint
 */
export async function uploadVideoRecordingBuffer(
  buffer: Buffer,
  userId: string,
  organizationId: string,
  title: string,
  durationSec: number
): Promise<any> {
  try {
    const videoBase64 = `data:video/webm;base64,${buffer.toString('base64')}`;

    const res = await fetch('http://localhost:3000/api/v1/recordings/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        organizationId,
        title,
        durationSec,
        videoBase64,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      console.log(`[ScreenRecorder] Video recording buffer uploaded successfully! Document ID: ${data?.data?.id || data?.id}`);
      return data;
    } else {
      console.warn(`[ScreenRecorder] Recording upload HTTP Error: ${res.status}`);
    }
  } catch (err) {
    console.error('[ScreenRecorder] Failed uploading recording buffer:', err);
  }
}
