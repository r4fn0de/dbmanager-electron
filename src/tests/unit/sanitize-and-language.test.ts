import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// sanitizeErrorMessage — extracted test from handlers.ts
// ---------------------------------------------------------------------------

// Inline the function to test it without importing the full handlers module
// (which has heavy Electron/oRPC dependencies)
function sanitizeErrorMessage(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback;
  let msg = err.message;
  msg = msg.replace(
    /(?:postgresql|postgres|mysql|mariadb|clickhouse|redis):\/\/[^@\s]+@[\w.-]+:\d+/gi,
    "[CONNECTION_STRING]",
  );
  msg = msg.replace(/password\s*=\s*\S+/gi, "password=[REDACTED]");
  msg = msg.replace(/:\w+@/g, ":[REDACTED]@");
  return msg || fallback;
}

describe("sanitizeErrorMessage", () => {
  it("returns fallback for non-Error values", () => {
    expect(sanitizeErrorMessage("string error", "fallback")).toBe("fallback");
    expect(sanitizeErrorMessage(null, "fallback")).toBe("fallback");
    expect(sanitizeErrorMessage(undefined, "fallback")).toBe("fallback");
  });

  it("returns message unchanged when no credentials present", () => {
    const err = new Error("Connection refused");
    expect(sanitizeErrorMessage(err, "fallback")).toBe("Connection refused");
  });

  it("redacts postgresql connection strings", () => {
    const err = new Error(
      'connect ECONNREFUSED postgresql://admin:secret123@db.example.com:5432/mydb',
    );
    const result = sanitizeErrorMessage(err, "fallback");
    expect(result).not.toContain("secret123");
    expect(result).not.toContain("admin:");
    expect(result).toContain("[CONNECTION_STRING]");
  });

  it("redacts mysql connection strings", () => {
    const err = new Error(
      "Failed mysql://root:password@localhost:3306/testdb",
    );
    const result = sanitizeErrorMessage(err, "fallback");
    expect(result).not.toContain("password");
    expect(result).toContain("[CONNECTION_STRING]");
  });

  it("redacts password= patterns", () => {
    const err = new Error("FATAL: password=MyS3cret authentication failed");
    const result = sanitizeErrorMessage(err, "fallback");
    expect(result).not.toContain("MyS3cret");
    expect(result).toContain("password=[REDACTED]");
  });

  it("redacts :password@ patterns not caught by connection string regex", () => {
    const err = new Error("auth failed for user:pass@host");
    const result = sanitizeErrorMessage(err, "fallback");
    expect(result).not.toContain(":pass@");
    expect(result).toContain(":[REDACTED]@");
  });

  it("handles multiple credentials in one message", () => {
    const err = new Error(
      "postgres://u:p@h1:5432 and mysql://u2:p2@h2:3306 both failed",
    );
    const result = sanitizeErrorMessage(err, "fallback");
    expect(result).not.toContain(":p@");
    expect(result).not.toContain(":p2@");
  });
});

// ---------------------------------------------------------------------------
// language actions
// ---------------------------------------------------------------------------

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();

Object.defineProperty(window, "localStorage", { value: localStorageMock });

vi.mock("@/constants", () => ({
  LOCAL_STORAGE_KEYS: { LANGUAGE: "app-language", THEME: "app-theme" },
}));

import { setAppLanguage, updateAppLanguage } from "@/features/shell/actions/language";

describe("shell actions — language", () => {
  const mockI18n = {
    changeLanguage: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
  });

  it("setAppLanguage stores language and updates i18n + document", () => {
    setAppLanguage("pt-BR", mockI18n as any);
    expect(localStorageMock.setItem).toHaveBeenCalledWith("app-language", "pt-BR");
    expect(mockI18n.changeLanguage).toHaveBeenCalledWith("pt-BR");
    expect(document.documentElement.lang).toBe("pt-BR");
  });

  it("updateAppLanguage does nothing when no stored language", () => {
    updateAppLanguage(mockI18n as any);
    expect(mockI18n.changeLanguage).not.toHaveBeenCalled();
  });

  it("updateAppLanguage applies stored language", () => {
    localStorageMock.setItem("app-language", "en");
    updateAppLanguage(mockI18n as any);
    expect(mockI18n.changeLanguage).toHaveBeenCalledWith("en");
    expect(document.documentElement.lang).toBe("en");
  });
});
