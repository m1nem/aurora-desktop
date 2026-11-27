// AURORA_PATCH: ImportButton v2 - Cloud Upload for Listen Along
'use client';

import { apiFetch } from '@/lib/api';
import { useRef, useState } from 'react';
import { Button } from './ui/Button';
import { readAudioDuration } from '@/lib/audioDuration';
import { usePlayerStore } from '@/store/usePlayerStore';
import type { Track } from '@/types';

interface ImportButtonProps {
  onImported?: () => void;
}

interface UploadResult {
  url: string;
  track?: Track;
}

export function ImportButton({ onImported }: ImportButtonProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const addTracks = usePlayerStore((s) => s.addTracks);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);

  const uploadFile = async (file: File): Promise<UploadResult | null> => {
    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await apiFetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) return null;
      const data = await res.json();
      if (!data.url) return null;
      return { url: data.url as string, track: data.track as Track | undefined };
    } catch {
      return null;
    }
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const audioExtensions = [
      '.mp3',
      '.wav',
      '.ogg',
      '.oga',
      '.m4a',
      '.aac',
      '.flac',
      '.opus',
      '.webm',
    ];
    const audioFiles = Array.from(files).filter(
      (file) =>
        file.type.startsWith('audio/') ||
        audioExtensions.some((extension) =>
          file.name.toLowerCase().endsWith(extension)
        )
    );

    if (audioFiles.length === 0) return;

    setUploadStatus(`Uploading 0/${audioFiles.length}...`);

    const newTracks: Track[] = [];

    for (let i = 0; i < audioFiles.length; i++) {
      const file = audioFiles[i];
      setUploadStatus(`Uploading ${i + 1}/${audioFiles.length}...`);

      const baseName = file.name.replace(/\.[^.]+$/, '');
      const localPreviewUrl = URL.createObjectURL(file);

      // Copy the file into the local media root so playback survives reloads.
      const uploaded = await uploadFile(file);

      if (uploaded?.track) {
        newTracks.push(uploaded.track);
      } else {
        const localDuration = await readAudioDuration(localPreviewUrl);
        newTracks.push({
          id: `track-${file.name}-${file.size}-${Date.now()}-${i}`,
          title: baseName,
          author: 'Uploaded MP3',
          duration: localDuration ? Math.round(localDuration) : 0,
          thumbnail: '',
          url: localPreviewUrl,
          source: 'local',
          fileSize: file.size,
          uploadedAt: Date.now(),
        });
      }
    }

    if (newTracks.length > 0) {
      addTracks(newTracks);
      onImported?.();
    }

    setUploadStatus('Uploaded!');
    setTimeout(() => setUploadStatus(null), 2000);
  };

  return (
    <div className="inline-flex items-center gap-2">
      <Button
        variant="primary"
        size="md"
        onClick={() => fileInput.current?.click()}
        disabled={!!uploadStatus && uploadStatus.startsWith('Uploading')}
      >
        {uploadStatus ? `[ ${uploadStatus} ]` : '[ + Import MP3 ]'}
      </Button>

      <Button
        variant="subtle"
        size="md"
        onClick={() => folderInput.current?.click()}
        title="Import directory of audio files"
        disabled={!!uploadStatus && uploadStatus.startsWith('Uploading')}
      >
        [ + Folder ]
      </Button>

      <input
        ref={fileInput}
        type="file"
        accept="audio/*,.mp3,.wav,.ogg"
        multiple
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
      />

      <input
        ref={folderInput}
        type="file"
        multiple
        {...({ webkitdirectory: 'true', directory: '' } as Record<string, string>)}
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
