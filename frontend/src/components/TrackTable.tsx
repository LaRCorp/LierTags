import React, { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Track } from '../types';
import { Disc3, Clock, CheckSquare, Square, FolderTree, X } from 'lucide-react';

interface TrackTableProps {
  tracks: Track[];
  selectedTrackId: string | null;
  onSelectTrack: (track: Track) => void;
  searchQuery: string;
  checkedTrackIds: Set<string>;
  onToggleCheckTrack: (trackId: string) => void;
  onSelectAllFiltered: (filtered: Track[]) => void;
  onClearChecked: () => void;
  onSendToOrganizer?: (selectedTracks: Track[]) => void;
}

export const TrackTable: React.FC<TrackTableProps> = ({
  tracks,
  selectedTrackId,
  onSelectTrack,
  searchQuery,
  checkedTrackIds,
  onToggleCheckTrack,
  onSelectAllFiltered,
  onClearChecked,
  onSendToOrganizer,
}) => {
  const parentRef = useRef<HTMLDivElement>(null);

  // Enhanced search across all relevant metadata and file paths
  const filteredTracks = React.useMemo(() => {
    if (!searchQuery.trim()) return tracks;
    const q = searchQuery.toLowerCase().trim();
    return tracks.filter((t) => {
      const title = (t.metadata.title || '').toLowerCase();
      const artist = (t.metadata.artist || '').toLowerCase();
      const album = (t.metadata.album || '').toLowerCase();
      const genre = (t.metadata.genre || '').toLowerCase();
      const fileName = (t.file_name || '').toLowerCase();
      const filePath = (t.file_path || '').toLowerCase();
      return (
        title.includes(q) ||
        artist.includes(q) ||
        album.includes(q) ||
        genre.includes(q) ||
        fileName.includes(q) ||
        filePath.includes(q)
      );
    });
  }, [tracks, searchQuery]);

  // Virtualizer for smooth 60fps scrolling with 4000+ tracks
  const rowVirtualizer = useVirtualizer({
    count: filteredTracks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 37, // average row height in pixels
    overscan: 12,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0]?.start || 0 : 0;
  const paddingBottom =
    virtualItems.length > 0
      ? rowVirtualizer.getTotalSize() - (virtualItems[virtualItems.length - 1]?.end || 0)
      : 0;

  const formatDuration = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remainder = Math.floor(secs % 60);
    return `${mins}:${remainder.toString().padStart(2, '0')}`;
  };

  const isAllFilteredChecked =
    filteredTracks.length > 0 && filteredTracks.every((t) => checkedTrackIds.has(t.id));

  const handleToggleSelectAll = () => {
    if (isAllFilteredChecked) {
      onClearChecked();
    } else {
      onSelectAllFiltered(filteredTracks);
    }
  };

  const selectedTracksList = React.useMemo(() => {
    return tracks.filter((t) => checkedTrackIds.has(t.id));
  }, [tracks, checkedTrackIds]);

  return (
    <div className="flex-1 flex flex-col h-full bg-[#18191f] border border-[#2b2d37] rounded-lg overflow-hidden shadow-lg">
      {/* Table Header / Stats Bar */}
      <div className="px-4 py-2.5 bg-[#1f2027] border-b border-[#2b2d37] flex items-center justify-between text-xs font-semibold text-[#9EA2B0] uppercase tracking-wider">
        <div className="flex items-center gap-2">
          <Disc3 className="w-4 h-4 text-[#39C5BB]" />
          <span>Библиотека треков ({filteredTracks.length}{searchQuery ? ` из ${tracks.length}` : ''})</span>
        </div>

        {searchQuery && (
          <span className="text-[11px] font-normal text-[#39C5BB] lowercase">
            фильтр: «{searchQuery}»
          </span>
        )}
      </div>

      {/* Multi-selection Action Banner */}
      {checkedTrackIds.size > 0 && (
        <div className="px-4 py-2 bg-[#212330] border-b border-[#2d3042] flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-white">
            <span className="font-semibold text-[#39C5BB]">{checkedTrackIds.size}</span>
            <span className="text-[#A6ABB8]">
              {checkedTrackIds.size === 1 ? 'трек выбран' : 'треков выбрано'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {onSendToOrganizer && (
              <button
                type="button"
                onClick={() => onSendToOrganizer(selectedTracksList)}
                className="flex items-center gap-1.5 px-3 py-1 rounded bg-[#39C5BB] hover:bg-[#4de1d7] text-black font-semibold shadow-xs transition-colors cursor-pointer"
                title="Передать выбранные треки во вкладку Органайзер"
              >
                <FolderTree className="w-3.5 h-3.5" />
                <span>Отправить в Органайзер ({checkedTrackIds.size})</span>
              </button>
            )}

            <button
              type="button"
              onClick={onClearChecked}
              className="flex items-center gap-1 px-2.5 py-1 rounded bg-[#282b3a] hover:bg-[#34384a] text-[#9EA2B0] hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              <span>Снять выбор</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Virtualized Table Content */}
      <div ref={parentRef} className="flex-1 overflow-y-auto">
        {filteredTracks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-[#6B7082] py-16 space-y-1">
            <Disc3 className="w-12 h-12 opacity-30 text-[#39C5BB]" />
            <p className="text-sm">Ничего не найдено по запросу «{searchQuery}»</p>
            <p className="text-xs text-[#545766]">Попробуйте изменить поисковый запрос в шапке</p>
          </div>
        ) : (
          <table className="w-full text-left text-xs border-collapse table-fixed">
            <thead className="sticky top-0 bg-[#1e2027] text-[#8E92A2] font-medium border-b border-[#2b2d37] z-10 select-none">
              <tr>
                <th className="py-2.5 px-2 w-9 text-center">
                  <button
                    type="button"
                    onClick={handleToggleSelectAll}
                    className="p-1 hover:text-white cursor-pointer"
                    title={isAllFilteredChecked ? 'Снять выбор' : 'Выбрать все найденные'}
                  >
                    {isAllFilteredChecked ? (
                      <CheckSquare className="w-4 h-4 text-[#39C5BB]" />
                    ) : (
                      <Square className="w-4 h-4 text-[#525667]" />
                    )}
                  </button>
                </th>
                <th className="py-2.5 px-2 w-10 text-center">#</th>
                <th className="py-2.5 px-3 w-2/5">Название</th>
                <th className="py-2.5 px-3 w-1/4">Исполнитель</th>
                <th className="py-2.5 px-3 w-1/4">Альбом</th>
                <th className="py-2.5 px-2 w-16 text-center">Год</th>
                <th className="py-2.5 px-2 w-18 text-center">Формат</th>
                <th className="py-2.5 px-3 w-16 text-right">
                  <Clock className="w-3.5 h-3.5 inline opacity-70" />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#252732]">
              {paddingTop > 0 && (
                <tr>
                  <td colSpan={8} style={{ height: `${paddingTop}px`, padding: 0 }} />
                </tr>
              )}
              {virtualItems.map((virtualRow) => {
                const track = filteredTracks[virtualRow.index];
                if (!track) return null;

                const isSelected = track.id === selectedTrackId;
                const isChecked = checkedTrackIds.has(track.id);
                const title = track.metadata.title || track.file_name;
                const artist = track.metadata.artist || '—';
                const album = track.metadata.album || '—';
                const year = track.metadata.year || '—';

                return (
                  <tr
                    key={track.id}
                    onClick={() => onSelectTrack(track)}
                    className={`cursor-pointer transition-colors duration-100 ${
                      isChecked
                        ? 'bg-[#39C5BB]/10 hover:bg-[#39C5BB]/15'
                        : isSelected
                        ? 'bg-[#2b2e3d] text-white font-medium border-l-4 border-l-[#39C5BB]'
                        : 'hover:bg-[#252732] text-[#D0D3DF]'
                    }`}
                    style={{ height: '37px' }}
                  >
                    <td
                      className="py-1 px-2 text-center"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleCheckTrack(track.id);
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

                    <td className="py-1 px-2 text-center text-[#7E8294]">
                      {track.dirty ? (
                        <span className="w-2 h-2 rounded-full bg-[#39C5BB] inline-block" title="Изменения не сохранены" />
                      ) : (
                        track.metadata.track_number || virtualRow.index + 1
                      )}
                    </td>

                    <td className="py-1 px-3 font-medium truncate" title={title}>
                      {title}
                    </td>

                    <td className="py-1 px-3 truncate text-[#A6AAB8]" title={artist}>
                      {artist}
                    </td>

                    <td className="py-1 px-3 truncate text-[#8E92A2]" title={album}>
                      {album}
                    </td>

                    <td className="py-1 px-2 text-center text-[#8E92A2]">{year}</td>

                    <td className="py-1 px-2 text-center">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[#282a35] text-[#39C5BB] border border-[#39C5BB]/30">
                        {track.extension.toUpperCase()}
                      </span>
                    </td>

                    <td className="py-1 px-3 text-right text-[#7E8294] font-mono">
                      {formatDuration(track.properties.duration_seconds)}
                    </td>
                  </tr>
                );
              })}
              {paddingBottom > 0 && (
                <tr>
                  <td colSpan={8} style={{ height: `${paddingBottom}px`, padding: 0 }} />
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};