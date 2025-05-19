/**
 * Copyright (c) 2024–2025, Daily
 *
 * SPDX-License-Identifier: BSD 2-Clause License
 */

export interface VoiceVisualizerOptions {
  backgroundColor?: string;
  barColor?: string;
  barWidth?: number;
  barGap?: number;
  barMaxHeight?: number;
  container?: string;
}

export interface FrequencyBand {
  startFreq: number;
  endFreq: number;
  smoothValue: number;
}

export class VoiceVisualizer {
  private options: Required<VoiceVisualizerOptions>;
  private canvas: HTMLCanvasElement | null;
  private canvasCtx: CanvasRenderingContext2D | null;
  private audioContext: AudioContext | null;
  private analyser: AnalyserNode | null;
  private source: MediaStreamAudioSourceNode | null;
  private isActive: boolean;
  private animationId: number | null;
  private bands: FrequencyBand[];

  constructor(options: VoiceVisualizerOptions = {}) {
    this.options = {
      backgroundColor: options.backgroundColor || "transparent",
      barColor: options.barColor || "rgba(255, 255, 255, 0.8)",
      barWidth: options.barWidth || 30,
      barGap: options.barGap || 12,
      barMaxHeight: options.barMaxHeight || 120,
      container: options.container || "voice-visualizer-container",
    };

    this.canvas = null;
    this.canvasCtx = null;
    this.audioContext = null;
    this.analyser = null;
    this.source = null;
    this.isActive = false;
    this.animationId = null;

    this.bands = [
      { startFreq: 85, endFreq: 255, smoothValue: 0 },
      { startFreq: 255, endFreq: 500, smoothValue: 0 },
      { startFreq: 500, endFreq: 2000, smoothValue: 0 },
      { startFreq: 2000, endFreq: 4000, smoothValue: 0 },
      { startFreq: 4000, endFreq: 8000, smoothValue: 0 },
    ];

    this.init();
  }

  private init(): void {
    const container = document.getElementById(this.options.container);
    if (!container) {
      console.error("Visualizer container not found");
      return;
    }

    // Create canvas element
    this.canvas = document.createElement("canvas");
    this.canvas.id = "voice-visualizer";
    container.appendChild(this.canvas);

    // Set up canvas
    this.setupCanvas();

    // Add resize handler
    window.addEventListener("resize", this.handleResize.bind(this));
  }

  private setupCanvas(): void {
    if (!this.canvas) return;

    const { barWidth, barGap, barMaxHeight } = this.options;
    const canvasWidth = 5 * barWidth + 4 * barGap;
    const canvasHeight = barMaxHeight;
    const scaleFactor = 2;

    this.canvas.width = canvasWidth * scaleFactor;
    this.canvas.height = canvasHeight * scaleFactor;
    this.canvas.style.width = `${canvasWidth}px`;
    this.canvas.style.height = `${canvasHeight}px`;

    this.canvasCtx = this.canvas.getContext("2d");
    if (this.canvasCtx) {
      this.canvasCtx.lineCap = "round";
      this.canvasCtx.scale(scaleFactor, scaleFactor);
    }

    // Draw initial inactive state
    this.drawInactiveCircles();
  }

  private handleResize(): void {
    this.setupCanvas();
    // Only draw circles if we're active
    if (this.isActive) {
      this.drawInactiveCircles();
    }
  }

  public connectToAudioTrack(track: MediaStreamTrack): void {
    if (!track) {
      console.log("No audio track provided");
      this.disconnectAudio();
      return;
    }

    // Clean up existing audio context if any
    this.disconnectAudio();

    try {
      // @ts-ignore
      this.audioContext = new (window.AudioContext ||
        (window as any).webkitAudioContext)();
      const stream = new MediaStream([track]);
      // @ts-ignore
      this.source = this.audioContext.createMediaStreamSource(stream);
      // @ts-ignore
      this.analyser = this.audioContext.createAnalyser();
      // @ts-ignore
      this.analyser.fftSize = 1024;
      // @ts-ignore
      this.source.connect(this.analyser);

      this.isActive = true;
      this.startVisualization();

      console.log("Voice visualizer connected to audio track");
    } catch (error) {
      console.error("Error connecting to audio track:", error);
    }
  }

