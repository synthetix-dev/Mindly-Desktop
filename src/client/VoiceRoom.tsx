import React, { useState, useEffect } from 'react';
import {
  LiveKitRoom,
  RoomAudioRenderer,
  AudioConference,
} from '@livekit/components-react';
import '@livekit/components-styles';

export function VoiceRoom({ roomName = 'demo-voice-room', participantName = 'User' }: { roomName?: string, participantName?: string }) {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/copilotkit/livekit/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomName, participantName })
        });
        const data = await res.json();
        if (data.token) {
          setToken(data.token);
        } else {
          setError(data.error || 'Failed to get token');
        }
      } catch (e) {
        setError(String(e));
      }
    })();
  }, [roomName, participantName]);

  if (error) {
    return (
      <div className="p-4 bg-red-100 text-red-800 rounded">
        <strong>Voice Configuration Error:</strong> {error}
        <p className="text-sm mt-2">Make sure LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET are set in your .env</p>
      </div>
    );
  }

  if (!token) {
    return <div className="p-4">Connecting to Voice Room...</div>;
  }

  return (
    <div className="flex flex-col h-full">
      <h2 className="p-4 text-xl font-bold border-b">Voice Meeting: {roomName}</h2>
      <div className="flex-1 p-4 bg-gray-50">
        <LiveKitRoom
          video={false}
          audio={true}
          token={token}
          serverUrl={process.env.LIVEKIT_URL || 'wss://demo.livekit.cloud'}
          data-lk-theme="default"
          style={{ height: '100%' }}
        >
          <AudioConference />
          <RoomAudioRenderer />
        </LiveKitRoom>
      </div>
    </div>
  );
}
