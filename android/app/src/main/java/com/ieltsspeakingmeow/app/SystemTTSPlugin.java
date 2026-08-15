package com.ieltsspeakingmeow.app;

import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

@CapacitorPlugin(name = "SystemTTS")
public class SystemTTSPlugin extends Plugin {
    private enum EngineState {
        IDLE,
        INITIALIZING,
        READY,
        DESTROYED
    }

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private TextToSpeech engine;
    private EngineState engineState = EngineState.IDLE;
    private int engineToken = 0;
    private int speechGeneration = 0;
    private PendingSpeech pendingSpeech;
    private PluginCall activeCall;
    private String activeUtteranceId;
    private PendingStatus pendingStatus;

    private static final class PendingSpeech {
        final PluginCall call;
        final int generation;
        final String text;
        final String language;
        final float rate;
        final float pitch;

        PendingSpeech(
            PluginCall call,
            int generation,
            String text,
            String language,
            float rate,
            float pitch
        ) {
            this.call = call;
            this.generation = generation;
            this.text = text;
            this.language = language;
            this.rate = rate;
            this.pitch = pitch;
        }
    }

    private static final class PendingStatus {
        final PluginCall call;
        final int initializationToken;

        PendingStatus(PluginCall call, int initializationToken) {
            this.call = call;
            this.initializationToken = initializationToken;
        }
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "").trim();
        if (text.isEmpty()) {
            call.reject("TTS text must not be empty");
            return;
        }

        synchronized (this) {
            if (engineState == EngineState.DESTROYED) {
                call.reject("Android System TTS is no longer available");
                return;
            }

            speechGeneration += 1;
            resolveActiveCall();
            pendingSpeech = new PendingSpeech(
                call,
                speechGeneration,
                text,
                call.getString("language", "en-US"),
                clamp(call.getFloat("rate", 1.0f), 0.1f, 2.0f),
                clamp(call.getFloat("pitch", 1.0f), 0.1f, 2.0f)
            );
            activeCall = call;
        }

        mainHandler.post(this::ensureEngineAndSpeak);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        synchronized (this) {
            speechGeneration += 1;
            pendingSpeech = null;
        }

