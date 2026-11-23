import React, { useState, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { Track, OrganizePreviewItem, OrganizeAction, OrganizeSummary } from '../types';
import {
  FolderSync,
  FolderOpen,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  FileCheck,
  RefreshCw,
  FolderTree,
  AlertCircle,
  Search,
  X,
  CheckSquare,
  Square,
  UserCheck,
  Filter,
  ArrowLeft,
} from 'lucide-react';

interface OrganizerTabProps {
  tracks: Track[];
  currentFolder: string | null;
  onRefreshLibrary: () => Promise<void>;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  selectedTrackIds: Set<string>;
  onUpdateSelectedTrackIds: (ids: Set<string>) => void;
}

const PRESET_TEMPLATES = [
  { label: 'Исполнитель / Альбом / Трек - Название', template: '{Artist}/{Album}/{TrackNumber} - {Title}' },
  { label: 'Исполнитель / Альбом / Название', template: '{Artist}/{Album}/{Title}' },
  { label: 'Жанр / Исполнитель / Название', template: '{Genre}/{Artist}/{Title}' },
  { label: 'Год / Альбом / Трек - Название', template: '{Year}/{Album}/{TrackNumber} - {Title}' },
  { label: 'Исполнитель - Название (в одну папку)', template: '{Artist} - {Title}' },
];

export const OrganizerTab: React.FC<OrganizerTabProps> = ({
  tracks,
  currentFolder,
  onRefreshLibrary,
  searchQuery,
  onSearchChange,
  selectedTrackIds,
  onUpdateSelectedTrackIds,
}) => {
  const [template, setTemplate] = useState<string>('{Artist}/{Album}/{TrackNumber} - {Title}');
  const [targetFolder, setTargetFolder] = useState<string>(currentFolder || '');
  const [selectedArtist, setSelectedArtist] = useState<string>('all');
  const [previewItems, setPreviewItems] = useState<OrganizePreviewItem[]>([]);
  const [checkedPreviewPaths, setCheckedPreviewPaths] = useState<Set<string>>(new Set());
  const [isLoadingPreview, setIsLoadingPreview] = useState<boolean>(false);
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [showConfirmModal, setShowConfirmModal] = useState<boolean>(false);
  const [summaryResult, setSummaryResult] = useState<OrganizeSummary | null>(null);
  const [filterMode, setFilterMode] = useState<'all' | 'movable' | 'conflicts'>('all');

  // Extract unique artists list with track counts
  const artistList = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of tracks) {
      const art = t.metadata.artist?.trim() || 'Без исполнителя';
      map.set(art, (map.get(art) || 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [tracks]);

  // Filter candidate tracks by search query and selected artist
  const filteredCandidates = useMemo(() => {
    return tracks.filter((t) => {
      // 1. Artist filter
      if (selectedArtist !== 'all') {
        const art = t.metadata.artist?.trim() || 'Без исполнителя';
        if (art.toLowerCase() !== selectedArtist.toLowerCase()) return false;
      }

      // 2. Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const title = (t.metadata.title || '').toLowerCase();
        const artist = (t.metadata.artist || '').toLowerCase();
        const album = (t.metadata.album || '').toLowerCase();
        const genre = (t.metadata.genre || '').toLowerCase();
        const fileName = (t.file_name || '').toLowerCase();
        const filePath = (t.file_path || '').toLowerCase();
        const match =
          title.includes(q) ||
          artist.includes(q) ||
          album.includes(q) ||
          genre.includes(q) ||
          fileName.includes(q) ||
          filePath.includes(q);
        if (!match) return false;
      }

      return true;
    });
  }, [tracks, selectedArtist, searchQuery]);

  // Target folder picker
  const handleSelectTargetFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Выберите целевую папку для перемещения',
      });
      if (selected && typeof selected === 'string') {
        setTargetFolder(selected);
      }
    } catch (err) {
      console.error('Target folder selection error:', err);
    }
  };

  // Selection helpers
  const handleToggleTrack = (trackId: string) => {
    const next = new Set(selectedTrackIds);
    if (next.has(trackId)) {
      next.delete(trackId);
    } else {
      next.add(trackId);
    }
    onUpdateSelectedTrackIds(next);
  };

  const handleSelectAllFiltered = () => {
    const next = new Set(selectedTrackIds);
    for (const t of filteredCandidates) {
      next.add(t.id);
    }
    onUpdateSelectedTrackIds(next);
  };

  const handleSelectOnlyFiltered = () => {
    const next = new Set<string>();
    for (const t of filteredCandidates) {
      next.add(t.id);
    }
    onUpdateSelectedTrackIds(next);
  };

  const handleClearSelection = () => {
    onUpdateSelectedTrackIds(new Set());
  };

  // Select all tracks for chosen artist
  const handleSelectArtistTracks = (artistName: string) => {
    setSelectedArtist(artistName);
    const next = new Set<string>();
    for (const t of tracks) {
      const art = t.metadata.artist?.trim() || 'Без исполнителя';
      if (art.toLowerCase() === artistName.toLowerCase()) {
        next.add(t.id);
      }
    }
    onUpdateSelectedTrackIds(next);
  };

  // Determine which tracks are being organized:
  // If user has checked specific tracks, use those.
  // Otherwise, if user has filtered tracks (by artist/search), offer to use those.
  const tracksToOrganize = useMemo(() => {
    if (selectedTrackIds.size > 0) {
      return tracks.filter((t) => selectedTrackIds.has(t.id));
    }
    return filteredCandidates;
  }, [tracks, selectedTrackIds, filteredCandidates]);

  // Generate preview
  const handleRunPreview = async () => {
    const dest = targetFolder || currentFolder;
    if (!dest) {
      alert('Укажите целевую папку для сортировки');
      return;
    }
    if (!template.trim()) {
      alert('Укажите шаблон сортировки');
      return;
    }
    if (tracksToOrganize.length === 0) {
      alert('Нет треков для сортировки. Выберите треки из списка или сбросьте фильтры.');
      return;
    }

    setIsLoadingPreview(true);
    setSummaryResult(null);
    try {
      const items = await invoke<OrganizePreviewItem[]>('preview_organize', {
        folderPath: currentFolder || undefined,
        targetFolder: dest,
        template,
        tracks: tracksToOrganize,
      });

      setPreviewItems(items);
      // By default, check all items that are ready/will move
      const initialChecked = new Set<string>();
      for (const it of items) {
        if (it.will_move) {
          initialChecked.add(it.original_path);
        }
      }
      setCheckedPreviewPaths(initialChecked);
    } catch (err) {
      console.error('Preview error:', err);
      alert(`Ошибка генерации предпросмотра: ${err}`);
    } finally {
      setIsLoadingPreview(false);
    }
  };

  // Toggle single item in preview table
  const handleTogglePreviewItem = (origPath: string) => {
    setCheckedPreviewPaths((prev) => {
      const next = new Set(prev);
      if (next.has(origPath)) {
        next.delete(origPath);
      } else {
        next.add(origPath);
      }
      return next;
    });
  };

  // Master toggle in preview table
  const handleToggleAllPreviewItems = () => {
    const movable = previewItems.filter((i) => i.will_move);
    const allChecked = movable.every((i) => checkedPreviewPaths.has(i.original_path));

    if (allChecked) {
      setCheckedPreviewPaths(new Set());
    } else {
      const next = new Set<string>();
      for (const it of movable) {
        next.add(it.original_path);
      }
      setCheckedPreviewPaths(next);
    }
  };

  const finalMovableActions: OrganizeAction[] = previewItems
    .filter((i) => i.will_move && checkedPreviewPaths.has(i.original_path))
    .map((item) => ({
      original_path: item.original_path,
      destination_path: item.destination_path,
    }));

  const handleExecuteOrganization = async () => {
    if (finalMovableActions.length === 0) return;

    setIsExecuting(true);
    setShowConfirmModal(false);
    try {
      const summary = await invoke<OrganizeSummary>('organize_files', {
        actions: finalMovableActions,
      });
      setSummaryResult(summary);
      await onRefreshLibrary();
      setPreviewItems([]);
      setCheckedPreviewPaths(new Set());
      onUpdateSelectedTrackIds(new Set());
    } catch (err) {
      console.error('Organization execute error:', err);
      alert(`Ошибка перемещения файлов: ${err}`);
    } finally {
      setIsExecuting(false);
    }
  };

  // Filter preview list
  const filteredPreview = previewItems.filter((item) => {
    if (filterMode === 'movable') return item.will_move;
    if (filterMode === 'conflicts') return item.status === 'target_exists' || item.status === 'missing_tags';
    return true;
  });

  return (
    <div className="flex-1 flex flex-col h-full bg-[#14151b] border border-[#262835] rounded-lg overflow-hidden shadow-xl">
      {/* Top Configuration Area */}
      <div className="p-4 bg-[#181921] border-b border-[#282a37] space-y-3">
        {/* Title & Quick Stats */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FolderTree className="w-5 h-5 text-[#39C5BB]" />
            <h2 className="text-sm font-bold text-white tracking-wide">
              Умная сортировка файлов (File Organizer)
            </h2>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="text-[#828698]">Всего в библиотеке:</span>
            <span className="font-semibold text-white">{tracks.length}</span>
            <span className="text-[#323544]">|</span>
            <span className="text-[#828698]">Выбрано для сортировки:</span>
            <span className={`font-bold ${selectedTrackIds.size > 0 ? 'text-[#39C5BB]' : 'text-amber-400'}`}>
              {selectedTrackIds.size > 0 ? selectedTrackIds.size : `${filteredCandidates.length} (все найденные)`}
            </span>
          </div>
        </div>

        {/* Filter Bar: Artist Selector & Search Query */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-2.5 items-center bg-[#13141a] p-2.5 rounded-md border border-[#2a2d3c]">
          {/* Artist Dropdown Filter */}
          <div className="lg:col-span-5 flex items-center gap-2">
            <UserCheck className="w-4 h-4 text-[#39C5BB] shrink-0" />
            <span className="text-xs text-[#9EA2B0] shrink-0">Исполнитель:</span>
            <select
              value={selectedArtist}
              onChange={(e) => {
                const val = e.target.value;
                if (val !== 'all') {
                  handleSelectArtistTracks(val);
                } else {
                  setSelectedArtist('all');
                }
              }}
              className="flex-1 px-2.5 py-1.5 bg-[#181922] border border-[#2e3142] focus:border-[#39C5BB] rounded text-xs text-white outline-none cursor-pointer"
            >
              <option value="all">Все исполнители ({artistList.length})</option>
              {artistList.map(([art, count]) => (
                <option key={art} value={art}>
                  {art} ({count} {count === 1 ? 'трек' : 'треков'})
                </option>
              ))}
            </select>
          </div>

          {/* Search Input */}
          <div className="lg:col-span-4 flex items-center gap-1.5 relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 text-[#686c7d]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Поиск артиста, трека, альбома..."
              className="w-full pl-8 pr-7 py-1.5 bg-[#181922] border border-[#2e3142] focus:border-[#39C5BB] rounded text-xs text-white outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => onSearchChange('')}
                className="absolute right-2 p-0.5 text-[#6b6f80] hover:text-white cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Quick Selection Buttons */}
          <div className="lg:col-span-3 flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={handleSelectOnlyFiltered}
              className="px-2.5 py-1 text-xs rounded bg-[#242735] hover:bg-[#32364a] text-[#39C5BB] border border-[#39C5BB]/30 transition-colors cursor-pointer shrink-0"
              title="Выбрать только отфильтрованные треки"
            >
              Выбрать найденные ({filteredCandidates.length})
            </button>

            {selectedTrackIds.size > 0 && (
              <button
                type="button"
                onClick={handleClearSelection}
                className="px-2 py-1 text-xs rounded bg-[#242735] hover:bg-[#32364a] text-[#9EA2B0] hover:text-white transition-colors cursor-pointer"
                title="Снять выделение"
              >
                Сброс
              </button>
            )}
          </div>
        </div>

        {/* Target Folder Selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#9EA2B0] w-28 shrink-0">Целевая папка:</span>
          <div className="flex-1 flex items-center gap-2 px-3 py-1.5 bg-[#121317] border border-[#2b2d39] rounded text-xs text-[#E0E2EC]">
            <FolderOpen className="w-4 h-4 text-[#39C5BB] shrink-0" />
            <span className="truncate flex-1 font-mono">{targetFolder || currentFolder || 'Не выбрана'}</span>
          </div>
          <button
            onClick={handleSelectTargetFolder}
            className="px-3 py-1.5 text-xs font-medium rounded bg-[#252734] hover:bg-[#323546] text-[#39C5BB] border border-[#39C5BB]/30 transition-colors cursor-pointer"
          >
            Выбрать папку...
          </button>
        </div>

        {/* Template Input & Run Preview Button */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#9EA2B0] w-28 shrink-0">Шаблон пути:</span>
          <input
            type="text"
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            placeholder="{Artist}/{Album}/{TrackNumber} - {Title}"
            className="flex-1 px-3 py-1.5 bg-[#121317] border border-[#2b2d39] focus:border-[#39C5BB] rounded text-xs font-mono text-white outline-none"
          />
          <button
            onClick={handleRunPreview}
            disabled={isLoadingPreview || (!targetFolder && !currentFolder) || tracksToOrganize.length === 0}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded bg-[#39C5BB] hover:bg-[#43ddd3] active:bg-[#2fa89f] text-black transition-colors shadow-md cursor-pointer disabled:opacity-50"
            title="Сформировать предпросмотр сортировки"
          >
            {isLoadingPreview ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <FolderSync className="w-3.5 h-3.5" />}
            <span>Предпросмотр ({tracksToOrganize.length})</span>
          </button>
        </div>

        {/* Preset Chips */}
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <span className="text-[11px] text-[#717586] mr-1">Шаблоны:</span>
          {PRESET_TEMPLATES.map((p, idx) => (
            <button
              key={idx}
              onClick={() => setTemplate(p.template)}
              className={`px-2 py-0.5 text-[11px] rounded transition-colors cursor-pointer border ${
                template === p.template
                  ? 'bg-[#39C5BB]/20 text-[#39C5BB] border-[#39C5BB]/50'
                  : 'bg-[#1e202a] hover:bg-[#272935] text-[#A6ABB8] border-[#2e3140]'
              }`}
              title={p.template}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Workspace: Candidate Track Selection or Preview Table */}
      {previewItems.length === 0 ? (
        /* View 1: Candidate Tracks Selection List */
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="px-4 py-2 bg-[#1b1c26] border-b border-[#282a37] flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <Filter className="w-3.5 h-3.5 text-[#39C5BB]" />
              <span className="font-semibold text-white">Выбор треков для сортировки</span>
              <span className="text-[#828698]">
                (найдено: {filteredCandidates.length}, выбрано: {selectedTrackIds.size})
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSelectAllFiltered}
                className="text-xs text-[#39C5BB] hover:underline cursor-pointer"
              >
                Выбрать все ({filteredCandidates.length})
              </button>
              <span className="text-[#323544]">|</span>
              <button
                type="button"
                onClick={handleClearSelection}
                className="text-xs text-[#9EA2B0] hover:text-white cursor-pointer"
              >
                Снять выбор
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {filteredCandidates.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-[#686c7d] space-y-2">
                <Search className="w-10 h-10 opacity-30 text-[#39C5BB]" />
                <p className="text-sm">Нет треков, соответствующих текущему поиску или фильтру исполнителя</p>
                <button
                  onClick={() => {
                    setSelectedArtist('all');
                    onSearchChange('');
                  }}
                  className="px-3 py-1 rounded bg-[#242735] text-xs text-[#39C5BB] hover:bg-[#303346] cursor-pointer"
                >
                  Сбросить фильтры
                </button>
              </div>
            ) : (
              <table className="w-full text-left text-xs border-collapse">
                <thead className="sticky top-0 bg-[#1e2027] text-[#8E92A2] font-medium border-b border-[#2b2d37] z-10 select-none">
                  <tr>
                    <th className="py-2 px-2 w-9 text-center">
                      <button
                        type="button"
                        onClick={() => {
                          const allChecked = filteredCandidates.every((t) => selectedTrackIds.has(t.id));
                          if (allChecked) {
                            handleClearSelection();
                          } else {
                            handleSelectAllFiltered();
                          }
                        }}
                        className="p-1 hover:text-white cursor-pointer"
                      >
                        {filteredCandidates.length > 0 && filteredCandidates.every((t) => selectedTrackIds.has(t.id)) ? (
                          <CheckSquare className="w-4 h-4 text-[#39C5BB]" />
                        ) : (
                          <Square className="w-4 h-4 text-[#525667]" />
                        )}
                      </button>
                    </th>
                    <th className="py-2 px-3">Исполнитель</th>
                    <th className="py-2 px-3">Название</th>
                    <th className="py-2 px-3">Альбом</th>
                    <th className="py-2 px-3">Путь к файлу</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1e202a]">
                  {filteredCandidates.map((track) => {
                    const isChecked = selectedTrackIds.has(track.id);
                    return (
                      <tr
                        key={track.id}
                        onClick={() => handleToggleTrack(track.id)}
                        className={`cursor-pointer transition-colors ${
                          isChecked ? 'bg-[#39C5BB]/15 text-white font-medium' : 'hover:bg-[#1c1d27] text-[#D0D4E4]'
                        }`}
                      >
                        <td
                          className="py-2 px-2 text-center"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleTrack(track.id);
                          }}
                        >
                          <button type="button" className="p-0.5 hover:text-white cursor-pointer">
                            {isChecked ? (
                              <CheckSquare className="w-4 h-4 text-[#39C5BB]" />
                            ) : (
                              <Square className="w-4 h-4 text-[#525667]" />
                            )}
                          </button>
                        </td>
                        <td className="py-2 px-3 font-semibold text-[#39C5BB] truncate max-w-[160px]">
                          {track.metadata.artist || '—'}
                        </td>
                        <td className="py-2 px-3 truncate max-w-[200px]">
                          {track.metadata.title || track.file_name}
                        </td>
                        <td className="py-2 px-3 truncate max-w-[160px] text-[#8E92A2]">
                          {track.metadata.album || '—'}
                        </td>
                        <td className="py-2 px-3 truncate font-mono text-[10px] text-[#6b7082]">
                          {track.file_path}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      ) : (
        /* View 2: Generated Preview Table */
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Summary / Filter & Move Bar */}
          <div className="px-4 py-2 bg-[#1b1c26] border-b border-[#282a37] flex items-center justify-between text-xs">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setPreviewItems([])}
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-[#252837] hover:bg-[#32364a] text-[#39C5BB] transition-colors cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Назад к выбору треков</span>
              </button>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setFilterMode('all')}
                  className={`px-2 py-0.5 rounded transition-colors ${
                    filterMode === 'all' ? 'bg-[#2b2e3e] text-white font-semibold' : 'text-[#9EA2B0] hover:text-white'
                  }`}
                >
                  Все ({previewItems.length})
                </button>
                <button
                  onClick={() => setFilterMode('movable')}
                  className={`px-2 py-0.5 rounded transition-colors ${
                    filterMode === 'movable'
                      ? 'bg-[#39C5BB]/20 text-[#39C5BB] font-semibold'
                      : 'text-[#39C5BB] hover:bg-[#39C5BB]/10'
                  }`}
                >
                  К перемещению ({previewItems.filter((i) => i.will_move).length})
                </button>
                <button
                  onClick={() => setFilterMode('conflicts')}
                  className={`px-2 py-0.5 rounded transition-colors ${
                    filterMode === 'conflicts'
                      ? 'bg-[#8B0000]/20 text-[#ff8080] font-semibold'
                      : 'text-[#9EA2B0] hover:text-[#ff8080]'
                  }`}
                >
                  Коллизии / Без тегов ({previewItems.filter((i) => i.status === 'target_exists' || i.status === 'missing_tags').length})
                </button>
              </div>
            </div>

            {/* Execute Move Button */}
            <button
              onClick={() => setShowConfirmModal(true)}
              disabled={finalMovableActions.length === 0 || isExecuting}
              className="flex items-center gap-2 px-4 py-1.5 rounded font-semibold text-xs text-white bg-[#8B0000] hover:bg-[#a30000] active:bg-[#720000] shadow-md transition-colors cursor-pointer disabled:opacity-40"
            >
              {isExecuting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <FileCheck className="w-3.5 h-3.5" />}
              <span>Переместить выбранные ({finalMovableActions.length})</span>
            </button>
          </div>

          <div className="flex-1 overflow-auto p-3">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="sticky top-0 bg-[#1e2027] text-[#8E92A2] font-medium border-b border-[#2b2d37] z-10 select-none">
                <tr className="text-[11px] uppercase tracking-wider">
                  <th className="py-2 px-2 w-9 text-center">
                    <button
                      type="button"
                      onClick={handleToggleAllPreviewItems}
                      className="p-1 hover:text-white cursor-pointer"
                      title="Выбрать / Снять выбор всех"
                    >
                      <CheckSquare className="w-4 h-4 text-[#39C5BB]" />
                    </button>
                  </th>
                  <th className="py-2 px-3 w-1/3">Исходный файл</th>
                  <th className="py-2 px-3 w-1/2">Новый путь назначения</th>
                  <th className="py-2 px-3 w-28 text-center">Статус</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1e202a]">
                {filteredPreview.map((item, idx) => {
                  const isChecked = checkedPreviewPaths.has(item.original_path);
                  return (
                    <tr
                      key={idx}
                      onClick={() => handleTogglePreviewItem(item.original_path)}
                      className={`cursor-pointer transition-colors ${
                        isChecked ? 'bg-[#1f212c]' : 'opacity-60 hover:opacity-100 hover:bg-[#1a1b24]'
                      }`}
                    >
                      <td
                        className="py-2 px-2 text-center"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleTogglePreviewItem(item.original_path);
                        }}
                      >
                        <button type="button" className="p-0.5 hover:text-white cursor-pointer">
                          {isChecked ? (
                            <CheckSquare className="w-4 h-4 text-[#39C5BB]" />
                          ) : (
                            <Square className="w-4 h-4 text-[#525667]" />
                          )}
                        </button>
                      </td>

                      <td className="py-2 px-3">
                        <div className="font-medium text-white truncate" title={item.file_name}>
                          {item.file_name}
                        </div>
                        <div className="text-[10px] text-[#727688] truncate font-mono" title={item.original_path}>
                          {item.original_path}
                        </div>
                      </td>

                      <td className="py-2 px-3">
                        <div className="flex items-center gap-1.5 font-mono text-[#39C5BB] truncate" title={item.relative_destination}>
                          <ArrowRight className="w-3 h-3 shrink-0 text-[#686c7d]" />
                          <span className="truncate">{item.relative_destination}</span>
                        </div>
                        <div className="text-[10px] text-[#727688] truncate font-mono" title={item.destination_path}>
                          {item.destination_path}
                        </div>
                      </td>

                      <td className="py-2 px-3 text-center">
                        {item.status === 'ready' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-[#39C5BB]/15 text-[#39C5BB] border border-[#39C5BB]/30">
                            <CheckCircle2 className="w-3 h-3" />
                            Готов
                          </span>
                        )}
                        {item.status === 'identical' && (
                          <span className="inline-block px-2 py-0.5 rounded text-[10px] font-medium bg-[#242633] text-[#868a9c]">
                            Без изм.
                          </span>
                        )}
                        {item.status === 'missing_tags' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-amber-500/15 text-amber-400 border border-amber-500/30">
                            <AlertTriangle className="w-3 h-3" />
                            Мало тегов
                          </span>
                        )}
                        {item.status === 'target_exists' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-[#8B0000]/20 text-[#ff8080] border border-[#8B0000]/40">
                            <AlertCircle className="w-3 h-3" />
                            Уже есть
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-[#1b1c24] border border-[#2e3140] rounded-lg max-w-md w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-white">
              <div className="w-10 h-10 rounded-full bg-[#8B0000]/20 border border-[#8B0000]/40 flex items-center justify-center text-[#ff6b6b]">
                <FolderSync className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-sm">Подтверждение перемещения</h3>
                <p className="text-xs text-[#9EA2B0]">
                  Перемещение <span className="font-bold text-white">{finalMovableActions.length}</span> выбранных файлов
                </p>
              </div>
            </div>

            <p className="text-xs text-[#C8CBD8] leading-relaxed">
              Файлы будут физически перемещены в новые папки в соответствии с шаблоном.
              Синхронизированные тексты (.lrc) будут перемещены автоматически вместе с аудиофайлами.
            </p>

            <div className="p-3 bg-[#13141a] border border-[#262835] rounded text-[11px] font-mono text-[#39C5BB] truncate">
              {targetFolder || currentFolder}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowConfirmModal(false)}
                className="px-3.5 py-1.5 rounded text-xs text-[#A6ABB8] hover:bg-[#282a37] transition-colors cursor-pointer"
              >
                Отмена
              </button>
              <button
                onClick={handleExecuteOrganization}
                disabled={isExecuting}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-semibold bg-[#8B0000] hover:bg-[#a60000] text-white shadow-md transition-colors cursor-pointer"
              >
                {isExecuting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
                <span>Да, переместить файлы</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Summary Notification Modal */}
      {summaryResult && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-[#1b1c24] border border-[#2e3140] rounded-lg max-w-lg w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[#39C5BB]/20 border border-[#39C5BB]/40 flex items-center justify-center text-[#39C5BB]">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-white">Сортировка завершена</h3>
                <p className="text-xs text-[#9EA2B0]">
                  Перемещено: <span className="text-[#39C5BB] font-semibold">{summaryResult.moved_count}</span> | Пропущено: {summaryResult.skipped_count} | Ошибок: {summaryResult.error_count}
                </p>
              </div>
            </div>

            <div className="max-h-56 overflow-y-auto bg-[#121317] border border-[#262835] rounded p-3 text-[11px] font-mono text-[#B0B4C4] space-y-1">
              {summaryResult.logs.map((log, idx) => (
                <div key={idx} className="truncate">{log}</div>
              ))}
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setSummaryResult(null)}
                className="px-4 py-1.5 rounded text-xs font-semibold bg-[#39C5BB] text-black hover:bg-[#4de1d7] transition-colors cursor-pointer"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};