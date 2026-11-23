import React from 'react';
import { Track } from '../types';
import { Music, Disc3, Clock } from 'lucide-react';

interface TrackTableProps {
  tracks: Track[];
  selectedTrackId: string | null;
  onSelectTrack: (track: Track) => void;
  searchQuery: string;
}

export const TrackTable: React.FC<TrackTableProps> = ({
  tracks,
  selectedTrackId,
  onSelectTrack,
  searchQuery,
}) => {
  const filteredTracks = tracks.filter((t) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const title = (t.metadata.title || t.file_name).toLowerCase();
    const artist = (t.metadata.artist || '').toLowerCase();
    const album = (t.metadata.album || '').toLowerCase();
    const genre = (t.metadata.genre || '').toLowerCase();
    return title.includes(q) || artist.includes(q) || album.includes(q) || genre.includes(q);
  });

  const formatDuration = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remainder = Math.floor(secs % 60);
    return `${mins}:${remainder.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#18191f] border border-[#2b2d37] rounded-lg overflow-hidden shadow-lg">
      <div className="px-4 py-2.5 bg-[#1f2027] border-b border-[#2b2d37] flex items-center justify-between text-xs font-semibold text-[#9EA2B0] uppercase tracking-wider">
        <div className="flex items-center gap-2">
          <Disc3 className="w-4 h-4 text-[#39C5BB]" />
          <span>Библиотека треков ({filteredTracks.length})</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filteredTracks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-[#6B7082] py-16">
            <Music className="w-12 h-12 mb-3 opacity-40" />
            <p className="text-sm">Нет треков для отображения</p>
            <p className="text-xs mt-1 text-[#545766]">Выберите папку или перетащите аудиофайлы</p>
          </div>
        ) : (
          <table className="w-full text-left text-xs border-collapse">
            <thead className="sticky top-0 bg-[#1e2027] text-[#8E92A2] font-medium border-b border-[#2b2d37] z-10">
              <tr>
                <th className="py-2.5 px-3 w-12 text-center">#</th>
                <th className="py-2.5 px-3">Название</th>
                <th className="py-2.5 px-3">Исполнитель</th>
                <th className="py-2.5 px-3">Альбом</th>
                <th className="py-2.5 px-2 w-16 text-center">Год</th>
                <th className="py-2.5 px-2 w-20 text-center">Формат</th>
                <th className="py-2.5 px-3 w-16 text-right">
                  <Clock className="w-3.5 h-3.5 inline opacity-70" />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#252732]">
              {filteredTracks.map((track, idx) => {
                const isSelected = track.id === selectedTrackId;
                const title = track.metadata.title || track.file_name;
                const artist = track.metadata.artist || '—';
                const album = track.metadata.album || '—';
                const year = track.metadata.year || '—';

                return (
                  <tr
                    key={track.id}
                    onClick={() => onSelectTrack(track)}
                    className={`cursor-pointer transition-colors duration-100 ${
                      isSelected
                        ? 'bg-[#39C5BB]/15 text-white font-medium border-l-4 border-l-[#39C5BB]'
                        : 'hover:bg-[#252732] text-[#D0D3DF]'
                    }`}
                  >
                    <td className="py-2.5 px-3 text-center text-[#7E8294]">
                      {track.dirty ? (
                        <span className="w-2 h-2 rounded-full bg-[#39C5BB] inline-block" title="Изменения не сохранены" />
                      ) : (
                        track.metadata.track_number || idx + 1
                      )}
                    </td>
                    <td className="py-2.5 px-3 font-medium truncate max-w-[200px]" title={title}>
                      {title}
                    </td>
                    <td className="py-2.5 px-3 truncate max-w-[150px] text-[#A6AAB8]" title={artist}>
                      {artist}
                    </td>
                    <td className="py-2.5 px-3 truncate max-w-[150px] text-[#8E92A2]" title={album}>
                      {album}
                    </td>
                    <td className="py-2.5 px-2 text-center text-[#8E92A2]">{year}</td>
                    <td className="py-2.5 px-2 text-center">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[#282a35] text-[#39C5BB] border border-[#39C5BB]/30">
                        {track.extension.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right text-[#7E8294] font-mono">
                      {formatDuration(track.properties.duration_seconds)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
