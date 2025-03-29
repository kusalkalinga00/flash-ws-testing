"use client";

import { useEffect, useRef, useState } from "react";
import webSocketService from "@/utils/websocket-service";
import { v4 as uuidv4 } from "uuid";
import { Button } from "@/components/ui/button";
import { Mic, MicOff } from "lucide-react";
import { Base64 } from "js-base64";

const ConnectionInd = () => {
  const [isConnected, setIsConnected] = useState(false);

  const sessionIdRef = useRef<string | null>(null);
  const userIdRef = useRef<string | null>(null);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const audioBuffers = useRef<string[]>([]);

  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const [isRecording, setIsRecording] = useState(false);

  const audioContext = useRef<AudioContext | null>(null);
  const audioQueue = useRef<Float32Array[]>([]);
  const isPlaying = useRef<boolean>(false);
  const currentSource = useRef<AudioBufferSourceNode | null>(null);
  const [streamConnectiondone, setStreamConnectionDone] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const audioWorkletNodeRef = useRef<AudioWorkletNode | null>(null);

  // Speech detection parameters
  const speechDetectionThreshold = 10; // Adjust based on testing
  const silenceTimeout = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!sessionIdRef.current) {
      sessionIdRef.current = uuidv4();
      setSessionId(sessionIdRef.current);
    }

    if (!userIdRef.current) {
      userIdRef.current = uuidv4();
      setUserId(userIdRef.current);
    }

    // Initialize audio context
    if (typeof window !== "undefined") {
      audioContext.current = new (window.AudioContext ||
        (window as any).webkitAudioContext)();
    }

    return () => {
      // Clean up audio context when component unmounts
      if (audioContext.current) {
        audioContext.current.close();
      }

      if (silenceTimeout.current) {
        clearTimeout(silenceTimeout.current);
      }
    };
  }, []);

  const processAudioData = async (base64Audio: string) => {
    if (!audioContext.current) return;

    try {
      // Decode base64 to bytes
      const binaryString = window.atob(base64Audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Convert to Int16Array (PCM format)
      const pcmData = new Int16Array(bytes.buffer);

      // Convert to float32 for Web Audio API
      const float32Data = new Float32Array(pcmData.length);
      for (let i = 0; i < pcmData.length; i++) {
        float32Data[i] = pcmData[i] / 32768.0;
      }

      // Calculate audio level for visualization (optional)
      let sum = 0;
      for (let i = 0; i < float32Data.length; i++) {
        sum += Math.abs(float32Data[i]);
      }
      const level = Math.min((sum / float32Data.length) * 100 * 5, 100);
      setAudioLevel(level);

      // Add to queue if not interrupted by user speaking
      if (!isUserSpeaking) {
        audioQueue.current.push(float32Data);

        // Start playing if not already playing
        if (!isPlaying.current) {
          playNextInQueue();
        }
      }
    } catch (error) {
      console.error("Error processing audio data:", error);
    }
  };

  const playNextInQueue = () => {
    // Stop playback if user is speaking
    if (isUserSpeaking) {
      stopCurrentPlayback();
      audioQueue.current = []; // Clear the queue
      return;
    }

    if (
      !audioContext.current ||
      isPlaying.current ||
      audioQueue.current.length === 0
    ) {
      if (audioQueue.current.length === 0) {
        isPlaying.current = false;
        setIsPlayingAudio(false);
      }
      return;
    }

    try {
      isPlaying.current = true;
      setIsPlayingAudio(true);

      const float32Data = audioQueue.current.shift()!;

      // Create a mono audio buffer with sample rate of 24000 (adjust if needed)
      const audioBuffer = audioContext.current.createBuffer(
        1,
        float32Data.length,
        24000
      );

      // Copy the float32 data to the buffer
      audioBuffer.getChannelData(0).set(float32Data);

      // Create and configure source
      currentSource.current = audioContext.current.createBufferSource();
      currentSource.current.buffer = audioBuffer;
      currentSource.current.connect(audioContext.current.destination);

      currentSource.current.onended = () => {
        isPlaying.current = false;
        currentSource.current = null;

        // Play next chunk if available and user is not speaking
        if (!isUserSpeaking) {
          playNextInQueue();
        }
      };

      currentSource.current.start(0);
    } catch (error) {
      console.error("Error playing audio:", error);
      isPlaying.current = false;
      setIsPlayingAudio(false);
      currentSource.current = null;

      // Try to continue with next chunk despite error
      playNextInQueue();
    }
  };

  // Function to stop current playback
  const stopCurrentPlayback = () => {
    if (currentSource.current) {
      try {
        currentSource.current.stop();
        currentSource.current.disconnect();
        currentSource.current = null;
      } catch (e) {
        console.error("Error stopping audio playback:", e);
      }
    }
    isPlaying.current = false;
    setIsPlayingAudio(false);
  };

  // Handle user speech detection
  const handleSpeechDetection = (level: number) => {
    // If level is above threshold and we're not already tracking speech
    if (level > speechDetectionThreshold && !isUserSpeaking) {
      console.log("User started speaking, level:", level);
      setIsUserSpeaking(true);

      // If AI is currently playing audio, stop it
      if (isPlaying.current) {
        stopCurrentPlayback();
      }
    }

    // Reset silence detection timer whenever we detect sound
    if (level > speechDetectionThreshold) {
      if (silenceTimeout.current) {
        clearTimeout(silenceTimeout.current);
      }

      // Set new timeout to detect when user stops speaking
      silenceTimeout.current = setTimeout(() => {
        console.log("User stopped speaking");
        setIsUserSpeaking(false);
      }, 1000); // 1 second of silence to consider speech ended
    }
  };

  useEffect(() => {
    if (!sessionId || !userId) return;

    webSocketService.on("statusChange", (status: boolean) => {
      setIsConnected(status);

      if (status) {
        const connectPayload = {
          event: "connect-stream",
          data: {
            web_socket_id: webSocketService.getWebSocketId(),
            session_id: sessionId,
            user_id: userId,
            unit_no: 1,
            lesson_no: 1,
            activation_no: 2,
          },
        };

        webSocketService.send(connectPayload);
        console.log("Sent connect-stream event", connectPayload);
      }
    });

    webSocketService.on("connect-stream-done", (data) => {
      console.log("Received connect-stream-done event", data);
      setStreamConnectionDone(true);
    });

    webSocketService.on("ai-audio-response", (data) => {
      console.log("Received AI audio response:", data);

      // Only process audio if user is not currently speaking
      const { session_id, user_id, message_id, ai_audio_data, stream_end } =
        data;

      if (ai_audio_data && !isUserSpeaking) {
        // Process and play the audio data
        processAudioData(ai_audio_data);
      }

      if (stream_end) {
        console.log("Audio stream complete");
        webSocketService.on("ai-text-response", (data) => {
          const { ai_transcribed_text } = data;
          console.log("Received AI text response:", ai_transcribed_text);
        });
      }

      // const conversationStopAudioPayload = {
      //   event: "conversation-stop-audio",
      //   data: {
      //     web_socket_id: webSocketService.getWebSocketId(),
      //     session_id: sessionId,
      //     user_id: userId,
      //     unit_no: 1,
      //     lesson_no: 1,
      //     activation_no: 2,
      //   },
      // };
    });

    // Cleanup function to remove event listeners
    return () => {
      webSocketService.removeAllListeners("statusChange");
      webSocketService.removeAllListeners("connect-stream-done");
      webSocketService.removeAllListeners("ai-audio-response");
      webSocketService.removeAllListeners("ai-text-response");

      if (silenceTimeout.current) {
        clearTimeout(silenceTimeout.current);
      }
    };
  }, [sessionId, userId, isUserSpeaking]);

  const initiateConversation = () => {
    const conversationPayload = {
      event: "conversation-initiate",
      data: {
        web_socket_id: webSocketService.getWebSocketId(),
        session_id: sessionId,
        user_id: userId,
        unit_no: 1,
        lesson_no: 1,
        activation_no: 2,
      },
    };

    webSocketService.send(conversationPayload);
    console.log("Sent conversation-initiate event", conversationPayload);
  };

  const handleStartRecording = async () => {
    if (!webSocketService.isConnected()) {
      console.log("WebSocket is not connected");
      return;
    }

    setIsRecording(true);

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        autoGainControl: true,
        noiseSuppression: true,
      },
    });

    audioContext.current = new AudioContext({
      sampleRate: 16000,
    });

    setStream(stream);
  };

  useEffect(() => {
    const handleAudioStream = async () => {
      if (!stream) {
        return;
      }

      const ctx = audioContext.current;
      if (!ctx || ctx.state === "closed") {
        console.log("Audio context is not available");
        return;
      }

      if (ctx.state === "suspended") {
        ctx.resume();
      }

      await ctx.audioWorklet.addModule("/worklets/audio-processor.js");

      audioWorkletNodeRef.current = new AudioWorkletNode(
        ctx,
        "audio-processor",
        {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          processorOptions: {
            sampleRate: 16000,
            bufferSize: 4096, // Larger buffer size like original
          },
          channelCount: 1,
          channelCountMode: "explicit",
          channelInterpretation: "speakers",
        }
      );

      const source = ctx.createMediaStreamSource(stream);
      audioWorkletNodeRef.current.port.onmessage = (event) => {
        const { pcmData, level } = event.data;
        setAudioLevel(level);

        // Check for user speech based on audio level
        handleSpeechDetection(level);

        const pcmArray = new Uint8Array(pcmData);
        const b64Data = Base64.fromUint8Array(pcmArray);
        sendAudioData(b64Data);
      };
      source.connect(audioWorkletNodeRef.current);
    };

    handleAudioStream();

    return () => {
      if (audioWorkletNodeRef.current) {
        audioWorkletNodeRef.current.port.close();
        audioWorkletNodeRef.current.disconnect();
        audioWorkletNodeRef.current = null;
      }
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
      if (silenceTimeout.current) {
        clearTimeout(silenceTimeout.current);
      }
    };
  }, [stream]);

  const sendAudioData = (b64Data: string) => {
    if (!isRecording) return;

    const audioPayload = {
      event: "conversation-stream-audio",
      data: {
        web_socket_id: webSocketService.getWebSocketId(),
        session_id: sessionId,
        user_id: userId,
        unit_no: 1,
        lesson_no: 1,
        activation_no: 2,
        audio_data: b64Data,
      },
    };
    webSocketService.send(audioPayload);
  };

  const handleStopRecording = () => {
    setIsRecording(false);

    if (audioWorkletNodeRef.current) {
      audioWorkletNodeRef.current.disconnect();
      audioWorkletNodeRef.current = null;
    }

    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
    }

    setIsUserSpeaking(false);

    if (silenceTimeout.current) {
      clearTimeout(silenceTimeout.current);
    }

    console.log("Recording stopped");
  };

  return (
    <div>
      <div className="p-4 border rounded shadow">
        <h2 className="text-xl font-bold mb-2">WebSocket Connection</h2>
        <p>
          Connection status:{" "}
          <span className={isConnected ? "text-green-600" : "text-red-600"}>
            {isConnected ? "Connected" : "Disconnected"}
          </span>
        </p>
        {isRecording && (
          <p className="mt-2">
            Status:{" "}
            {isUserSpeaking
              ? "User speaking"
              : isPlayingAudio
              ? "AI speaking"
              : "Listening"}
          </p>
        )}
        <div className="mt-2 h-2 w-full bg-gray-200 rounded">
          <div
            className={`h-full rounded ${
              isUserSpeaking ? "bg-green-500" : "bg-blue-500"
            }`}
            style={{ width: `${audioLevel}%` }}
          />
        </div>
      </div>
      <div className="flex flex-col items-center mt-4">
        <div className="mt-5">
          <Button
            onClick={initiateConversation}
            disabled={!streamConnectiondone}
          >
            Initiate Conversation
          </Button>
        </div>
        <div className="mt-10 gap-4 space-x-3.5">
          <Button
            size={"icon"}
            onClick={handleStartRecording}
            disabled={isRecording}
            className={isRecording ? "bg-gray-400" : ""}
          >
            <Mic className="h-4 w-4" />
          </Button>

          <Button
            size={"icon"}
            onClick={handleStopRecording}
            disabled={!isRecording}
            className={!isRecording ? "bg-gray-400" : ""}
          >
            <MicOff className="h-4 w-4" />
          </Button>
        </div>
        <div className="mt-4">
          <p>
            1. Initiate conversation by clicking the "Initiate Conversation"
            button.
          </p>
          <p>
            2. Click the microphone button to start recording your voice. It
            will stream audio to backend.
          </p>
          <p>3. Click the microphone button again to stop recording.</p>
        </div>
      </div>
    </div>
  );
};

export default ConnectionInd;
