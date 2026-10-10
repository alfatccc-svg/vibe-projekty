// Přepis řeči v zařízení: Whisper přes transformers.js (ONNX Runtime Web, WASM).
// Model se stahuje jen v režimu přípravy; v secure režimu je vzdálené načítání vypnuté.
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2/dist/transformers.min.js';

env.useBrowserCache = true;
env.allowLocalModels = false;

let asr = null, nactenyModel = null;

async function priprav(model, povolitSit, zprava) {
  env.allowRemoteModels = !!povolitSit;
  if (asr && nactenyModel === model) return;
  asr = await pipeline('automatic-speech-recognition', model, {
    dtype: 'q8', device: 'wasm',
    progress_callback: p => {
      if (p.status === 'progress' && p.total) zprava({ typ: 'stahovani', soubor: p.file, hotovo: p.loaded, celkem: p.total });
    },
  });
  nactenyModel = model;
}

self.onmessage = async ({ data }) => {
  const posli = m => self.postMessage({ ...m, id: data.id });
  try {
    if (data.typ === 'priprav') {
      await priprav(data.model, data.povolitSit, posli);
      posli({ typ: 'pripraveno' });
    } else if (data.typ === 'prepis') {
      await priprav(data.model, data.povolitSit, posli);
      const delka = data.audio.length / 16000;
      let hotovo = 0;
      const vysledek = await asr(data.audio, {
        language: data.jazyk, task: 'transcribe',
        chunk_length_s: 30, stride_length_s: 5, return_timestamps: true,
        chunk_callback: () => { hotovo = Math.min(delka, hotovo + 25); posli({ typ: 'postup', hotovo, delka }); },
      });
      posli({ typ: 'hotovo', chunks: vysledek.chunks || [{ timestamp: [0, delka], text: vysledek.text }] });
    }
  } catch (e) {
    posli({ typ: 'chyba', zprava: String(e && e.message || e) });
  }
};
