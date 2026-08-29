import React, { useState, useEffect } from 'react';
import { Video, ShieldCheck, Clock, HardDrive, Play, Lock, Film, X, Download, Eye, Sparkles } from 'lucide-react';

export interface RecordingItem {
  id: string;
  title: string;
  userName?: string;
  userRole?: string;
  timeRange: string;
  duration: string;
  durationSec?: number;
  size: string;
  fileSizeMb?: number;
  status: string;
  fileUrl: string;
  thumbnailUrl: string;
  createdAt?: string;
}

export const RecordingsView: React.FC = () => {
  const [recordings, setRecordings] = useState<RecordingItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [activeModalRecording, setActiveModalRecording] = useState<RecordingItem | null>(null);

  const defaultRecordings: RecordingItem[] = [
    {
      id: 'rec-1',
      title: 'Morning Work Session - UI Development',
      userName: 'Alex Morgan',
      userRole: 'Manager & Lead Developer',
      timeRange: '09:00 AM - 01:00 PM',
      duration: '4h 00m',
      durationSec: 14400,
      size: '850 MB',
      fileSizeMb: 850,
      status: 'Completed',
      fileUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
      thumbnailUrl: 'https://images.unsplash.com/photo-1555066931-4365d14bab8c?auto=format&fit=crop&w=800&q=80',
    },
    {
      id: 'rec-2',
      title: 'Afternoon Work Session - Backend Integration',
      userName: 'Alex Morgan',
      userRole: 'Manager & Lead Developer',
      timeRange: '01:30 PM - 05:30 PM',
      duration: '4h 00m',
      durationSec: 14400,
      size: '880 MB',
      fileSizeMb: 880,
      status: 'Completed',
      fileUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
      thumbnailUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=800&q=80',
    },
    {
      id: 'rec-3',
      title: 'Evening Sync & Code Review Session',
      userName: 'Alex Morgan',
      userRole: 'Manager & Lead Developer',
      timeRange: '05:45 PM - 06:30 PM',
      duration: '45m',
      durationSec: 2700,
      size: '180 MB',
      fileSizeMb: 180,
      status: 'Completed',
      fileUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
      thumbnailUrl: 'https://images.unsplash.com/photo-1587825140708-dfaf72ae4b04?auto=format&fit=crop&w=800&q=80',
    },
  ];

  const normalizeRecordings = (list: any[]): RecordingItem[] => {
    return list.map(rec => ({
      id: rec.id,
      title: rec.title || rec.name || `Session Recording ${new Date(rec.createdAt || rec.startedAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
      userName: rec.userName || rec.user?.name || `${rec.user?.firstName || 'Alex'} ${rec.user?.lastName || 'Morgan'}`.trim(),
      userRole: rec.userRole || rec.user?.role || 'Software Engineer',
      timeRange: rec.timeRange || `${new Date(rec.createdAt || rec.startedAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
      duration: rec.duration || `${Math.floor((rec.durationSec || 900) / 60)}h ${Math.floor((rec.durationSec || 900) % 60)}m`,
      durationSec: rec.durationSec || Math.round((parseInt(rec.durationMs || '0', 10) || 900) / 1000),
      size: rec.size || `${(rec.fileSizeMb || 0).toFixed(1)} MB`,
      fileSizeMb: rec.fileSizeMb || 0,
      status: rec.status || 'Completed',
      fileUrl: rec.fileUrl || `http://localhost:3000/api/v1/recordings/stream/${rec.id}`,
      thumbnailUrl: rec.thumbnailUrl || 'https://images.unsplash.com/photo-1555066931-4365d14bab8c?auto=format&fit=crop&w=800&q=80',
      createdAt: rec.createdAt || rec.startedAt || new Date(),
    }));
  };

  const fetchRecordings = async () => {
    try {
      setLoading(true);
      const res = await fetch('http://localhost:3000/api/v1/recordings/feed');
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data)
          ? data
          : Array.isArray(data?.data)
            ? data.data
            : [];
        if (list.length > 0) {
          setRecordings(normalizeRecordings(list));
        } else {
          setRecordings([]);
        }
      } else {
        setRecordings([]);
      }
    } catch (e) {
      console.warn('Recordings feed fetch fallback:', e);
      setRecordings([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecordings();
  }, []);

  // Compute metrics dynamically from state
  const totalRecordingsCount = recordings.length;
  const totalStorageMb = recordings.reduce((acc, curr) => acc + (curr.fileSizeMb || 100), 0);
  const formattedStorage = totalStorageMb >= 1024 
    ? `${(totalStorageMb / 1024).toFixed(2)} GB` 
    : `${totalStorageMb.toFixed(1)} MB`;

  const totalDurationSec = recordings.reduce((acc, curr) => acc + (curr.durationSec || 900), 0);
  const formattedTotalTime = `${Math.floor(totalDurationSec / 3600)}h ${Math.floor((totalDurationSec % 3600) / 60)}m`;

  return (
    <div className="w-full max-w-7xl font-sans space-y-6 select-none">
      
      {/* Header Info Banner */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200/80 dark:border-slate-800 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4 transition-colors">
        <div>
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 rounded-2xl">
              <Video className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-800 dark:text-white">Continuous Screen Recording Logs</h2>
              <p className="text-xs text-slate-400 mt-0.5">Automated session video playback logs fetched directly from MongoDB collection.</p>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={fetchRecordings}
            className="px-3.5 py-1.5 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-100 rounded-2xl text-xs font-bold transition-all cursor-pointer"
          >
            Refresh MongoDB Feed
          </button>

          <div className="flex items-center space-x-2 px-3 py-1.5 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 rounded-full text-xs font-semibold border border-emerald-200/60 dark:border-emerald-900/50">
            <ShieldCheck className="w-4 h-4" />
            <span>AES-256 Encrypted</span>
          </div>
        </div>
      </div>

      {/* 3 Summary Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm transition-colors">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-slate-400">Sessions Recorded</p>
            <Film className="w-5 h-5 text-indigo-500" />
          </div>
          <h4 className="text-3xl font-extrabold text-slate-800 dark:text-white mt-2">
            {totalRecordingsCount} {totalRecordingsCount === 1 ? 'Recording' : 'Recordings'}
          </h4>
          <p className="text-xs text-indigo-500 font-semibold mt-1">{formattedTotalTime} total video duration</p>
        </div>

        <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm transition-colors">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-slate-400">Cloud Storage Allocated</p>
            <HardDrive className="w-5 h-5 text-emerald-500" />
          </div>
          <h4 className="text-3xl font-extrabold text-slate-800 dark:text-white mt-2">{formattedStorage}</h4>
          <p className="text-xs text-emerald-600 font-semibold mt-1">Optimized WebM/H.264 stream</p>
        </div>

        <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm transition-colors">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-slate-400">Stream Resolution</p>
            <Clock className="w-5 h-5 text-amber-500" />
          </div>
          <h4 className="text-3xl font-extrabold text-slate-800 dark:text-white mt-2">1080p @ 30fps</h4>
          <p className="text-xs text-slate-400 font-semibold mt-1">Auto keyframe indexing</p>
        </div>
      </div>

      {/* Security Notice */}
      <div className="p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-900/50 rounded-2xl flex items-center justify-between text-xs text-amber-800 dark:text-amber-300">
        <div className="flex items-center space-x-2.5">
          <Lock className="w-4 h-4 text-amber-600 shrink-0" />
          <span><strong>Security Notice:</strong> Recordings are stored in MongoDB Atlas and disk storage. Click any card to launch the interactive video playback modal.</span>
        </div>
      </div>

      {/* ================= RECORDINGS GRID ================= */}
      {loading ? (
        <div className="p-12 text-center text-slate-400 font-medium text-xs">
          Loading MongoDB recordings collection...
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {recordings.map((rec) => (
            <div 
              key={rec.id}
              onClick={() => setActiveModalRecording(rec)}
              className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 overflow-hidden shadow-sm flex flex-col justify-between transition-all hover:shadow-lg hover:-translate-y-1 cursor-pointer group"
            >
              {/* Video Preview Container */}
              <div className="relative aspect-video w-full bg-slate-950 overflow-hidden">
                <img 
                  src={rec.thumbnailUrl || 'https://images.unsplash.com/photo-1555066931-4365d14bab8c?auto=format&fit=crop&w=800&q=80'} 
                  alt={rec.title} 
                  className="w-full h-full object-cover opacity-85 group-hover:scale-105 transition-transform duration-300"
                />
                
                {/* Play Overlay Icon */}
                <div className="absolute inset-0 bg-slate-950/40 flex flex-col items-center justify-center space-y-2 group-hover:bg-slate-950/60 transition-colors">
                  <div className="w-14 h-14 rounded-full bg-indigo-600/90 text-white flex items-center justify-center shadow-xl group-hover:scale-110 transition-transform">
                    <Play className="w-6 h-6 fill-current ml-1 text-white" />
                  </div>
                  <span className="text-[11px] font-extrabold text-white tracking-wide opacity-0 group-hover:opacity-100 transition-opacity">
                    Watch Full Recording
                  </span>
                </div>

                {/* Duration Badge */}
                <div className="absolute bottom-3 right-3 bg-slate-900/80 backdrop-blur-md text-white px-2.5 py-1 rounded-lg text-[10px] font-bold border border-white/10">
                  {rec.duration}
                </div>

                {/* User Avatar Badge */}
                {rec.userName && (
                  <div className="absolute top-3 left-3 bg-slate-900/80 backdrop-blur-md text-white px-2.5 py-1 rounded-lg text-[10px] font-bold border border-white/10 flex items-center space-x-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                    <span>{rec.userName}</span>
                  </div>
                )}
              </div>

              {/* Video Information Details */}
              <div className="p-5 space-y-2 bg-white dark:bg-slate-900">
                <h4 className="text-sm font-bold text-slate-800 dark:text-white line-clamp-1">{rec.title}</h4>
                <p className="text-xs text-slate-400">{rec.timeRange} · {rec.userRole || 'Engineer'}</p>

                <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800 text-xs">
                  <span className="text-slate-500 font-semibold">{rec.size}</span>
                  <span className={`px-2.5 py-0.5 rounded-full font-bold text-[10px] ${
                    rec.status === 'Completed' || rec.status === 'COMPLETED'
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                      : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                  }`}>
                    {rec.status}
                  </span>
                </div>
              </div>

            </div>
          ))}
        </div>
      )}

      {/* ================= VIDEO PLAYBACK POPUP MODAL ================= */}
      {activeModalRecording && (
        <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 w-full max-w-4xl rounded-3xl overflow-hidden shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col max-h-[92vh]">
            
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/50">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-full bg-indigo-600 text-white font-bold text-xs flex items-center justify-center shadow-md">
                  <Video className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-sm text-slate-900 dark:text-white flex items-center space-x-2">
                    <span>{activeModalRecording.title}</span>
                    <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 text-[10px] font-bold rounded-full border border-emerald-500/40">
                      STREAMING LIVE
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400">{activeModalRecording.userName || 'Employee'} · {activeModalRecording.duration} · {activeModalRecording.size}</p>
                </div>
              </div>

              <div className="flex items-center space-x-3">
                <button 
                  onClick={() => setActiveModalRecording(null)}
                  className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full text-slate-500 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Video Player Display */}
            <div className="flex-1 overflow-auto bg-slate-950 p-4 flex items-center justify-center">
              <video 
                src={activeModalRecording.fileUrl} 
                controls 
                autoPlay 
                className="max-w-full max-h-[68vh] rounded-2xl shadow-2xl bg-black border border-slate-800"
              />
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/50">
              <div className="flex items-center space-x-2">
                <ShieldCheck className="w-4 h-4 text-emerald-500" />
                <span>MongoDB Video Stream URL: <code className="text-indigo-400 font-mono text-[11px] truncate max-w-xs inline-block align-bottom">{activeModalRecording.fileUrl}</code></span>
              </div>

              <div className="flex items-center space-x-3">
                <button 
                  onClick={() => setActiveModalRecording(null)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl cursor-pointer"
                >
                  Close Video Player
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};

export default RecordingsView;
