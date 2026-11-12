"use client";

import { useEffect, useState } from "react";
import { translateText } from "../utils/gameApi";

const japaneseCharacters = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/;
const translationCache = new Map();

function getTranslation(text) {
  if (!translationCache.has(text)) {
    const request = translateText(text).catch((error) => {
      translationCache.delete(text);
      throw error;
    });
    translationCache.set(text, request);
  }
  return translationCache.get(text);
}

export default function TranslatedText({ text }) {
  const [result, setResult] = useState({ text: "", translation: "", status: "idle" });
  const shouldTranslate = typeof text === "string" && japaneseCharacters.test(text);

  useEffect(() => {
    if (!shouldTranslate) return undefined;
    let active = true;
    setResult({ text, translation: "", status: "loading" });
    getTranslation(text)
      .then((translation) => {
        if (active) setResult({ text, translation, status: "complete" });
      })
      .catch(() => {
        if (active) setResult({ text, translation: "", status: "error" });
      });
    return () => {
      active = false;
    };
  }, [shouldTranslate, text]);

  if (typeof text !== "string") return null;
  if (!shouldTranslate) return <>{text}</>;

  const currentResult = result.text === text ? result : { status: "loading" };
  return (
    <span className="translated-text">
      {text}
      {currentResult.status === "complete" ? (
        <span className="translated-text-translation">{currentResult.translation}</span>
      ) : currentResult.status === "error" ? (
        <span className="translated-text-status" role="status">ဘာသာပြန်၍မရပါ</span>
      ) : (
        <span className="translated-text-status" role="status">ဘာသာပြန်နေသည်…</span>
      )}
    </span>
  );
}
