class RickyPcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0] && input[0].length) {
      const mono = new Float32Array(input[0]);
      this.port.postMessage({ samples: mono, sampleRate }, [mono.buffer]);
    }
    return true;
  }
}

registerProcessor("ricky-pcm-capture", RickyPcmCaptureProcessor);
