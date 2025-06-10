/**
 * Copyright (c) 2024–2025, Daily
 *
 * SPDX-License-Identifier: BSD 2-Clause License
 */

// Import required libraries for AppSync Events API
import { Amplify } from 'aws-amplify';
import { events } from 'aws-amplify/data';

import { SmallWebRTCTransport } from "@pipecat-ai/small-webrtc-transport";
import {
  Participant,
  RTVIClient,
  RTVIClientOptions,
} from "@pipecat-ai/client-js";
import "./style.css";
import { VoiceVisualizer } from "./voice-visualizer";

// Types for AppSync Events data
interface Conversation {
  conversation_id: string;
  timestamp: string;
  speaker?: string;
  language?: string;
  conversation?: string; // Add conversation field to store the conversation content
}

interface Booking {
  bookingId: string;
  date: string;
  name: string;
  hour: string;
  numGuests: number;
  status: string;
  timestamp: string;
  source?: string;
  eventName?: string;
  type?: string;
}

// AppSync Events subscription names
const EVENT_CONVERSATION_CREATED = 'onCreateConversation';
const EVENT_BOOKING_CREATED = 'onCreateBooking';

class WebRTCApp {
  // UI elements
  private connectBtn!: HTMLButtonElement;
  private connectBtnText!: HTMLElement;
  private disconnectBtn!: HTMLButtonElement;
  private audioInput!: HTMLSelectElement;
  private videoInput!: HTMLSelectElement;
  private audioCodec!: HTMLSelectElement;
  private videoCodec!: HTMLSelectElement;
  private videoElement!: HTMLVideoElement;
  private audioElement!: HTMLAudioElement;
  private debugLog!: HTMLElement;
  private micToggleBtn!: HTMLButtonElement;
  private cameraToggleBtn!: HTMLButtonElement;
  private micChevronBtn!: HTMLButtonElement;
  private cameraChevronBtn!: HTMLButtonElement;
  private micPopover!: HTMLElement;
  private cameraPopover!: HTMLElement;
  private currentAudioDevice!: HTMLElement;
  private currentVideoDevice!: HTMLElement;
  private selfViewContainer!: HTMLElement;
  private selfViewVideo!: HTMLVideoElement;
  private videoContainer!: HTMLElement;
  private botName!: HTMLElement;
  private dataTableContainer!: HTMLElement;
  private dataTable!: HTMLElement;
  private dataTableBody!: HTMLElement;
  private dataTableStatus!: HTMLElement;
  private novaTranscribeStatus!: HTMLElement;
  private novaTranscribeBody!: HTMLElement;

  // State
  private connected: boolean = false;
  private connecting: boolean = false;
  private micMuted: boolean = false;
  private cameraMuted: boolean = true;
  private smallWebRTCTransport!: SmallWebRTCTransport;
  private rtviClient!: RTVIClient;
  private declare voiceVisualizer: VoiceVisualizer;
  private transcripts: Array<{timestamp: string, role: string, content: string, language?: string, confidence?: number}> = [];
  
  // AppSync Events channels and subscriptions
  private eventChannels: Map<string, any> = new Map();
  private eventSubscriptions: Map<string, any> = new Map();
  
  // Data state
  private conversations: Conversation[] = [];
  private bookings: Booking[] = [];
  private appSyncApiUrl: string = '';
  private appSyncApiKey: string = '';

  constructor() {
    this.initializeVoiceVisualizer();
    this.setupDOMElements();
    this.setupDOMEventListeners();
    this.initializeRTVIClient();
    this.configureAppSync();

    // Get bot name from URL query if available
    const urlParams = new URLSearchParams(window.location.search);
    const botNameParam = urlParams.get("bot");
    if (botNameParam && this.botName) {
      this.botName.textContent = botNameParam;
    }

    // Initialize the devices
    void this.populateDevices();
  }
  
  /**
   * Configure AppSync with endpoint and API key
   */
  private configureAppSync(): void {
    try {
      // Get runtime configuration
      const runtimeConfig = (window as any).runtimeConfig || {};
      
      // Configure AppSync endpoint using runtime configuration
      this.appSyncApiUrl = runtimeConfig.APPSYNC_API_URL;
      this.appSyncApiKey = runtimeConfig.APPSYNC_API_KEY;
      
      if (!this.appSyncApiUrl || !this.appSyncApiKey) {
        this.log("AppSync configuration missing. Using mock data for demonstration.", "error");
      } else {
        this.log(`AppSync Events API configured with URL: ${this.appSyncApiUrl}`, "status");
        this.log(`Using API Key: ${this.appSyncApiKey.substring(0, 8)}...${this.appSyncApiKey.substring(this.appSyncApiKey.length - 4)}`, "status");
        
        // Configure Amplify for Events API
        Amplify.configure({
          API: {
            Events: {
              endpoint: `${this.appSyncApiUrl}/event`,
              region: this.extractRegionFromUrl(this.appSyncApiUrl),
              defaultAuthMode: "apiKey",
              apiKey: this.appSyncApiKey
            }
          }
        });
        
        this.log("Amplify configured successfully for AppSync Events API", "status");
      }
      
      // Subscribe to data changes
      this.subscribeToDataChanges();
    } catch (error) {
      const err = error as Error;
      this.log(`Failed to configure AppSync: ${err.message}`, "error");
      console.error("AppSync configuration error:", error);
    }
  }
  
  /**
   * Extract AWS region from AppSync URL
   */
  private extractRegionFromUrl(url: string): string {
    const regionMatch = url.match(/appsync-api\.([^.]+)\.amazonaws\.com/);
    return regionMatch ? regionMatch[1] : 'ap-southeast-1'; // Default to ap-southeast-1 if not found
  }
  
