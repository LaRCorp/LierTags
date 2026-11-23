import React from 'react';
import { ImportPayload, Track } from '../types';
import { Sparkles, ArrowRight, X, Check } from 'lucide-react';

interface ImportModalProps {
  payload: ImportPayload | null;
  activeTrack: Track | null;
  onApply: (applyPayload: ImportPayload, autoSave: boolean) => void;
  onClose: () => void;
}

export const ImportModal: React.FC<ImportModalProps> = ({
  payload,
  activeTrack,
  onApply,
  onClose,
}) => {
  if (!payload) return null;

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div className="bg-[#1a1b22] border border-[#333644] rounded-xl max-w-lg w-full shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-3.5 bg-[#20222b] border-b border-[#2d303d] flex items-center justify-between">
          <div className="flex items-center gap-2 text-[#39C5BB]">
            <Sparkles className="w-5 h-5" />
            <h3 className="font-semibold text-sm text-white">LierEX-Q: Импорт метаданных трека</h3>
          </div>
          <button
            onClick={onClose}
            className="text-[#787c8e] hover:text-white p-1 rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          <p className="text-xs text-[#9EA2B0]">
            Расширение LierEX-Q передало метаданные через локальный порт 8766. Проверьте данные перед применением:
          </p>

          <div className="bg-[#131419] border border-[#292b37] rounded-lg p-3.5 space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-[#717688]">Название:</span>
              <span className="font-semibold text-white">{payload.title}</span>
            </div>
            {payload.artist && (
              <div className="flex justify-between">
                <span className="text-[#717688]">Исполнитель:</span>
                <span className="text-[#D0D3DF]">{payload.artist}</span>
              </div>
            )}
            {payload.album && (
              <div className="flex justify-between">
                <span className="text-[#717688]">Альбом:</span>
                <span className="text-[#D0D3DF]">{payload.album}</span>
              </div>
            )}
            {payload.year && (
              <div className="flex justify-between">
                <span className="text-[#717688]">Год выпуска:</span>
                <span className="text-[#D0D3DF]">{payload.year}</span>
              </div>
            )}
            {payload.genre && (
              <div className="flex justify-between">
                <span className="text-[#717688]">Жанр:</span>
                <span className="text-[#D0D3DF]">{payload.genre}</span>
              </div>
            )}
            {payload.artwork_url && (
              <div className="pt-2 border-t border-[#21232d] flex items-center gap-3">
                <img
                  src={payload.artwork_url}
                  alt="Artwork preview"
                  className="w-14 h-14 object-cover rounded border border-[#343746]"
                />
                <span className="text-[11px] text-[#8E92A2]">Найдена обложка альбома по ссылке</span>
              </div>
            )}
          </div>

          {activeTrack ? (
            <div className="text-xs text-[#9EA2B0] bg-[#22242e] p-2.5 rounded border border-[#2f3240] flex items-center gap-2">
              <ArrowRight className="w-4 h-4 text-[#39C5BB] shrink-0" />
              <span>
                Будет применено к выделенному треку:{' '}
                <strong className="text-white">{activeTrack.metadata.title || activeTrack.file_name}</strong>
              </span>
            </div>
          ) : (
            <div className="text-xs text-[#ff9090] bg-[#8B0000]/15 p-2.5 rounded border border-[#8B0000]/40">
              Внимание: сейчас не выбран ни один трек в библиотеке. Выберите файл для записи.
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-5 py-3.5 bg-[#20222b] border-t border-[#2d303d] flex justify-end gap-2.5">
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 rounded text-xs text-[#A0A4B4] hover:bg-[#2b2e3c] transition-colors"
          >
            Отклонить
          </button>
          <button
            onClick={() => onApply(payload, false)}
            disabled={!activeTrack}
            className="px-3.5 py-1.5 rounded text-xs font-medium text-white bg-[#2a2d3a] hover:bg-[#353949] border border-[#3e4254] transition-colors disabled:opacity-40"
          >
            Заполнить поля
          </button>
          <button
            onClick={() => onApply(payload, true)}
            disabled={!activeTrack}
            className="px-4 py-1.5 rounded text-xs font-semibold text-black bg-[#39C5BB] hover:bg-[#48d8ce] transition-colors flex items-center gap-1.5 disabled:opacity-40"
          >
            <Check className="w-4 h-4" />
            <span>Применить и сохранить</span>
          </button>
        </div>
      </div>
    </div>
  );
};
