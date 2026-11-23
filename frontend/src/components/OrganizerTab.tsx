import React, { useState } from 'react';
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
  HelpCircle,
  Check,
} from 'lucide-react';

interface OrganizerTabProps {
  tracks: Track[];
  currentFolder: string | null;
  onRefreshLibrary: () => Promise<void>;
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
}) => {
  const [template, setTemplate] = useState<string>('{Artist}/{Album}/{TrackNumber} - {Title}');
  const [targetFolder, setTargetFolder] = useState<string>(currentFolder || '');
  const [previewItems, setPreviewItems] = useState<OrganizePreviewItem[]>([]);
  const [isLoadingPreview, setIsLoadingPreview] = useState<boolean>(false);
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [showConfirmModal, setShowConfirmModal] = useState<boolean>(false);
  const [summaryResult, setSummaryResult] = useState<OrganizeSummary | null>(null);
  const [filterMode, setFilterMode] = useState<'all' | 'movable' | 'conflicts'>('all');

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

    setIsLoadingPreview(true);
    setSummaryResult(null);
    try {
      const items = await invoke<OrganizePreviewItem[]>('preview_organize', {
        folderPath: currentFolder || undefined,
        targetFolder: dest,
        template,
        tracks: tracks.length > 0 ? tracks : undefined,
      });
      setPreviewItems(items);
    } catch (err) {
      console.error('Preview error:', err);
      alert(`Ошибка генерации предпросмотра: ${err}`);
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const movableItems = previewItems.filter((i) => i.will_move);

  const handleExecuteOrganization = async () => {
    if (movableItems.length === 0) return;

    setIsExecuting(true);
    setShowConfirmModal(false);
    try {
      const actions: OrganizeAction[] = movableItems.map((item) => ({
        original_path: item.original_path,
        destination_path: item.destination_path,
      }));

      const summary = await invoke<OrganizeSummary>('organize_files', { actions });
      setSummaryResult(summary);
      await onRefreshLibrary();
      // Re-run preview on remaining/new state
      setPreviewItems([]);
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
      {/* Top Config Header */}
      <div className="p-4 bg-[#181921] border-b border-[#282a37] space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FolderTree className="w-5 h-5 text-[#39C5BB]" />
            <h2 className="text-sm font-bold text-white tracking-wide">
              Умная сортировка файлов (File Organizer)
            </h2>
          </div>
          <div className="text-xs text-[#828698]">
            Файлов в библиотеке: <span className="font-semibold text-white">{tracks.length}</span>
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

        {/* Template Input */}
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
            disabled={isLoadingPreview || (!targetFolder && !currentFolder)}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded bg-[#39C5BB] hover:bg-[#43ddd3] active:bg-[#2fa89f] text-black transition-colors shadow-md cursor-pointer disabled:opacity-50"
          >
            {isLoadingPreview ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <FolderSync className="w-3.5 h-3.5" />}
            <span>Предпросмотр</span>
          </button>
        </div>

        {/* Preset Chips */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
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

        {/* Token Helpers */}
        <div className="flex items-center gap-2 text-[10px] text-[#696d7e]">
          <HelpCircle className="w-3 h-3 text-[#39C5BB]" />
          <span>Переменные:</span>
          <span className="font-mono text-[#9EA2B0]">{'{Artist}'}</span>
          <span className="font-mono text-[#9EA2B0]">{'{Album}'}</span>
          <span className="font-mono text-[#9EA2B0]">{'{Title}'}</span>
          <span className="font-mono text-[#9EA2B0]">{'{TrackNumber}'}</span>
          <span className="font-mono text-[#9EA2B0]">{'{Year}'}</span>
          <span className="font-mono text-[#9EA2B0]">{'{Genre}'}</span>
          <span className="font-mono text-[#9EA2B0]">{'{ext}'}</span>
        </div>
      </div>

      {/* Summary / Stats and Execution Bar */}
      {previewItems.length > 0 && (
        <div className="px-4 py-2.5 bg-[#1b1c26] border-b border-[#282a37] flex items-center justify-between">
          {/* Filter Pills */}
          <div className="flex items-center gap-2 text-xs">
            <button
              onClick={() => setFilterMode('all')}
              className={`px-2.5 py-1 rounded transition-colors ${
                filterMode === 'all'
                  ? 'bg-[#2b2e3e] text-white font-semibold'
                  : 'text-[#9EA2B0] hover:text-white'
              }`}
            >
              Все ({previewItems.length})
            </button>
            <button
              onClick={() => setFilterMode('movable')}
              className={`px-2.5 py-1 rounded transition-colors flex items-center gap-1 ${
                filterMode === 'movable'
                  ? 'bg-[#39C5BB]/20 text-[#39C5BB] font-semibold border border-[#39C5BB]/40'
                  : 'text-[#39C5BB] hover:bg-[#39C5BB]/10'
              }`}
            >
              <Check className="w-3 h-3" />
              <span>К перемещению ({movableItems.length})</span>
            </button>
            <button
              onClick={() => setFilterMode('conflicts')}
              className={`px-2.5 py-1 rounded transition-colors ${
                filterMode === 'conflicts'
                  ? 'bg-[#8B0000]/20 text-[#ff8080] font-semibold border border-[#8B0000]/40'
                  : 'text-[#9EA2B0] hover:text-[#ff8080]'
              }`}
            >
              Коллизии / Без тегов ({previewItems.filter((i) => i.status === 'target_exists' || i.status === 'missing_tags').length})
            </button>
          </div>

          {/* Execute Move Button */}
          <button
            onClick={() => setShowConfirmModal(true)}
            disabled={movableItems.length === 0 || isExecuting}
            className="flex items-center gap-2 px-4 py-1.5 rounded font-semibold text-xs text-white bg-[#8B0000] hover:bg-[#a30000] active:bg-[#720000] shadow-md transition-colors cursor-pointer disabled:opacity-40"
          >
            {isExecuting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <FileCheck className="w-3.5 h-3.5" />}
            <span>Переместить файлы ({movableItems.length})</span>
          </button>
        </div>
      )}

      {/* Main Preview Table */}
      <div className="flex-1 overflow-auto p-3">
        {previewItems.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-[#686c7d] space-y-2">
            <FolderTree className="w-12 h-12 opacity-30 text-[#39C5BB]" />
            <p className="text-sm">Выберите шаблон и нажмите «Предпросмотр», чтобы увидеть новую структуру</p>
            <p className="text-xs text-[#525565]">LierTags ничего не переместит без вашего подтверждения</p>
          </div>
        ) : (
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-[#282a37] text-[#8E92A2] select-none text-[11px] uppercase tracking-wider">
                <th className="py-2 px-3 w-1/3">Исходный файл</th>
                <th className="py-2 px-3 w-1/2">Новый путь назначения</th>
                <th className="py-2 px-3 w-28 text-center">Статус</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1e202a]">
              {filteredPreview.map((item, idx) => (
                <tr
                  key={idx}
                  className="hover:bg-[#1b1d26] transition-colors group"
                >
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
              ))}
            </tbody>
          </table>
        )}
      </div>

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
                  Перемещение <span className="font-bold text-white">{movableItems.length}</span> файлов
                </p>
              </div>
            </div>

            <p className="text-xs text-[#C8CBD8] leading-relaxed">
              Файлы будут физически перемещены в новые папки в соответствии с выбранным шаблоном.
              Если рядом с аудиофайлами есть синхронизированные тексты (.lrc), они будут перемещены вместе с ними.
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

      {/* Execution Summary Modal / Notification */}
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

            {/* Scrollable logs */}
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