  /**
   * Subscribe to real-time data changes from AppSync Events API
   */
  private async subscribeToDataChanges(): Promise<void> {
    try {
      // Set up data subscriptions
      this.updateDataTableStatus("Setting up AppSync Events API subscriptions...");
      
      // Check if AppSync configuration is available
      if (!this.appSyncApiUrl || !this.appSyncApiKey) {
        this.log("AppSync configuration missing. Using mock data instead.", "error");
        return;
      }
      
      // Set up channel for conversation events
      this.log("Setting up Events API channel for conversation events", "status");
      try {
        // Connect to the conversation channel
        const conversationChannel = await events.connect('events/conversations');
        this.eventChannels.set(EVENT_CONVERSATION_CREATED, conversationChannel);
        
        // Subscribe to the channel
        const conversationSubscription = conversationChannel.subscribe({
          next: (data) => {
            this.log("Received conversation event from Events API", "status");
            console.log("[Events API] Conversation data:", data);
            
            if (data && data.event) {
              // Update the data table status
              this.updateDataTableStatus(`Last update: ${new Date().toLocaleTimeString()} - REAL DATA`);
              
              // Process the event data - data.event contains the conversation data
              this.handleConversationEvent({ payload: data.event });
            }
          },
          error: (error) => {
            this.log(`Events API error for conversation events: ${error}`, "error");
            console.error("Events API subscription error:", error);
          }
        });
        
        // Store subscription for cleanup
        this.eventSubscriptions.set(EVENT_CONVERSATION_CREATED, conversationSubscription);
        this.log("Successfully subscribed to conversation events", "status");
        
      } catch (error) {
        this.log(`Failed to set up Events API for conversation events: ${error}`, "error");
        console.error("Events API setup error:", error);
     }
      
      // Set up channel for booking events
      this.log("Setting up Events API channel for booking events", "status");
      try {
        // Connect to the booking channel
        const bookingChannel = await events.connect('events/restaurant-booking');
        this.eventChannels.set(EVENT_BOOKING_CREATED, bookingChannel);
        
        // Subscribe to the channel
        const bookingSubscription = bookingChannel.subscribe({
          next: (data) => {
            this.log("Received booking event from Events API", "status");
            console.log("[Events API] Booking data:", data);
            
            if (data && data.event) {
              // Update the data table status
              this.updateDataTableStatus(`Last update: ${new Date().toLocaleTimeString()} - REAL DATA`);
              
              // Process the event data
              this.handleBookingEvent({ event: data.event });
            }
          },
          error: (error) => {
            this.log(`Events API error for booking events: ${error}`, "error");
            console.error("Events API subscription error:", error);
          }
        });
        
        // Store subscription for cleanup
        this.eventSubscriptions.set(EVENT_BOOKING_CREATED, bookingSubscription);
        this.log("Successfully subscribed to booking events", "status");
        
      } catch (error) {
        this.log(`Failed to set up Events API for booking events: ${error}`, "error");
        console.error("Events API setup error:", error);
      }
      
      this.log("Successfully subscribed to AppSync Events API", "status");
      
      // Update status
      this.updateDataTableStatus("Waiting for events...");
      
    } catch (error) {
      const err = error as Error;
      this.log(`Failed to subscribe to AppSync Events API: ${err.message}`, "error");
      console.error("AppSync Events API subscription error:", error);
      this.updateDataTableStatus(`Error: ${err.message}`);
    }
  }
  
  
  /**
   * Handle conversation event data
   */
  private handleConversationEvent(data: any): void {
    // Check if the data follows the new format with event property
    const conversation = data?.event || data?.payload;
    if (conversation) {
      // Log the raw conversation data for debugging
      console.log("[AppSync Events] Raw conversation data:", JSON.stringify(conversation));
      
      // Create a properly formatted conversation object from the received data
      const formattedConversation: Conversation = {
        conversation_id: conversation.conversation_id || `conv-${Date.now()}`,
        timestamp: conversation.timestamp || new Date().toISOString(),
        conversation: conversation.conversation || conversation.text || 'No content'
      };
      
      // Add to conversations array
      this.conversations.unshift(formattedConversation);
      
      // Log the appropriate message content
      const messageContent = formattedConversation.conversation || 'No content';
      this.log(`Received new conversation data: ${messageContent}`, "status");
      
      // Update the Nova Transcribe table
      this.updateNovaTranscribe();
      
      // Update status message
      this.updateDataTableStatus("Last update: " + new Date().toLocaleTimeString());
      
      // Log detailed data structure for debugging
      console.log("[AppSync Events] Formatted conversation:", JSON.stringify(formattedConversation));
    } else {
      this.log("Received conversation event with invalid data structure", "error");
      console.error("[AppSync Events] Invalid conversation data:", data);
    }
  }
  
  /**
   * Handle booking event data
   */
  private handleBookingEvent(data: any): void {
    // Check if the data follows the expected format with event property
    const booking = data?.event || data?.payload;
    if (booking) {
      // Log the raw booking data for debugging
      console.log("[AppSync Events] Raw booking data:", JSON.stringify(booking));
      
      // Create a properly formatted booking object from the received data
      const formattedBooking: Booking = {
        bookingId: booking.bookingId || '',
        date: booking.date || '',
        name: booking.name || '',
        hour: booking.hour || '',
        numGuests: booking.numGuests || 0,
        status: booking.status || 'unknown',
        timestamp: booking.timestamp || new Date().toISOString(),
        source: booking.source,
        eventName: booking.eventName,
        type: booking.type
      };
      
      this.bookings.unshift(formattedBooking);
      this.log(`Received new booking: ${formattedBooking.name} for ${formattedBooking.date} at ${formattedBooking.hour}`, "status");
      this.updateDataTable();
      
      // Update status message
      this.updateDataTableStatus("Last update: " + new Date().toLocaleTimeString());
      
      // Log detailed data structure for debugging
      console.log("[AppSync Events] Formatted booking data:", JSON.stringify(formattedBooking));
    } else {
      this.log("Received booking event with invalid data structure", "error");
      console.error("[AppSync Events] Invalid booking data:", data);
    }
  }
  
  /**
   * Update the data table status message
   */
  private updateDataTableStatus(message: string): void {
    if (this.dataTableStatus) {
      this.dataTableStatus.textContent = message;
    }
  }

  /**
   * Initialize the voice visualizer
   */
  private initializeVoiceVisualizer(): void {
    this.voiceVisualizer = new VoiceVisualizer({
      backgroundColor: "transparent",
      barColor: "rgba(255, 255, 255, 0.8)",
      barWidth: 30,
      barGap: 12,
      barMaxHeight: 120,
    });
  }

