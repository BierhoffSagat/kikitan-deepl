import { Recognizer } from "./recognizer";

import {
    info,
    error,
    debug
} from '@tauri-apps/plugin-log';

import translateDeepL, { DeepLApiPlan, DeepLError } from "../translators/deepl_translate";
import translateGoogle, { GoogleTranslateError } from "../translators/google_translate";
import { TranslationEngine, TranslationError } from "../translators/types";

type TranslationAttempt = {
    text: string;
    succeeded: boolean;
};

export class WebSpeech extends Recognizer {
    recognition: SpeechRecognition;
    no_translate: boolean = false;
    jp_omit_questionmark: boolean = false;
    callback: ((result: string[], final: boolean) => void) | null = null
    error_callback: ((error: TranslationError) => void) | null = null
    translation_engine: TranslationEngine = "deepl";
    api_plan: DeepLApiPlan = "free";
    send_source_on_error: boolean = false;

    constructor(language_src: string, language_target: string, translation_engine: TranslationEngine = "deepl", api_plan: DeepLApiPlan = "free", send_source_on_error: boolean = false, no_translate: boolean = false, jp_omit_questionmark: boolean = false) {
        super(language_src, language_target);

        this.recognition = new window.webkitSpeechRecognition();
        this.recognition.interimResults = true
        this.recognition.maxAlternatives = 1
        this.recognition.continuous = true
        this.recognition.lang = language_src;
        this.no_translate = no_translate;
        this.jp_omit_questionmark = jp_omit_questionmark
        this.translation_engine = translation_engine;
        this.api_plan = api_plan;
        this.send_source_on_error = send_source_on_error;
    }

    start() {
        this.running = true;
        try {
            this.recognition.start();

            info("[WEBSPEECH] Recognition started!")
        } catch (e) {
            error("[WEBSPEECH] Error starting recognition: " + e)
        }

        this.recognition.onend = () => {
            if (this.running) {
                setTimeout(() => {
                    try {
                        this.recognition.start();
                    } catch { /* empty */ }
                }, 500);
            }
        }

        this.recognition.onnomatch = () => {
            if (this.running) {
                setTimeout(() => {
                    try {
                        this.recognition.start();
                    } catch { /* empty */ }
                }, 500);
            }
        }

        this.recognition.onerror = (e) => {
            if (e.message.trim().length != 0) error("[WEBSPEECH] Error: " + e.message)

            if (this.running) {
                setTimeout(() => {
                    try {
                        this.recognition.start();
                    } catch { /* empty */ }
                }, 500);
            }
        }
    }

    stop() {
        this.running = false;
        this.recognition.stop();

        info("[WEBSPEECH] Recognition stopped!")
    }

    set_lang(language_src: string, language_target: string) {
        this.recognition.lang = language_src;

        if (language_target.trim().length != 0) {
            this.language_target = language_target

            debug(`[WEBSPEECH] Language target set to ${language_target}`)
        }

        debug(`[WEBSPEECH] Language source set to ${language_target}`)
        this.recognition.stop();

        debug("[WEBSPEECH] Restarting in 500ms...")
        setTimeout(() => {
            this.recognition.start();
        }, 500);
    }

    status(): boolean {
        return this.running;
    }

    private async translate(text: string): Promise<TranslationAttempt> {
        const startedAt = performance.now();
        const inputChars = Array.from(text).length;
        const engineName = this.translation_engine === "deepl" ? "DeepL" : "Google";
        info(
            `[TRANSLATION] ${engineName} request started (source=${this.language_src}, target=${this.language_target}, input_chars=${inputChars})`
        );

        try {
            const translation = this.translation_engine === "deepl"
                ? await translateDeepL(
                    text,
                    this.language_src,
                    this.language_target,
                    this.api_plan,
                )
                : await translateGoogle(
                    text,
                    this.language_src,
                    this.language_target,
                );
            const elapsedMs = Math.round(performance.now() - startedAt);
            info(
                `[TRANSLATION] ${engineName} request succeeded (elapsed_ms=${elapsedMs}, input_chars=${inputChars}, output_chars=${Array.from(translation).length})`
            );
            this.error_callback?.({
                engine: this.translation_engine,
                code: "",
                message: "",
            });
            return {
                text: translation,
                succeeded: true,
            };
        } catch (e) {
            const translationError = e as DeepLError | GoogleTranslateError;
            const elapsedMs = Math.round(performance.now() - startedAt);
            error(
                `[TRANSLATION] ${engineName} request failed (code=${translationError.code ?? "unknown"}, status=${translationError.status ?? "none"}, elapsed_ms=${elapsedMs}, input_chars=${inputChars})`
            );
            this.error_callback?.({
                engine: this.translation_engine,
                code: translationError.code ?? "translation_failed",
                message: translationError.message ?? `${engineName} translation failed.`,
                status: translationError.status,
            });
            return {
                text: this.send_source_on_error ? text : "",
                succeeded: false,
            };
        }
    }

    onResult(callback: (result: string[], final: boolean) => void) {
        this.callback = callback

        this.recognition.onresult = async (event) => {
            if (event.results.length > 0) {
                let transcript = event.results[event.results.length - 1][0].transcript.trim()
                const isFinal = event.results[event.results.length - 1].isFinal
                
                if (this.language_src == "ja" && this.jp_omit_questionmark) {
                    transcript = transcript.replace("？", "")
                }

                const result = [transcript, ""]

                
                callback(result, false);

                if (isFinal && !this.no_translate) {
                    const translation = await this.translate(transcript);
                    result[1] = translation.text;
                    result[2] = translation.succeeded ? "translated" : "fallback";
                    callback(result, isFinal);
                } else {
                    callback(result, isFinal && this.no_translate);
                }
            }
        }
    }

    name(): string {
        return "WebSpeech";
    }

    async manual_trigger(data: string) {
        const result = [data, ""];
        if (!this.no_translate) {
            const translation = await this.translate(data);
            result[1] = translation.text;
            result[2] = translation.succeeded ? "translated" : "fallback";
        }

        this.callback?.(result, true);
    }

    onError(callback: (error: TranslationError) => void) {
        this.error_callback = callback;
    }
}
