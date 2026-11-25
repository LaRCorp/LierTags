import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { open } from '@tauri-apps/plugin-dialog';
import { Track, SaveTrackPayload, ImportPayload, MusicBrainzRecording, DropResult, EcosystemAppStatus, LierSyncSendResult } from './types';
import { TrackTable } from './components/TrackTable';
import { EditPanel } from './components/EditPanel';
import { ImportModal } from './components/ImportModal';
import { OrganizerTab } from './components/OrganizerTab';
import { DuplicatesTab } from './components/DuplicatesTab';
import {
  FolderOpen,
  FileAudio,
  Radio,
  RefreshCw,
  RotateCcw,
  Search,
  UploadCloud,
  Music,
  FolderTree,
  Copy,
  X,
  Send,
  Globe,
} from 'lucide-react';

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
  const [activeTab, setActiveTab] = useState<'library' | 'organizer' | 'duplicates'>('library');
  const [checkedTrackIds, setCheckedTrackIds] = useState<Set<string>>(new Set());
  const [showEcosystemModal, setShowEcosystemModal] = useState<boolean>(false);
  const [ecosystemApps, setEcosystemApps] = useState<EcosystemAppStatus[]>([]);
  const [ecosystemBanner, setEcosystemBanner] = useState<string | null>(null);
  const [isSendingToSync, setIsSendingToSync] = useState<boolean>(false);

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

  // 2. Load fresh full track details (artwork + lyrics) for active track on select
  useEffect(() => {
    if (!selectedTrackId) return;
    const current = tracks.find((t) => t.id === selectedTrackId);
    if (!current) return;

    invoke<Track>('read_track', { filePath: current.file_path })
      .then((fresh) => {
        setTracks((prev) =>
          prev.map((t) =>
            t.id === fresh.id
              ? {
                  ...fresh,
                  dirty: t.dirty,
                }
              : t
          )
        );
      })
      .catch((err) => console.warn('Failed to load track details on select:', err));
  }, [selectedTrackId]);

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
        const hasLyricsChanged = fresh.metadata.lyrics !== current.metadata.lyrics;

        if (hasArtworkChanged || hasTitleChanged || hasArtistChanged || hasAlbumChanged || hasYearChanged || hasLyricsChanged) {
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

  const handleToggleCheckTrack = (trackId: string) => {
    setCheckedTrackIds((prev) => {
      const next = new Set(prev);
      if (next.has(trackId)) {
        next.delete(trackId);
      } else {
        next.add(trackId);
      }
      return next;
    });
  };

  const handleSelectAllFiltered = (filtered: Track[]) => {
    const next = new Set(checkedTrackIds);
    for (const t of filtered) {
      next.add(t.id);
    }
    setCheckedTrackIds(next);
  };

  const handleClearChecked = () => {
    setCheckedTrackIds(new Set());
  };

  const handleSendToOrganizer = (selectedTracks: Track[]) => {
    const ids = new Set(selectedTracks.map((t) => t.id));
    setCheckedTrackIds(ids);
    setActiveTab('organizer');
  };

  const refreshEcosystem = async () => {
    try {
      const apps = await invoke<EcosystemAppStatus[]>('probe_lier_ecosystem');
      setEcosystemApps(apps);
    } catch (err) {
      console.warn('Ecosystem probe failed:', err);
    }
  };

  useEffect(() => {
    refreshEcosystem();
  }, []);

  const handleSendToLierSync = async () => {
    const selectedPaths =
      checkedTrackIds.size > 0
        ? tracks.filter((t) => checkedTrackIds.has(t.id)).map((t) => t.file_path)
        : activeTrack
        ? [activeTrack.file_path]
        : currentFolder
        ? [currentFolder]
        : [];

    if (selectedPaths.length === 0) {
      setEcosystemBanner('Выберите треки или откройте папку для отправки в LierSync');
      return;
    }

    setIsSendingToSync(true);
    setEcosystemBanner(null);
    try {
      const res = await invoke<LierSyncSendResult>('send_paths_to_liersync', {
        paths: selectedPaths,
        target: null,
      });
      setEcosystemBanner(
        `Отправлено через LierSync (${res.target || 'пир'}): ${res.sent_files} файл(ов)`
      );
    } catch (err) {
      setEcosystemBanner(`Ошибка LierSync: ${err}`);
    } finally {
      setIsSendingToSync(false);
    }
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
            v1.1
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

        {/* Navigation Tabs */}
        <div className="flex items-center gap-1 bg-[#121317] p-1 rounded-md border border-[#292c3a]">
          <button
            onClick={() => setActiveTab('library')}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded transition-colors cursor-pointer ${
              activeTab === 'library'
                ? 'bg-[#39C5BB] text-black shadow-xs'
                : 'text-[#A6ABB8] hover:text-white'
            }`}
          >
            <Music className="w-3.5 h-3.5" />
            <span>Библиотека</span>
          </button>

          <button
            onClick={() => setActiveTab('organizer')}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded transition-colors cursor-pointer ${
              activeTab === 'organizer'
                ? 'bg-[#39C5BB] text-black shadow-xs'
                : 'text-[#A6ABB8] hover:text-white'
            }`}
          >
            <FolderTree className="w-3.5 h-3.5" />
            <span>Органайзер</span>
          </button>

          <button
            onClick={() => setActiveTab('duplicates')}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded transition-colors cursor-pointer ${
              activeTab === 'duplicates'
                ? 'bg-[#39C5BB] text-black shadow-xs'
                : 'text-[#A6ABB8] hover:text-white'
            }`}
          >
            <Copy className="w-3.5 h-3.5" />
            <span>Дубликаты</span>
          </button>
        </div>

        {/* Center / Right controls */}
        <div className="flex items-center gap-4">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-[#686c7d]" />
            <input
              type="text"
              placeholder="Поиск по названию, артисту, альбому, пути..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-7 py-1 text-xs bg-[#121317] border border-[#2e313e] focus:border-[#39C5BB] rounded-md text-white outline-none w-64 lg:w-80 transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-2 p-0.5 text-[#686c7d] hover:text-white cursor-pointer"
                title="Очистить поиск"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Send selected / active track / folder to LierSync */}
          <button
            onClick={handleSendToLierSync}
            disabled={isSendingToSync}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded bg-[#262833] hover:bg-[#323544] text-[#39C5BB] border border-[#39C5BB]/30 transition-colors cursor-pointer"
            title="Передать выбранные треки (или текущий трек/папку) на телефон или ПК через LierSync (:8768)"
          >
            {isSendingToSync ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
            <span>В LierSync</span>
          </button>

          {/* LIER Ecosystem status & LierEX-Q local server indicator */}
          <button
            onClick={() => {
              setShowEcosystemModal(true);
              refreshEcosystem();
            }}
            className="flex items-center gap-2 px-2.5 py-1 bg-[#15161c] hover:bg-[#1f212b] border border-[#292b37] rounded-md text-xs cursor-pointer transition-colors"
            title="Статус экосистемы LIER и локальных мостов"
          >
            <Radio className="w-3.5 h-3.5 text-[#39C5BB] animate-pulse" />
            <span className="text-[11px] text-[#A6AAB8]">LIER (8766)</span>
            <Globe className="w-3.5 h-3.5 text-[#8B0000]" />
          </button>
        </div>
      </header>

      {ecosystemBanner && (
        <div className="px-4 py-1.5 bg-[#1b2226] border-b border-[#39C5BB]/30 text-xs text-[#E0E2EC] flex items-center justify-between">
          <span>{ecosystemBanner}</span>
          <button
            onClick={() => setEcosystemBanner(null)}
            className="text-[#8E92A2] hover:text-white cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main Workspace Body */}
      <main className="flex-1 flex gap-3 p-3 overflow-hidden">
        {activeTab === 'library' && (
          <>
            <TrackTable
              tracks={tracks}
              selectedTrackId={selectedTrackId}
              onSelectTrack={(t) => setSelectedTrackId(t.id)}
              searchQuery={searchQuery}
              checkedTrackIds={checkedTrackIds}
              onToggleCheckTrack={handleToggleCheckTrack}
              onSelectAllFiltered={handleSelectAllFiltered}
              onClearChecked={handleClearChecked}
              onSendToOrganizer={handleSendToOrganizer}
            />
            <EditPanel
              track={activeTrack}
              onSave={handleSaveTrack}
              onSearchMusicBrainz={handleSearchMusicBrainz}
              onReload={handleReloadActiveTrack}
              isSaving={isSaving}
              isReloading={isReloading}
            />
          </>
        )}

        {activeTab === 'organizer' && (
          <OrganizerTab
            tracks={tracks}
            currentFolder={currentFolder}
            onRefreshLibrary={handleRescanFolder}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            selectedTrackIds={checkedTrackIds}
            onUpdateSelectedTrackIds={setCheckedTrackIds}
          />
        )}

        {activeTab === 'duplicates' && (
          <DuplicatesTab
            tracks={tracks}
            currentFolder={currentFolder}
            onRefreshLibrary={handleRescanFolder}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
          />
        )}
      </main>

      {/* Import Modal from LierEX-Q */}
      <ImportModal
        payload={importModalPayload}
        activeTrack={activeTrack}
        onApply={handleApplyImport}
        onClose={() => setImportModalPayload(null)}
      />

      {/* LIER Ecosystem & About Modal */}
      {showEcosystemModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#181920] border border-[#2e313e] rounded-lg shadow-2xl overflow-hidden">
            <div className="px-4 py-3 bg-[#1f2027] border-b border-[#2e313e] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-[#39C5BB]" />
                <span className="font-semibold text-sm text-white">Экосистема LIER · LierTags v1.1</span>
              </div>
              <button
                onClick={() => setShowEcosystemModal(false)}
                className="text-[#8E92A2] hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3 text-xs">
              <div className="space-y-2">
                {ecosystemApps.map((app) => (
                  <div
                    key={app.id}
                    className="flex items-center justify-between p-2 rounded bg-[#121317] border border-[#292c3a]"
                  >
                    <div>
                      <div className="font-semibold text-white">{app.name}</div>
                      <div className="text-[11px] text-[#828698]">127.0.0.1:{app.port}</div>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded font-mono ${
                        app.online
                          ? 'bg-[#39C5BB]/15 text-[#39C5BB]'
                          : 'bg-[#262833] text-[#828698]'
                      }`}
                    >
                      {app.online ? `ONLINE (${app.detail})` : 'offline'}
                    </span>
                  </div>
                ))}
              </div>
              <div className="pt-2 border-t border-[#292c3a] text-[#9EA2B0] space-y-1">
                <div>Разработчик: LaRevole (LaRCorp)</div>
                <div>Лицензия: GNU General Public License v3.0 (GPLv3)</div>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={refreshEcosystem}
                  className="px-3 py-1.5 rounded bg-[#262833] hover:bg-[#323544] text-[#39C5BB] border border-[#36394a] cursor-pointer"
                >
                  Обновить статус
                </button>
                <button
                  onClick={() => setShowEcosystemModal(false)}
                  className="px-3 py-1.5 rounded bg-[#8B0000] hover:bg-[#a00000] text-white cursor-pointer"
                >
                  Закрыть
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
