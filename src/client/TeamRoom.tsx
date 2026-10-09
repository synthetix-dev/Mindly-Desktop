import React, { useState, useEffect } from 'react';
import { LiveKitRoom, RoomAudioRenderer, AudioConference } from '@livekit/components-react';
import '@livekit/components-styles';

export function TeamRoom({ roomId = 'default-room' }: { roomId?: string }) {
  const [messages, setMessages] = useState<{id: string, role: string, content: string, senderId?: string}[]>([]);
  const [participants, setParticipants] = useState<{id: string, name: string}[]>([]);
  const [availableDots, setAvailableDots] = useState<{id: string, name: string}[]>([]);
  const [selectedDotId, setSelectedDotId] = useState<string>('');
  const [input, setInput] = useState('');
  const [token, setToken] = useState<string | null>(null);

  const loadDots = async () => {
    try {
      const res = await fetch('/api/workspace');
      if (res.ok) {
        const data = await res.json();
        setAvailableDots(data.dots || []);
        if (data.dots?.length > 0) setSelectedDotId(data.dots[0].id);
      }
    } catch (e) { console.error(e); }
  };

  const loadMessages = async () => {
    try {
      const res = await fetch(`/api/copilotkit/rooms/${roomId}/messages`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadDots();
    loadMessages();
    const interval = setInterval(loadMessages, 3000);
    return () => clearInterval(interval);
  }, [roomId]);

  const joinVoice = async (dotId: string) => {
    try {
      const res = await fetch('/api/copilotkit/livekit/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomName: roomId, participantName: 'User', dotId })
      });
      const data = await res.json();
      if (data.token) {
        setToken(data.token);
      }
    } catch (e) { console.error(e); }
  };

  const handleAddAgent = () => {
    const dot = availableDots.find(d => d.id === selectedDotId);
    if (!dot || participants.find(p => p.id === dot.id)) return;
    setParticipants(p => [...p, dot]);
    joinVoice(dot.id);
  };

  const handleSend = async () => {
    if (!input.trim()) return;
    const content = input;
    setInput('');
    // Optimistic UI update
    setMessages(m => [...m, { id: Date.now().toString(), role: 'user', content }]);
    
    await fetch(`/api/copilotkit/rooms/${roomId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, activeDots: participants.map(p => p.id) })
    });
    loadMessages();
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-zinc-900 p-4">
      <div className="flex justify-between items-center mb-4 border-b pb-2">
        <h2 className="text-xl font-bold">Team Room: {roomId}</h2>
        <div className="flex gap-2 items-center">
          <select 
            value={selectedDotId} 
            onChange={e => setSelectedDotId(e.target.value)}
            className="border p-1 rounded dark:bg-zinc-800 dark:text-white"
          >
            {availableDots.map(dot => (
              <option key={dot.id} value={dot.id}>{dot.name}</option>
            ))}
          </select>
          <button 
            onClick={handleAddAgent}
            className="bg-blue-600 text-white px-3 py-1 rounded disabled:opacity-50"
            disabled={!selectedDotId || participants.some(p => p.id === selectedDotId)}
          >
            + Add AI Employee (Voice)
          </button>
        </div>
      </div>
      
      {participants.length > 0 && (
        <div className="mb-4 text-sm text-gray-500">
          Active AI Employees: {participants.map(p => p.name).join(', ')}
        </div>
      )}

      <div className="flex-1 overflow-y-auto mb-4 space-y-4">
        {messages.map((msg, i) => (
          <div key={msg.id || i} className={`p-3 rounded-lg ${msg.role === 'user' ? 'bg-blue-100 ml-8 dark:bg-blue-900' : 'bg-gray-100 mr-8 dark:bg-zinc-800'}`}>
            <span className="font-semibold block mb-1">
              {msg.role === 'user' ? 'You' : (msg.senderId ? `Agent (${msg.senderId})` : 'Agent')}
            </span>
            {msg.content}
          </div>
        ))}
      </div>

      {token && (
        <div className="h-24 bg-gray-100 dark:bg-zinc-800 rounded mb-4">
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
      )}

      <div className="flex gap-2">
        <input 
          type="text" 
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSend()}
          placeholder="Message @agent or type Summarize..."
          className="flex-1 border p-2 rounded dark:bg-zinc-800 dark:border-zinc-700 dark:text-white"
        />
        <button onClick={handleSend} className="bg-blue-600 text-white px-4 py-2 rounded">
          Send
        </button>
      </div>
    </div>
  );
}