  public disconnectAudio(): void {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }

    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }

    if (this.audioContext) {
      if (this.audioContext.state !== "closed") {
        this.audioContext.close();
      }
      this.audioContext = null;
    }

    this.analyser = null;
    this.isActive = false;

    // Draw inactive state
    this.drawInactiveCircles();
  }

  private getFrequencyBinIndex(frequency: number): number {
    if (!this.audioContext || !this.analyser) return 0;
    const nyquist = this.audioContext.sampleRate / 2;
    return Math.round(
      (frequency / nyquist) * (this.analyser.frequencyBinCount - 1)
    );
  }

  // In the startVisualization method
  private startVisualization(): void {
    if (!this.canvasCtx || !this.analyser || !this.canvas) return;

    const frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
    const scaleFactor = 2;
    const { barWidth, barGap, barMaxHeight, backgroundColor, barColor } =
      this.options;

    const drawSpectrum = () => {
      // Recheck all variables since they could become null between animation frames
      if (!this.analyser || !this.canvasCtx || !this.canvas) return;

      this.analyser.getByteFrequencyData(frequencyData);
      this.canvasCtx.clearRect(
        0,
        0,
        this.canvas.width / scaleFactor,
        this.canvas.height / scaleFactor
      );
      this.canvasCtx.fillStyle = backgroundColor;
      this.canvasCtx.fillRect(
        0,
        0,
        this.canvas.width / scaleFactor,
        this.canvas.height / scaleFactor
      );

      let isActive = false;

      const totalBarsWidth =
        this.bands.length * barWidth + (this.bands.length - 1) * barGap;
      const startX = (this.canvas.width / scaleFactor - totalBarsWidth) / 2;

      const adjustedCircleRadius = barWidth / 2;
      const canvasHeight = this.canvas.height;
      const ctx = this.canvasCtx; // Store in local variable to satisfy TypeScript

      this.bands.forEach((band, i) => {
        const startIndex = this.getFrequencyBinIndex(band.startFreq);
        const endIndex = this.getFrequencyBinIndex(band.endFreq);
        const bandData = frequencyData.slice(startIndex, endIndex);
        const bandValue =
          bandData.reduce((acc, val) => acc + val, 0) / bandData.length;

        const smoothingFactor = 0.2;

        if (bandValue < 1) {
          band.smoothValue = Math.max(
            band.smoothValue - smoothingFactor * 5,
            0
          );
        } else {
          band.smoothValue =
            band.smoothValue + (bandValue - band.smoothValue) * smoothingFactor;
          isActive = true;
        }

        const x = startX + i * (barWidth + barGap);
        const barHeight = Math.min(
          (band.smoothValue / 255) * barMaxHeight,
          barMaxHeight
        );

        const yTop = Math.max(
          canvasHeight / scaleFactor / 2 - barHeight / 2,
          adjustedCircleRadius
        );
        const yBottom = Math.min(
          canvasHeight / scaleFactor / 2 + barHeight / 2,
          canvasHeight / scaleFactor - adjustedCircleRadius
        );

        if (band.smoothValue > 0) {
          ctx.beginPath();
          ctx.moveTo(x + barWidth / 2, yTop);
          ctx.lineTo(x + barWidth / 2, yBottom);
          ctx.lineWidth = barWidth;
          ctx.strokeStyle = barColor;
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(
            x + barWidth / 2,
            canvasHeight / scaleFactor / 2,
            adjustedCircleRadius,
            0,
            2 * Math.PI
          );
          ctx.fillStyle = barColor;
          ctx.fill();
          ctx.closePath();
        }
      });

      if (!isActive) {
        this.drawInactiveCircles();
      }

      this.animationId = requestAnimationFrame(drawSpectrum);
    };

    this.animationId = requestAnimationFrame(drawSpectrum);
  }

  private drawInactiveCircles(): void {
    if (!this.canvasCtx || !this.canvas) return;

    const scaleFactor = 2;
    const { barWidth, barGap, barColor } = this.options;
    const circleRadius = barWidth / 2;
    const canvasWidth = this.canvas.width;
    const canvasHeight = this.canvas.height;
    const ctx = this.canvasCtx; // Store in local variable to satisfy TypeScript

    ctx.clearRect(0, 0, canvasWidth / scaleFactor, canvasHeight / scaleFactor);
    ctx.fillStyle = this.options.backgroundColor;
    ctx.fillRect(0, 0, canvasWidth / scaleFactor, canvasHeight / scaleFactor);

    const totalBarsWidth =
      this.bands.length * barWidth + (this.bands.length - 1) * barGap;
    const startX = (canvasWidth / scaleFactor - totalBarsWidth) / 2;
    const y = canvasHeight / scaleFactor / 2;

    this.bands.forEach((_, i) => {
      const x = startX + i * (barWidth + barGap);

      ctx.beginPath();
      ctx.arc(x + barWidth / 2, y, circleRadius, 0, 2 * Math.PI);
      ctx.fillStyle = barColor;
      ctx.fill();
      ctx.closePath();
    });
  }
}