  private initializeRTVIClient(): void {
    const transport = new SmallWebRTCTransport();

    // Configure the transport with any codec preferences
    if (this.audioCodec) {
      transport.setAudioCodec(this.audioCodec.value);
    }
    if (this.videoCodec) {
      transport.setVideoCodec(this.videoCodec.value);
    }

    // Get runtime configuration
    const runtimeConfig = (window as any).runtimeConfig || {};
    
    // Configure ICE servers
    const stunServer = runtimeConfig.STUN_SERVER || "stun:stun.l.google.com:19302";
    const turnServer = runtimeConfig.TURN_SERVER;
    const turnUsername = runtimeConfig.TURN_USERNAME;
    const turnPassword = runtimeConfig.TURN_PASSWORD;
    
    // Build ICE servers configuration - SmallWebRTCTransport expects string array
    const iceServers = [stunServer];
    
    // Add TURN server if configured
    if (turnServer && turnUsername && turnPassword) {
      // Format: turn:turn-server.example.com:3478?transport=udp&username=user&password=pass
      iceServers.push(`turn:${turnServer}?username=${encodeURIComponent(turnUsername)}&credential=${encodeURIComponent(turnPassword)}`);
    }
    
    transport.iceServers = iceServers;

    // The backend will provide the complete ICE configuration including TURN servers
    // in the WebRTC answer, so we don't need to manually configure TURN here

    // Configure API endpoint using runtime configuration
    const baseUrl = `${import.meta.env.VITE_API_ENDPOINT}/api/offer`;
    console.log("Base URL:", baseUrl);

    const RTVIConfig: RTVIClientOptions = {
      // need to understand why it is complaining
      // @ts-ignore
      transport,
      params: {
        baseUrl: baseUrl,
      },
      enableMic: true, // We'll control actual muting with enableMic() later
      enableCam: !this.cameraMuted, // Start with camera off by default
      callbacks: {
        // Connection events
        onConnected: () => {
          console.log("[CALLBACK] User connected");
          this.onConnectedHandler();
        },
        onDisconnected: () => {
          console.log("[CALLBACK] User disconnected");
          this.onDisconnectedHandler();
        },
        onTransportStateChanged: (state: string) => {
          console.log("[CALLBACK] State change:", state);
          // Additional logging for ICE connection states
          if (state === 'ready') {
            this.log("WebRTC transport connected successfully", "status");
            this.log("Connection established with ICE servers (STUN/TURN)", "status");
          } else if (state === 'error') {
            this.log("WebRTC transport encountered an error", "error");
            this.log("This may indicate issues with STUN/TURN servers or network connectivity", "error");
          } else if (state === 'disconnected') {
            this.log("WebRTC transport disconnected", "status");
          } else if (state === 'connecting') {
            this.log("Establishing WebRTC connection using ICE servers...", "status");
          }
        },
        
        // Bot events
        onBotConnected: (participant: Participant) => {
          console.log("[CALLBACK] Bot connected", participant);
        },
        onBotDisconnected: (participant: Participant) => {
          console.log("[CALLBACK] Bot disconnected", participant);
        },
        onBotReady: (botReadyData: any) => {
          console.log("[CALLBACK] Bot ready to chat!", botReadyData);
        },
        
        // Generic message handling
        onGenericMessage: (data: unknown) => {
          console.log("[CALLBACK] Generic message:", data);
        },
        onMessageError: (message: any) => {
          console.log("[CALLBACK] Message error:", message);
        },
        onError: (message: any) => {
          console.log("[CALLBACK] Error:", message);
        },
        
        // Configuration events
        onConfig: (config: any) => {
          console.log("[CALLBACK] Config received:", config);
        },
        onConfigDescribe: (configDescription: unknown) => {
          console.log("[CALLBACK] Config description:", configDescription);
        },
        onActionsAvailable: (actions: unknown) => {
          console.log("[CALLBACK] Actions available:", actions);
        },
        
        // Participant events
        onParticipantJoined: (participant: Participant) => {
          console.log("[CALLBACK] Participant joined:", participant);
        },
        onParticipantLeft: (participant: Participant) => {
          console.log("[CALLBACK] Participant left:", participant);
        },
        
        // Metrics
        onMetrics: (data: any) => {
          console.log("[CALLBACK] Metrics:", data);
        },
        
        // Device updates
        onAvailableCamsUpdated: (cams: MediaDeviceInfo[]) => {
          console.log("[CALLBACK] Available cameras updated:", cams);
        },
        onAvailableMicsUpdated: (mics: MediaDeviceInfo[]) => {
          console.log("[CALLBACK] Available microphones updated:", mics);
        },
        onAvailableSpeakersUpdated: (speakers: MediaDeviceInfo[]) => {
          console.log("[CALLBACK] Available speakers updated:", speakers);
        },
        onCamUpdated: (cam: MediaDeviceInfo) => {
          console.log("[CALLBACK] Camera updated:", cam);
        },
        onMicUpdated: (mic: MediaDeviceInfo) => {
          console.log("[CALLBACK] Microphone updated:", mic);
        },
        onSpeakerUpdated: (speaker: MediaDeviceInfo) => {
          console.log("[CALLBACK] Speaker updated:", speaker);
        },
        
        // Media track events
        onTrackStarted: (
          track: MediaStreamTrack,
          participant?: Participant
        ) => {
          console.log("[CALLBACK] Track started:", track.kind, participant);

          if (participant?.local) {
            // Handle local tracks (e.g., self-view)
            if (track.kind === "video") {
              this.selfViewVideo.srcObject = new MediaStream([track]);
              this.updateSelfViewVisibility();
            }
            return;
          }
          // Handle remote tracks (the bot)
          this.onBotTrackStarted(track);
        },
        onTrackStopped: (track: MediaStreamTrack, participant?: Participant) => {
          console.log("[CALLBACK] Track stopped:", track.kind, participant);
        },
        onScreenTrackStarted: (track: MediaStreamTrack, participant?: Participant) => {
          console.log("[CALLBACK] Screen track started:", track.kind, participant);
        },
        onScreenTrackStopped: (track: MediaStreamTrack, participant?: Participant) => {
          console.log("[CALLBACK] Screen track stopped:", track.kind, participant);
        },
        onScreenShareError: (errorMessage: string) => {
          console.log("[CALLBACK] Screen share error:", errorMessage);
        },
        
        // Audio levels
        onLocalAudioLevel: (level: number) => {
          // Don't log this to avoid console spam
          // console.log("[CALLBACK] Local audio level:", level);
        },
        onRemoteAudioLevel: (level: number, participant: Participant) => {
          // Don't log this to avoid console spam
          // console.log("[CALLBACK] Remote audio level:", level, participant);
        },
        
        // Speaking events
        onUserStartedSpeaking: () => {
          console.log("[CALLBACK] User started speaking.");
        },
        onUserStoppedSpeaking: () => {
          console.log("[CALLBACK] User stopped speaking.");
        },
        onBotStartedSpeaking: () => {
          console.log("[CALLBACK] Bot started speaking.");
        },
        onBotStoppedSpeaking: () => {
          console.log("[CALLBACK] Bot stopped speaking.");
        },
        
        // Transcript and text events
        onUserTranscript: (transcript) => {
          if (transcript.final) {
            console.log(`[CALLBACK] User transcript: ${transcript.text}`);
          }
        },
        onBotTranscript: (transcript) => {
          console.log(`[CALLBACK] Bot transcript: ${transcript.text}`);
        },
        onBotLlmText: (text) => {
          console.log(`[CALLBACK] Bot LLM text: ${text}`);
        },
        onBotLlmStarted: () => {
          console.log("[CALLBACK] Bot LLM started");
        },
        onBotLlmStopped: () => {
          console.log("[CALLBACK] Bot LLM stopped");
        },
        onBotTtsText: (text) => {
          console.log(`[CALLBACK] Bot TTS text: ${text}`);
        },
        onBotTtsStarted: () => {
          console.log("[CALLBACK] Bot TTS started");
        },
        onBotTtsStopped: () => {
          console.log("[CALLBACK] Bot TTS stopped");
        },
        onBotLlmSearchResponse: (data: any) => {
          console.log("[CALLBACK] Bot LLM search response:", data);
        },
        
        // Storage and server messages
        onStorageItemStored: (data: any) => {
          console.log("[CALLBACK] Storage item stored:", data);
        },
        onServerMessage: (data: any) => {
          console.log("[CALLBACK] Server message:", data);
          
          // Enhanced debugging for transcript messages
          console.log("[TRANSCRIPT DEBUG] Received server message with data:", JSON.stringify(data));
          
          // Check if this is a transcript message - the structure should be { type: "server-message", data: { message_type: "transcript", ... } }
          if (data && data.type === "server-message" && data.data && data.data.message_type === "transcript") {
            console.log("[TRANSCRIPT DEBUG] Identified as transcript message");
            this.store_conversation(data.data.transcript);
          } else if (data && data.message_type === "transcript") {
            // Alternative structure check
            console.log("[TRANSCRIPT DEBUG] Identified as transcript message (alternative structure)");
            this.store_conversation(data.transcript);
          } else {
            console.log("[TRANSCRIPT DEBUG] Not a transcript message:");
            console.log("[TRANSCRIPT DEBUG] data.type:", data?.type);
            console.log("[TRANSCRIPT DEBUG] data.data?.message_type:", data?.data?.message_type);
            console.log("[TRANSCRIPT DEBUG] data.message_type:", data?.message_type);
          }
        },
      }
    };

    // This is required for SmallWebRTCTransport
    RTVIConfig.customConnectHandler = () => Promise.resolve();

    this.rtviClient = new RTVIClient(RTVIConfig);
    this.smallWebRTCTransport = transport;
  }

