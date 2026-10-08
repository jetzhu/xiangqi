// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LogInPage, authErrorText, safeNext, usernameFormatProblem } from "../src/account/AuthPages.js";
import { AccountProvider, sessionKey } from "../src/account/session.js";
import { SiteNav } from "../src/SiteNav.js";
import { SettingsProvider } from "../src/settings.js";

const CONFIG = { url: "https://abcd.supabase.co", key: "sb_publishable_test" };
const USER = { id: "u1", email: "a@example.com", user_metadata: { username: "meta-name" } };

// A stand-in for the bits of supabase-js the site uses.
const fake = {
  session: null as null | { user: typeof USER },
  createClient: vi.fn(),
  signOut: vi.fn(async () => {
    fake.session = null;
    return { error: null };
  }),
  signInWithPassword: vi.fn(async (_: { email: string; password: string }) => ({ error: { code: "invalid_credentials", message: "Invalid login credentials" } as { code: string; message: string } | null })),
};
vi.mock("@supabase/supabase-js", () => ({
  createClient: (...args: unknown[]) => {
    fake.createClient(...args);
    return {
      auth: {
        getSession: async () => ({ data: { session: fake.session } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
        signOut: fake.signOut,
        signInWithPassword: fake.signInWithPassword,
      },
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { username: "Alice_1" } }) }) }) }),
    };
  },
}));

const renderNav = (config: typeof CONFIG | null) =>
  render(
    <SettingsProvider lang="en">
      <AccountProvider config={config}>
        <SiteNav current="home" />
      </AccountProvider>
    </SettingsProvider>,
  );

beforeEach(() => {
  localStorage.clear();
  fake.session = null;
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("account rules shared with the database", () => {
  it("checks usernames as the database does", () => {
    expect(usernameFormatProblem("Alice_1")).toBeNull();
    expect(usernameFormatProblem("a-b")).toBeNull();
    expect(usernameFormatProblem("ab")).toBe("format");
    expect(usernameFormatProblem("_ab")).toBe("format");
    expect(usernameFormatProblem("ab-")).toBe("format");
    expect(usernameFormatProblem("a".repeat(21))).toBe("format");
    expect(usernameFormatProblem("中文名")).toBe("format");
    expect(usernameFormatProblem("2024")).toBe("digits");
  });

  it("returns only to pages on this site after logging in", () => {
    expect(safeNext("/bots/")).toBe("/bots/");
    expect(safeNext("/analysis?moves=h2e2")).toBe("/analysis?moves=h2e2");
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext("/\\evil.example")).toBe("/");
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext(null)).toBe("/");
  });

  it("explains auth errors in both languages", () => {
    const en = (a: string) => a;
    const zh = (_: string, b: string) => b;
    expect(authErrorText({ code: "invalid_credentials" }, en)).toBe("Wrong email or password.");
    expect(authErrorText({ code: "invalid_credentials" }, zh)).toBe("邮箱或密码不正确。");
    expect(authErrorText({ message: "Failed to fetch" }, en)).toMatch(/Can't reach the server/);
    expect(authErrorText({ code: "something_new" }, en)).toMatch(/Something went wrong/);
  });
});

describe("header account menu", () => {
  it("shows nothing about accounts when they are off", () => {
    renderNav(null);
    expect(screen.queryByText("Log in")).toBeNull();
    expect(screen.getByText("My stats")).toBeTruthy();
  });

  it("offers Log in and Sign up to guests without loading Supabase", async () => {
    renderNav(CONFIG);
    expect(await screen.findByText("Log in")).toBeTruthy();
    expect(screen.getByText("Sign up")).toBeTruthy();
    expect(fake.createClient).not.toHaveBeenCalled();
  });

  it("shows the signed-in player's menu, and signs out on this device", async () => {
    localStorage.setItem(sessionKey(CONFIG.url), "{}");
    fake.session = { user: USER };
    renderNav(CONFIG);
    const button = await screen.findByRole("button", { name: /Alice_1/ });
    // My stats and Settings move into the menu.
    expect(screen.queryByText("My stats")).toBeNull();
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("a@example.com")).toBeTruthy();
    expect(screen.getByText("Game history")).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Sign out" })));
    expect(fake.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(await screen.findByText("Log in")).toBeTruthy();
  });

  it("falls back to guest when the stored session has expired", async () => {
    localStorage.setItem(sessionKey(CONFIG.url), "{}");
    renderNav(CONFIG);
    expect(await screen.findByText("Log in")).toBeTruthy();
  });
});

describe("log in", () => {
  it("says when the email or password is wrong", async () => {
    render(
      <SettingsProvider lang="en">
        <AccountProvider config={CONFIG}>
          <LogInPage />
        </AccountProvider>
      </SettingsProvider>,
    );
    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: " a@example.com " } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Wrong email or password.");
    expect(fake.signInWithPassword).toHaveBeenCalledWith({ email: "a@example.com", password: "wrong-password" });
    await waitFor(() => expect((screen.getByRole("button", { name: "Log in" }) as HTMLButtonElement).disabled).toBe(false));
  });
});
