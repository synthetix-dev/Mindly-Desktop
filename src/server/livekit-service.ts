import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { AgentDispatchClient } from 'livekit-server-sdk';
import { randomUUID } from 'node:crypto';

export class LiveKitService {
  private roomService: RoomServiceClient | undefined;
  private agentDispatch: AgentDispatchClient | undefined;

  constructor(
    private readonly wsUrl?: string,
    private readonly apiKey?: string,
    private readonly apiSecret?: string
  ) {
    if (this.wsUrl && this.apiKey && this.apiSecret) {
      this.roomService = new RoomServiceClient(this.wsUrl, this.apiKey, this.apiSecret);
      const httpUrl = this.wsUrl.replace(/^wss?:\/\//, (match) => match === 'wss://' ? 'https://' : 'http://');
      this.agentDispatch = new AgentDispatchClient(httpUrl, this.apiKey, this.apiSecret);
    }
  }

  isConfigured() {
    return !!this.roomService;
  }

  async createRoom(roomName: string = randomUUID()) {
    if (!this.roomService) throw new Error('LiveKit not configured');
    const room = await this.roomService.createRoom({
      name: roomName,
      emptyTimeout: 10 * 60, // 10 minutes
      maxParticipants: 10,
    });
    return room;
  }

  async dispatchAgent(roomName: string, dotId: string, agentName: string = 'opendots-agent') {
    if (!this.agentDispatch) throw new Error('LiveKit not configured');
    return await this.agentDispatch.createDispatch(roomName, agentName, {
      metadata: JSON.stringify({ dotId })
    });
  }

  async getJoinToken(roomName: string, participantName: string, isAgent: boolean = false) {
    if (!this.apiKey || !this.apiSecret) throw new Error('LiveKit not configured');
    
    const at = new AccessToken(this.apiKey, this.apiSecret, {
      identity: isAgent ? `agent-${randomUUID()}` : `user-${randomUUID()}`,
      name: participantName,
    });
    
    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
    });
    
    return await at.toJwt();
  }
}