  private setupDOMElements(): void {
    // Get all the UI elements
    this.connectBtn = document.getElementById(
      "connect-btn"
    ) as HTMLButtonElement;
    this.connectBtnText = this.connectBtn.querySelector(
      ".btn-text"
    ) as HTMLElement;
    this.disconnectBtn = document.getElementById(
      "disconnect-btn"
    ) as HTMLButtonElement;
    this.audioInput = document.getElementById(
      "audio-input"
    ) as HTMLSelectElement;
    this.videoInput = document.getElementById(
      "video-input"
    ) as HTMLSelectElement;
    this.audioCodec = document.getElementById(
      "audio-codec"
    ) as HTMLSelectElement;
    this.videoCodec = document.getElementById(
      "video-codec"
    ) as HTMLSelectElement;
    this.videoElement = document.getElementById(
      "bot-video"
    ) as HTMLVideoElement;
    this.audioElement = document.getElementById(
      "bot-audio"
    ) as HTMLAudioElement;
    this.debugLog = document.getElementById("debug-log") as HTMLElement;
    this.micToggleBtn = document.getElementById(
      "mic-toggle"
    ) as HTMLButtonElement;
    this.cameraToggleBtn = document.getElementById(
      "camera-toggle"
    ) as HTMLButtonElement;
    this.micChevronBtn = document.getElementById(
      "mic-chevron"
    ) as HTMLButtonElement;
    this.cameraChevronBtn = document.getElementById(
      "camera-chevron"
    ) as HTMLButtonElement;
    this.micPopover = document.getElementById("mic-popover") as HTMLElement;
    this.cameraPopover = document.getElementById(
      "camera-popover"
    ) as HTMLElement;
    this.currentAudioDevice = document.getElementById(
      "current-audio-device"
    ) as HTMLElement;
    this.currentVideoDevice = document.getElementById(
      "current-video-device"
    ) as HTMLElement;
    this.selfViewContainer = document.getElementById(
      "self-view-container"
    ) as HTMLElement;
    this.selfViewVideo = document.getElementById(
      "self-view"
    ) as HTMLVideoElement;
    this.videoContainer = document.getElementById(
      "bot-video-container"
    ) as HTMLElement;
    this.botName = document.getElementById("bot-name") as HTMLElement;
    
    // We're removing the transcript container as per requirements
    
    // Set up data table container
    this.setupDataTableUI();
  }
  
