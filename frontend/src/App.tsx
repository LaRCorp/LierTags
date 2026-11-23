import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { open } from '@tauri-apps/plugin-dialog';
import { Track, SaveTrackPayload, ImportPayload, MusicBrainzRecording, DropResult } from './types';
import { TrackTable } from './components/TrackTable';
import { EditPanel } from './components/EditPanel';
import { ImportModal } from './components/ImportModal';
import { FolderOpen, FileAudio, Radio, RefreshCw, RotateCcw, Search, UploadCloud } from 'lucide-react';

const LAST_FOLDER_KEY = 'liertags_last_folder';

export const App: React.FC = () => {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isReloading, setIsReloading] = useState<boolean>(false);
  const [isDraggingOverWindow, setIsDraggingOverWindow] = useState<boolean>(false);
  const [importModalPayload, setImportModalPayload] = useState<ImportPayload | null>(null);
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);

  // Active track derived from selected ID
  const activeTrack = tracks.find((t) => t.id === selectedTrackId) || null;

  // 1. Auto-load last opened folder from fast SQLite cache on startup
  useEffect(() => {
    const savedFolder = localStorage.getItem(LAST_FOLDER_KEY);
    if (savedFolder) {
      setCurrentFolder(savedFolder);
      setIsScanning(true);
      invoke<Track[]>('scan_folder', { folderPath: savedFolder, recursive: true })
        .then((cachedTracks) => {
          setTracks(cachedTracks);
          if (cachedTracks.length > 0) {
            setSelectedTrackId(cachedTracks[0].id);
          }
        })
        .catch((err) => console.warn('Could not auto-restore last folder:', err))
        .finally(() => setIsScanning(false));
    }
  }, []);

  // 2. Lazy-load full artwork for currently active track on demand
  useEffect(() => {
    if (!activeTrack) return;
    if (activeTrack.metadata.has_artwork && !activeTrack.metadata.artwork_base64) {
      invoke<string | null>('read_track_artwork', { filePath: activeTrack.file_path })
        .then((artUri) => {
          if (artUri) {
            setTracks((prev) =>
              prev.map((t) =>
                t.id === activeTrack.id
                  ? { ...t, metadata: { ...t.metadata, artwork_base64: artUri } }
                  : t
              )
            );
          }
        })
        .catch((err) => console.warn('Failed to lazy load artwork:', err));
    }
  }, [selectedTrackId, activeTrack]);

  // 3. Listen for LierEX-Q import events on port 8766
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      try {
        unlisten = await listen<ImportPayload>('track_imported', (event) => {
          console.log('Received track_imported event from LierEX-Q:', event.payload);
          setImportModalPayload(event.payload);
        });
      } catch (err) {
        console.warn('Tauri event listener not registered (browser preview mode?):', err);
      }
    };

    setupListener();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // 4. Tauri Window Drag & Drop support (files or folders)
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupDragDrop = async () => {
      try {
        const appWindow = getCurrentWebviewWindow();
        unlisten = await appWindow.onDragDropEvent(async (event) => {
          if (event.payload.type === 'enter' || event.payload.type === 'over') {
            setIsDraggingOverWindow(true);
          } else if (event.payload.type === 'leave') {
            setIsDraggingOverWindow(false);
          } else if (event.payload.type === 'drop') {
            setIsDraggingOverWindow(false);
            const paths = event.payload.paths;
            if (paths && paths.length > 0) {
              await handleProcessPaths(paths);
            }
          }
        });
      } catch (err) {
        console.warn('Tauri DragDropEvent registration:', err);
      }
    };

    setupDragDrop();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // Keyboard shortcut Ctrl+S
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        const saveBtn = document.querySelector('button[title*="Ctrl+S"]') as HTMLButtonElement | null;
        if (saveBtn) saveBtn.click();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Passive Auto-Refresh on window focus: reload active track if modified externally (e.g. by AIMP)
  useEffect(() => {
    const handleFocus = async () => {
      if (!selectedTrackId) return;
      const current = tracks.find((t) => t.id === selectedTrackId);
      if (!current) return;

      try {
        const fresh = await invoke<Track>('read_track', { filePath: current.file_path });
        const hasArtworkChanged = fresh.metadata.has_artwork !== current.metadata.has_artwork ||
          fresh.metadata.artwork_base64 !== current.metadata.artwork_base64;
        const hasTitleChanged = fresh.metadata.title !== current.metadata.title;
        const hasArtistChanged = fresh.metadata.artist !== current.metadata.artist;
        const hasAlbumChanged = fresh.metadata.album !== current.metadata.album;
        const hasYearChanged = fresh.metadata.year !== current.metadata.year;

        if (hasArtworkChanged || hasTitleChanged || hasArtistChanged || hasAlbumChanged || hasYearChanged) {
          console.log('Passive reload: external change detected on track', fresh.file_name);
          setTracks((prev) => prev.map((t) => (t.id === fresh.id ? { ...fresh, dirty: false } : t)));
        }
      } catch {
        // file might be temporarily locked
      }
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [selectedTrackId, tracks]);

  // Handle dropped paths (folder or files)
  const handleProcessPaths = async (paths: string[]) => {
    setIsScanning(true);
    try {
      const result = await invoke<DropResult>('handle_dropped_paths', { paths });
      if (result.tracks.length > 0) {
        setTracks(result.tracks);
        setSelectedTrackId(result.tracks[0].id);
        if (result.mode === 'folder' && result.folder_path) {
          setCurrentFolder(result.folder_path);
          localStorage.setItem(LAST_FOLDER_KEY, result.folder_path);
        } else if (result.folder_path) {
          setCurrentFolder(result.folder_path);
        }
      }
    } catch (err) {
      console.error('Failed to process dropped paths:', err);
    } finally {
      setIsScanning(false);
    }
  };

  // Open directory dialog and scan
  const handleOpenFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Выберите папку с музыкальными файлами',
      });

      if (selected && typeof selected === 'string') {
        setCurrentFolder(selected);
        localStorage.setItem(LAST_FOLDER_KEY, selected);
        setIsScanning(true);
        const scannedTracks = await invoke<Track[]>('scan_folder', {
          folderPath: selected,
          recursive: true,
        });
        setTracks(scannedTracks);
        if (scannedTracks.length > 0) {
          setSelectedTrackId(scannedTracks[0].id);
        }
      }
    } catch (err) {
      console.error('Scan error:', err);
    } finally {
      setIsScanning(false);
    }
  };

  // Open single or multiple files dialog
  const handleOpenFiles = async () => {
    try {
      const selected = await open({
        directory: false,
        multiple: true,
        title: 'Выберите аудиофайлы для редактирования',
        filters: [
          {
            name: 'Аудиофайлы',
            extensions: ['mp3', 'flac', 'm4a', 'ogg', 'wav', 'opus', 'aiff'],
          },
        ],
      });

      if (selected) {
        const fileList = Array.isArray(selected) ? selected : [selected];
        if (fileList.length > 0) {
          setIsScanning(true);
          const loadedTracks = await invoke<Track[]>('open_files', { filePaths: fileList });
          if (loadedTracks.length > 0) {
            setTracks(loadedTracks);
            setSelectedTrackId(loadedTracks[0].id);
            setCurrentFolder(null); // specific file set
          }
        }
      }
    } catch (err) {
      console.error('Open files error:', err);
    } finally {
      setIsScanning(false);
    }
  };

  // Rescan current folder on demand
  const handleRescanFolder = async () => {
    if (!currentFolder) return;
    setIsScanning(true);
    try {
      const scannedTracks = await invoke<Track[]>('scan_folder', {
        folderPath: currentFolder,
        recursive: true,
      });
      setTracks(scannedTracks);
      if (selectedTrackId && !scannedTracks.some((t) => t.id === selectedTrackId) && scannedTracks.length > 0) {
        setSelectedTrackId(scannedTracks[0].id);
      }
    } catch (err) {
      console.error('Rescan error:', err);
    } finally {
      setIsScanning(false);
    }
  };

  // Reload selected track directly from disk
  const handleReloadActiveTrack = async () => {
    if (!activeTrack) return;
    setIsReloading(true);
    try {
      const fresh = await invoke<Track>('read_track', { filePath: activeTrack.file_path });
      setTracks((prev) => prev.map((t) => (t.id === fresh.id ? { ...fresh, dirty: false } : t)));
    } catch (err) {
      console.error('Failed to reload track from disk:', err);
    } finally {
      setIsReloading(false);
    }
  };

  // Save tags handler
  const handleSaveTrack = async (payload: SaveTrackPayload) => {
    setIsSaving(true);
    try {
      const updated = await invoke<Track>('save_tags', { payload });
      setTracks((prev) => prev.map((t) => (t.id === updated.id ? { ...updated, dirty: false } : t)));
    } catch (err) {
      console.error('Failed to save tags:', err);
      alert(`Ошибка сохранения: ${err}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Search MusicBrainz
  const handleSearchMusicBrainz = async (query: string): Promise<MusicBrainzRecording[]> => {
    try {
      return await invoke<MusicBrainzRecording[]>('search_musicbrainz', { query });
    } catch (err) {
      console.error('MusicBrainz error:', err);
      return [];
    }
  };

  // Apply LierEX-Q import payload
  const handleApplyImport = async (payload: ImportPayload, autoSave: boolean) => {
    if (!activeTrack) return;

    let artworkB64: string | undefined = undefined;
    if (payload.artwork_url) {
      try {
        artworkB64 = await invoke<string>('fetch_cover_image', { url: payload.artwork_url });
      } catch (err) {
        console.warn('Failed to download artwork:', err);
      }
    }

    const savePayload: SaveTrackPayload = {
      file_path: activeTrack.file_path,
      title: payload.title || activeTrack.metadata.title,
      artist: payload.artist || activeTrack.metadata.artist,
      album: payload.album || activeTrack.metadata.album,
      year: payload.year || activeTrack.metadata.year,
      genre: payload.genre || activeTrack.metadata.genre,
      track_number: payload.track_number || activeTrack.metadata.track_number,
      comment: payload.comment || activeTrack.metadata.comment,
      new_artwork_base64: artworkB64,
      remove_artwork: false,
    };

    if (autoSave) {
      await handleSaveTrack(savePayload);
    } else {
      setTracks((prev) =>
        prev.map((t) =>
          t.id === activeTrack.id
            ? {
                ...t,
                dirty: true,
                metadata: {
                  ...t.metadata,
                  title: savePayload.title,
                  artist: savePayload.artist,
                  album: savePayload.album,
                  year: savePayload.year,
                  genre: savePayload.genre,
                  artwork_base64: artworkB64 || t.metadata.artwork_base64,
                },
              }
            : t
        )
      );
    }

    setImportModalPayload(null);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDraggingOverWindow(true);
      }}
      onDragLeave={() => setIsDraggingOverWindow(false)}
      className="relative flex flex-col h-screen w-screen overflow-hidden bg-[#121316] text-[#E0E2EC]"
    >
      {/* Visual Drag and Drop Overlay */}
      {isDraggingOverWindow && (
        <div className="absolute inset-0 bg-[#121316]/85 backdrop-blur-sm z-50 flex flex-col items-center justify-center border-4 border-dashed border-[#39C5BB] p-8 pointer-events-none">
          <UploadCloud className="w-20 h-20 text-[#39C5BB] animate-bounce mb-4" />
          <h2 className="text-xl font-bold text-white mb-1">Перетащите файлы или папку сюда</h2>
          <p className="text-xs text-[#9EA2B0]">
            Поддерживаются папки с музыкой или отдельные треки: MP3, FLAC, M4A, OGG, WAV
          </p>
        </div>
      )}

      {/* Top Navigation Bar */}
      <header className="h-13 bg-[#181920] border-b border-[#282a35] px-4 flex items-center justify-between shrink-0 shadow-md">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-2 font-bold text-sm tracking-wide text-white">
            <span className="w-3 h-3 rounded-full bg-[#8B0000] inline-block shadow-sm shadow-[#8B0000]" />
            <span>LierTags</span>
          </div>
          <span className="text-[11px] px-2 py-0.5 rounded bg-[#252733] text-[#39C5BB] font-mono border border-[#39C5BB]/20">
            v0.1.0
          </span>
          <div className="h-4 w-px bg-[#323544] mx-1" />

          {/* Open Folder button */}
          <button
            onClick={handleOpenFolder}
            disabled={isScanning}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-[#262833] hover:bg-[#323544] text-[#E0E2EC] border border-[#36394a] transition-colors cursor-pointer"
            title="Открыть директорию с треками"
          >
            {isScanning ? <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#39C5BB]" /> : <FolderOpen className="w-3.5 h-3.5 text-[#39C5BB]" />}
            <span>Папка</span>
          </button>

          {/* Open Files button */}
          <button
            onClick={handleOpenFiles}
            disabled={isScanning}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-[#262833] hover:bg-[#323544] text-[#E0E2EC] border border-[#36394a] transition-colors cursor-pointer"
            title="Открыть один или несколько аудиофайлов"
          >
            <FileAudio className="w-3.5 h-3.5 text-[#39C5BB]" />
            <span>Файлы</span>
          </button>

          {/* Rescan Folder button */}
          {currentFolder && (
            <button
              onClick={handleRescanFolder}
              disabled={isScanning}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded bg-[#262833] hover:bg-[#323544] text-[#39C5BB] border border-[#36394a] transition-colors cursor-pointer"
              title="Пересканировать текущую папку"
            >
              <RotateCcw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
              <span>Обновить</span>
            </button>
          )}

          {currentFolder && (
            <span className="text-xs text-[#828698] truncate max-w-xs" title={currentFolder}>
              {currentFolder}
            </span>
          )}
        </div>

        {/* Center / Right controls */}
        <div className="flex items-center gap-4">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-[#686c7d]" />
            <input
              type="text"
              placeholder="Поиск по названию, артисту, альбому..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1 text-xs bg-[#121317] border border-[#2e313e] focus:border-[#39C5BB] rounded-md text-white outline-none w-64 lg:w-80 transition-colors"
            />
          </div>

          {/* LierEX-Q local server indicator */}
          <div className="flex items-center gap-2 px-2.5 py-1 bg-[#15161c] border border-[#292b37] rounded-md text-xs">
            <Radio className="w-3.5 h-3.5 text-[#39C5BB] animate-pulse" />
            <span className="text-[11px] text-[#A6AAB8]">LierEX (8766):</span>
            <span className="text-[11px] font-semibold text-[#39C5BB]">Готов</span>
          </div>
        </div>
      </header>

      {/* Main Workspace Body */}
      <main className="flex-1 flex gap-3 p-3 overflow-hidden">
        <TrackTable
          tracks={tracks}
          selectedTrackId={selectedTrackId}
          onSelectTrack={(t) => setSelectedTrackId(t.id)}
          searchQuery={searchQuery}
        />
        <EditPanel
          track={activeTrack}
          onSave={handleSaveTrack}
          onSearchMusicBrainz={handleSearchMusicBrainz}
          onReload={handleReloadActiveTrack}
          isSaving={isSaving}
          isReloading={isReloading}
        />
      </main>

      {/* Import Modal from LierEX-Q */}
      <ImportModal
        payload={importModalPayload}
        activeTrack={activeTrack}
        onApply={handleApplyImport}
        onClose={() => setImportModalPayload(null)}
      />
    </div>
  );
};
