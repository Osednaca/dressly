const WAV_SAMPLE_RATE = 16_000;

/**
 * Re-encode a MediaRecorder clip (usually WebM/Opus) as 16 kHz mono 16-bit WAV.
 *
 * WAV is a format every transcription model accepts, and at speech quality a 30s
 * clip stays around 1MB.
 */
export async function toWav(recording: Blob): Promise<Blob> {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await recording.arrayBuffer());
    const offline = new OfflineAudioContext(
      1,
      Math.max(1, Math.ceil(decoded.duration * WAV_SAMPLE_RATE)),
      WAV_SAMPLE_RATE,
    );
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const samples = (await offline.startRendering()).getChannelData(0);

    const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
    const ascii = (offset: number, value: string) => {
      for (let index = 0; index < value.length; index += 1) {
        view.setUint8(offset + index, value.charCodeAt(index));
      }
    };
    ascii(0, "RIFF");
    view.setUint32(4, 36 + samples.length * 2, true);
    ascii(8, "WAVE");
    ascii(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, WAV_SAMPLE_RATE, true);
    view.setUint32(28, WAV_SAMPLE_RATE * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    ascii(36, "data");
    view.setUint32(40, samples.length * 2, true);
    samples.forEach((sample, index) => {
      view.setInt16(44 + index * 2, Math.max(-1, Math.min(1, sample)) * 0x7fff, true);
    });
    return new Blob([view], { type: "audio/wav" });
  } finally {
    void context.close();
  }
}