        mainHandler.post(() -> {
            TextToSpeech currentEngine;
            synchronized (SystemTTSPlugin.this) {
                currentEngine = engine;
            }
            if (currentEngine != null) {
                currentEngine.stop();
            }
            synchronized (SystemTTSPlugin.this) {
                // Deliberate stop resolves the active speak Promise by contract.
                resolveActiveCall();
            }
            call.resolve();
        });
    }

    /**
     * 设置页「本机能力」读取:TTS 引擎、已装引擎列表、英语语音包是否可用。
     * 与 speak 共用同一个引擎初始化流程,初始化完成后立即回填结果。
     */
    @PluginMethod
    public void status(PluginCall call) {
        synchronized (this) {
            if (engineState == EngineState.DESTROYED) {
                call.reject("Android System TTS is no longer available");
                return;
            }
            if (engineState == EngineState.READY && engine != null) {
                resolveStatusNow(call);
                return;
            }
            if (engineState == EngineState.INITIALIZING) {
                pendingStatus = new PendingStatus(call, engineToken);
                return;
            }
            engineState = EngineState.INITIALIZING;
            engineToken += 1;
            pendingStatus = new PendingStatus(call, engineToken);
            initializeEngine(engineToken);
        }
    }

    private void ensureEngineAndSpeak() {
        synchronized (this) {
            if (engineState == EngineState.DESTROYED) {
                rejectActiveCall("Android System TTS is no longer available");
                rejectPendingStatus("Android System TTS is no longer available");
                return;
            }
            if (engineState == EngineState.READY && engine != null) {
                speakPending();
                return;
            }
            if (engineState == EngineState.INITIALIZING) {
                return;
            }

            engineState = EngineState.INITIALIZING;
            engineToken += 1;
            initializeEngine(engineToken);
        }
    }

    private void initializeEngine(int initializationToken) {
        try {
            TextToSpeech createdEngine = new TextToSpeech(
                getContext(),
                status -> mainHandler.post(
                    () -> handleEngineInitialized(initializationToken, status)
                )
            );
            synchronized (this) {
                if (
                    engineState == EngineState.DESTROYED ||
                    initializationToken != engineToken
                ) {
                    createdEngine.shutdown();
                    return;
                }
                engine = createdEngine;
            }
        } catch (RuntimeException error) {
            synchronized (this) {
                if (initializationToken == engineToken) {
                    engineState = EngineState.IDLE;
                    engine = null;
                    rejectActiveCall("Android System TTS could not be initialized");
                    rejectPendingStatus("Android System TTS could not be initialized");
                }
            }
        }
    }

    private void handleEngineInitialized(int initializationToken, int status) {
        TextToSpeech initializedEngine;
        synchronized (this) {
            if (
                engineState == EngineState.DESTROYED ||
                initializationToken != engineToken
            ) {
                return;
            }
            initializedEngine = engine;
            if (initializedEngine == null || status != TextToSpeech.SUCCESS) {
                engine = null;
                engineState = EngineState.IDLE;
                rejectActiveCall("Android System TTS could not be initialized");
                rejectPendingStatus("Android System TTS could not be initialized");
            } else {
                engineState = EngineState.READY;
            }
        }

        if (initializedEngine == null) {
            return;
        }
        if (status != TextToSpeech.SUCCESS) {
            initializedEngine.shutdown();
            return;
        }

        initializedEngine.setOnUtteranceProgressListener(
            new UtteranceProgressListener() {
                @Override
                public void onStart(String utteranceId) {}

                @Override
                public void onDone(String utteranceId) {
                    dispatchUtteranceResult(utteranceId, null);
                }

                @Override
                @SuppressWarnings("deprecation")
                public void onError(String utteranceId) {
                    dispatchUtteranceResult(
                        utteranceId,
                        "Android System TTS playback failed"
                    );
                }

                @Override
                public void onError(String utteranceId, int errorCode) {
                    dispatchUtteranceResult(
                        utteranceId,
                        "Android System TTS playback failed (" + errorCode + ")"
                    );
                }

                @Override
                public void onStop(String utteranceId, boolean interrupted) {
                    dispatchUtteranceResult(
                        utteranceId,
                        interrupted
                            ? "Android System TTS playback was interrupted"
                            : null
                    );
                }
            }
        );
        speakPending();
        resolveStatusPending(null);
    }

    /** 主线程读取当前引擎信息并回填 status() 调用。 */
    private void resolveStatusNow(PluginCall call) {
        TextToSpeech currentEngine;
        synchronized (this) {
            currentEngine = engine;
        }
        if (currentEngine == null) {
            call.reject("Android System TTS is not initialized");
            return;
        }

        JSObject result = new JSObject();
        result.put("available", true);
        result.put("engine", currentEngine.getDefaultEngine());

        JSArray enginesArray = new JSArray();
        for (TextToSpeech.EngineInfo info : currentEngine.getEngines()) {
            JSObject entry = new JSObject();
            entry.put("name", info.name);
            entry.put("label", info.label);
            enginesArray.put(entry);
        }
        result.put("engines", enginesArray);

        // 英语语音包:先看 setLanguage(en-US) 的结果,再看已加载的 voices
        int languageResult = currentEngine.setLanguage(Locale.US);
        boolean englishAvailable =
            languageResult != TextToSpeech.LANG_MISSING_DATA &&
            languageResult != TextToSpeech.LANG_NOT_SUPPORTED;
        if (!englishAvailable) {
            for (android.speech.tts.Voice voice : currentEngine.getVoices()) {
                Locale voiceLocale = voice.getLocale();
                if (
                    voiceLocale != null &&
                    "en".equalsIgnoreCase(voiceLocale.getLanguage())
                ) {
                    englishAvailable = true;
                    break;
                }
            }
        }
        result.put("englishAvailable", englishAvailable);
        call.resolve(result);
    }

    private synchronized void resolveStatusPending(String error) {
        PendingStatus pending = pendingStatus;
        pendingStatus = null;
        if (pending == null) {
            return;
        }
        if (error == null) {
            resolveStatusNow(pending.call);
        } else {
            pending.call.reject(error);
        }
    }

    private synchronized void rejectPendingStatus(String message) {
        PendingStatus pending = pendingStatus;
        pendingStatus = null;
        if (pending != null) {
            pending.call.reject(message);
        }
    }

    private void speakPending() {
        PendingSpeech request;
        TextToSpeech readyEngine;
        synchronized (this) {
            request = pendingSpeech;
            readyEngine = engine;
            if (
                request == null ||
                request.generation != speechGeneration ||
                engineState != EngineState.READY ||
                readyEngine == null
            ) {
                return;
            }
            pendingSpeech = null;
        }

        try {
            Locale locale = Locale.forLanguageTag(request.language);
            int languageResult = readyEngine.setLanguage(locale);
            if (
                languageResult == TextToSpeech.LANG_MISSING_DATA ||
                languageResult == TextToSpeech.LANG_NOT_SUPPORTED
            ) {
                synchronized (this) {
                    rejectActiveCall(
                        "The requested System TTS language is unavailable"
                    );
                }
                return;
            }

            readyEngine.setSpeechRate(request.rate);
            readyEngine.setPitch(request.pitch);
            String utteranceId = "system-tts-" + request.generation;
            synchronized (this) {
                activeUtteranceId = utteranceId;
            }

            int result = readyEngine.speak(
                request.text,
                TextToSpeech.QUEUE_FLUSH,
                null,
                utteranceId
            );
            if (result == TextToSpeech.ERROR) {
                dispatchUtteranceResult(
                    utteranceId,
                    "Android System TTS rejected playback"
                );
            }
        } catch (RuntimeException error) {
            synchronized (this) {
                rejectActiveCall("Android System TTS playback failed");
            }
        }
    }

    private void dispatchUtteranceResult(String utteranceId, String error) {
        // TTS callbacks may arrive on binder threads. Capacitor calls are completed
        // on the main thread so WebView message delivery never depends on vendor
        // callback threading behaviour.
        mainHandler.post(() -> finishUtterance(utteranceId, error));
    }

    private synchronized void finishUtterance(String utteranceId, String error) {
        if (!utteranceId.equals(activeUtteranceId)) {
            return;
        }

        PluginCall call = activeCall;
        activeCall = null;
        activeUtteranceId = null;
        if (call == null) {
            return;
        }
        if (error == null) {
            call.resolve();
        } else {
            call.reject(error);
        }
    }

    private synchronized void resolveActiveCall() {
        PluginCall call = activeCall;
        activeCall = null;
        activeUtteranceId = null;
        if (call != null) {
            call.resolve();
        }
    }

    private synchronized void rejectActiveCall(String message) {
        pendingSpeech = null;
        PluginCall call = activeCall;
        activeCall = null;
        activeUtteranceId = null;
        if (call != null) {
            call.reject(message);
        }
    }

    private static float clamp(float value, float minimum, float maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }

    @Override
    protected void handleOnDestroy() {
        TextToSpeech engineToDestroy;
        synchronized (this) {
            speechGeneration += 1;
            engineToken += 1;
            pendingSpeech = null;
            rejectActiveCall("Android System TTS was destroyed");
            rejectPendingStatus("Android System TTS was destroyed");
            engineState = EngineState.DESTROYED;
            engineToDestroy = engine;
            engine = null;
        }
        if (engineToDestroy != null) {
            engineToDestroy.stop();
            engineToDestroy.shutdown();
        }
        super.handleOnDestroy();
    }
}
