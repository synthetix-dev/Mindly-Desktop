import { fileURLToPath } from 'node:url';
import {
  cli,
  defineAgent,
  llm,
  voice
} from '@livekit/agents';
import * as openai from '@livekit/agents-plugin-openai';
import * as silero from '@livekit/agents-plugin-silero';

class PlatformLLM extends llm.LLM {
  private roomId: string;
  private dotId: string;
  private endpoint: string;
  private ownerToken: string;

  constructor(roomId: string, dotId: string, endpoint: string = 'http://127.0.0.1:4310/api/copilotkit/livekit/turn') {
    super();
    this.roomId = roomId;
    this.dotId = dotId;
    this.endpoint = endpoint;
    this.ownerToken = process.env.OWNER_TOKEN || '';
  }

  label(): string { return 'PlatformLLM'; }
  get model(): string { return 'opendots-agent'; }
  get provider(): string { return 'opendots'; }

  chat({ chatCtx, toolCtx, connOptions }: any): llm.LLMStream {
    const stream = new (class extends llm.LLMStream {
      constructor(llm: llm.LLM) {
        super(llm, { chatCtx, connOptions: connOptions || {} });
        this.runPromise = this.run();
      }
      runPromise: Promise<void>;
      async run() {
        try {
          const msgs = (this.chatCtx as any).messages; 
          const lastMsg = msgs[msgs.length - 1];
          if (!lastMsg || lastMsg.role !== 'user' || typeof lastMsg.content !== 'string') {
            return;
          }
          
          const prompt = lastMsg.content;
          const identity = lastMsg.name || 'user'; // Extract speaker identity if provided
          
          const res = await fetch(((this as any).llm).endpoint, {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${((this as any).llm).ownerToken}`
            },
            body: JSON.stringify({
              roomId: ((this as any).llm).roomId,
              dotId: ((this as any).llm).dotId,
              prompt: prompt,
              identity: identity
            })
          });
          
          if (!res.ok) {
            throw new Error(`Platform API error: ${res.status}`);
          }
          
          const data = await res.json();
          if (data.error) throw new Error(data.error);

          (this as any).output.push({
            id: 'id',
            delta: { role: 'assistant', content: data.text }
          });
        } catch (e: any) {
          console.error('PlatformLLM run error:', e);
          (this as any).output.push({
            id: 'error',
            delta: { role: 'assistant', content: "Вибачте, сталася помилка з'єднання з агентом." }
          });
        } finally {
          this.output.close();
        }
      }
    })(this);
    
    return stream;
  }
}

export default defineAgent({
  entry: async (ctx) => {
    try {
      await ctx.connect();
      console.log('Voice agent connected to room:', ctx.room.name);
  
      let dotId = '';
      try {
        if (ctx.job.metadata) {
          const meta = JSON.parse(ctx.job.metadata);
          dotId = meta.dotId || '';
        }
      } catch (e) {
        console.warn('Failed to parse job metadata', e);
      }
      
      if (!dotId) {
        // fallback for auto-dispatch or virtual participants
        dotId = (ctx as any).participant?.identity || 'unknown-dot';
      }
  
      const chatCtx = new llm.ChatContext();
      chatCtx.addMessage({
        role: 'system',
        content: `You are a voice assistant in the OpenDots platform. Be concise, friendly, and helpful. Respond strictly in Ukrainian. Keep answers under 3 sentences. 
TURN-TAKING RULE: If there are multiple AI agents or users speaking, wait for your turn. Do not talk over others. Only respond when addressed or when it is naturally your turn in the conversation.`
      });
  
      const agent = voice.Agent.create({
        instructions: `You are a voice assistant in the OpenDots platform. Be concise, friendly, and helpful. Respond strictly in Ukrainian. Keep answers under 3 sentences. 
TURN-TAKING RULE: If there are multiple AI agents or users speaking, wait for your turn. Do not talk over others. Only respond when addressed or when it is naturally your turn in the conversation.`,
        vad: await silero.VAD.load(),
        stt: new openai.STT(),
        llm: new PlatformLLM(ctx.room.name || 'default-room', dotId),
        tts: new openai.TTS(),
        chatCtx
      });
  
      const session = new voice.AgentSession();
      
      ctx.room.on('disconnected', () => console.log('Room disconnected'));
  
      await session.start({ agent, room: ctx.room });
      
      await session.say('Привіт! Я штучний інтелект компанії OpenDots. Як я можу допомогти?', { allowInterruptions: true });
      console.log(`AI Agent (${dotId}) is now listening in the LiveKit room...`);
    } catch (e) {
      console.error('Agent entry error:', e);
    }
  },
});

if (import.meta.url.startsWith('file:') && process.argv[1] === fileURLToPath(import.meta.url)) {
  cli.runApp({
    agent: fileURLToPath(import.meta.url),
    wsURL: process.env.LIVEKIT_URL || 'ws://localhost',
    apiKey: process.env.LIVEKIT_API_KEY || 'devkey',
    apiSecret: process.env.LIVEKIT_API_SECRET || 'secret',
  } as any);
}
