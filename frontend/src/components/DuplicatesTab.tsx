import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Track, DuplicateGroup, DuplicateMode, DeleteSummary } from '../types';
import {
  Copy,
  Trash2,
  RefreshCw,
  Search,
  CheckSquare,
  Square,
  ShieldAlert,
  Sparkles,
  Music,
  CheckCircle2,
} from 'lucide-react';

interface DuplicatesTabProps {
  tracks: Track[];
  currentFolder: string | null;
  onRefreshLibrary: () => Promise<void>;
}

export const DuplicatesTab: React.FC<DuplicatesTabProps> = ({
  tracks,
  currentFolder,
  onRefreshLibrary,
}) => {
  const [mode, setMode] = useState<DuplicateMode>('size_duration');
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([]);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [showDeleteModal, setShowDeleteModal] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [deleteResult, setDeleteResult] = useState<DeleteSummary | null>(null);

  const handleScanDuplicates = async () => {
    setIsScanning(true);
    setSelectedPaths(new Set());
    setDeleteResult(null);
    try {
      const groups = await invoke<DuplicateGroup[]>('find_duplicates', {
        folderPath: currentFolder || undefined,
        mode,
        tracks: tracks.length > 0 ? tracks : undefined,
      });
      setDuplicateGroups(groups);
    } catch (err) {
      console.error('Duplicate scan error:', err);
      alert(`Ошибка поиска дубликатов: ${err}`);
    } finally {
      setIsScanning(false);
    }
  };

  // Toggle single file selection
  const toggleFileSelection = (filePath: string) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
  };

  // Select all lower-quality duplicates (keep index 0 which has best bitrate/size)
  const handleSelectLowerQuality = () => {
    const toSelect = new Set<string>();
    for (const group of duplicateGroups) {
      // Index 0 is best quality; select items from index 1 onwards
      for (let i = 1; i < group.files.length; i++) {
        toSelect.add(group.files[i].file_path);
      }
    }
    setSelectedPaths(toSelect);
  };

  // Clear all selections
  const handleClearSelection = () => {
    setSelectedPaths(new Set());
  };

  // Calculate total bytes selected
  const totalSelectedBytes = duplicateGroups
    .flatMap((g) => g.files)
    .filter((f) => selectedPaths.has(f.file_path))
    .reduce((acc, f) => acc + f.file_size_bytes, 0);

  const formatMb = (bytes: number) => {
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Delete execution
  const handleDeleteSelected = async () => {
    if (selectedPaths.size === 0) return;

    setIsDeleting(true);
    setShowDeleteModal(false);
    try {
      const pathsArray = Array.from(selectedPaths);
      const summary = await invoke<DeleteSummary>('delete_duplicate_files', {
        filePaths: pathsArray,
      });

      setDeleteResult(summary);

      // Remove deleted files from current duplicate groups
      setDuplicateGroups((prev) =>
        prev
          .map((g) => ({
            ...g,
            files: g.files.filter((f) => !selectedPaths.has(f.file_path)),
          }))
          .filter((g) => g.files.length >= 2)
      );

      setSelectedPaths(new Set());
      await onRefreshLibrary();
    } catch (err) {
      console.error('Delete error:', err);
      alert(`Ошибка удаления файлов: ${err}`);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#14151b] border border-[#262835] rounded-lg overflow-hidden shadow-xl">
      {/* Top Controls Header */}
      <div className="p-4 bg-[#181921] border-b border-[#282a37] space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Copy className="w-5 h-5 text-[#39C5BB]" />
            <h2 className="text-sm font-bold text-white tracking-wide">
              Поиск дубликатов (Duplicate Finder)
            </h2>
          </div>
          <div className="text-xs text-[#828698]">
            Файлов для анализа: <span className="font-semibold text-white">{tracks.length}</span>
          </div>
        </div>

        {/* Mode Selector & Scan Button */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#9EA2B0] mr-1">Режим поиска:</span>
            <div className="flex rounded-md bg-[#121317] p-0.5 border border-[#2a2d3c]">
              <button
                type="button"
                onClick={() => setMode('size_duration')}
                className={`px-3 py-1 text-xs rounded transition-colors cursor-pointer ${
                  mode === 'size_duration'
                    ? 'bg-[#39C5BB] text-black font-semibold shadow-xs'
                    : 'text-[#A6ABB8] hover:text-white'
                }`}
                title="Поиск треков с точно совпадающим размером и длительностью"
              >
                Размер и длительность (Быстро)
              </button>
              <button
                type="button"
                onClick={() => setMode('metadata')}
                className={`px-3 py-1 text-xs rounded transition-colors cursor-pointer ${
                  mode === 'metadata'
                    ? 'bg-[#39C5BB] text-black font-semibold shadow-xs'
                    : 'text-[#A6ABB8] hover:text-white'
                }`}
                title="Поиск треков по совпадению названия трека и исполнителя"
              >
                По метаданным (Артист + Название)
              </button>
              <button
                type="button"
                onClick={() => setMode('hash')}
                className={`px-3 py-1 text-xs rounded transition-colors cursor-pointer ${
                  mode === 'hash'
                    ? 'bg-[#39C5BB] text-black font-semibold shadow-xs'
                    : 'text-[#A6ABB8] hover:text-white'
                }`}
                title="Побайтовое хеширование SHA-256 для выявления 100% идентичных файлов"
              >
                По хешу SHA-256 (Точно)
              </button>
            </div>
          </div>

          <button
            onClick={handleScanDuplicates}
            disabled={isScanning || tracks.length === 0}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded bg-[#39C5BB] hover:bg-[#45ded4] active:bg-[#2fa89f] text-black transition-colors shadow-md cursor-pointer disabled:opacity-50"
          >
            {isScanning ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
            <span>{isScanning ? 'Сканирование...' : 'Сканировать дубликаты'}</span>
          </button>
        </div>

        {/* Quick Selection Helpers (visible when duplicates are present) */}
        {duplicateGroups.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#262835]">
            <div className="flex items-center gap-2">
              <span className="text-xs text-[#828698]">Быстрый выбор:</span>
              <button
                type="button"
                onClick={handleSelectLowerQuality}
                className="flex items-center gap-1 px-2.5 py-1 text-xs rounded bg-[#242735] hover:bg-[#303346] text-[#39C5BB] border border-[#39C5BB]/30 transition-colors cursor-pointer"
                title="Оставить трек с максимальным качеством и выделить остальные копии"
              >
                <Sparkles className="w-3 h-3" />
                <span>Выделить худшие копии</span>
              </button>
              <button
                type="button"
                onClick={handleClearSelection}
                className="px-2.5 py-1 text-xs rounded bg-[#242735] hover:bg-[#303346] text-[#9EA2B0] transition-colors cursor-pointer"
              >
                Снять выбор
              </button>
            </div>

            <div className="flex items-center gap-3">
              <div className="text-xs text-[#9EA2B0]">
                Выбрано: <span className="font-semibold text-white">{selectedPaths.size}</span> файлов{' '}
                {selectedPaths.size > 0 && (
                  <span className="text-[#39C5BB]">({formatMb(totalSelectedBytes)})</span>
                )}
              </div>

              <button
                type="button"
                onClick={() => setShowDeleteModal(true)}
                disabled={selectedPaths.size === 0 || isDeleting}
                className="flex items-center gap-1.5 px-3.5 py-1 text-xs font-semibold rounded bg-[#8B0000] hover:bg-[#a60000] active:bg-[#720000] text-white shadow-md transition-colors cursor-pointer disabled:opacity-40"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Удалить выбранные ({selectedPaths.size})</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Main Groups List Body */}
      <div className="flex-1 overflow-auto p-4 space-y-3">
        {duplicateGroups.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-[#686c7d] space-y-2">
            <Copy className="w-12 h-12 opacity-30 text-[#39C5BB]" />
            <p className="text-sm">
              {isScanning ? 'Выполняется анализ библиотеки...' : 'Дубликаты не найдены или поиск еще не запускался'}
            </p>
            <p className="text-xs text-[#525565]">
              Выберите режим и нажмите «Сканировать дубликаты»
            </p>
          </div>
        ) : (
          duplicateGroups.map((group) => {
            const groupFileCount = group.files.length;

            return (
              <div
                key={group.group_id}
                className="bg-[#181a23] border border-[#272a39] rounded-lg overflow-hidden shadow-sm"
              >
                {/* Group Header */}
                <div className="px-3.5 py-2.5 bg-[#1f212c] border-b border-[#292c3c] flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <Music className="w-4 h-4 text-[#39C5BB]" />
                    <div className="font-semibold text-xs text-white">
                      {group.artist ? `${group.artist} — ` : ''}{group.title}
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-[#272a38] text-[#9EA2B0] border border-[#373a4e]">
                      {groupFileCount} копии
                    </span>
                  </div>

                  <span className="text-[11px] font-mono text-[#39C5BB]/80 bg-[#39C5BB]/10 px-2 py-0.5 rounded">
                    {group.match_reason}
                  </span>
                </div>

                {/* File items within this group */}
                <div className="divide-y divide-[#212432]">
                  {group.files.map((file, fileIdx) => {
                    const isSelected = selectedPaths.has(file.file_path);
                    const isBestQuality = fileIdx === 0;

                    return (
                      <div
                        key={file.file_path}
                        onClick={() => toggleFileSelection(file.file_path)}
                        className={`px-3.5 py-2.5 flex items-center justify-between text-xs cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-[#8B0000]/15 hover:bg-[#8B0000]/25'
                            : 'hover:bg-[#1f212c]'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1 mr-4">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleFileSelection(file.file_path);
                            }}
                            className="text-[#9EA2B0] hover:text-white cursor-pointer"
                          >
                            {isSelected ? (
                              <CheckSquare className="w-4 h-4 text-[#ff7070]" />
                            ) : (
                              <Square className="w-4 h-4 text-[#525667]" />
                            )}
                          </button>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-white truncate" title={file.file_name}>
                                {file.file_name}
                              </span>
                              {isBestQuality && (
                                <span className="text-[10px] px-1.5 py-0.2 rounded font-semibold bg-[#39C5BB]/20 text-[#39C5BB] border border-[#39C5BB]/40 shrink-0">
                                  Лучшее качество
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-[#717688] truncate font-mono" title={file.file_path}>
                              {file.file_path}
                            </div>
                          </div>
                        </div>

                        {/* Specs column */}
                        <div className="flex items-center gap-3 shrink-0 text-[11px] text-[#A6ABB8]">
                          <span className="px-1.5 py-0.5 rounded bg-[#131418] border border-[#2a2d3c] uppercase font-mono text-[10px] text-[#39C5BB]">
                            {file.extension}
                          </span>
                          <span className="font-mono text-[#D0D4E4]">
                            {file.bitrate_kbps ? `${file.bitrate_kbps} kbps` : '—'}
                          </span>
                          <span className="font-mono text-[#8E92A2]">{formatDuration(file.duration_seconds)}</span>
                          <span className="font-mono text-[#8E92A2] w-18 text-right">
                            {formatMb(file.file_size_bytes)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-[#1b1c24] border border-[#2e3140] rounded-lg max-w-lg w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[#8B0000]/20 border border-[#8B0000]/40 flex items-center justify-center text-[#ff6b6b]">
                <ShieldAlert className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-white">Удаление дубликатов</h3>
                <p className="text-xs text-[#ff8080]">
                  Внимание! Будет безвозвратно удалено {selectedPaths.size} файлов ({formatMb(totalSelectedBytes)})
                </p>
              </div>
            </div>

            <p className="text-xs text-[#C8CBD8] leading-relaxed">
              Выбранные файлы будут полностью удалены с диска. Если рядом находятся синхронизированные тексты (.lrc), они также будут удалены.
            </p>

            {/* List of files to delete */}
            <div className="max-h-48 overflow-y-auto bg-[#121317] border border-[#262835] rounded p-2.5 text-[11px] font-mono text-[#ff9999] space-y-1">
              {Array.from(selectedPaths).map((p, idx) => (
                <div key={idx} className="truncate">{p}</div>
              ))}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                className="px-3.5 py-1.5 rounded text-xs text-[#A6ABB8] hover:bg-[#282a37] transition-colors cursor-pointer"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleDeleteSelected}
                disabled={isDeleting}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-semibold bg-[#8B0000] hover:bg-[#a60000] text-white shadow-md transition-colors cursor-pointer"
              >
                {isDeleting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
                <span>Удалить навсегда</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Result Modal */}
      {deleteResult && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-[#1b1c24] border border-[#2e3140] rounded-lg max-w-md w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[#39C5BB]/20 border border-[#39C5BB]/40 flex items-center justify-center text-[#39C5BB]">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-white">Удаление выполнено</h3>
                <p className="text-xs text-[#9EA2B0]">
                  Удалено файлов: <span className="text-[#39C5BB] font-semibold">{deleteResult.deleted_count}</span> | Ошибок: {deleteResult.failed_count}
                </p>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setDeleteResult(null)}
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