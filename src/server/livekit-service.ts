import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { randomUUID } from 'node:crypto';

export class LiveKitService {
  private roomService: RoomServiceClient | undefined;

  constructor(
    private readonly wsUrl?: string,
    private readonly apiKey?: string,
    private readonly apiSecret?: string
  ) {
    if (this.wsUrl && this.apiKey && this.apiSecret) {
      this.roomService = new RoomServiceClient(this.wsUrl, this.apiKey, this.apiSecret);
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