  /**
   * Set up the data table UI for displaying DynamoDB data
   */
  private setupDataTableUI(): void {
    // Check if data-table-container exists, if not create it
    this.dataTableContainer = document.getElementById("data-table-container") as HTMLElement;
    
    if (!this.dataTableContainer) {
      // Create the data table container if it doesn't exist
      this.dataTableContainer = document.createElement("div");
      this.dataTableContainer.id = "data-table-container";
      this.dataTableContainer.className = "panel-content";
      
      // Add it to the debug panel
      const debugPanel = document.querySelector(".debug-panel");
      if (debugPanel) {
        debugPanel.appendChild(this.dataTableContainer);
      }
      
      // Add a tab for the data table
      const panelTabs = document.querySelector(".panel-tabs");
      if (panelTabs) {
        const dataTableTab = document.createElement("button");
        dataTableTab.className = "panel-tab";
        dataTableTab.setAttribute("data-tab", "data-table");
        dataTableTab.textContent = "Data Table";
        panelTabs.appendChild(dataTableTab);
        
        // No need to store reference to tabs since we're not using it elsewhere
      }
    }
    
    // Create the data table structure
    this.dataTableContainer.innerHTML = `
      <div class="data-table-header">
        <div class="data-table-tabs">
          <button class="data-tab" data-type="bookings">Restaurant Bookings</button>
        </div>
        <div class="data-table-status">Waiting for data...</div>
      </div>
      <div class="data-table-wrapper">
        <table class="data-table">
          <thead>
            <tr id="data-table-headers">
              <th>Booking ID</th>
              <th>Name</th>
              <th>Date</th>
              <th>Time</th>
              <th>Guests</th>
              <th>Status</th>
              <th>Timestamp</th>
              <th>Source</th>
              <th>Event</th>
            </tr>
          </thead>
          <tbody id="data-table-body">
            <tr>
              <td colspan="5" class="data-table-empty">No data available</td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
    
    // Get references to the table elements
    this.dataTable = this.dataTableContainer.querySelector(".data-table") as HTMLElement;
    this.dataTableBody = this.dataTableContainer.querySelector("#data-table-body") as HTMLElement;
    this.dataTableStatus = this.dataTableContainer.querySelector(".data-table-status") as HTMLElement;
    
    // Create Nova Transcribe container outside of data table
    this.setupNovaTranscribeUI();
  }
  
  /**
   * Set up the Nova Transcribe UI outside of the data table
   * This creates a separate container below the main-content div
   */
  private setupNovaTranscribeUI(): void {
    // Check if container already exists
    let novaTranscribeContainer = document.getElementById("nova-transcribe-container");
    
    if (!novaTranscribeContainer) {
      // Create the Nova Transcribe container
      novaTranscribeContainer = document.createElement("div");
      novaTranscribeContainer.id = "nova-transcribe-container";
      novaTranscribeContainer.className = "nova-transcribe-container";
      
      // Create the HTML structure with only timestamp and conversation columns
      novaTranscribeContainer.innerHTML = `
        <div class="nova-transcribe-header">
          <h3>Nova Transcribe</h3>
          <div class="nova-transcribe-status">Waiting for data...</div>
        </div>
        <div class="nova-transcribe-wrapper">
          <table class="nova-transcribe-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Conversation</th>
              </tr>
            </thead>
            <tbody id="nova-transcribe-body">
              <tr>
                <td colspan="2" class="nova-transcribe-empty">No transcription data available</td>
              </tr>
            </tbody>
          </table>
        </div>
      `;
      
      // Insert after the main-content div
      const mainContent = document.querySelector(".main-content");
      if (mainContent && mainContent.parentNode) {
        mainContent.parentNode.insertBefore(novaTranscribeContainer, mainContent.nextSibling);
      } else {
        // Fallback: append to body if main-content not found
        document.body.appendChild(novaTranscribeContainer);
      }
    }
    
    // Get references to the Nova Transcribe elements
    this.novaTranscribeStatus = novaTranscribeContainer.querySelector(".nova-transcribe-status") as HTMLElement;
    this.novaTranscribeBody = novaTranscribeContainer.querySelector("#nova-transcribe-body") as HTMLElement;
  }

  private setupDOMEventListeners(): void {
    // Connect/disconnect button
    this.connectBtn.addEventListener("click", () => {
      const state = this.connectBtn.getAttribute("data-state");
      if (state === "disconnected") {
        void this.start();
      } else if (state === "connected") {
        void this.stop();
      }
      // Do nothing if connecting - button should be disabled
    });

    if (this.disconnectBtn) {
      this.disconnectBtn.addEventListener("click", () => void this.stop());
    }
    
    // Set up panel tab switching - only debug and data-table tabs
    const panelTabs = document.querySelectorAll('.panel-tab');
    panelTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        // Remove active class from all tabs and panels
        document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.panel-content').forEach(p => p.classList.remove('active'));
        
        // Add active class to clicked tab
        tab.classList.add('active');
        
        // Get the tab's data-tab attribute and activate corresponding panel
        const tabName = tab.getAttribute('data-tab');
        if (tabName === 'debug') {
          document.getElementById('debug-log')?.classList.add('active');
        } else if (tabName === 'data-table') {
          document.getElementById('data-table-container')?.classList.add('active');
        }
      });
    });
    
    // Remove any existing transcript tab if it exists
    const transcriptTab = document.querySelector('.panel-tab[data-tab="transcript"]');
    if (transcriptTab) {
      transcriptTab.remove();
    }
    
    // Add Data Table tab if it doesn't exist
    const panelTabsContainer = document.querySelector('.panel-tabs');
    if (panelTabsContainer) {
      // Check if Data Table tab exists
      const dataTableTab = document.querySelector('.panel-tab[data-tab="data-table"]');
      if (!dataTableTab) {
        // Create Data Table tab
        const newDataTableTab = document.createElement('button');
        newDataTableTab.className = 'panel-tab';
        newDataTableTab.setAttribute('data-tab', 'data-table');
        newDataTableTab.textContent = 'Data Table';
        
        // Add click event listener
        newDataTableTab.addEventListener('click', () => {
          // Remove active class from all tabs and panels
          document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
          document.querySelectorAll('.panel-content').forEach(p => p.classList.remove('active'));
          
          // Add active class to this tab
          newDataTableTab.classList.add('active');
          
          // Activate data table panel
          document.getElementById('data-table-container')?.classList.add('active');
        });
        
        // Add to panel tabs
        panelTabsContainer.appendChild(newDataTableTab);
        
        this.log("Added Data Table tab to UI", "status");
      }
      
      // Ensure there's no transcript tab
      const transcriptTab = panelTabsContainer.querySelector('.panel-tab[data-tab="transcript"]');
      if (transcriptTab) {
        transcriptTab.remove();
        this.log("Removed Transcript tab from UI", "status");
      }
    }

    // Media toggle buttons
    this.micToggleBtn.addEventListener("click", () => {
      this.toggleMicrophone();
    });

    this.cameraToggleBtn.addEventListener("click", () => {
      this.toggleCamera();
    });

    // Chevron buttons to show/hide device popovers
    this.micChevronBtn.addEventListener("click", (e: MouseEvent) => {
      e.preventDefault();
      this.togglePopover(this.micPopover, this.micChevronBtn);

      // Hide camera popover if it's open
      if (this.cameraPopover.classList.contains("show")) {
        this.togglePopover(this.cameraPopover, this.cameraChevronBtn);
      }
    });

    this.cameraChevronBtn.addEventListener("click", (e: MouseEvent) => {
      e.preventDefault();
      this.togglePopover(this.cameraPopover, this.cameraChevronBtn);

      // Hide mic popover if it's open
      if (this.micPopover.classList.contains("show")) {
        this.togglePopover(this.micPopover, this.micChevronBtn);
      }
    });

    // Device selection changes
    this.audioInput.addEventListener("change", (e) => {
      const target = e.target as HTMLSelectElement;
      const audioDevice = target.value;

      void this.rtviClient.updateMic(audioDevice);
      this.updateCurrentDeviceDisplay();
    });

    this.videoInput.addEventListener("change", (e) => {
      const target = e.target as HTMLSelectElement;
      const videoDevice = target.value;

      void this.rtviClient.updateCam(videoDevice);
      this.updateCurrentDeviceDisplay();
    });

    // Close popovers when clicking outside
    document.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (
        !target.closest(".media-control") &&
        !target.closest(".device-popover")
      ) {
        this.micPopover.classList.remove("show");
        this.micChevronBtn.classList.remove("active");
        this.cameraPopover.classList.remove("show");
        this.cameraChevronBtn.classList.remove("active");
      }
    });
  }

  private togglePopover(popover: HTMLElement, chevronBtn: HTMLElement): void {
    popover.classList.toggle("show");
    chevronBtn.classList.toggle("active");
  }

  private toggleMicrophone(): void {
    if (!this.connected) {
      this.log("Cannot toggle microphone when not connected", "error");
      return;
    }

    this.micMuted = !this.micMuted;

    // Use RTVI client to enable/disable the microphone
    this.rtviClient.enableMic(!this.micMuted);

    // Update UI
    if (this.micMuted) {
      this.micToggleBtn.setAttribute("data-state", "muted");
      this.log("Microphone muted");
    } else {
      this.micToggleBtn.setAttribute("data-state", "unmuted");
      this.log("Microphone unmuted");
    }
  }

  private toggleCamera(): void {
    if (!this.connected) {
      this.log("Cannot toggle camera when not connected", "error");
      return;
    }

    this.cameraMuted = !this.cameraMuted;

    // Use RTVI client to enable/disable the camera
    this.rtviClient.enableCam(!this.cameraMuted);

    // Update UI
    if (this.cameraMuted) {
      this.cameraToggleBtn.setAttribute("data-state", "muted");
      this.log("Camera turned off");
    } else {
      this.cameraToggleBtn.setAttribute("data-state", "unmuted");
      this.log("Camera turned on");
    }

    // Update self view visibility
    this.updateSelfViewVisibility();
  }

  private updateCurrentDeviceDisplay(): void {
    // Update displayed device names in the dropdowns
    if (this.audioInput.selectedIndex > 0) {
      this.currentAudioDevice.textContent =
        this.audioInput.options[this.audioInput.selectedIndex].text;
    } else {
      this.currentAudioDevice.textContent = "Default device";
    }

    if (this.videoInput.selectedIndex > 0) {
      this.currentVideoDevice.textContent =
        this.videoInput.options[this.videoInput.selectedIndex].text;
    } else {
      this.currentVideoDevice.textContent = "Default device";
    }
  }

  private updateSelfViewVisibility(): void {
    // Show self-view when connected and camera is not muted
    if (this.connected && !this.cameraMuted) {
      this.selfViewContainer.classList.add("active");
    } else {
      this.selfViewContainer.classList.remove("active");
    }
  }

  private updateVideoVisibility(
    track: MediaStreamTrack,
    enabled: boolean
  ): void {
    this.log(`Video track ${enabled ? "enabled" : "disabled"}`);
    if (enabled) {
      // Show video, hide visualizer
      this.videoContainer.classList.remove("video-hidden");
      this.videoContainer.classList.add("video-visible");
    } else {
      // Hide video, show visualizer
      this.videoContainer.classList.remove("video-visible");
      this.videoContainer.classList.add("video-hidden");
    }
  }

  private log(message: string, type: string = "normal"): void {
    if (!this.debugLog) return;

    const now = new Date();
    const timeString = now.toISOString().replace("T", " ").substring(0, 19);

    const entry = document.createElement("div");
    entry.textContent = `${timeString} - ${message}`;

    // Apply styling based on message type
    if (type === "status" || message.includes("Status:")) {
      entry.classList.add("status-message");
    } else if (message.includes("User transcript:")) {
      entry.classList.add("user-message");
    } else if (message.includes("Bot transcript:")) {
      entry.classList.add("bot-message");
    } else if (type === "error") {
      entry.classList.add("error-message");
    }

    this.debugLog.appendChild(entry);
    this.debugLog.scrollTop = this.debugLog.scrollHeight;
  }

  private clearAllLogs(): void {
    if (this.debugLog) {
      this.debugLog.innerHTML = "";
      this.log("Log cleared", "status");
    }
  }
  
  private store_conversation(transcript: {timestamp: string, role: string, content: string}): void {
    console.log("[TRANSCRIPT DEBUG] store_conversation called with:", JSON.stringify(transcript));
    
    // Add the transcript to our local array
    this.transcripts.push(transcript);
    
    // Log the transcript
    console.log(`[TRANSCRIPT] ${transcript.timestamp} ${transcript.role}: ${transcript.content}`);
    
    // Update the Nova Transcribe table instead of the transcript container
    this.updateNovaTranscribe();
    
    // Optionally store transcripts in localStorage for persistence
    localStorage.setItem("conversation-transcripts", JSON.stringify(this.transcripts));
  }
  
  /**
   * Update the Nova Transcribe table with the latest transcripts
   */
  private updateNovaTranscribe(): void {
    if (!this.novaTranscribeBody) return;
    
    // Clear the table body
    this.novaTranscribeBody.innerHTML = '';
    
    // Check if we have conversations from AppSync Events API
    if (this.conversations.length > 0) {
      // Use conversations data from AppSync Events API
      this.conversations.forEach(conversation => {
        const row = document.createElement('tr');
        
        // Format timestamp for display
        const timestamp = new Date(conversation.timestamp);
        const formattedTime = timestamp.toLocaleTimeString();
        
        row.innerHTML = `
          <td>${formattedTime}</td>
          <td>${conversation.conversation || 'No content'}</td>
        `;
        
        this.novaTranscribeBody.appendChild(row);
      });
    } else if (this.transcripts.length === 0) {
      // No data available
      this.novaTranscribeBody.innerHTML = `
        <tr>
          <td colspan="2" class="nova-transcribe-empty">No transcription data available</td>
        </tr>
      `;
      return;
    } else {
      // Use transcript data as fallback
      this.transcripts.forEach(transcript => {
        const row = document.createElement('tr');
        
        // Format timestamp for display
        const timestamp = new Date(transcript.timestamp);
        const formattedTime = timestamp.toLocaleTimeString();
        
        row.innerHTML = `
          <td>${formattedTime}</td>
          <td>${transcript.content || ''}</td>
        `;
        
        this.novaTranscribeBody.appendChild(row);
      });
    }
    
    // Update status
    if (this.novaTranscribeStatus) {
      this.novaTranscribeStatus.textContent = `Last update: ${new Date().toLocaleTimeString()}`;
    }
    
    // Auto-scroll to the bottom
    const wrapper = this.novaTranscribeBody.closest('.nova-transcribe-wrapper');
    if (wrapper) {
      wrapper.scrollTop = wrapper.scrollHeight;
    }
  }

  private onConnectedHandler(): void {
    this.connected = true;
    this.connecting = false;

    // Update UI for connected state
    this.connectBtn.setAttribute("data-state", "connected");
    this.connectBtnText.textContent = "Disconnect";

    // Enable media control buttons
    this.micToggleBtn.disabled = false;
    this.cameraToggleBtn.disabled = false;
    this.micChevronBtn.disabled = false;
    this.cameraChevronBtn.disabled = false;

    // Set initial UI state for media controls based on mute states
    this.micToggleBtn.setAttribute(
      "data-state",
      this.micMuted ? "muted" : "unmuted"
    );
    this.cameraToggleBtn.setAttribute(
      "data-state",
      this.cameraMuted ? "muted" : "unmuted"
    );

    // Update self view visibility
    this.updateSelfViewVisibility();

    this.log(`Status: Connected`, "status");
  }

  private onDisconnectedHandler(): void {
    this.connected = false;
    this.connecting = false;

    // Update UI for disconnected state
    this.connectBtn.setAttribute("data-state", "disconnected");
    this.connectBtnText.textContent = "Connect";

    // Disable media control buttons
    this.micToggleBtn.disabled = false;
    this.cameraToggleBtn.disabled = false;
    this.micChevronBtn.disabled = false;
    this.cameraChevronBtn.disabled = false;

    // Hide self view
    this.selfViewContainer.classList.remove("active");

    // Reset video container state
    this.videoContainer.classList.remove("video-visible");
    this.videoContainer.classList.remove("video-hidden");

    // Disconnect the visualizer
    if (this.voiceVisualizer) {
      this.voiceVisualizer.disconnectAudio();
    }

    this.log(`Status: Disconnected`, "status");
  }

  /**
   * Handles new media tracks from the bot
   *
   * Visualizer display logic:
   * - Show visualizer when no video track is active (track is muted or not available)
   * - Hide visualizer when video track is active with valid resolution
   * - Show visualizer when video track is active but has 0x0 resolution (empty video)
   *
   * This ensures the visualizer is always visible when there's no meaningful video content
   * to display, even if a track is technically "active" but contains no visible content.
   *
   * @param track The media track received from the bot
   */
  private onBotTrackStarted(track: MediaStreamTrack): void {
    if (track.kind === "video") {
      // Set the video track to the video element
      this.videoElement.srcObject = new MediaStream([track]);

      // Function to check resolution and update visibility
      const checkVideoResolution = () => {
        const hasValidResolution =
          this.videoElement.videoWidth > 0 && this.videoElement.videoHeight > 0;
        // Show video only if track is not muted AND has valid resolution
        // Otherwise show the visualizer
        this.updateVideoVisibility(track, !track.muted && hasValidResolution);
      };

      // Check resolution once metadata is loaded
      this.videoElement.addEventListener(
        "loadedmetadata",
        checkVideoResolution
      );

      // Also check when resolution might change (e.g., after track changes)
      this.videoElement.addEventListener("resize", checkVideoResolution);

      // Set up track mute/unmute handling
      track.onmute = () => this.updateVideoVisibility(track, false);
      track.onunmute = () => {
        // When track unmutes, check if we have valid video dimensions
        if (this.videoElement.readyState >= 1) {
          checkVideoResolution();
        } // Otherwise, loadedmetadata event will handle it
      };

      // Initial check in case the track already has valid data
      if (this.videoElement.readyState >= 1) {
        checkVideoResolution();
      }
    } else if (track.kind === "audio") {
      // Set the audio track to the audio element
      this.audioElement.srcObject = new MediaStream([track]);

      // Connect to visualizer
      if (this.voiceVisualizer) {
        this.voiceVisualizer.connectToAudioTrack(track);
      }
    }
  }

  private async populateDevices(): Promise<void> {
    try {
      // Initialize the media devices
      await this.rtviClient.initDevices();

      // Get available devices
      const audioDevices = await this.rtviClient.getAllMics();
      const videoDevices = await this.rtviClient.getAllCams();

      // Clear existing options (except Default)
      while (this.audioInput.options.length > 1) {
        this.audioInput.options.remove(1);
      }

      while (this.videoInput.options.length > 1) {
        this.videoInput.options.remove(1);
      }

      // Add audio devices
      audioDevices.forEach((device, index) => {
        const option = document.createElement("option");
        option.value = device.deviceId;
        option.text = device.label || `Microphone ${index + 1}`;
        this.audioInput.appendChild(option);
      });

      // Add video devices
      videoDevices.forEach((device, index) => {
        const option = document.createElement("option");
        option.value = device.deviceId;
        option.text = device.label || `Camera ${index + 1}`;
        this.videoInput.appendChild(option);
      });

      // Update display
      this.updateCurrentDeviceDisplay();

      // Log detected devices
      if (audioDevices.length > 0) {
        this.log(`Detected ${audioDevices.length} audio input devices`);
      }

      if (videoDevices.length > 0) {
        this.log(`Detected ${videoDevices.length} video input devices`);
      }
    } catch (e) {
      const error = e as Error;
      this.log(`Error getting devices: ${error.message}`, "error");
      console.error("Device initialization error:", e);
    }
  }

  private async start(): Promise<void> {
    if (this.connecting) {
      return; // Prevent multiple connection attempts
    }

    this.connecting = true;
    this.clearAllLogs();

    // Update UI to show connecting state
    this.connectBtn.setAttribute("data-state", "connecting");
    this.connectBtnText.textContent = "Connect";

    this.log("Connecting...", "status");

    try {
      // Set the audio and video codecs if needed
      if (this.audioCodec) {
        this.smallWebRTCTransport.setAudioCodec(this.audioCodec.value);
      }
      if (this.videoCodec) {
        this.smallWebRTCTransport.setVideoCodec(this.videoCodec.value);
      }

      // Enable or disable mic/camera based on current state
      this.rtviClient.enableMic(!this.micMuted);
      this.rtviClient.enableCam(!this.cameraMuted);

      // Connect to the bot
      await this.rtviClient.connect();
      
      // Log successful connection with ICE server info
      this.log("WebRTC connection established successfully", "status");
      
      // Note: onConnectedHandler will be called via the callback when connection is fully established
    } catch (e) {
      const error = e as Error;
      this.log(`Failed to connect: ${error.message}`, "error");
      console.error("Connection error:", e);
      
      // Check if the error might be related to ICE connectivity
      if (error.message.includes("ICE") ||
          error.message.includes("connection") ||
          error.message.includes("timeout")) {
        this.log("Connection issue might be related to network connectivity or firewall restrictions.", "error");
        this.log("The system will attempt to use TURN servers if available.", "status");
        
        // Provide more detailed diagnostics
        this.logWebRTCDiagnostics();
      }

      // Reset UI state on error
      this.connectBtn.setAttribute("data-state", "disconnected");
      this.connectBtnText.textContent = "Connect";
      this.connecting = false;

      void this.stop();
    }
  }

  private async stop(): Promise<void> {
    try {
      // Disconnect from the bot
      await this.rtviClient.disconnect();

      // Additional cleanup for the visualizer
      if (this.voiceVisualizer) {
        this.voiceVisualizer.disconnectAudio();
      }

      // Clear video elements
      if (this.videoElement.srcObject) {
        this.videoElement.srcObject = null;
      }

      if (this.audioElement.srcObject) {
        this.audioElement.srcObject = null;
      }

      if (this.selfViewVideo.srcObject) {
        this.selfViewVideo.srcObject = null;
      }
      
      // Clean up mock data intervals
      if ((window as any).mockDataIntervals) {
        (window as any).mockDataIntervals.forEach((interval: number) => {
          clearInterval(interval);
        });
        (window as any).mockDataIntervals = [];
        this.log("Mock data intervals cleaned up", "status");
      }
      
      // Clean up Events API subscriptions
      this.eventSubscriptions.forEach((subscription, eventName) => {
        if (subscription && typeof subscription.unsubscribe === 'function') {
          this.log(`Unsubscribing from ${eventName}`, "status");
          subscription.unsubscribe();
        }
      });
      this.eventSubscriptions.clear();
      
      // Clean up Events API channels
      this.eventChannels.forEach((channel, eventName) => {
        if (channel && typeof channel.disconnect === 'function') {
          this.log(`Disconnecting channel for ${eventName}`, "status");
          channel.disconnect();
        }
      });
      this.eventChannels.clear();
      
      this.log("Event subscriptions and channels cleaned up", "status");
    } catch (e) {
      const error = e as Error;
      this.log(`Error during disconnect: ${error.message}`, "error");
      console.error("Disconnect error:", e);
    }
  }
  
  /**
   * Update the data table with the current data
   */
  private updateDataTable(): void {
    if (!this.dataTable || !this.dataTableBody) return;
    
    // Clear the table body
    this.dataTableBody.innerHTML = '';
    
    // Only handle bookings data in the data table now
    if (this.bookings.length === 0) {
      this.dataTableBody.innerHTML = `
        <tr>
          <td colspan="9" class="data-table-empty">No booking data available</td>
        </tr>
      `;
      return;
    }
    
    // Add booking data rows
    this.bookings.forEach(booking => {
      const row = document.createElement('tr');
      
      // Format timestamp for better readability if it exists
      const formattedTimestamp = booking.timestamp ?
        new Date(booking.timestamp).toLocaleString() :
        '';
      
      row.innerHTML = `
        <td>${booking.bookingId || ''}</td>
        <td>${booking.name || ''}</td>
        <td>${booking.date || ''}</td>
        <td>${booking.hour || ''}</td>
        <td>${booking.numGuests || 0}</td>
        <td>${booking.status || ''}</td>
        <td>${formattedTimestamp}</td>
        <td>${booking.source || ''}</td>
        <td>${booking.eventName || ''}</td>
      `;
      
      this.dataTableBody.appendChild(row);
    });
    
    // Update the Nova Transcribe table separately
    this.updateNovaTranscribe();
  }

  /**
   * Logs diagnostic information about WebRTC connectivity
   * Helps diagnose issues with ICE servers, especially TURN server connectivity
   */
  private logWebRTCDiagnostics(): void {
    const runtimeConfig = (window as any).runtimeConfig || {};
    const logLevel = runtimeConfig.LOG_LEVEL || 'info';
    
    this.log("--- WebRTC Connection Diagnostics ---", "status");
    this.log(`Runtime configuration: LOG_LEVEL=${logLevel}`, "status");
    
    // Check if we're behind a symmetric NAT (which would require TURN)
    this.log("Checking network connectivity...", "status");
    
    // Log information about the ICE servers being used
    this.log("ICE Servers Configuration:", "status");
    this.log(`- STUN server: ${runtimeConfig.STUN_SERVER || "stun:stun.l.google.com:19302"}`, "status");
    
    if (runtimeConfig.TURN_SERVER) {
      this.log(`- TURN server: ${runtimeConfig.TURN_SERVER}`, "status");
      if (runtimeConfig.TURN_USERNAME) {
        this.log(`- TURN credentials: Configured`, "status");
      } else {
        this.log(`- TURN credentials: Missing username/password`, "status");
      }
    } else {
      this.log("- No TURN server configured", "status");
    }
    
    // Log API endpoint
    this.log(`- API Endpoint: ${runtimeConfig.API_ENDPOINT || 'http://localhost:8000'}`, "status");
    
    // Provide troubleshooting tips
    this.log("Troubleshooting tips:", "status");
    this.log("1. Ensure you're not behind a restrictive firewall", "status");
    this.log("2. Check that the TURN server is properly configured in environment variables", "status");
    this.log("3. Verify that UDP ports 3478 and 49152-65535 are not blocked", "status");
    this.log("4. For secure connections, ensure TLS port 5349 is accessible", "status");
    
    this.log("Attempting to reconnect with TURN relay...", "status");
  }

  // Public method for external access (e.g. from event handlers)
  public shutdown(): void {
    void this.stop();
  }
}

// Define the global interface for TypeScript
declare global {
  interface Window {
    webRTCApp: {
      shutdown(): void;
    };
  }
}

// Initialize the application
document.addEventListener("DOMContentLoaded", () => {
  // @ts-ignore - We know this is compatible
  window.webRTCApp = new WebRTCApp();

  // Cleanup when leaving the page
  window.addEventListener("beforeunload", () => {
    if (window.webRTCApp) {
      window.webRTCApp.shutdown();
    }
  });
  
  // Remove any transcript tab that might be in the HTML
  setTimeout(() => {
    const transcriptTab = document.querySelector('.panel-tab[data-tab="transcript"]');
    if (transcriptTab) {
      transcriptTab.remove();
      console.log("Removed Transcript tab from UI on page load");
    }
    
    // Also remove any transcript content panel
    const transcriptPanel = document.getElementById('transcript-container');
    if (transcriptPanel) {
      transcriptPanel.remove();
      console.log("Removed Transcript panel from UI on page load");
    }
  }, 100);
});

export {};
