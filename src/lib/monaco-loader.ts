import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";

// Avoid CDN loader.js (blocked by Electron CSP: script-src 'self').
loader.config({ monaco });

