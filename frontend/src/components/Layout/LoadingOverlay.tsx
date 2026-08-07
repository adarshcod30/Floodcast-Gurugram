interface LoadingOverlayProps {
  statusText: string;
  isColdStart: boolean;
}

export default function LoadingOverlay({ statusText, isColdStart }: LoadingOverlayProps) {
  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center p-6 text-center"
      style={{ background: 'var(--bg-base, #09090b)' }}>

      {/* Pulsing ring */}
      <div className="relative flex items-center justify-center mb-6">
        <div className="absolute w-20 h-20 rounded-full border-2 border-blue-500/20 animate-ping" style={{ animationDuration: '2s' }} />
        <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-2xl shadow-xl">
          🌊
        </div>
      </div>

      <h1 className="text-lg font-bold text-white mb-1 tracking-tight">
        Gurugram<span className="text-blue-400">Pulse</span>
      </h1>
      <p className="text-sm text-zinc-400 max-w-xs">{statusText}</p>

      {isColdStart && (
        <>
          <div className="mt-5 w-48 h-1 rounded-full overflow-hidden bg-zinc-900">
            <div className="h-full rounded-full" style={{
              animation: 'shimmer 1.5s infinite linear',
              background: 'linear-gradient(90deg, transparent 0%, #3b82f6 50%, transparent 100%)',
              backgroundSize: '200% 100%'
            }} />
            <style>{`@keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }`}</style>
          </div>
          <p className="text-[11px] text-zinc-600 mt-3 max-w-xs leading-relaxed">
            Server is waking up from sleep. Usually takes 30–60 seconds.
          </p>
        </>
      )}
    </div>
  );
}
